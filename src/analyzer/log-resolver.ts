/**
 * Resolves JSONL log file paths for a team's agents.
 *
 * Priority:
 *   1. Recorded paths from spawner (agent-logs.json) — most accurate
 *   2. Auto-detect from CLI-native log locations — fallback
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface AgentLogConfig {
  name: string;
  cli: string;
  cwd: string;
}

export interface ResolvedLog {
  agent: string;
  cli: string;
  path: string;
  mtime: number;
  source: 'recorded' | 'auto-detected';
}

/**
 * Find JSONL log files for each agent in a team.
 * First checks spawner-recorded paths, then falls back to auto-detection.
 */
export function resolveTeamLogs(agents: AgentLogConfig[], teamName?: string): ResolvedLog[] {
  const recorded = teamName ? loadRecordedLogs(teamName) : {};
  const results: ResolvedLog[] = [];

  for (const agent of agents) {
    // Try recorded path first
    const rec = recorded[agent.name];
    if (rec?.path && existsSync(rec.path)) {
      try {
        results.push({
          agent: agent.name,
          cli: rec.cli || agent.cli,
          path: rec.path,
          mtime: statSync(rec.path).mtimeMs,
          source: 'recorded',
        });
        continue;
      } catch {
        // fall through to auto-detect
      }
    }

    // Fall back to auto-detection
    const logs = agent.cli === 'codex'
      ? findCodexLogs(agent)
      : findClaudeLogs(agent);
    results.push(...logs);
  }

  return results.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Load spawner-recorded log paths from ~/.vibehq/teams/<team>/agent-logs.json
 */
function loadRecordedLogs(teamName: string): Record<string, { path: string; cli: string; updatedAt: string }> {
  const logsFile = join(homedir(), '.vibehq', 'teams', teamName, 'agent-logs.json');
  try {
    if (existsSync(logsFile)) {
      return JSON.parse(readFileSync(logsFile, 'utf-8'));
    }
  } catch {
    // corrupted or missing
  }
  return {};
}

function findClaudeLogs(agent: AgentLogConfig): ResolvedLog[] {
  const encodedPath = agent.cwd.replace(/[\\\\//:]/g, '-');
  const projectDir = join(homedir(), '.claude', 'projects', encodedPath);

  if (!existsSync(projectDir)) return [];

  try {
    return readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const fullPath = join(projectDir, f);
        return {
          agent: agent.name,
          cli: 'claude' as const,
          path: fullPath,
          mtime: statSync(fullPath).mtimeMs,
          source: 'auto-detected' as const,
        };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 1);
  } catch {
    return [];
  }
}

function findCodexLogs(agent: AgentLogConfig): ResolvedLog[] {
  const sessionsDir = join(homedir(), '.codex', 'sessions');
  if (!existsSync(sessionsDir)) return [];

  try {
    const years = readdirSync(sessionsDir).filter(f => /^\d{4}$/.test(f)).sort().reverse();
    for (const year of years) {
      const yearDir = join(sessionsDir, year);
      const months = readdirSync(yearDir).filter(f => /^\d{2}$/.test(f)).sort().reverse();
      for (const month of months) {
        const monthDir = join(yearDir, month);
        const days = readdirSync(monthDir).filter(f => /^\d{2}$/.test(f)).sort().reverse();
        for (const day of days) {
          const dayDir = join(monthDir, day);
          const files = readdirSync(dayDir)
            .filter(f => f.startsWith('rollout-') && f.endsWith('.jsonl'))
            .map(f => {
              const fullPath = join(dayDir, f);
              return {
                agent: agent.name,
                cli: 'codex' as const,
                path: fullPath,
                mtime: statSync(fullPath).mtimeMs,
                source: 'auto-detected' as const,
              };
            })
            .sort((a, b) => b.mtime - a.mtime);
          if (files.length > 0) return files.slice(0, 1);
        }
      }
    }
  } catch {
    // directory structure might not exist
  }
  return [];
}

/**
 * Filter logs to only include those from a recent session window.
 */
export function filterSessionWindow(logs: ResolvedLog[], windowMs: number = 4 * 60 * 60 * 1000): ResolvedLog[] {
  if (logs.length === 0) return [];
  const newest = logs[0].mtime;
  return logs.filter(l => newest - l.mtime < windowMs);
}

import type { RunMetrics, DetectedFlags, DetectedFlag, Severity } from './types.js';

interface DetectionRule {
  ruleId: string;
  severity: Severity;
  description: string;
  detect: (metrics: RunMetrics) => Record<string, unknown>[];
}

const RULES: DetectionRule[] = [
  // ─── Coordination Issues ───
  {
    ruleId: 'STUB_FILE',
    severity: 'high',
    description: 'Agent published placeholder/stub instead of full content',
    detect: (m) => {
      const results: Record<string, unknown>[] = [];
      for (const a of m.artifacts) {
        // Case 1: multiple attempts where first was tiny but final is large
        if (a.publishAttempts > 1 && a.firstAttemptSize < 500 && a.finalSize > 500) {
          results.push({
            agent: a.producer,
            artifact: a.filename,
            firstAttemptBytes: a.firstAttemptSize,
            finalBytes: a.finalSize,
            attempts: a.publishAttempts,
            resolved: true,
          });
        }
        // Case 2: final artifact is still suspiciously small for its file type
        const isContentFile = /\.(html|json|md|csv|js|ts|css)$/i.test(a.filename);
        if (isContentFile && a.finalSize < 500 && a.finalSize > 0) {
          results.push({
            agent: a.producer,
            artifact: a.filename,
            firstAttemptBytes: a.firstAttemptSize,
            finalBytes: a.finalSize,
            attempts: a.publishAttempts,
            resolved: false,
          });
        }
      }
      return results;
    },
  },
  {
    ruleId: 'ORCHESTRATOR_ROLE_DRIFT',
    severity: 'critical',
    description: 'Orchestrator used implementation tools (Write/Edit/Bash/shell_command)',
    detect: (m) => m.agents
      .filter(a => a.agentRole === 'orchestrator' && a.implementationToolUsed)
      .map(a => ({
        agent: a.agentId,
        implTools: Object.entries(a.nativeToolCalls)
          .filter(([name]) => ['Write', 'Edit', 'Bash', 'shell_command'].includes(name))
          .map(([name, count]) => ({ name, count })),
      })),
  },
  {
    ruleId: 'PREMATURE_TASK_ACCEPT',
    severity: 'medium', // base severity, overridden per-detail below
    description: 'Agent accepted task within 10 seconds of creation',
    detect: (m) => m.tasks
      .filter(t => t.stateTransitions.some(
        tr => tr.from === 'created' && tr.to === 'accepted' && tr.durationSec < 10
      ))
      .map(t => {
        // Check if task had "QUEUED" or dependency indicators
        const hasDepIndicator = t.description.toLowerCase().includes('queued')
          || t.description.toLowerCase().includes('waiting for')
          || t.description.toLowerCase().includes('depends on')
          || t.description.toLowerCase().includes('after');
        return {
          taskId: t.taskId,
          description: t.description.substring(0, 80),
          acceptDelaySec: t.stateTransitions.find(
            tr => tr.from === 'created' && tr.to === 'accepted'
          )?.durationSec,
          severity: hasDepIndicator ? 'high' : 'info',
        };
      }),
  },
  {
    ruleId: 'TASK_TIMEOUT',
    severity: 'high',
    description: 'Task took longer than 15 minutes to complete',
    detect: (m) => m.tasks
      .filter(t => t.totalDurationSec > 900)
      .map(t => ({
        taskId: t.taskId,
        description: t.description.substring(0, 80),
        durationMin: Math.round(t.totalDurationSec / 60),
      })),
  },
  {
    ruleId: 'INCOMPLETE_TASK',
    severity: 'high',
    description: 'Task was never completed (no "done" transition)',
    detect: (m) => m.tasks
      .filter(t => !t.stateTransitions.some(tr => tr.to === 'done'))
      .map(t => ({
        taskId: t.taskId,
        description: t.description.substring(0, 80),
        lastState: t.stateTransitions[t.stateTransitions.length - 1]?.to || 'unknown',
      })),
  },

  // ─── Token Efficiency Issues ───
  {
    ruleId: 'CONTEXT_BLOAT',
    severity: 'medium',
    description: 'Agent context grew more than 5x during session',
    detect: (m) => m.agents
      .filter(a => a.contextGrowth.bloatRatio > 5.0)
      .map(a => ({
        agent: a.agentId,
        firstContext: a.contextGrowth.firstTurnContextSize,
        lastContext: a.contextGrowth.lastTurnContextSize,
        bloatRatio: a.contextGrowth.bloatRatio,
      })),
  },
  {
    ruleId: 'HIGH_COORDINATION_OVERHEAD',
    severity: 'high',
    description: 'Orchestrator consumed more than 30% of total output tokens',
    detect: (m) => {
      const totalOutput = m.tokenSummary.totalOutputTokens;
      if (totalOutput === 0) return [];
      return m.agents
        .filter(a => a.agentRole === 'orchestrator')
        .filter(a => (a.tokens.outputTokens / totalOutput) > 0.30)
        .map(a => ({
          agent: a.agentId,
          outputTokens: a.tokens.outputTokens,
          totalOutputTokens: totalOutput,
          ratio: Math.round((a.tokens.outputTokens / totalOutput) * 100) / 100,
        }));
    },
  },
  {
    ruleId: 'DUPLICATE_ARTIFACT',
    severity: 'medium',
    description: 'Multiple agents produced artifacts with the same filename',
    detect: (m) => {
      const byFile = new Map<string, string[]>();
      for (const a of m.artifacts) {
        const list = byFile.get(a.filename) || [];
        list.push(a.producer);
        byFile.set(a.filename, list);
      }
      return [...byFile.entries()]
        .filter(([, producers]) => new Set(producers).size > 1)
        .map(([filename, producers]) => ({ filename, producers: [...new Set(producers)] }));
    },
  },

  {
    ruleId: 'AGENT_UNRESPONSIVE',
    severity: 'high',
    description: 'Agent never responded or was flagged as unresponsive',
    detect: (m) => {
      const results: Record<string, unknown>[] = [];
      // Check for agents mentioned as task assignees but not present in agent list
      // (they were in the team config but never connected)
      const activeAgents = new Set(m.agents.map(a => a.agentId.toLowerCase()));
      const assigneeCounts = new Map<string, number>();
      for (const t of m.tasks) {
        const a = (t.assignee || '').toLowerCase();
        if (a) assigneeCounts.set(a, (assigneeCounts.get(a) || 0) + 1);
      }
      for (const [assignee, count] of assigneeCounts) {
        if (!activeAgents.has(assignee)) {
          results.push({
            agent: assignee,
            reason: 'never_connected',
            tasksAssigned: count,
          });
        }
      }
      // Also check for workers with assigned tasks but 0 completed tasks
      for (const agent of m.agents) {
        if (agent.agentRole !== 'worker') continue;
        const assigned = m.tasks.filter(t => t.assignee.toLowerCase() === agent.agentId.toLowerCase());
        const completed = assigned.filter(t => t.stateTransitions.some(tr => tr.to === 'done'));
        if (assigned.length > 0 && completed.length === 0 && agent.turns < 5) {
          results.push({
            agent: agent.agentId,
            reason: 'no_tasks_completed',
            tasksAssigned: assigned.length,
            turns: agent.turns,
          });
        }
      }
      return results;
    },
  },
  {
    ruleId: 'TASK_REASSIGNED',
    severity: 'info',
    description: 'Task was reassigned to a different agent (fallback)',
    detect: (m) => {
      // Look for tasks where orchestrator mentioned "fallback" in description
      // or tasks with very similar descriptions assigned to different agents
      const byDesc = new Map<string, { taskId: string; assignee: string }[]>();
      for (const t of m.tasks) {
        const key = t.description.substring(0, 30).toLowerCase();
        if (!key) continue;
        const list = byDesc.get(key) || [];
        list.push({ taskId: t.taskId, assignee: t.assignee });
        byDesc.set(key, list);
      }
      return [...byDesc.entries()]
        .filter(([, tasks]) => {
          const agents = new Set(tasks.map(t => t.assignee.toLowerCase()).filter(Boolean));
          return agents.size > 1;
        })
        .map(([desc, tasks]) => ({
          description: desc,
          assignments: tasks,
        }));
    },
  },

  // ─── Regression Issues ───
  {
    ruleId: 'ARTIFACT_REGRESSION',
    severity: 'critical',
    description: 'Agent artifact size decreased significantly between attempts (content regression)',
    detect: (m) => m.artifacts
      .filter(a => a.publishAttempts > 1 && a.firstAttemptSize > 300 && a.finalSize < a.firstAttemptSize * 0.1)
      .map(a => ({
        agent: a.producer,
        artifact: a.filename,
        firstAttemptBytes: a.firstAttemptSize,
        finalBytes: a.finalSize,
        attempts: a.publishAttempts,
        regressionRatio: Math.round((a.finalSize / a.firstAttemptSize) * 1000) / 1000,
      })),
  },

  // ─── Quality Issues ───
  {
    ruleId: 'NO_ARTIFACTS_PRODUCED',
    severity: 'high',
    description: 'Worker agent produced zero artifacts',
    detect: (m) => {
      const producerSet = new Set(m.artifacts.map(a => a.producer));
      return m.agents
        .filter(a => a.agentRole === 'worker' && !producerSet.has(a.agentId))
        .map(a => ({ agent: a.agentId, turns: a.turns }));
    },
  },
  {
    ruleId: 'EXCESSIVE_MCP_POLLING',
    severity: 'low',
    description: 'Agent called check_status or list_tasks excessively (hub sends proactive notifications — polling should be minimal)',
    detect: (m) => m.agents
      .filter(a => {
        const polling = (a.mcpToolCalls['check_status'] || 0)
          + (a.mcpToolCalls['list_tasks'] || 0)
          + (a.mcpToolCalls['list_teammates'] || 0);
        return polling > 15;
      })
      .map(a => ({
        agent: a.agentId,
        checkStatus: a.mcpToolCalls['check_status'] || 0,
        listTasks: a.mcpToolCalls['list_tasks'] || 0,
        listTeammates: a.mcpToolCalls['list_teammates'] || 0,
      })),
  },
];

export function detectPatterns(metrics: RunMetrics): DetectedFlags {
  const flags: DetectedFlag[] = [];
  const summary: Record<Severity, number> & { total: number } = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    total: 0,
  };

  for (const rule of RULES) {
    const details = rule.detect(metrics);
    const flag: DetectedFlag = {
      ruleId: rule.ruleId,
      severity: rule.severity,
      description: rule.description,
      count: details.length,
      details,
    };
    flags.push(flag);
    if (details.length > 0) {
      for (const detail of details) {
        // Use per-detail severity if present, otherwise fall back to rule severity
        const effectiveSeverity = (detail.severity as Severity) || rule.severity;
        summary[effectiveSeverity] += 1;
        summary.total += 1;
      }
    }
  }

  return { flags, summary };
}

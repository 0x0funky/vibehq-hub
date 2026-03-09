// ============================================================
// CLI Entry: vibehq — Interactive TUI
// ============================================================

import { startHub } from '../src/hub/server.js';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { exec } from 'child_process';
import { createServer } from 'net';
import { tmpdir } from 'os';
import type { WebSocketServer } from 'ws';
import { c, screen, cursor } from '../src/tui/renderer.js';
import { welcomeScreen } from '../src/tui/screens/welcome.js';
import { createTeamScreen } from '../src/tui/screens/create-team.js';
import { DashboardScreen } from '../src/tui/screens/dashboard.js';
import { settingsScreen } from '../src/tui/screens/settings.js';
import { getPresetByRole } from '../src/tui/role-presets.js';
import { selectMenu } from '../src/tui/menu.js';
import { prompt } from '../src/tui/input.js';
import { resolveTeamLogs } from '../src/analyzer/log-resolver.js';
import {
    parseLogFile, extractMetrics, detectPatterns,
    formatReport, saveRun, formatReportCard,
    runLlmAnalysis, shouldTriggerLlm, saveReportCard,
} from '../src/analyzer/index.js';

// --- Running hub tracker ---
let runningHub: { wss: WebSocketServer; port: number } | null = null;
// Track spawned agent names for killing
let spawnedAgentNames: string[] = [];

async function stopHub(): Promise<void> {
    if (!runningHub) return;
    await new Promise<void>((resolve) => {
        runningHub!.wss.close(() => resolve());
        setTimeout(resolve, 1000);
    });
    runningHub = null;
}

function stopAgents(): void {
    if (spawnedAgentNames.length === 0) return;
    if (process.platform === 'win32') {
        // Kill vibehq-spawn processes matching each agent name
        for (const name of spawnedAgentNames) {
            exec(`wmic process where "commandline like '%vibehq-spawn%--name \"${name}\"%'" call terminate`, () => { });
        }
    } else {
        exec(`pkill -f 'vibehq-spawn'`, () => { });
    }
    spawnedAgentNames = [];
}

// --- Types ---
interface AgentConfig {
    name: string;
    role: string;
    cli: string;
    cwd: string;
    systemPrompt?: string;
    dangerouslySkipPermissions?: boolean;
    additionalDirs?: string[];
}

interface TeamConfig {
    name: string;
    hub: { port: number };
    agents: AgentConfig[];
}

/** New multi-team format */
interface VibehqMultiConfig {
    teams: TeamConfig[];
}

/** Legacy single-team format */
interface VibehqLegacyConfig {
    team: string;
    hub: { port: number };
    agents: AgentConfig[];
}

// --- Parse top-level args ---
function getCommand(): { command: string; configPath: string } {
    const args = process.argv.slice(2);
    let command = '';
    let configPath = 'vibehq.config.json';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--config' || args[i] === '-c') {
            configPath = args[++i];
        } else if (args[i] === '-h' || args[i] === '--help') {
            console.log(`
${c.bold}vibehq${c.reset} — Multi-Agent Team Manager

Usage:
  vibehq                          Interactive mode
  vibehq start [--config <path>]  Start team from config
  vibehq init                     Create example config
  vibehq dashboard                Connect to running hub

Options:
  -c, --config <path>    Config file (default: vibehq.config.json)
  -h, --help             Show help
`);
            process.exit(0);
        } else if (!command) {
            command = args[i];
        }
    }

    return { command, configPath };
}

// --- Load config (supports both legacy and multi-team format) ---
function loadTeams(configPath: string): TeamConfig[] | null {
    if (!existsSync(configPath)) return null;
    try {
        const raw = JSON.parse(readFileSync(configPath, 'utf-8'));

        // Multi-team format: { teams: [...] }
        if (raw.teams && Array.isArray(raw.teams)) {
            return raw.teams;
        }

        // Legacy single-team format: { team, hub, agents }
        if (raw.team && raw.agents) {
            return [{
                name: raw.team,
                hub: raw.hub,
                agents: raw.agents,
            }];
        }

        return null;
    } catch {
        return null;
    }
}

// --- Find available port (auto-scan, skips restricted/busy ports) ---
async function tryPort(port: number): Promise<'available' | 'inuse' | 'restricted'> {
    return new Promise((resolve) => {
        const server = createServer();
        server.once('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') resolve('inuse');
            else resolve('restricted');
        });
        server.once('listening', () => { server.close(); resolve('available'); });
        server.listen(port, '127.0.0.1');
    });
}

async function autoFindPort(startPort: number): Promise<number | null> {
    for (let port = startPort; port < startPort + 100; port++) {
        const status = await tryPort(port);
        if (status === 'available') return port;
        // 'inuse' or 'restricted' → keep scanning
    }
    return null;
}

// --- Select team ---
async function selectTeam(teams: TeamConfig[]): Promise<TeamConfig> {
    if (teams.length === 1) return teams[0];

    process.stdout.write(cursor.show);
    console.log('');

    const items = teams.map(t => ({
        label: t.name,
        description: `${t.agents.length} agent${t.agents.length !== 1 ? 's' : ''}, port ${t.hub.port}`,
        value: t.name,
    }));

    const choice = await selectMenu(items, '⚡ Select Team');
    return teams.find(t => t.name === choice)!;
}

// --- Detect available Linux terminal ---
function detectLinuxTerminal(): string | null {
    const terms = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm', 'alacritty', 'kitty'];
    for (const t of terms) {
        try { require('child_process').execSync(`which ${t} 2>/dev/null`); return t; } catch { }
    }
    return null;
}

// --- Spawn one agent in a new terminal window ---
function spawnOneAgent(agent: AgentConfig, team: TeamConfig, hubUrl: string): void {
    // Resolve system prompt: explicit > role preset > none
    const effectivePrompt = agent.systemPrompt || getPresetByRole(agent.role)?.defaultSystemPrompt || '';
    let sysPromptArg = '';
    if (effectivePrompt) {
        const tmpFile = `${tmpdir()}/vibehq-prompt-${agent.name.replace(/\s/g, '_')}-${Date.now()}.md`;
        writeFileSync(tmpFile, effectivePrompt);
        sysPromptArg = ` --system-prompt-file "${tmpFile}"`;
    }
    const skipPermsArg = agent.dangerouslySkipPermissions ? ' --skip-permissions' : '';
    const addDirsArg = agent.additionalDirs?.map(d => ` --add-dir "${d}"`).join('') || '';
    const spawnCmd = `vibehq-spawn --name "${agent.name}" --role "${agent.role}" --team "${team.name}" --hub "${hubUrl}"${sysPromptArg}${skipPermsArg}${addDirsArg} -- ${agent.cli}`;
    const safeCmd = spawnCmd.replace(/'/g, "'\\''");

    if (process.platform === 'win32') {
        // Windows Terminal
        const wtCmd = `wt -w new --title "${agent.name}" -d "${agent.cwd}" cmd /k "chcp 65001 >nul && ${spawnCmd}"`;
        exec(wtCmd);

    } else if (process.platform === 'darwin') {
        // Mac: create a temp launcher script to avoid quoting issues with osascript
        const launcherPath = `${tmpdir()}/vibehq-launch-${agent.name.replace(/\s/g, '_')}-${Date.now()}.sh`;
        writeFileSync(launcherPath, `#!/bin/bash\ncd '${agent.cwd.replace(/'/g, "'\\''")}'\n${safeCmd}\nexec bash\n`, { mode: 0o755 });

        // Escape for AppleScript double-quoted strings
        const asLauncher = launcherPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

        // Try iTerm2 first, then Terminal.app, then open command
        const iTermScript = `osascript -e '
            tell application "iTerm2"
                create window with default profile
                tell current session of current window
                    write text "bash \\"${asLauncher}\\""
                end tell
            end tell' 2>/dev/null`;
        const terminalScript = `osascript -e '
            tell application "Terminal"
                do script "bash \\"${asLauncher}\\""
                activate
            end tell' 2>/dev/null`;

        exec(iTermScript, (err) => {
            if (err) {
                exec(terminalScript, (err2) => {
                    if (err2) {
                        // Last resort: open Terminal.app with the script directly
                        exec(`open -a Terminal.app "${launcherPath}"`);
                    }
                });
            }
        });

    } else {
        // Linux: check if inside tmux session first
        if (process.env.TMUX) {
            // Already in tmux — open new window
            exec(`tmux new-window -n "${agent.name}" "cd '${agent.cwd}' && ${safeCmd}; exec $SHELL"`);
            return;
        }

        // Try to find a terminal emulator
        const linuxTerm = detectLinuxTerminal();
        if (linuxTerm === 'gnome-terminal') {
            exec(`gnome-terminal --title="${agent.name}" -- bash -c "cd '${agent.cwd}' && ${safeCmd}; exec bash"`);
        } else if (linuxTerm === 'konsole') {
            exec(`konsole --new-tab -p tabtitle="${agent.name}" -e bash -c "cd '${agent.cwd}' && ${safeCmd}; exec bash"`);
        } else if (linuxTerm === 'xfce4-terminal') {
            exec(`xfce4-terminal --title="${agent.name}" -e "bash -c 'cd \\"${agent.cwd}\\" && ${safeCmd}; exec bash'"`);
        } else if (linuxTerm === 'xterm') {
            exec(`xterm -title "${agent.name}" -e bash -c "cd '${agent.cwd}' && ${safeCmd}; exec bash" &`);
        } else if (linuxTerm) {
            exec(`${linuxTerm} --title "${agent.name}" -e "bash -c 'cd \\"${agent.cwd}\\" && ${safeCmd}; exec bash'" &`);
        } else {
            // No terminal found — suggest tmux and run in background
            console.log(`  ${c.yellow}⚠${c.reset} No terminal emulator found. Tip: run inside a tmux session for auto window management.`);
            console.log(`  ${c.dim}Starting ${agent.name} in background...${c.reset}`);
            exec(`bash -c "cd '${agent.cwd}' && ${safeCmd}" &`);
        }
    }
}

// --- Spawn agents (with staggered delay to prevent config write contention) ---
async function spawnAgents(team: TeamConfig): Promise<void> {
    const hubUrl = `ws://localhost:${team.hub.port}`;
    spawnedAgentNames = team.agents.map(a => a.name);

    for (let i = 0; i < team.agents.length; i++) {
        const agent = team.agents[i];
        spawnOneAgent(agent, team, hubUrl);
        console.log(`  ${c.green}↗${c.reset} ${c.bold}${agent.name}${c.reset} ${c.dim}(${agent.cli})${c.reset} → ${c.gray}${agent.cwd}${c.reset}`);
        // Wait between spawns to prevent MCP config write races
        if (i < team.agents.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }
}

// --- Start team flow ---
async function startTeam(configPath: string): Promise<void> {
    const teams = loadTeams(configPath);
    if (!teams || teams.length === 0) {
        console.log(`\n  ${c.yellow}⚠${c.reset} Config not found: ${c.bold}${configPath}${c.reset}`);
        console.log(`  ${c.dim}Run "vibehq create" or "vibehq init" first${c.reset}\n`);
        return;
    }

    // Select team if multiple
    const team = await selectTeam(teams);

    // Stop existing hub if running on a different port (or restart it)
    if (runningHub) {
        if (runningHub.port === team.hub.port) {
            // Same port — reuse, skip port check & startHub
            process.stdout.write(screen.clear);
            console.log(`\n  ${c.bold}${c.brightCyan}⚡ Team "${team.name}"${c.reset}  ${c.dim}(hub already running on port ${team.hub.port})${c.reset}\n`);
            console.log(`  ${c.bold}Spawning ${team.agents.length} agent${team.agents.length !== 1 ? 's' : ''}...${c.reset}\n`);
            await new Promise(r => setTimeout(r, 500));
            await spawnAgents(team);
            console.log(`\n  ${c.dim}Opening dashboard in 2s...${c.reset}\n`);
            await new Promise(r => setTimeout(r, 2000));
            await runDashboard({ team: team.name, hub: team.hub, agents: team.agents });
            return;
        }
        // Different port — close old hub
        console.log(`  ${c.dim}Stopping previous hub on port ${runningHub.port}...${c.reset}`);
        await stopHub();
        await new Promise(r => setTimeout(r, 500));
    }

    // Auto-find available port (scans upward, skips Windows-restricted ports)
    process.stdout.write(screen.clear);
    console.log(`\n  ${c.bold}${c.brightCyan}⚡ Starting team "${team.name}"${c.reset}\n`);
    console.log(`  ${c.dim}Scanning for available port from ${team.hub.port}...${c.reset}`);

    const actualPort = await autoFindPort(team.hub.port);
    if (actualPort === null) {
        console.log(`\n  ${c.yellow}⚠${c.reset} No available port found near ${team.hub.port}.`);
        console.log(`  ${c.dim}A hub may already be running. Use "Dashboard" to connect.${c.reset}\n`);
        await new Promise(r => setTimeout(r, 400));
        return;
    }

    if (actualPort !== team.hub.port) {
        console.log(`  ${c.yellow}→${c.reset} Port ${team.hub.port} restricted — using ${c.bold}${actualPort}${c.reset} instead`);
    }

    // Start Hub on the found port
    console.log(`  ${c.green}✓${c.reset} Hub started on port ${c.bold}${actualPort}${c.reset}`);
    const wss = startHub({ port: actualPort, verbose: false, team: team.name });
    runningHub = { wss, port: actualPort };

    // Spawn agents (pass actual hub port they should connect to)
    const teamWithActualPort = { ...team, hub: { port: actualPort } };
    console.log(`  ${c.bold}Spawning ${team.agents.length} agent${team.agents.length !== 1 ? 's' : ''}...${c.reset}\n`);
    await new Promise(r => setTimeout(r, 800));
    await spawnAgents(teamWithActualPort);

    // Launch dashboard
    console.log(`\n  ${c.dim}Opening dashboard in 3s... Press [q] to return to menu${c.reset}\n`);
    await new Promise(r => setTimeout(r, 3000));

    await runDashboard({
        team: team.name,
        hub: { port: actualPort },
        agents: team.agents,
    });
    // Hub stays running — reused if same team started again

}

// --- Run dashboard (returns when [q] pressed, kills agents) ---
async function runDashboard(dashConfig: { team: string; hub: { port: number }; agents: AgentConfig[] }): Promise<void> {
    const dashboard = new DashboardScreen(dashConfig);
    await dashboard.start();
    // [q] pressed — kill all spawned terminal windows
    stopAgents();
}

// --- Dashboard-only flow (without starting hub) ---
async function dashboardOnly(configPath: string): Promise<void> {
    const teams = loadTeams(configPath);
    let dashConfig: { team: string; hub: { port: number }; agents: AgentConfig[] };

    if (teams && teams.length > 0) {
        const team = await selectTeam(teams);
        // Use runningHub port if available (actual port after auto-scan)
        const port = runningHub?.port ?? team.hub.port;
        dashConfig = { team: team.name, hub: { port }, agents: team.agents };
    } else {
        const portStr = await prompt('Hub port', String(runningHub?.port ?? 3001));
        dashConfig = {
            team: 'default',
            hub: { port: parseInt(portStr, 10) || 3001 },
            agents: [],
        };
    }

    await runDashboard(dashConfig);
}

// --- Analyze team flow ---
async function analyzeTeam(configPath: string): Promise<void> {
    const teams = loadTeams(configPath);
    if (!teams || teams.length === 0) {
        console.log(`\n  ${c.yellow}!${c.reset} No teams found in ${c.bold}${configPath}${c.reset}\n`);
        await new Promise(r => setTimeout(r, 1500));
        return;
    }

    const team = await selectTeam(teams);
    process.stdout.write(screen.clear);
    console.log(`\n  ${c.bold}${c.brightCyan}Analyzing team "${team.name}"${c.reset}\n`);

    // Resolve log files for each agent
    console.log(`  ${c.dim}Scanning log locations for ${team.agents.length} agents...${c.reset}\n`);
    const allLogs = resolveTeamLogs(team.agents, team.name);

    if (allLogs.length === 0) {
        console.log(`  ${c.yellow}!${c.reset} No JSONL log files found for this team's agents.`);
        console.log(`  ${c.dim}Logs are auto-detected from:${c.reset}`);
        console.log(`  ${c.dim}  Claude: ~/.claude/projects/<encoded-cwd>/*.jsonl${c.reset}`);
        console.log(`  ${c.dim}  Codex:  ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl${c.reset}`);
        console.log('');
        // Show what paths were checked
        for (const agent of team.agents) {
            const label = agent.cli === 'codex' ? '~/.codex/sessions/' : `~/.claude/projects/${agent.cwd.replace(/[\\\\//:]/g, '-')}/`;
            console.log(`    ${c.dim}${agent.name} (${agent.cli}) -> ${label}${c.reset}`);
        }
        console.log('');
        await prompt('Press Enter to return', '');
        return;
    }

    // Show found logs with dates (no auto-filtering)
    console.log(`  Found ${c.bold}${allLogs.length}${c.reset} log file(s):\n`);
    for (const log of allLogs) {
        const date = new Date(log.mtime);
        const dateStr = date.toLocaleString();
        const sourceTag = log.source === 'recorded' ? `${c.green}recorded${c.reset}` : `${c.yellow}auto-detected${c.reset}`;
        console.log(`    ${c.green}+${c.reset} ${c.bold}${log.agent}${c.reset} ${c.dim}(${log.cli})${c.reset} [${sourceTag}] — ${dateStr}`);
        console.log(`      ${c.dim}${log.path}${c.reset}`);
    }
    console.log('');

    // Confirm before proceeding
    process.stdout.write(cursor.show);
    const proceed = await prompt('Analyze these logs? (y/n)', 'y');
    if (proceed.toLowerCase() !== 'y') return;

    // Parse all logs
    const events = allLogs.flatMap(l => parseLogFile(l.path));
    if (events.length === 0) {
        console.log(`  ${c.yellow}!${c.reset} No events found in log files.\n`);
        await prompt('Press Enter to return', '');
        return;
    }

    // Run analysis pipeline
    const metrics = extractMetrics(events, `${team.name}-${new Date().toISOString().slice(0, 10)}`);
    const flags = detectPatterns(metrics);

    // Display report
    console.log(formatReport(metrics, flags));

    // LLM analysis hint
    if (shouldTriggerLlm(flags)) {
        console.log(`\n  ${c.yellow}!${c.reset} High-severity flags detected.`);
    }

    // Post-report menu
    console.log('');
    process.stdout.write(cursor.show);
    const action = await selectMenu([
        { label: 'Save to history ', description: `~/.vibehq/analytics/runs/${metrics.runId}/`, value: 'save' },
        { label: 'Save + LLM     ', description: 'Save and run LLM deep analysis', value: 'save-llm' },
        { label: 'Back to menu   ', description: '', value: 'back' },
    ], 'Actions');

    if (action === 'save' || action === 'save-llm') {
        const rawPaths = allLogs.map(l => l.path);
        const runDir = saveRun(metrics, flags, rawPaths);
        console.log(`\n  ${c.green}+${c.reset} Saved to ${c.dim}${runDir}${c.reset}`);

        if (action === 'save-llm') {
            try {
                console.log(`  ${c.dim}Running LLM analysis...${c.reset}`);
                const reportCard = await runLlmAnalysis(metrics, flags, events);
                saveReportCard(metrics.runId, reportCard);
                console.log('');
                console.log(formatReportCard(reportCard));
                console.log(`\n  ${c.green}+${c.reset} Report card saved.`);
            } catch (e) {
                console.log(`\n  ${c.yellow}!${c.reset} LLM analysis failed: ${(e as Error).message}`);
            }
        }
    }

    console.log('');
    await prompt('Press Enter to return', '');
}

// --- Interactive mode ---
async function interactive(configPath: string): Promise<void> {
    while (true) {
        const choice = await welcomeScreen();

        switch (choice) {
            case 'start':
                await startTeam(configPath);
                // Returns here after [b] press in dashboard — loop back to menu
                break;

            case 'create': {
                process.stdout.write(cursor.show);
                const savedFile = await createTeamScreen();
                if (savedFile) {
                    const startNow = await prompt('Start team now? (y/n)', 'y');
                    if (startNow.toLowerCase() === 'y') {
                        await startTeam(savedFile);
                    }
                }
                break;
            }

            case 'dashboard':
                await dashboardOnly(configPath);
                break; // Returns to menu on [b]

            case 'analyze':
                await analyzeTeam(configPath);
                break;

            case 'settings':
                await settingsScreen(configPath);
                break;

            case 'quit':
                process.stdout.write(cursor.show + screen.clear);
                console.log(`  ${c.dim}Goodbye! 👋${c.reset}\n`);
                process.exit(0);
        }
    }
}

// --- Init ---
function initConfig(): void {
    const config: VibehqMultiConfig = {
        teams: [
            {
                name: 'my-team',
                hub: { port: 3001 },
                agents: [
                    { name: 'Alex', role: 'Backend Engineer', cli: 'claude', cwd: 'D:\\my-project\\backend' },
                    { name: 'Jordan', role: 'Frontend Engineer', cli: 'claude', cwd: 'D:\\my-project\\frontend' },
                ],
            },
        ],
    };
    writeFileSync('vibehq.config.json', JSON.stringify(config, null, 4) + '\n');
    console.log(`${c.green}✓${c.reset} Created ${c.bold}vibehq.config.json${c.reset}`);
}

// --- Main ---
const { command, configPath } = getCommand();

switch (command) {
    case 'start':
        startTeam(configPath);
        break;
    case 'init':
        initConfig();
        break;
    case 'create':
        createTeamScreen().then(() => process.exit(0));
        break;
    case 'dashboard':
        dashboardOnly(configPath);
        break;
    default:
        interactive(configPath);
        break;
}

// ============================================================
// CLI Entry: vibehq — Interactive TUI
// ============================================================

import { startHub } from '../src/hub/server.js';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { exec } from 'child_process';
import { c, screen, cursor } from '../src/tui/renderer.js';
import { welcomeScreen } from '../src/tui/screens/welcome.js';
import { createTeamScreen } from '../src/tui/screens/create-team.js';
import { DashboardScreen } from '../src/tui/screens/dashboard.js';
import { selectMenu } from '../src/tui/menu.js';
import { prompt } from '../src/tui/input.js';

// --- Types ---
interface AgentConfig {
    name: string;
    role: string;
    cli: string;
    cwd: string;
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

// --- Select team ---
async function selectTeam(teams: TeamConfig[]): Promise<TeamConfig> {
    if (teams.length === 1) return teams[0];

    process.stdout.write(cursor.show);
    console.log('');

    const items = teams.map(t => ({
        label: t.name,
        description: `${t.agents.length} agents, port ${t.hub.port}`,
        value: t.name,
    }));

    const choice = await selectMenu(items, '⚡ Select Team');
    return teams.find(t => t.name === choice)!;
}

// --- Spawn agents ---
function spawnAgents(team: TeamConfig): void {
    const hubUrl = `ws://localhost:${team.hub.port}`;

    for (const agent of team.agents) {
        const spawnCmd = `vibehq-spawn --name "${agent.name}" --role "${agent.role}" --team "${team.name}" --hub "${hubUrl}" -- ${agent.cli}`;

        if (process.platform === 'win32') {
            const wtCmd = `wt -w new --title "${agent.name}" -d "${agent.cwd}" cmd /k "chcp 65001 >nul && ${spawnCmd}"`;
            exec(wtCmd, (err) => {
                if (err) {
                    exec(`start "${agent.name}" cmd /k "cd /d "${agent.cwd}" && chcp 65001 >nul && ${spawnCmd}"`);
                }
            });
        } else {
            exec(`osascript -e 'tell app "Terminal" to do script "cd \\"${agent.cwd}\\" && ${spawnCmd}"'`, () => {
                exec(`bash -c 'cd "${agent.cwd}" && ${spawnCmd}'`);
            });
        }

        console.log(`  ${c.green}↗${c.reset} ${c.bold}${agent.name}${c.reset} ${c.dim}(${agent.cli})${c.reset} → ${c.gray}${agent.cwd}${c.reset}`);
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

    process.stdout.write(screen.clear);
    console.log(`\n  ${c.bold}${c.brightCyan}⚡ Starting team "${team.name}"${c.reset}\n`);

    // Start Hub
    console.log(`  ${c.green}✓${c.reset} Hub started on port ${team.hub.port}`);
    startHub({ port: team.hub.port, verbose: false });

    // Spawn agents
    console.log(`  ${c.bold}Spawning ${team.agents.length} agents...${c.reset}\n`);
    await new Promise(r => setTimeout(r, 500));
    spawnAgents(team);

    // Launch dashboard
    console.log(`\n  ${c.dim}Launching dashboard...${c.reset}\n`);
    await new Promise(r => setTimeout(r, 2000));

    const dashboard = new DashboardScreen({
        team: team.name,
        hub: team.hub,
        agents: team.agents,
    });
    dashboard.start();
}

// --- Dashboard-only flow ---
async function dashboardOnly(configPath: string): Promise<void> {
    const teams = loadTeams(configPath);
    let dashConfig: { team: string; hub: { port: number }; agents: AgentConfig[] };

    if (teams && teams.length > 0) {
        const team = await selectTeam(teams);
        dashConfig = { team: team.name, hub: team.hub, agents: team.agents };
    } else {
        const portStr = await prompt('Hub port', '3001');
        dashConfig = {
            team: 'default',
            hub: { port: parseInt(portStr, 10) || 3001 },
            agents: [],
        };
    }

    const dashboard = new DashboardScreen(dashConfig);
    dashboard.start();
}

// --- Interactive mode ---
async function interactive(configPath: string): Promise<void> {
    while (true) {
        const choice = await welcomeScreen();

        switch (choice) {
            case 'start':
                await startTeam(configPath);
                return;

            case 'create': {
                process.stdout.write(cursor.show);
                const savedFile = await createTeamScreen();
                if (savedFile) {
                    const startNow = await prompt('Start team now? (y/n)', 'y');
                    if (startNow.toLowerCase() === 'y') {
                        await startTeam(savedFile);
                        return;
                    }
                }
                break;
            }

            case 'dashboard':
                await dashboardOnly(configPath);
                return;

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

// ============================================================
// Screen: Settings — Edit teams configuration in TUI
// ============================================================

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { c, screen, cursor, box, padRight, getWidth } from '../renderer.js';
import { selectMenu } from '../menu.js';
import { prompt, confirm, selectInput } from '../input.js';

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

interface VibehqConfig {
    teams: TeamConfig[];
}

function loadConfig(configPath: string): VibehqConfig {
    if (!existsSync(configPath)) return { teams: [] };
    try {
        const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (raw.teams) return raw;
        if (raw.team) return { teams: [{ name: raw.team, hub: raw.hub, agents: raw.agents }] };
    } catch { }
    return { teams: [] };
}

function saveConfig(configPath: string, config: VibehqConfig): void {
    writeFileSync(configPath, JSON.stringify(config, null, 4) + '\n');
}

export async function settingsScreen(configPath: string): Promise<void> {
    while (true) {
        process.stdout.write(screen.clear + cursor.show);
        const config = loadConfig(configPath);

        console.log(`\n  ${c.bold}${c.brightCyan}⚙  Settings${c.reset}  ${c.dim}${configPath}${c.reset}\n`);

        // Show current teams
        if (config.teams.length === 0) {
            console.log(`  ${c.dim}No teams configured yet.${c.reset}\n`);
        } else {
            console.log(`  ${c.bold}${c.white}Current Teams:${c.reset}`);
            for (const t of config.teams) {
                console.log(`  ${c.cyan}●${c.reset} ${c.bold}${t.name}${c.reset}  ${c.dim}port: ${t.hub.port}  agents: ${t.agents.length}${c.reset}`);
                for (const a of t.agents) {
                    console.log(`    ${c.dim}· ${a.name} (${a.role}) [${a.cli}] ${a.cwd}${c.reset}`);
                }
            }
            console.log('');
        }

        const menuItems = [
            { label: 'Edit Team Port', description: 'Change hub port for a team', value: 'port' },
            { label: 'Add Agent to Team', description: 'Add a new agent to a team', value: 'add-agent' },
            { label: 'Remove Agent', description: 'Remove an agent from a team', value: 'remove-agent' },
            { label: 'Remove Team', description: 'Delete a team from config', value: 'remove-team' },
            { label: 'Edit Config File', description: 'Open in system editor', value: 'editor' },
            { label: 'Back', description: '', value: 'back' },
        ];

        const action = await selectMenu(menuItems, '⚙  Settings');

        if (action === 'back') {
            return;
        }

        if (action === 'port') {
            if (config.teams.length === 0) { console.log(`\n  ${c.yellow}No teams to edit${c.reset}\n`); await sleep(1000); continue; }
            const teamName = await selectInput('Select team', config.teams.map(t => t.name));
            const team = config.teams.find(t => t.name === teamName)!;
            const newPort = await prompt('New port', String(team.hub.port));
            team.hub.port = parseInt(newPort, 10) || team.hub.port;
            saveConfig(configPath, config);
            console.log(`\n  ${c.green}✓${c.reset} Port updated to ${team.hub.port}\n`);
            await sleep(800);
        }

        if (action === 'add-agent') {
            if (config.teams.length === 0) { console.log(`\n  ${c.yellow}No teams to edit${c.reset}\n`); await sleep(1000); continue; }
            const teamName = await selectInput('Select team', config.teams.map(t => t.name));
            const team = config.teams.find(t => t.name === teamName)!;
            console.log(`\n  ${c.cyan}── New Agent ──${c.reset}`);
            const name = await prompt('  Name');
            const role = await prompt('  Role', 'Engineer');
            const cli = await selectInput('  CLI type', ['claude', 'codex', 'gemini']);
            const cwd = await prompt('  Project directory');
            team.agents.push({ name, role, cli, cwd });
            saveConfig(configPath, config);
            console.log(`\n  ${c.green}✓${c.reset} Added ${c.bold}${name}${c.reset}\n`);
            await sleep(800);
        }

        if (action === 'remove-agent') {
            if (config.teams.length === 0) { console.log(`\n  ${c.yellow}No teams${c.reset}\n`); await sleep(1000); continue; }
            const teamName = await selectInput('Select team', config.teams.map(t => t.name));
            const team = config.teams.find(t => t.name === teamName)!;
            if (team.agents.length === 0) { console.log(`  ${c.yellow}No agents in this team${c.reset}\n`); await sleep(1000); continue; }
            const agentName = await selectInput('Select agent to remove', team.agents.map(a => a.name));
            const ok = await confirm(`  Remove ${agentName}?`, false);
            if (ok) {
                team.agents = team.agents.filter(a => a.name !== agentName);
                saveConfig(configPath, config);
                console.log(`\n  ${c.green}✓${c.reset} Removed ${agentName}\n`);
            }
            await sleep(800);
        }

        if (action === 'remove-team') {
            if (config.teams.length === 0) { console.log(`\n  ${c.yellow}No teams${c.reset}\n`); await sleep(1000); continue; }
            const teamName = await selectInput('Select team to remove', config.teams.map(t => t.name));
            const ok = await confirm(`  Remove team "${teamName}"?`, false);
            if (ok) {
                config.teams = config.teams.filter(t => t.name !== teamName);
                saveConfig(configPath, config);
                console.log(`\n  ${c.green}✓${c.reset} Removed team ${teamName}\n`);
            }
            await sleep(800);
        }

        if (action === 'editor') {
            const editorCmd = process.platform === 'win32' ? `notepad "${configPath}"` : `open "${configPath}"`;
            const { exec } = await import('child_process');
            exec(editorCmd);
            console.log(`\n  ${c.dim}Opening ${configPath} in editor...${c.reset}\n`);
            await sleep(1000);
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

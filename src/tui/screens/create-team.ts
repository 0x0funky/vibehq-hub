// ============================================================
// Screen: Create Team — Interactive team creation wizard
// ============================================================

import { writeFileSync } from 'fs';
import { c, screen, cursor, box, getWidth } from '../renderer.js';
import { prompt, confirm, selectInput } from '../input.js';

interface AgentConfig {
    name: string;
    role: string;
    cli: string;
    cwd: string;
}

interface TeamConfig {
    team: string;
    hub: { port: number };
    agents: AgentConfig[];
}

export async function createTeamScreen(): Promise<string | null> {
    process.stdout.write(screen.clear + cursor.show);
    console.log(`\n  ${c.bold}${c.brightCyan}⚡ Create New Team${c.reset}\n`);

    // Step 1: Team name
    const teamName = await prompt('Team name', 'my-team');
    if (!teamName) return null;

    // Step 2: Hub port
    const portStr = await prompt('Hub port', '3001');
    const port = parseInt(portStr, 10) || 3001;

    // Step 3: Agents
    const agents: AgentConfig[] = [];
    console.log(`\n  ${c.bold}Add agents to your team${c.reset} ${c.dim}(at least 1)${c.reset}\n`);

    let addMore = true;
    let agentNum = 1;

    while (addMore) {
        console.log(`  ${c.cyan}── Agent ${agentNum} ──${c.reset}`);

        const name = await prompt('  Agent name', `Agent${agentNum}`);
        const role = await prompt('  Role', 'Engineer');
        const cli = await selectInput('  CLI type', ['claude', 'codex', 'gemini']);
        const cwd = await prompt('  Project directory');

        agents.push({ name, role, cli, cwd });
        agentNum++;

        console.log(`  ${c.green}✓${c.reset} Added ${c.bold}${name}${c.reset} (${role})\n`);

        addMore = await confirm('  Add another agent?', agents.length < 2);
    }

    // Step 4: Review
    console.log(`\n${c.bold}  Review:${c.reset}`);
    console.log(`  ${c.dim}Team:${c.reset} ${c.bold}${teamName}${c.reset}`);
    console.log(`  ${c.dim}Hub:${c.reset}  port ${port}`);
    console.log(`  ${c.dim}Agents:${c.reset}`);
    for (const a of agents) {
        console.log(`    ${c.cyan}●${c.reset} ${a.name} — ${a.role} [${a.cli}]`);
        console.log(`      ${c.dim}${a.cwd}${c.reset}`);
    }
    console.log('');

    const ok = await confirm('  Save config?');
    if (!ok) return null;

    // Save
    const config: TeamConfig = {
        team: teamName,
        hub: { port },
        agents,
    };

    const filename = `vibehq.config.json`;
    writeFileSync(filename, JSON.stringify(config, null, 4) + '\n');
    console.log(`\n  ${c.green}✓${c.reset} Saved to ${c.bold}${filename}${c.reset}`);
    console.log(`  ${c.dim}Run "vibehq start" to launch your team${c.reset}\n`);

    return filename;
}

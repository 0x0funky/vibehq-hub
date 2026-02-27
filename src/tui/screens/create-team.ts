// ============================================================
// Screen: Create Team — Interactive team creation wizard
// ============================================================

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { c, screen, cursor, getWidth, padRight } from '../renderer.js';
import { prompt, confirm, selectInput } from '../input.js';
import { ROLE_PRESETS, getPresetByRole } from '../role-presets.js';
import { selectMenu } from '../menu.js';

interface AgentConfig {
    name: string;
    role: string;
    cli: string;
    cwd: string;
    systemPrompt?: string;
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

        // Role selector with presets
        console.log(`\n  ${c.dim}Select a role:${c.reset}`);
        const roleItems = ROLE_PRESETS.map(p => ({
            label: p.role,
            description: p.description,
            value: p.role,
        }));

        const selectedRole = await selectMenu(roleItems, '  Role');

        let customRole = selectedRole;
        let systemPrompt = getPresetByRole(selectedRole)?.defaultSystemPrompt ?? '';

        // Custom role — ask for role name
        if (selectedRole === 'Custom') {
            customRole = await prompt('  Custom role title', 'Engineer');
        }

        // Show default system prompt and allow customization
        console.log(`\n  ${c.green}✓${c.reset} Default system prompt set for ${c.bold}${customRole}${c.reset}`);
        console.log(`  ${c.dim}(covers workflow, communication protocol, and VibHQ tools)${c.reset}\n`);

        const customize = await confirm('  Customize system prompt?', false);
        if (customize) {
            console.log(`  ${c.dim}Enter your system prompt (press Enter twice when done):${c.reset}`);
            console.log(`  ${c.dim}Current prompt starts with: "${systemPrompt.slice(0, 80).trim()}..."${c.reset}\n`);
            const extra = await prompt('  Additional instructions (appended to default)', '');
            if (extra) {
                systemPrompt = systemPrompt + `\n\n## Additional Instructions:\n${extra}`;
            }
        }

        const cli = await selectInput('  CLI type', ['claude', 'codex', 'gemini', 'aider', 'cursor']);
        const cwd = await prompt('  Project directory');

        agents.push({ name, role: customRole, cli, cwd, systemPrompt });
        agentNum++;

        console.log(`  ${c.green}✓${c.reset} Added ${c.bold}${name}${c.reset} (${customRole} · ${cli})\n`);

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
        console.log(`      ${c.dim}System prompt: ${a.systemPrompt ? '✓ set' : '—'}${c.reset}`);
    }
    console.log('');

    const ok = await confirm('  Save config?');
    if (!ok) return null;

    // Save — append to existing config or create new
    const filename = `vibehq.config.json`;
    let existingTeams: any[] = [];

    if (existsSync(filename)) {
        try {
            const raw = JSON.parse(readFileSync(filename, 'utf-8'));
            if (raw.teams && Array.isArray(raw.teams)) {
                existingTeams = raw.teams;
            } else if (raw.team && raw.agents) {
                existingTeams = [{ name: raw.team, hub: raw.hub, agents: raw.agents }];
            }
        } catch { }
    }

    existingTeams.push({
        name: teamName,
        hub: { port },
        agents,
    });

    writeFileSync(filename, JSON.stringify({ teams: existingTeams }, null, 4) + '\n');
    console.log(`\n  ${c.green}✓${c.reset} Saved to ${c.bold}${filename}${c.reset} (${existingTeams.length} team${existingTeams.length > 1 ? 's' : ''})`);
    console.log(`  ${c.dim}Run "vibehq start" to launch your team${c.reset}\n`);

    return filename;
}

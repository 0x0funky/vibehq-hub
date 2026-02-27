// ============================================================
// Screen: Welcome — Logo + Main Menu
// ============================================================

import { c, screen, cursor, getWidth, padCenter, stripAnsi } from '../renderer.js';
import { selectMenu } from '../menu.js';

const LOGO = `
   ██╗   ██╗██╗██████╗ ███████╗██╗  ██╗ ██████╗
   ██║   ██║██║██╔══██╗██╔════╝██║  ██║██╔═══██╗
   ██║   ██║██║██████╔╝█████╗  ███████║██║   ██║
   ╚██╗ ██╔╝██║██╔══██╗██╔══╝  ██╔══██║██║▄▄ ██║
    ╚████╔╝ ██║██████╔╝███████╗██║  ██║╚██████╔╝
     ╚═══╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚══▀▀═╝`;

const TAGLINE = 'Run a Real AI Company — Multi-Agent Team Platform';

const FEATURES = [
    '🏢 Run your own Real AI Company with multiple agent teams',
    '⚡ Spawn Claude, Codex & Gemini agents side-by-side',
    '🤝 Real-time messaging between agents via MCP tools',
    '📁 Shared file system per team — no more copy-paste',
    '📋 Team bulletin board — track progress, cut token waste',
    '🔀 Full isolation — multiple teams, multiple projects',
];

export async function welcomeScreen(): Promise<string> {
    const W = getWidth();
    process.stdout.write(screen.clear + cursor.hide);

    // Logo — gradient cyan→blue
    const logoLines = LOGO.split('\n');
    for (let i = 0; i < logoLines.length; i++) {
        const color = i < 2 ? c.brightCyan : i < 4 ? c.cyan : c.blue;
        console.log(`${c.bold}${color}${logoLines[i]}${c.reset}`);
    }

    // Tagline
    console.log(`\n${c.bold}${c.white}${padCenter(TAGLINE, W)}${c.reset}`);
    console.log(`${c.dim}${padCenter('━'.repeat(40), W)}${c.reset}\n`);

    // Feature list
    for (const f of FEATURES) {
        console.log(`  ${c.dim}${f}${c.reset}`);
    }
    console.log('');

    const choice = await selectMenu([
        { label: 'Start Team     ', description: 'Launch agents from config', value: 'start' },
        { label: 'Create Team    ', description: 'Setup a new team with wizard', value: 'create' },
        { label: 'Dashboard      ', description: 'Monitor a running team', value: 'dashboard' },
        { label: 'Quit           ', description: '', value: 'quit' },
    ], '⚡ VibeHQ');

    return choice;
}

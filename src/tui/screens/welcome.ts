// ============================================================
// Screen: Welcome — Logo + Main Menu
// ============================================================

import { c, logo, screen, cursor, getWidth } from '../renderer.js';
import { selectMenu } from '../menu.js';

export async function welcomeScreen(): Promise<string> {
    process.stdout.write(screen.clear + cursor.hide);
    console.log(logo());
    console.log(`  ${c.dim}v0.1.0${c.reset}\n`);

    const choice = await selectMenu([
        { label: 'Start Team', description: 'Launch from config file', value: 'start' },
        { label: 'Create Team', description: 'Interactive setup wizard', value: 'create' },
        { label: 'Dashboard', description: 'Connect to running hub', value: 'dashboard' },
        { label: 'Quit', description: '', value: 'quit' },
    ], '⚡ Main Menu');

    return choice;
}

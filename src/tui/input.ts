// ============================================================
// TUI Input — Interactive prompts
// ============================================================

import { c, getWidth } from './renderer.js';
import { createInterface } from 'readline';

export async function prompt(label: string, defaultValue?: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const defaultHint = defaultValue ? ` ${c.dim}(${defaultValue})${c.reset}` : '';

    return new Promise((resolve) => {
        rl.question(`${c.brightCyan}?${c.reset} ${c.bold}${label}${c.reset}${defaultHint}${c.dim}: ${c.reset}`, (answer) => {
            rl.close();
            resolve(answer.trim() || defaultValue || '');
        });
    });
}

export async function confirm(label: string, defaultYes = true): Promise<boolean> {
    const hint = defaultYes ? `${c.dim}(Y/n)${c.reset}` : `${c.dim}(y/N)${c.reset}`;
    const answer = await prompt(`${label} ${hint}`);
    if (!answer) return defaultYes;
    return answer.toLowerCase().startsWith('y');
}

export async function selectInput(label: string, options: string[]): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    return new Promise((resolve) => {
        console.log(`${c.brightCyan}?${c.reset} ${c.bold}${label}${c.reset}`);
        options.forEach((opt, i) => {
            console.log(`  ${c.dim}${i + 1}.${c.reset} ${opt}`);
        });

        rl.question(`${c.dim}  Choose (1-${options.length}): ${c.reset}`, (answer) => {
            rl.close();
            const idx = parseInt(answer, 10) - 1;
            if (idx >= 0 && idx < options.length) {
                resolve(options[idx]);
            } else {
                resolve(options[0]);
            }
        });
    });
}

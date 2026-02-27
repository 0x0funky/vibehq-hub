// ============================================================
// TUI Menu — Arrow-key selectable menu
// ============================================================

import { c, box, padRight, getWidth, stripAnsi } from './renderer.js';

export interface MenuItem {
    label: string;
    description?: string;
    value: string;
}

export function renderMenu(items: MenuItem[], selectedIndex: number, title?: string): string {
    const width = getWidth();
    const lines: string[] = [''];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const selected = i === selectedIndex;
        const pointer = selected ? `${c.brightCyan}❯${c.reset}` : ' ';
        const label = selected
            ? `${c.bold}${c.brightWhite}${item.label}${c.reset}`
            : `${c.white}${item.label}${c.reset}`;
        const desc = item.description
            ? `  ${c.dim}${item.description}${c.reset}`
            : '';

        lines.push(` ${pointer} ${padRight(label + desc, width - 6)}`);
    }

    lines.push('');
    return box(width, lines, { title, borderColor: c.cyan });
}

export async function selectMenu(items: MenuItem[], title?: string): Promise<string> {
    return new Promise((resolve) => {
        let selectedIndex = 0;
        const stdin = process.stdin;

        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        const render = () => {
            // Move cursor up to overwrite previous render
            const totalLines = items.length + 4; // box top + padding + items + padding + box bottom
            process.stdout.write(`\x1b[${totalLines}A`);
            process.stdout.write(renderMenu(items, selectedIndex, title));
        };

        // Initial render
        process.stdout.write(renderMenu(items, selectedIndex, title));

        const handler = (key: string) => {
            if (key === '\x1b[A' || key === 'k') {
                // Up arrow or k
                selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                render();
            } else if (key === '\x1b[B' || key === 'j') {
                // Down arrow or j
                selectedIndex = (selectedIndex + 1) % items.length;
                render();
            } else if (key === '\r' || key === '\n') {
                // Enter
                stdin.removeListener('data', handler);
                stdin.setRawMode(false);
                stdin.pause();
                resolve(items[selectedIndex].value);
            } else if (key === '\x03') {
                // Ctrl+C
                process.stdout.write('\x1b[?25h'); // show cursor
                process.exit(0);
            }
        };

        stdin.on('data', handler);
    });
}

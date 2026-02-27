// ============================================================
// TUI Renderer — ANSI rendering helpers
// ============================================================

// --- Colors ---
const ESC = '\x1b';

export const c = {
    reset: `${ESC}[0m`,
    bold: `${ESC}[1m`,
    dim: `${ESC}[2m`,
    italic: `${ESC}[3m`,
    underline: `${ESC}[4m`,

    // Theme colors
    cyan: `${ESC}[36m`,
    green: `${ESC}[32m`,
    yellow: `${ESC}[33m`,
    red: `${ESC}[31m`,
    magenta: `${ESC}[35m`,
    white: `${ESC}[37m`,
    gray: `${ESC}[90m`,
    blue: `${ESC}[34m`,

    // Bright
    brightCyan: `${ESC}[96m`,
    brightGreen: `${ESC}[92m`,
    brightYellow: `${ESC}[93m`,
    brightWhite: `${ESC}[97m`,

    // BG
    bgDark: `${ESC}[48;5;236m`,
    bgCyan: `${ESC}[46m`,
    bgBlue: `${ESC}[44m`,
};

// --- Cursor / Screen ---
export const cursor = {
    hide: `${ESC}[?25l`,
    show: `${ESC}[?25h`,
    up: (n = 1) => `${ESC}[${n}A`,
    down: (n = 1) => `${ESC}[${n}B`,
    to: (row: number, col: number) => `${ESC}[${row};${col}H`,
    save: `${ESC}7`,
    restore: `${ESC}8`,
};

export const screen = {
    clear: `${ESC}[2J${ESC}[H`,
    altOn: `${ESC}[?1049h`,
    altOff: `${ESC}[?1049l`,
    eraseLine: `${ESC}[2K`,
};

// --- Box Drawing ---
const BOX = {
    tl: '╭', tr: '╮', bl: '╰', br: '╯',
    h: '─', v: '│',
    tee_l: '├', tee_r: '┤',
    cross: '┼',
};

export function box(width: number, lines: string[], opts?: { title?: string; borderColor?: string }): string {
    const border = opts?.borderColor || c.cyan;
    const title = opts?.title || '';
    const inner = width - 2;

    let out = '';

    // Top
    if (title) {
        const titleStr = ` ${title} `;
        const remaining = inner - stripAnsi(titleStr).length;
        out += `${border}${BOX.tl}${BOX.h}${c.bold}${c.white}${titleStr}${c.reset}${border}${BOX.h.repeat(Math.max(0, remaining))}${BOX.tr}${c.reset}\n`;
    } else {
        out += `${border}${BOX.tl}${BOX.h.repeat(inner)}${BOX.tr}${c.reset}\n`;
    }

    // Content
    for (const line of lines) {
        const visible = stripAnsi(line).length;
        const pad = Math.max(0, inner - visible);
        out += `${border}${BOX.v}${c.reset}${line}${' '.repeat(pad)}${border}${BOX.v}${c.reset}\n`;
    }

    // Bottom
    out += `${border}${BOX.bl}${BOX.h.repeat(inner)}${BOX.br}${c.reset}\n`;

    return out;
}

export function separator(width: number, borderColor?: string): string {
    const bc = borderColor || c.cyan;
    return `${bc}${BOX.tee_l}${BOX.h.repeat(width - 2)}${BOX.tee_r}${c.reset}\n`;
}

export function padRight(str: string, len: number): string {
    const visible = stripAnsi(str).length;
    if (visible >= len) return str;
    return str + ' '.repeat(len - visible);
}

export function padCenter(str: string, len: number): string {
    const visible = stripAnsi(str).length;
    if (visible >= len) return str;
    const left = Math.floor((len - visible) / 2);
    const right = len - visible - left;
    return ' '.repeat(left) + str + ' '.repeat(right);
}

export function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function truncate(str: string, maxLen: number): string {
    const visible = stripAnsi(str).length;
    if (visible <= maxLen) return str;
    // Simple truncation — strip ANSI, cut, add ...
    const plain = stripAnsi(str);
    return plain.substring(0, maxLen - 3) + '...';
}

// --- Logo ---
export function logo(): string {
    return `${c.bold}${c.brightCyan}
   ╦  ╦╦╔╗ ╔═╗╦ ╦╔═╗
   ╚╗╔╝║╠╩╗║╣ ╠═╣║ ║
    ╚╝ ╩╚═╝╚═╝╩ ╩╚═╝${c.reset}
   ${c.dim}Multi-Agent Team Manager${c.reset}
`;
}

export function getWidth(): number {
    return Math.min(process.stdout.columns || 80, 80);
}

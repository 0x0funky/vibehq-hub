// ============================================================
// CLI Entry: vibehq (launcher + dashboard)
// Reads vibehq.config.json, starts hub, opens terminal tabs,
// then shows a live dashboard.
// ============================================================

import { startHub } from '../src/hub/server.js';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import WebSocket from 'ws';
import type { Agent, TeamUpdate } from '../src/shared/types.js';

// --- ANSI helpers ---
const ESC = '\x1b';
const CLEAR = `${ESC}[2J${ESC}[H`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const CYAN = `${ESC}[36m`;
const MAGENTA = `${ESC}[35m`;
const WHITE = `${ESC}[37m`;
const GRAY = `${ESC}[90m`;
const BG_DARK = `${ESC}[48;5;236m`;

// --- Types ---
interface AgentConfig {
    name: string;
    role: string;
    cli: string;
    cwd: string;
}

interface VibehqConfig {
    team: string;
    hub: { port: number };
    agents: AgentConfig[];
}

// --- Parse args ---
function parseArgs(): { configPath: string } {
    const args = process.argv.slice(2);
    let configPath = 'vibehq.config.json';
    let command = '';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--config' || args[i] === '-c') {
            configPath = args[++i];
        } else if (args[i] === '-h' || args[i] === '--help') {
            console.log(`
${BOLD}vibehq${RESET} — Team Launcher + Dashboard

Usage:
  vibehq start [--config <path>]    Start hub + agents + dashboard
  vibehq init                       Create example config file

Options:
  -c, --config <path>    Config file path (default: vibehq.config.json)
  -h, --help             Show help
`);
            process.exit(0);
        } else if (!command) {
            command = args[i];
        }
    }

    if (command === 'init') {
        createExampleConfig();
        process.exit(0);
    }

    return { configPath };
}

function createExampleConfig(): void {
    const example: VibehqConfig = {
        team: 'my-team',
        hub: { port: 3001 },
        agents: [
            { name: 'Alex', role: 'Backend Engineer', cli: 'claude', cwd: 'D:\\my-project\\backend' },
            { name: 'Jordan', role: 'Frontend Engineer', cli: 'codex', cwd: 'D:\\my-project\\frontend' },
            { name: 'Bob', role: 'AI Engineer', cli: 'gemini', cwd: 'D:\\my-project\\ai' },
        ],
    };
    const fs = require('fs');
    fs.writeFileSync('vibehq.config.json', JSON.stringify(example, null, 2) + '\n');
    console.log(`${GREEN}✓${RESET} Created vibehq.config.json — edit it with your agent settings.`);
}

// --- Load config ---
function loadConfig(configPath: string): VibehqConfig {
    if (!existsSync(configPath)) {
        console.error(`Config file not found: ${configPath}`);
        console.error(`Run "vibehq init" to create one.`);
        process.exit(1);
    }
    try {
        return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (err) {
        console.error(`Invalid config file: ${(err as Error).message}`);
        process.exit(1);
    }
}

// --- Spawn agents in Windows Terminal tabs ---
function spawnAgents(config: VibehqConfig): void {
    const { team, hub, agents } = config;
    const hubUrl = `ws://localhost:${hub.port}`;

    for (const agent of agents) {
        const spawnCmd = `vibehq-spawn --name "${agent.name}" --role "${agent.role}" --team "${team}" --hub "${hubUrl}" -- ${agent.cli}`;

        if (process.platform === 'win32') {
            // Try Windows Terminal first, fall back to cmd
            try {
                spawn('wt', [
                    '-w', '0',
                    'new-tab',
                    '--title', `${agent.name} (${agent.cli})`,
                    '-d', agent.cwd,
                    'cmd', '/k', spawnCmd,
                ], { shell: true, detached: true, stdio: 'ignore' });
            } catch {
                spawn('cmd', ['/c', 'start', 'cmd', '/k', `cd /d "${agent.cwd}" && ${spawnCmd}`], {
                    shell: true, detached: true, stdio: 'ignore',
                });
            }
        } else {
            // macOS / Linux — open new terminal
            spawn('bash', ['-c', `cd "${agent.cwd}" && ${spawnCmd}`], {
                detached: true, stdio: 'ignore',
            });
        }

        console.log(`  ${GREEN}↗${RESET} ${agent.name} (${agent.cli}) → ${GRAY}${agent.cwd}${RESET}`);
    }
}

// --- Dashboard ---
class Dashboard {
    private agents: Map<string, Agent> = new Map();
    private updates: TeamUpdate[] = [];
    private ws: WebSocket | null = null;
    private config: VibehqConfig;
    private interval: ReturnType<typeof setInterval> | null = null;

    constructor(config: VibehqConfig) {
        this.config = config;
    }

    start(): void {
        const hubUrl = `ws://localhost:${this.config.hub.port}`;
        this.connectWithRetry(hubUrl);

        // Refresh dashboard every 2 seconds
        this.interval = setInterval(() => this.render(), 2000);

        // Handle keyboard
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('data', (data) => {
                const key = data.toString();
                if (key === 'q' || key === '\x03') { // q or Ctrl+C
                    this.cleanup();
                    process.exit(0);
                }
                if (key === 'r') {
                    this.render();
                }
            });
        }

        this.render();
    }

    private connectWithRetry(hubUrl: string): void {
        try {
            this.ws = new WebSocket(hubUrl);

            this.ws.on('open', () => {
                this.ws!.send(JSON.stringify({ type: 'viewer:connect' }));
                this.render();
            });

            this.ws.on('message', (raw) => {
                let msg: any;
                try { msg = JSON.parse(raw.toString()); } catch { return; }
                this.handleMessage(msg);
            });

            this.ws.on('close', () => {
                setTimeout(() => this.connectWithRetry(hubUrl), 2000);
            });

            this.ws.on('error', () => {
                setTimeout(() => this.connectWithRetry(hubUrl), 2000);
            });
        } catch {
            setTimeout(() => this.connectWithRetry(hubUrl), 2000);
        }
    }

    private handleMessage(msg: any): void {
        switch (msg.type) {
            case 'agent:status:broadcast':
                this.agents.set(msg.agentId, {
                    id: msg.agentId,
                    name: msg.name,
                    role: msg.role || '',
                    capabilities: [],
                    status: msg.status,
                });
                this.render();
                break;

            case 'agent:disconnected':
                this.agents.delete(msg.agentId);
                this.render();
                break;

            case 'team:update:broadcast':
                this.updates.push(msg.update);
                if (this.updates.length > 20) this.updates.shift();
                this.render();
                break;
        }
    }

    private render(): void {
        const now = new Date().toLocaleTimeString('en-US', { hour12: false });
        const connected = this.ws?.readyState === WebSocket.OPEN;
        const team = this.config.team;
        const sharedDir = join(homedir(), '.vibehq', 'teams', team, 'shared');

        let out = CLEAR;

        // Header
        out += `${BOLD}${CYAN}┌${'─'.repeat(60)}┐${RESET}\n`;
        out += `${BOLD}${CYAN}│${RESET} ${BOLD}⚡ VibeHQ Dashboard${RESET}${' '.repeat(17)}${GRAY}team: ${WHITE}${team}${RESET}${' '.repeat(Math.max(0, 10 - team.length))}${CYAN}│${RESET}\n`;
        out += `${BOLD}${CYAN}│${RESET} ${connected ? `${GREEN}● Connected${RESET}` : `${YELLOW}○ Connecting...${RESET}`}${' '.repeat(connected ? 25 : 22)}${GRAY}${now}${RESET}    ${CYAN}│${RESET}\n`;
        out += `${BOLD}${CYAN}├${'─'.repeat(60)}┤${RESET}\n`;

        // Agents
        out += `${CYAN}│${RESET} ${BOLD}${WHITE}AGENTS${RESET}${' '.repeat(54)}${CYAN}│${RESET}\n`;
        out += `${CYAN}│${RESET}${' '.repeat(60)}${CYAN}│${RESET}\n`;

        if (this.agents.size === 0) {
            // Show expected agents from config (waiting)
            for (const a of this.config.agents) {
                out += `${CYAN}│${RESET}  ${GRAY}○${RESET} ${padRight(a.name, 10)} ${padRight(a.role, 22)} ${DIM}[${a.cli}]${RESET}${padRight('', 6)}${DIM}waiting${RESET}  ${CYAN}│${RESET}\n`;
            }
        } else {
            for (const agent of this.agents.values()) {
                const statusColor = agent.status === 'idle' ? GREEN : agent.status === 'working' ? YELLOW : MAGENTA;
                const dot = `${statusColor}●${RESET}`;
                const cli = this.config.agents.find(a => a.name === agent.name)?.cli || '?';
                out += `${CYAN}│${RESET}  ${dot} ${padRight(agent.name, 10)} ${padRight(agent.role || '—', 22)} ${DIM}[${cli}]${RESET}${padRight('', 6)}${statusColor}${agent.status}${RESET}${padRight('', Math.max(0, 7 - agent.status.length))} ${CYAN}│${RESET}\n`;
            }
            // Show disconnected expected agents
            for (const a of this.config.agents) {
                const online = Array.from(this.agents.values()).some(ag => ag.name === a.name);
                if (!online) {
                    out += `${CYAN}│${RESET}  ${GRAY}○${RESET} ${padRight(a.name, 10)} ${padRight(a.role, 22)} ${DIM}[${a.cli}]${RESET}${padRight('', 6)}${DIM}offline${RESET}   ${CYAN}│${RESET}\n`;
                }
            }
        }

        out += `${CYAN}│${RESET}${' '.repeat(60)}${CYAN}│${RESET}\n`;
        out += `${BOLD}${CYAN}├${'─'.repeat(60)}┤${RESET}\n`;

        // Team Updates
        out += `${CYAN}│${RESET} ${BOLD}${WHITE}TEAM UPDATES${RESET}${' '.repeat(48)}${CYAN}│${RESET}\n`;
        out += `${CYAN}│${RESET}${' '.repeat(60)}${CYAN}│${RESET}\n`;

        if (this.updates.length === 0) {
            out += `${CYAN}│${RESET}  ${DIM}No updates yet${RESET}${' '.repeat(44)}${CYAN}│${RESET}\n`;
        } else {
            const recent = this.updates.slice(-5);
            for (const u of recent) {
                const time = new Date(u.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
                const msg = u.message.length > 40 ? u.message.substring(0, 37) + '...' : u.message;
                out += `${CYAN}│${RESET}  ${GRAY}${time}${RESET}  ${BOLD}${u.from}${RESET}: ${msg}${padRight('', Math.max(0, 40 - msg.length - u.from.length))} ${CYAN}│${RESET}\n`;
            }
        }

        out += `${CYAN}│${RESET}${' '.repeat(60)}${CYAN}│${RESET}\n`;
        out += `${BOLD}${CYAN}├${'─'.repeat(60)}┤${RESET}\n`;

        // Shared Files
        out += `${CYAN}│${RESET} ${BOLD}${WHITE}SHARED FILES${RESET}${' '.repeat(48)}${CYAN}│${RESET}\n`;
        out += `${CYAN}│${RESET}${' '.repeat(60)}${CYAN}│${RESET}\n`;

        try {
            if (existsSync(sharedDir)) {
                const files = readdirSync(sharedDir);
                if (files.length === 0) {
                    out += `${CYAN}│${RESET}  ${DIM}No shared files yet${RESET}${' '.repeat(39)}${CYAN}│${RESET}\n`;
                } else {
                    for (const f of files.slice(0, 5)) {
                        const stat = statSync(join(sharedDir, f));
                        const size = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(1)}KB`;
                        out += `${CYAN}│${RESET}  ${GREEN}📄${RESET} ${padRight(f, 35)} ${GRAY}${padRight(size, 10)}${RESET}    ${CYAN}│${RESET}\n`;
                    }
                    if (files.length > 5) {
                        out += `${CYAN}│${RESET}  ${DIM}...and ${files.length - 5} more${RESET}${' '.repeat(42)}${CYAN}│${RESET}\n`;
                    }
                }
            } else {
                out += `${CYAN}│${RESET}  ${DIM}No shared files yet${RESET}${' '.repeat(39)}${CYAN}│${RESET}\n`;
            }
        } catch {
            out += `${CYAN}│${RESET}  ${DIM}No shared files yet${RESET}${' '.repeat(39)}${CYAN}│${RESET}\n`;
        }

        out += `${CYAN}│${RESET}${' '.repeat(60)}${CYAN}│${RESET}\n`;
        out += `${BOLD}${CYAN}├${'─'.repeat(60)}┤${RESET}\n`;
        out += `${CYAN}│${RESET} ${GRAY}[r] refresh  [q] quit${RESET}${' '.repeat(38)}${CYAN}│${RESET}\n`;
        out += `${BOLD}${CYAN}└${'─'.repeat(60)}┘${RESET}\n`;

        process.stdout.write(out);
    }

    private cleanup(): void {
        if (this.interval) clearInterval(this.interval);
        if (this.ws) this.ws.close();
        process.stdout.write(CLEAR);
    }
}

function padRight(str: string, len: number): string {
    if (str.length >= len) return str.substring(0, len);
    return str + ' '.repeat(len - str.length);
}

// --- Main ---
const { configPath } = parseArgs();
const config = loadConfig(configPath);

console.log(`\n${BOLD}${CYAN}⚡ VibeHQ${RESET} — Starting team "${config.team}"\n`);

// 1. Start Hub
console.log(`${BOLD}  Hub${RESET} → port ${config.hub.port}`);
startHub({ port: config.hub.port, verbose: false });

// 2. Wait a moment for hub to start, then spawn agents
console.log(`\n${BOLD}  Spawning agents...${RESET}`);
setTimeout(() => {
    spawnAgents(config);

    // 3. Start Dashboard after a short delay
    console.log(`\n${GRAY}  Starting dashboard in 3s...${RESET}`);
    setTimeout(() => {
        const dashboard = new Dashboard(config);
        dashboard.start();
    }, 3000);
}, 500);

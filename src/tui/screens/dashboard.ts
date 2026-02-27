// ============================================================
// Screen: Dashboard — Live monitoring TUI
// ============================================================

import WebSocket from 'ws';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { c, padRight, cursor, screen, getWidth, stripAnsi } from '../renderer.js';
import type { Agent, TeamUpdate } from '../../shared/types.js';

interface AgentConfig {
    name: string;
    role: string;
    cli: string;
    cwd: string;
}

interface DashboardConfig {
    team: string;
    hub: { port: number };
    agents: AgentConfig[];
}

export class DashboardScreen {
    private agents: Map<string, Agent & { team?: string }> = new Map();
    private updates: TeamUpdate[] = [];
    private ws: WebSocket | null = null;
    private config: DashboardConfig;
    private interval: ReturnType<typeof setInterval> | null = null;
    private startTime = Date.now();
    private destroyed = false; // Prevents reconnect after cleanup

    constructor(config: DashboardConfig) {
        this.config = config;
    }

    start(): Promise<void> {
        this.destroyed = false;
        return new Promise((resolve) => {
            const hubUrl = `ws://localhost:${this.config.hub.port}`;
            this.connectWithRetry(hubUrl);

            // Refresh every 2s
            this.interval = setInterval(() => {
                if (!this.destroyed) this.render();
            }, 2000);

            // Keyboard handler — stored so we can remove it
            const keyHandler = (key: string) => {
                if (key === 'q' || key === '\x03') {
                    // q or Ctrl+C → return to main menu
                    process.stdin.removeListener('data', keyHandler);
                    if (process.stdin.isTTY) {
                        process.stdin.setRawMode(false);
                        process.stdin.pause();
                    }
                    this.cleanup();
                    resolve(); // Return to caller (main menu)
                } else if (key === 'r') {
                    this.render();
                }
            };

            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.setEncoding('utf8');
                process.stdin.on('data', keyHandler);
            }

            process.stdout.write(cursor.hide);
            this.render();
        });
    }

    private connectWithRetry(hubUrl: string): void {
        if (this.destroyed) return; // Stop reconnecting after cleanup

        try {
            this.ws = new WebSocket(hubUrl);
            this.ws.on('open', () => {
                if (this.destroyed) { this.ws?.close(); return; }
                this.ws!.send(JSON.stringify({ type: 'viewer:connect' }));
                this.render();
            });
            this.ws.on('message', (raw) => {
                if (this.destroyed) return;
                try { this.handleMessage(JSON.parse(raw.toString())); } catch { }
            });
            this.ws.on('close', () => {
                if (!this.destroyed) {
                    setTimeout(() => this.connectWithRetry(hubUrl), 2000);
                }
            });
            this.ws.on('error', () => {
                if (!this.destroyed) {
                    setTimeout(() => this.connectWithRetry(hubUrl), 2000);
                }
            });
        } catch {
            if (!this.destroyed) {
                setTimeout(() => this.connectWithRetry(hubUrl), 2000);
            }
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
                if (this.updates.length > 50) this.updates.shift();
                this.render();
                break;
        }
    }

    private render(): void {
        if (this.destroyed) return;
        const W = getWidth();
        const inner = W - 2;
        const now = new Date().toLocaleTimeString('en-US', { hour12: false });
        const connected = this.ws?.readyState === WebSocket.OPEN;
        const team = this.config.team;
        const uptime = this.formatUptime();
        const sharedDir = join(homedir(), '.vibehq', 'teams', team, 'shared');
        const bc = c.cyan;

        let out = screen.clear;

        // ═══ Header ═══
        const statusDot = connected ? `${c.green}●${c.reset}` : `${c.yellow}○${c.reset}`;
        const statusText = connected ? `${c.green}Connected${c.reset}` : `${c.yellow}Connecting${c.reset}`;

        out += `${bc}╭${'─'.repeat(inner)}╮${c.reset}\n`;
        out += `${bc}│${c.reset}${padRight('', inner)}${bc}│${c.reset}\n`;
        out += `${bc}│${c.reset}   ${c.bold}${c.brightCyan}⚡ VibeHQ${c.reset}  ${c.dim}team:${c.reset} ${c.bold}${c.white}${team}${c.reset}${padRight('', Math.max(0, inner - 18 - team.length - now.length - 4))}${c.gray}${now}${c.reset}   ${bc}│${c.reset}\n`;
        out += `${bc}│${c.reset}   ${statusDot} ${statusText}  ${c.dim}uptime: ${uptime}${c.reset}${padRight('', Math.max(0, inner - 28 - uptime.length - stripAnsi(statusText).length))}${bc}│${c.reset}\n`;
        out += `${bc}│${c.reset}${padRight('', inner)}${bc}│${c.reset}\n`;
        out += `${bc}├${'─'.repeat(inner)}┤${c.reset}\n`;

        // ═══ Agents ═══
        out += `${bc}│${c.reset} ${c.bold}${c.white} AGENTS${c.reset}${padRight('', inner - 8)}${bc}│${c.reset}\n`;
        out += `${bc}│${c.reset}${padRight('', inner)}${bc}│${c.reset}\n`;
        out += `${bc}│${c.reset}  ${c.dim}${padRight('NAME', 12)}${padRight('ROLE', 24)}${padRight('CLI', 10)}${padRight('STATUS', 10)}${c.reset}${bc}│${c.reset}\n`;
        out += `${bc}│${c.reset}  ${c.dim}${'─'.repeat(12)}${'─'.repeat(24)}${'─'.repeat(10)}${'─'.repeat(inner - 50)}${c.reset}  ${bc}│${c.reset}\n`;

        const onlineNames = new Set(Array.from(this.agents.values()).map(a => a.name));

        for (const agent of this.agents.values()) {
            const statusColor = agent.status === 'idle' ? c.green : agent.status === 'working' ? c.yellow : c.magenta;
            const dot = `${statusColor}●${c.reset}`;
            const cli = this.config.agents.find(a => a.name === agent.name)?.cli || '?';
            const statusStr = `${statusColor}${agent.status}${c.reset}`;
            out += `${bc}│${c.reset}  ${dot} ${padRight(c.bold + agent.name + c.reset, 11 + c.bold.length + c.reset.length)}${padRight(agent.role || '—', 24)}${padRight(`[${cli}]`, 10)}${padRight(statusStr, 10 + statusColor.length + c.reset.length)}${bc}│${c.reset}\n`;
        }

        for (const a of this.config.agents) {
            if (!onlineNames.has(a.name)) {
                out += `${bc}│${c.reset}  ${c.dim}○ ${padRight(a.name, 11)}${padRight(a.role, 24)}${padRight(`[${a.cli}]`, 10)}offline${c.reset}${padRight('', Math.max(0, inner - 52 - 6))}  ${bc}│${c.reset}\n`;
            }
        }

        if (this.agents.size === 0 && this.config.agents.length === 0) {
            out += `${bc}│${c.reset}  ${c.dim}No agents configured${c.reset}${padRight('', inner - 22)}${bc}│${c.reset}\n`;
        }

        out += `${bc}│${c.reset}${padRight('', inner)}${bc}│${c.reset}\n`;
        out += `${bc}├${'─'.repeat(inner)}┤${c.reset}\n`;

        // ═══ Team Updates ═══
        out += `${bc}│${c.reset} ${c.bold}${c.white} TEAM UPDATES${c.reset}${padRight('', inner - 14)}${bc}│${c.reset}\n`;
        out += `${bc}│${c.reset}${padRight('', inner)}${bc}│${c.reset}\n`;

        if (this.updates.length === 0) {
            out += `${bc}│${c.reset}  ${c.dim}No updates yet — agents use post_update() to share progress${c.reset}${padRight('', Math.max(0, inner - 62))}${bc}│${c.reset}\n`;
        } else {
            for (const u of this.updates.slice(-6)) {
                const time = new Date(u.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
                const maxMsg = inner - 22;
                const msg = stripAnsi(u.message).length > maxMsg ? u.message.substring(0, maxMsg - 3) + '...' : u.message;
                const fromPadded = padRight(u.from, 8);
                const line = `  ${c.gray}${time}${c.reset}  ${c.bold}${fromPadded}${c.reset} ${msg}`;
                out += `${bc}│${c.reset}${padRight(line, inner + (line.length - stripAnsi(line).length))}${bc}│${c.reset}\n`;
            }
        }

        out += `${bc}│${c.reset}${padRight('', inner)}${bc}│${c.reset}\n`;
        out += `${bc}├${'─'.repeat(inner)}┤${c.reset}\n`;

        // ═══ Shared Files ═══
        out += `${bc}│${c.reset} ${c.bold}${c.white} SHARED FILES${c.reset}${padRight('', inner - 14)}${bc}│${c.reset}\n`;
        out += `${bc}│${c.reset}${padRight('', inner)}${bc}│${c.reset}\n`;

        try {
            if (existsSync(sharedDir)) {
                const files = readdirSync(sharedDir);
                if (files.length === 0) {
                    out += `${bc}│${c.reset}  ${c.dim}No shared files — agents use share_file() to share documents${c.reset}${padRight('', Math.max(0, inner - 63))}${bc}│${c.reset}\n`;
                } else {
                    for (const f of files.slice(0, 6)) {
                        const stat = statSync(join(sharedDir, f));
                        const size = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(1)}KB`;
                        const modified = stat.mtime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
                        out += `${bc}│${c.reset}  ${c.green}📄${c.reset} ${padRight(f, 30)}${c.dim}${padRight(size, 10)}${modified}${c.reset}${padRight('', Math.max(0, inner - 55))}${bc}│${c.reset}\n`;
                    }
                    if (files.length > 6) {
                        out += `${bc}│${c.reset}  ${c.dim}...and ${files.length - 6} more${c.reset}${padRight('', Math.max(0, inner - 22))}${bc}│${c.reset}\n`;
                    }
                }
            } else {
                out += `${bc}│${c.reset}  ${c.dim}No shared files — agents use share_file() to share documents${c.reset}${padRight('', Math.max(0, inner - 63))}${bc}│${c.reset}\n`;
            }
        } catch {
            out += `${bc}│${c.reset}  ${c.dim}Unable to read shared directory${c.reset}${padRight('', Math.max(0, inner - 33))}${bc}│${c.reset}\n`;
        }

        out += `${bc}│${c.reset}${padRight('', inner)}${bc}│${c.reset}\n`;
        out += `${bc}├${'─'.repeat(inner)}┤${c.reset}\n`;

        // ═══ Footer ═══
        out += `${bc}│${c.reset}  ${c.dim}[r]${c.reset} refresh   ${c.dim}[q]${c.reset} back to menu${padRight('', Math.max(0, inner - 30))}${bc}│${c.reset}\n`;
        out += `${bc}╰${'─'.repeat(inner)}╯${c.reset}\n`;

        process.stdout.write(out);
    }

    private formatUptime(): string {
        const s = Math.floor((Date.now() - this.startTime) / 1000);
        if (s < 60) return `${s}s`;
        if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
        return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    }

    private cleanup(): void {
        this.destroyed = true; // Stop all reconnect timers
        if (this.interval) { clearInterval(this.interval); this.interval = null; }
        if (this.ws) {
            try { this.ws.close(); } catch { }
            this.ws = null;
        }
        process.stdout.write(cursor.show + screen.clear);
    }
}

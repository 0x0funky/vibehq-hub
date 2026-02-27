import * as pty from 'node-pty';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import WebSocket from 'ws';
import type {
    AgentStatusBroadcastMessage,
    AgentDisconnectedMessage,
    RelayQuestionMessage,
    RelayTaskMessage,
    RelayReplyDeliveredMessage,
    SpawnerSubscribedMessage,
    Agent,
} from '../shared/types.js';

/**
 * Resolve a command name to its full path on Windows.
 */
function resolveCommand(command: string): string {
    if (process.platform !== 'win32') return command;
    try {
        const result = execSync(`where.exe ${command}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const lines = result.split(/\r?\n/);
        return lines.find(l => l.endsWith('.cmd') || l.endsWith('.exe')) || lines[0] || command;
    } catch {
        return command;
    }
}

export interface SpawnerOptions {
    name: string;
    role: string;
    hubUrl: string;
    command: string;
    args: string[];
}

export class AgentSpawner {
    private ptyProcess: pty.IPty | null = null;
    private ws: WebSocket | null = null;
    private options: SpawnerOptions;
    private agentId: string | null = null;
    private teammates: Map<string, Agent> = new Map();

    constructor(options: SpawnerOptions) {
        this.options = options;
    }

    async start(): Promise<void> {
        this.autoConfigureMcp();
        this.spawnCli();
        await this.connectToHub();
    }

    /**
     * Auto-configure MCP for the CLI being spawned.
     * Detects CLI type and writes config with matching name/role/hub.
     */
    private autoConfigureMcp(): void {
        const { name, role, hubUrl, command } = this.options;
        const cmd = command.toLowerCase();

        if (cmd === 'claude' || cmd.includes('claude')) {
            this.configureClaudeMcp(name, role, hubUrl);
        } else if (cmd === 'codex' || cmd.includes('codex')) {
            this.configureCodexMcp(name, role, hubUrl);
        }
    }

    /**
     * Write .mcp.json for Claude Code in CWD.
     */
    private configureClaudeMcp(name: string, role: string, hubUrl: string): void {
        const mcpPath = join(process.cwd(), '.mcp.json');
        let config: any = {};

        if (existsSync(mcpPath)) {
            try { config = JSON.parse(readFileSync(mcpPath, 'utf-8')); } catch { config = {}; }
        }

        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers.team = {
            command: 'vibehq-agent',
            args: ['--name', name, '--role', role, '--hub', hubUrl],
        };

        writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
    }

    /**
     * Update ~/.codex/config.toml for Codex CLI.
     */
    private configureCodexMcp(name: string, role: string, hubUrl: string): void {
        const configPath = join(homedir(), '.codex', 'config.toml');
        if (!existsSync(configPath)) return;

        let content = readFileSync(configPath, 'utf-8');

        // Remove existing [mcp_servers.team] block if present
        content = content.replace(/\[mcp_servers\.team\]\s*\n(?:(?!\[).*\n)*/g, '');
        content = content.trimEnd();

        // Append new team config
        const teamBlock = `\n\n[mcp_servers.team]\ncommand = "vibehq-agent"\nargs = ["--name", "${name}", "--role", "${role}", "--hub", "${hubUrl}"]\n`;
        content += teamBlock;

        writeFileSync(configPath, content);
    }

    private spawnCli(): void {
        const { command, args } = this.options;
        const resolvedCommand = resolveCommand(command);
        const cols = process.stdout.columns || 80;
        const rows = process.stdout.rows || 24;

        this.ptyProcess = pty.spawn(resolvedCommand, args, {
            name: 'xterm-color',
            cols,
            rows,
            cwd: process.cwd(),
            env: process.env as { [key: string]: string },
        });

        process.stdout.on('resize', () => {
            this.ptyProcess?.resize(
                process.stdout.columns || 80,
                process.stdout.rows || 24,
            );
        });

        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdin.resume();

        // User stdin → PTY (direct passthrough)
        process.stdin.on('data', (data) => {
            this.ptyProcess?.write(data.toString());
        });

        // PTY output → user stdout (direct passthrough, no parsing)
        this.ptyProcess.onData((data: string) => {
            process.stdout.write(data);
        });

        this.ptyProcess.onExit(({ exitCode }) => {
            this.cleanup();
            process.exit(exitCode);
        });
    }

    private connectToHub(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.options.hubUrl);

            this.ws.on('open', () => {
                // Subscribe as spawner — don't register as a new agent
                this.ws!.send(JSON.stringify({
                    type: 'spawner:subscribe',
                    name: this.options.name,
                }));
            });

            this.ws.on('message', (raw) => {
                let msg: any;
                try { msg = JSON.parse(raw.toString()); } catch { return; }

                switch (msg.type) {
                    case 'spawner:subscribed':
                        this.handleSubscribed(msg);
                        resolve();
                        break;
                    case 'agent:status:broadcast':
                        this.handleStatusBroadcast(msg);
                        break;
                    case 'agent:disconnected':
                        this.handleDisconnected(msg);
                        break;
                    case 'relay:question':
                        this.handleQuestion(msg);
                        break;
                    case 'relay:task':
                        this.handleTask(msg);
                        break;
                    case 'relay:reply:delivered':
                        this.handleReplyDelivered(msg);
                        break;
                }
            });

            this.ws.on('close', () => {
                setTimeout(() => this.connectToHub().catch(() => { }), 3000);
            });

            this.ws.on('error', (err) => {
                if (!this.agentId) reject(err);
            });
        });
    }

    /**
     * Write text to PTY in chunks, then press Enter.
     * PTY input buffers are limited (~4096 bytes), so long messages must be chunked.
     */
    private writeToPty(text: string): void {
        const CHUNK_SIZE = 512;
        const chunks: string[] = [];

        for (let i = 0; i < text.length; i += CHUNK_SIZE) {
            chunks.push(text.substring(i, i + CHUNK_SIZE));
        }

        const writeChunk = (index: number) => {
            if (index >= chunks.length) {
                // All chunks written — wait longer for large messages before pressing Enter
                const enterDelay = Math.max(300, chunks.length * 100);
                setTimeout(() => {
                    this.ptyProcess?.write('\r');
                }, enterDelay);
                return;
            }
            this.ptyProcess?.write(chunks[index]);
            // Delay between chunks to let PTY buffer drain
            setTimeout(() => writeChunk(index + 1), 80);
        };

        writeChunk(0);
    }

    /**
     * Inject a teammate's question into the CLI's PTY.
     * The agent should use reply_to_team MCP tool to respond.
     */
    private handleQuestion(msg: RelayQuestionMessage): void {
        const prompt = `[Team question from ${msg.fromAgent}]: ${msg.question} — Use the reply_to_team tool to respond to ${msg.fromAgent}.`;
        this.writeToPty(prompt);
    }

    /**
     * Inject a task assignment (fire-and-forget).
     */
    private handleTask(msg: RelayTaskMessage): void {
        const prompt = `[Task from ${msg.fromAgent}, priority: ${msg.priority}]: ${msg.task}`;
        this.writeToPty(prompt);
    }

    /**
     * Inject a teammate's reply into the CLI's PTY.
     */
    private handleReplyDelivered(msg: RelayReplyDeliveredMessage): void {
        const prompt = `[Reply from ${msg.fromAgent}]: ${msg.message}`;
        this.writeToPty(prompt);
    }

    // --- Hub handlers ---

    private handleSubscribed(msg: SpawnerSubscribedMessage): void {
        this.agentId = msg.name;
        this.teammates.clear();
        for (const agent of msg.teammates) {
            this.teammates.set(agent.id, agent);
        }
    }

    private handleStatusBroadcast(msg: AgentStatusBroadcastMessage): void {
        if (msg.agentId === this.agentId) return;
        const existing = this.teammates.get(msg.agentId);
        if (existing) {
            existing.status = msg.status;
        } else {
            this.teammates.set(msg.agentId, {
                id: msg.agentId, name: msg.name, role: '', capabilities: [], status: msg.status,
            });
        }
    }

    private handleDisconnected(msg: AgentDisconnectedMessage): void {
        this.teammates.delete(msg.agentId);
    }

    private sendToHub(msg: any): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    private cleanup(): void {
        this.ws?.close();
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
    }
}

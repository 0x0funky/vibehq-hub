// ============================================================
// Agent Spawner — wraps a CLI process (PTY) + Hub connection
// No stdout parsing. Inject-only via stdin.
// ============================================================

import * as pty from 'node-pty';
import { execSync } from 'child_process';
import WebSocket from 'ws';
import type {
    AgentRegisterMessage,
    AgentRegisteredMessage,
    AgentStatusBroadcastMessage,
    AgentDisconnectedMessage,
    RelayQuestionMessage,
    RelayTaskMessage,
    RelayReplyDeliveredMessage,
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
        this.spawnCli();
        await this.connectToHub();
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
                this.ws!.send(JSON.stringify({
                    type: 'agent:register',
                    name: this.options.name,
                    role: this.options.role,
                } satisfies AgentRegisterMessage));
            });

            this.ws.on('message', (raw) => {
                let msg: any;
                try { msg = JSON.parse(raw.toString()); } catch { return; }

                switch (msg.type) {
                    case 'agent:registered':
                        this.handleRegistered(msg);
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
        const CHUNK_SIZE = 1024;
        const chunks: string[] = [];

        for (let i = 0; i < text.length; i += CHUNK_SIZE) {
            chunks.push(text.substring(i, i + CHUNK_SIZE));
        }

        const writeChunk = (index: number) => {
            if (index >= chunks.length) {
                // All chunks written, send Enter
                setTimeout(() => {
                    this.ptyProcess?.write('\r');
                }, 100);
                return;
            }
            this.ptyProcess?.write(chunks[index]);
            // Small delay between chunks to let PTY buffer drain
            setTimeout(() => writeChunk(index + 1), 50);
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

    private handleRegistered(msg: AgentRegisteredMessage): void {
        this.agentId = msg.agentId;
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

// ============================================================
// Agent Spawner — wraps a CLI process (PTY) + Hub connection
// Zero logs to avoid corrupting the terminal.
// ============================================================

import * as pty from 'node-pty';
import { execSync } from 'child_process';
import WebSocket from 'ws';
import { ResponseParser } from './response-parser.js';
import type {
    AgentRegisterMessage,
    AgentRegisteredMessage,
    AgentStatusBroadcastMessage,
    AgentDisconnectedMessage,
    RelayQuestionMessage,
    RelayAnswerMessage,
    RelayTaskMessage,
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
    askTimeout?: number;
}

export class AgentSpawner {
    private ptyProcess: pty.IPty | null = null;
    private ws: WebSocket | null = null;
    private parser: ResponseParser;
    private options: SpawnerOptions;
    private agentId: string | null = null;
    private teammates: Map<string, Agent> = new Map();

    constructor(options: SpawnerOptions) {
        this.options = options;
        this.parser = new ResponseParser(options.askTimeout ?? 120000);
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

        // Handle terminal resize
        process.stdout.on('resize', () => {
            this.ptyProcess?.resize(
                process.stdout.columns || 80,
                process.stdout.rows || 24,
            );
        });

        // Raw mode for direct keypress forwarding
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdin.resume();

        // User stdin → PTY (direct, no processing)
        process.stdin.on('data', (data) => {
            this.ptyProcess?.write(data.toString());
        });

        // PTY output → response parser → user stdout
        this.ptyProcess.onData((data: string) => {
            const output = this.parser.feed(data);
            if (output) {
                process.stdout.write(output);
            }
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
     * Write text to PTY, then press Enter after a delay.
     */
    private writeToPty(text: string): void {
        this.ptyProcess?.write(text);
        // Delay before pressing Enter — let the TUI process the text first
        setTimeout(() => {
            this.ptyProcess?.write('\r');
        }, 200);
    }

    /**
     * Inject a teammate question into the CLI's PTY.
     */
    private async handleQuestion(msg: RelayQuestionMessage): Promise<void> {
        this.sendToHub({ type: 'agent:status', status: 'working' });

        const responsePromise = this.parser.expectResponse(msg.requestId);

        // Inject question as a single line
        const prompt = `[Team question from ${msg.fromAgent}]: ${msg.question} — Reply between [TEAM_RESPONSE_START] and [TEAM_RESPONSE_END] markers.`;
        this.writeToPty(prompt);

        try {
            const response = await responsePromise;
            this.sendToHub({
                type: 'relay:answer',
                requestId: msg.requestId,
                answer: response,
            } satisfies RelayAnswerMessage);
        } catch {
            this.sendToHub({
                type: 'relay:answer',
                requestId: msg.requestId,
                answer: `[Error] Agent "${this.options.name}" did not respond in time.`,
            } satisfies RelayAnswerMessage);
        }

        this.sendToHub({ type: 'agent:status', status: 'idle' });
    }

    /**
     * Inject a task assignment (fire-and-forget).
     */
    private handleTask(msg: RelayTaskMessage): void {
        const prompt = `[Task from ${msg.fromAgent}, priority: ${msg.priority}]: ${msg.task}`;
        this.writeToPty(prompt);
    }

    // --- Hub handlers (no logs) ---

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
        this.parser.destroy();
        this.ws?.close();
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
    }
}

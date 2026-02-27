// ============================================================
// Agent Spawner — wraps a CLI process (PTY) + Hub connection
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
 * node-pty can't find .cmd/.bat files by name alone.
 */
function resolveCommand(command: string): string {
    if (process.platform !== 'win32') return command;

    try {
        const result = execSync(`where.exe ${command}`, { encoding: 'utf-8' }).trim();
        // `where` may return multiple lines; take the first .cmd or .exe match
        const lines = result.split(/\r?\n/);
        const cmdMatch = lines.find(l => l.endsWith('.cmd') || l.endsWith('.exe'));
        const resolved = cmdMatch || lines[0];
        if (resolved) {
            console.error(`[Spawner] Resolved "${command}" → ${resolved}`);
            return resolved;
        }
    } catch {
        // where.exe failed, try as-is
    }
    return command;
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

    /**
     * Start the spawner: spawn CLI in PTY + connect to Hub.
     */
    async start(): Promise<void> {
        // 1. Spawn the CLI process in a pseudo-terminal
        this.spawnCli();

        // 2. Connect to Hub
        await this.connectToHub();

        console.error(`[Spawner] Agent "${this.options.name}" ready — CLI: ${this.options.command}, Hub: ${this.options.hubUrl}`);
    }

    /**
     * Spawn the CLI in a pseudo-terminal so interactive UIs work.
     */
    private spawnCli(): void {
        const { command, args } = this.options;

        // Resolve command path (important on Windows for .cmd files)
        const resolvedCommand = resolveCommand(command);

        // Get terminal size
        const cols = process.stdout.columns || 80;
        const rows = process.stdout.rows || 24;

        // Spawn in PTY
        this.ptyProcess = pty.spawn(resolvedCommand, args, {
            name: 'xterm-color',
            cols,
            rows,
            cwd: process.cwd(),
            env: process.env as { [key: string]: string },
        });

        // Handle terminal resize
        process.stdout.on('resize', () => {
            const newCols = process.stdout.columns || 80;
            const newRows = process.stdout.rows || 24;
            this.ptyProcess?.resize(newCols, newRows);
        });

        // Set raw mode on stdin so keypresses go straight through
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdin.resume();

        // Pipe user's stdin to PTY
        process.stdin.on('data', (data) => {
            this.ptyProcess?.write(data.toString());
        });

        // Pipe PTY output through response parser to user's stdout
        this.ptyProcess.onData((data: string) => {
            const userOutput = this.parser.feed(data);
            if (userOutput) {
                process.stdout.write(userOutput);
            }
        });

        this.ptyProcess.onExit(({ exitCode }) => {
            console.error(`\n[Spawner] CLI process exited with code ${exitCode}`);
            this.cleanup();
            process.exit(exitCode);
        });
    }

    /**
     * Connect to the Hub WebSocket server.
     */
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
                try {
                    msg = JSON.parse(raw.toString());
                } catch {
                    return;
                }

                switch (msg.type) {
                    case 'agent:registered':
                        this.handleRegistered(msg as AgentRegisteredMessage);
                        resolve();
                        break;

                    case 'agent:status:broadcast':
                        this.handleStatusBroadcast(msg as AgentStatusBroadcastMessage);
                        break;

                    case 'agent:disconnected':
                        this.handleDisconnected(msg as AgentDisconnectedMessage);
                        break;

                    case 'relay:question':
                        this.handleQuestion(msg as RelayQuestionMessage);
                        break;

                    case 'relay:task':
                        this.handleTask(msg as RelayTaskMessage);
                        break;
                }
            });

            this.ws.on('close', () => {
                console.error(`[Spawner] Lost connection to Hub. Reconnecting...`);
                setTimeout(() => this.connectToHub().catch(() => { }), 3000);
            });

            this.ws.on('error', (err) => {
                if (!this.agentId) {
                    console.error(`[Spawner] Cannot connect to Hub at ${this.options.hubUrl}`);
                    console.error(`[Spawner] Make sure the Hub is running: vibehq-hub --port <port>`);
                    reject(err);
                }
            });
        });
    }

    /**
     * Inject a teammate's question into the CLI's stdin and capture response.
     */
    private async handleQuestion(msg: RelayQuestionMessage): Promise<void> {
        console.error(`\n[Spawner] 📨 Question from ${msg.fromAgent}: ${msg.question.substring(0, 80)}...`);

        // Update agent status to working
        this.sendToHub({ type: 'agent:status', status: 'working' });

        // Set up response capture BEFORE injecting
        const responsePromise = this.parser.expectResponse(msg.requestId);

        // Inject the question into CLI's PTY stdin
        const injectedPrompt = this.buildQuestionPrompt(msg.fromAgent, msg.question);
        this.ptyProcess?.write(injectedPrompt + '\r');

        try {
            // Wait for the CLI to respond (captured by response parser)
            const response = await responsePromise;
            console.error(`[Spawner] ✅ Response captured (${response.length} chars), sending back to ${msg.fromAgent}`);

            // Send answer back to Hub
            this.sendToHub({
                type: 'relay:answer',
                requestId: msg.requestId,
                answer: response,
            } satisfies RelayAnswerMessage);
        } catch (err) {
            console.error(`[Spawner] ❌ Failed to capture response:`, (err as Error).message);

            // Send error response
            this.sendToHub({
                type: 'relay:answer',
                requestId: msg.requestId,
                answer: `[Error] Agent "${this.options.name}" could not generate a response in time.`,
            } satisfies RelayAnswerMessage);
        }

        // Reset status
        this.sendToHub({ type: 'agent:status', status: 'idle' });
    }

    /**
     * Inject a task assignment into the CLI's stdin (fire-and-forget).
     */
    private handleTask(msg: RelayTaskMessage): void {
        console.error(`\n[Spawner] 📋 Task from ${msg.fromAgent} (${msg.priority}): ${msg.task.substring(0, 80)}...`);

        const injectedPrompt = this.buildTaskPrompt(msg.fromAgent, msg.task, msg.priority);
        this.ptyProcess?.write(injectedPrompt + '\r');
    }

    /**
     * Build the prompt to inject for a teammate question.
     */
    private buildQuestionPrompt(fromAgent: string, question: string): string {
        return [
            `[Teammate Message from ${fromAgent}]`,
            `${question}`,
            ``,
            `IMPORTANT: You MUST wrap your entire response to this teammate question between these exact markers:`,
            `[TEAM_RESPONSE_START]`,
            `(your response here)`,
            `[TEAM_RESPONSE_END]`,
            ``,
            `Respond directly and concisely to the question.`,
        ].join('\n');
    }

    /**
     * Build the prompt to inject for a task assignment.
     */
    private buildTaskPrompt(fromAgent: string, task: string, priority: string): string {
        return [
            `[Task Assignment from ${fromAgent}] (Priority: ${priority})`,
            `${task}`,
            ``,
            `Please work on this task assigned by your teammate ${fromAgent}.`,
        ].join('\n');
    }

    // --- Hub message handlers ---

    private handleRegistered(msg: AgentRegisteredMessage): void {
        this.agentId = msg.agentId;
        this.teammates.clear();
        for (const agent of msg.teammates) {
            this.teammates.set(agent.id, agent);
        }
        console.error(`[Spawner] Registered as "${this.options.name}" — ${msg.teammates.length} teammate(s) online`);
    }

    private handleStatusBroadcast(msg: AgentStatusBroadcastMessage): void {
        if (msg.agentId === this.agentId) return;
        const existing = this.teammates.get(msg.agentId);
        if (existing) {
            existing.status = msg.status;
        } else {
            this.teammates.set(msg.agentId, {
                id: msg.agentId,
                name: msg.name,
                role: '',
                capabilities: [],
                status: msg.status,
            });
            console.error(`[Spawner] 👋 Teammate "${msg.name}" came online`);
        }
    }

    private handleDisconnected(msg: AgentDisconnectedMessage): void {
        const agent = this.teammates.get(msg.agentId);
        this.teammates.delete(msg.agentId);
        if (agent) {
            console.error(`[Spawner] 👋 Teammate "${agent.name}" disconnected`);
        }
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

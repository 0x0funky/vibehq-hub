// ============================================================
// Agent Spawner — wraps a CLI process + Hub connection
// ============================================================

import { spawn, ChildProcess } from 'child_process';
import WebSocket from 'ws';
import { randomUUID } from 'crypto';
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

export interface SpawnerOptions {
    name: string;
    role: string;
    hubUrl: string;
    command: string;
    args: string[];
    askTimeout?: number;
}

export class AgentSpawner {
    private child: ChildProcess | null = null;
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
     * Start the spawner: spawn CLI process + connect to Hub.
     */
    async start(): Promise<void> {
        // 1. Spawn the CLI process
        this.spawnCli();

        // 2. Connect to Hub
        await this.connectToHub();

        console.error(`[Spawner] Agent "${this.options.name}" ready — CLI: ${this.options.command}, Hub: ${this.options.hubUrl}`);
    }

    /**
     * Spawn the CLI as a child process with interactive stdin/stdout.
     */
    private spawnCli(): void {
        const { command, args } = this.options;

        this.child = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'inherit'], // stdin: pipe, stdout: pipe, stderr: inherit
            shell: true,
            env: { ...process.env },
        });

        // Pipe user's stdin to child's stdin
        process.stdin.setRawMode?.(false);
        process.stdin.on('data', (data) => {
            this.child?.stdin?.write(data);
        });

        // Pipe child's stdout through response parser to user's stdout
        this.child.stdout?.on('data', (data: Buffer) => {
            const text = data.toString();
            const userOutput = this.parser.feed(text);
            if (userOutput) {
                process.stdout.write(userOutput);
            }
        });

        this.child.on('exit', (code) => {
            console.error(`\n[Spawner] CLI process exited with code ${code}`);
            this.cleanup();
            process.exit(code ?? 0);
        });

        this.child.on('error', (err) => {
            console.error(`[Spawner] Failed to spawn "${command}":`, err.message);
            process.exit(1);
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

        // Inject the question into CLI's stdin
        const injectedPrompt = this.buildQuestionPrompt(msg.fromAgent, msg.question);
        this.child?.stdin?.write(injectedPrompt + '\n');

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
        this.child?.stdin?.write(injectedPrompt + '\n');
    }

    /**
     * Build the prompt to inject for a teammate question.
     * Asks the CLI to wrap its response in markers for capture.
     */
    private buildQuestionPrompt(fromAgent: string, question: string): string {
        return [
            ``,
            `[Teammate Message from ${fromAgent}]`,
            `${question}`,
            ``,
            `IMPORTANT: You MUST wrap your entire response to this teammate question between these exact markers:`,
            `[TEAM_RESPONSE_START]`,
            `(your response here)`,
            `[TEAM_RESPONSE_END]`,
            ``,
            `Respond directly and concisely to the question. Do not include the markers in your explanation, just use them to wrap your answer.`,
        ].join('\n');
    }

    /**
     * Build the prompt to inject for a task assignment.
     */
    private buildTaskPrompt(fromAgent: string, task: string, priority: string): string {
        return [
            ``,
            `[Task Assignment from ${fromAgent}] (Priority: ${priority})`,
            `${task}`,
            ``,
            `Please work on this task. This was assigned by your teammate ${fromAgent}.`,
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
    }
}

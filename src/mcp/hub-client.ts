// ============================================================
// Hub Client — WS client for connecting MCP Agent to Hub
// ============================================================

import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import type {
    Agent,
    AgentRegisterMessage,
    AgentRegisteredMessage,
    AgentStatusBroadcastMessage,
    AgentDisconnectedMessage,
    RelayAskMessage,
    RelayQuestionMessage,
    RelayAnswerMessage,
    RelayResponseMessage,
    RelayAssignMessage,
    RelayTaskMessage,
    AgentStatus,
    TaskPriority,
} from '../shared/types.js';

interface PendingAsk {
    resolve: (answer: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

export class HubClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private hubUrl: string;
    private agentName: string;
    private agentRole: string;
    private agentId: string | null = null;
    private teammates: Map<string, Agent> = new Map();
    private pendingAsks: Map<string, PendingAsk> = new Map();
    private askTimeout: number;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(hubUrl: string, name: string, role: string, askTimeout = 120000) {
        super();
        this.hubUrl = hubUrl;
        this.agentName = name;
        this.agentRole = role;
        this.askTimeout = askTimeout;
    }

    /**
     * Connect to the Hub server.
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.hubUrl);

                this.ws.on('open', () => {
                    // Register with the Hub
                    this.send({
                        type: 'agent:register',
                        name: this.agentName,
                        role: this.agentRole,
                    } satisfies AgentRegisterMessage);
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
                            this.emit('relay:question', msg as RelayQuestionMessage);
                            break;

                        case 'relay:response':
                            this.handleResponse(msg as RelayResponseMessage);
                            break;

                        case 'relay:task':
                            this.emit('relay:task', msg as RelayTaskMessage);
                            break;
                    }
                });

                this.ws.on('close', () => {
                    console.error(`[HubClient] Connection to Hub lost. Attempting reconnect...`);
                    this.scheduleReconnect();
                });

                this.ws.on('error', (err) => {
                    console.error(`[HubClient] WebSocket error:`, err.message);
                    if (!this.agentId) {
                        reject(err);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Send a raw message to the Hub.
     */
    send(msg: any): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    /**
     * Ask a teammate a question (synchronous, waits for response).
     */
    async ask(teammateName: string, question: string): Promise<{ from: string; response: string }> {
        const requestId = randomUUID();

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingAsks.delete(requestId);
                reject(new Error(`Timeout: No response from "${teammateName}" within ${this.askTimeout / 1000}s`));
            }, this.askTimeout);

            this.pendingAsks.set(requestId, {
                resolve: (answer) => {
                    resolve({ from: teammateName, response: answer });
                }, reject, timer
            });

            this.send({
                type: 'relay:ask',
                requestId,
                fromAgent: this.agentName,
                toAgent: teammateName,
                question,
            } satisfies RelayAskMessage);
        });
    }

    /**
     * Assign a task to a teammate (fire-and-forget).
     */
    assign(teammateName: string, task: string, priority: TaskPriority = 'medium'): { taskId: string } {
        const requestId = randomUUID();

        this.send({
            type: 'relay:assign',
            requestId,
            fromAgent: this.agentName,
            toAgent: teammateName,
            task,
            priority,
        } satisfies RelayAssignMessage);

        return { taskId: requestId };
    }

    /**
     * Update this agent's status on the Hub.
     */
    updateStatus(status: AgentStatus): void {
        this.send({ type: 'agent:status', status });
    }

    /**
     * Get all known teammates.
     */
    getTeammates(): Agent[] {
        return Array.from(this.teammates.values());
    }

    /**
     * Get a specific teammate by name.
     */
    getTeammate(name: string): Agent | undefined {
        for (const agent of this.teammates.values()) {
            if (agent.name.toLowerCase() === name.toLowerCase()) {
                return agent;
            }
        }
        return undefined;
    }

    /**
     * Send an answer back to the Hub for a relay:question.
     */
    sendAnswer(requestId: string, answer: string): void {
        this.send({
            type: 'relay:answer',
            requestId,
            answer,
        } satisfies RelayAnswerMessage);
    }

    // --- Private handlers ---

    private handleRegistered(msg: AgentRegisteredMessage): void {
        this.agentId = msg.agentId;
        this.teammates.clear();
        for (const agent of msg.teammates) {
            this.teammates.set(agent.id, agent);
        }
        console.error(`[HubClient] Registered as "${this.agentName}" (${this.agentId}), ${msg.teammates.length} teammates online`);
    }

    private handleStatusBroadcast(msg: AgentStatusBroadcastMessage): void {
        const existing = this.teammates.get(msg.agentId);
        if (existing) {
            existing.status = msg.status;
        } else if (msg.agentId !== this.agentId) {
            // New agent joined
            this.teammates.set(msg.agentId, {
                id: msg.agentId,
                name: msg.name,
                role: '',
                capabilities: [],
                status: msg.status,
            });
        }
    }

    private handleDisconnected(msg: AgentDisconnectedMessage): void {
        this.teammates.delete(msg.agentId);
    }

    private handleResponse(msg: RelayResponseMessage): void {
        const pending = this.pendingAsks.get(msg.requestId);
        if (pending) {
            clearTimeout(pending.timer);
            this.pendingAsks.delete(msg.requestId);
            pending.resolve(msg.answer);
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            try {
                await this.connect();
            } catch {
                this.scheduleReconnect();
            }
        }, 3000);
    }
}

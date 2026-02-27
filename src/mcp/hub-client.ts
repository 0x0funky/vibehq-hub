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
    RelayReplyMessage,
    RelayReplyDeliveredMessage,
    TeamUpdate,
    TeamUpdatePostMessage,
    TeamUpdateListRequestMessage,
    TeamUpdateListResponseMessage,
    TeamUpdateBroadcastMessage,
    AgentStatus,
    TaskPriority,
} from '../shared/types.js';

export class HubClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private hubUrl: string;
    private agentName: string;
    private agentRole: string;
    private agentTeam: string;
    private agentId: string | null = null;
    private teammates: Map<string, Agent> = new Map();
    private askTimeout: number;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingUpdateRequests: Map<string, (updates: TeamUpdate[]) => void> = new Map();

    constructor(hubUrl: string, name: string, role: string, team = 'default', askTimeout = 120000) {
        super();
        this.hubUrl = hubUrl;
        this.agentName = name;
        this.agentRole = role;
        this.agentTeam = team;
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
                        team: this.agentTeam,
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
                            break;

                        case 'relay:task':
                            this.emit('relay:task', msg as RelayTaskMessage);
                            break;

                        case 'relay:reply:delivered':
                            this.emit('relay:reply', msg as RelayReplyDeliveredMessage);
                            break;

                        case 'team:update:broadcast':
                            this.emit('team:update', (msg as TeamUpdateBroadcastMessage).update);
                            break;

                        case 'team:update:list:response':
                            this.handleUpdateListResponse(msg as TeamUpdateListResponseMessage);
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
     * Ask a teammate a question (fire-and-forget).
     */
    ask(teammateName: string, question: string): string {
        const requestId = randomUUID();

        this.send({
            type: 'relay:ask',
            requestId,
            fromAgent: this.agentName,
            toAgent: teammateName,
            question,
        } satisfies RelayAskMessage);

        return requestId;
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
     * Send an async reply to a teammate.
     */
    reply(teammateName: string, message: string): void {
        this.send({
            type: 'relay:reply',
            toAgent: teammateName,
            message,
        } satisfies RelayReplyMessage);
    }

    /**
     * Post a team update.
     */
    postUpdate(message: string): void {
        this.send({
            type: 'team:update:post',
            message,
        } satisfies TeamUpdatePostMessage);
    }

    /**
     * Get recent team updates.
     */
    async getUpdates(limit = 20): Promise<TeamUpdate[]> {
        return new Promise((resolve) => {
            const requestId = randomUUID();
            this.pendingUpdateRequests.set(requestId, resolve);

            this.send({
                type: 'team:update:list',
                limit,
            } satisfies TeamUpdateListRequestMessage);

            // Resolve with the next response within 5s
            setTimeout(() => {
                if (this.pendingUpdateRequests.has(requestId)) {
                    this.pendingUpdateRequests.delete(requestId);
                    resolve([]);
                }
            }, 5000);
        });
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
     * Get the team name.
     */
    getTeam(): string {
        return this.agentTeam;
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
        this.agentTeam = msg.team;
        this.teammates.clear();
        for (const agent of msg.teammates) {
            this.teammates.set(agent.id, agent);
        }
        console.error(`[HubClient] Registered as "${this.agentName}" (${this.agentId}), team="${this.agentTeam}", ${msg.teammates.length} teammates online`);
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

    private handleUpdateListResponse(msg: TeamUpdateListResponseMessage): void {
        // Resolve the first pending request
        for (const [id, resolve] of this.pendingUpdateRequests.entries()) {
            this.pendingUpdateRequests.delete(id);
            resolve(msg.updates);
            break;
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

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
    TaskState,
    TaskCreateMessage,
    TaskAcceptMessage,
    TaskUpdateMessage,
    TaskCompleteMessage,
    TaskListRequestMessage,
    TaskListResponseMessage,
    ArtifactMeta,
    ArtifactType,
    ArtifactPublishMessage,
    ArtifactListRequestMessage,
    ArtifactListResponseMessage,
    ContractPublishMessage,
    ContractSignMessage,
    ContractCheckMessage,
    ContractCheckResponseMessage,
    ContractState,
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
    private agentCli: string | undefined;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingUpdateRequests: Map<string, (updates: TeamUpdate[]) => void> = new Map();
    private pendingTaskListRequests: Map<string, (tasks: TaskState[]) => void> = new Map();
    private pendingArtifactListRequests: Map<string, (artifacts: ArtifactMeta[]) => void> = new Map();
    private pendingContractCheckRequests: Map<string, (contracts: ContractState[]) => void> = new Map();

    constructor(hubUrl: string, name: string, role: string, team = 'default', askTimeout = 120000, cli?: string) {
        super();
        this.hubUrl = hubUrl;
        this.agentName = name;
        this.agentRole = role;
        this.agentTeam = team;
        this.askTimeout = askTimeout;
        this.agentCli = cli;
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
                        cli: this.agentCli,
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

                        // V2: Task lifecycle
                        case 'task:created':
                            this.emit('task:created', msg.task);
                            break;
                        case 'task:status:broadcast':
                            this.emit('task:status', msg.task);
                            break;
                        case 'task:list:response':
                            this.handleTaskListResponse(msg as TaskListResponseMessage);
                            break;

                        // V2: Artifact
                        case 'artifact:changed':
                            this.emit('artifact:changed', msg.artifact, msg.action);
                            break;
                        case 'artifact:list:response':
                            this.handleArtifactListResponse(msg as ArtifactListResponseMessage);
                            break;

                        // V2: Contract
                        case 'contract:status':
                            this.emit('contract:status', msg.contract);
                            break;
                        case 'contract:check:response':
                            this.handleContractCheckResponse(msg as ContractCheckResponseMessage);
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
            if (msg.role) existing.role = msg.role;
        } else if (msg.agentId !== this.agentId) {
            // New agent joined
            this.teammates.set(msg.agentId, {
                id: msg.agentId,
                name: msg.name,
                role: msg.role || '',
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

    private handleTaskListResponse(msg: TaskListResponseMessage): void {
        for (const [id, resolve] of this.pendingTaskListRequests.entries()) {
            this.pendingTaskListRequests.delete(id);
            resolve(msg.tasks);
            break;
        }
    }

    private handleArtifactListResponse(msg: ArtifactListResponseMessage): void {
        for (const [id, resolve] of this.pendingArtifactListRequests.entries()) {
            this.pendingArtifactListRequests.delete(id);
            resolve(msg.artifacts);
            break;
        }
    }

    private handleContractCheckResponse(msg: ContractCheckResponseMessage): void {
        for (const [id, resolve] of this.pendingContractCheckRequests.entries()) {
            this.pendingContractCheckRequests.delete(id);
            resolve(msg.contracts);
            break;
        }
    }

    // --- V2: Task Lifecycle ---

    createTask(title: string, description: string, assignee: string, priority: TaskPriority = 'medium', extra?: {
        outputTarget?: { directory?: string; filenames?: string[]; integrates_into?: string };
        consumes?: { artifact: string; owner: string }[];
        produces?: { artifact?: string; shared_files?: string[] };
        dependsOn?: { task_id?: string; artifact?: string }[];
    }): void {
        this.send({
            type: 'task:create', title, description, assignee, priority,
            ...(extra?.outputTarget && { outputTarget: extra.outputTarget }),
            ...(extra?.consumes && { consumes: extra.consumes }),
            ...(extra?.produces && { produces: extra.produces }),
            ...(extra?.dependsOn && { dependsOn: extra.dependsOn }),
        } satisfies TaskCreateMessage);
    }

    acceptTask(taskId: string, accepted: boolean, note?: string): void {
        this.send({ type: 'task:accept', taskId, accepted, note } satisfies TaskAcceptMessage);
    }

    updateTask(taskId: string, status: 'in_progress' | 'blocked', note?: string): void {
        this.send({ type: 'task:update', taskId, status, note } satisfies TaskUpdateMessage);
    }

    completeTask(taskId: string, artifact: string, note?: string): void {
        this.send({ type: 'task:complete', taskId, artifact, note } satisfies TaskCompleteMessage);
    }

    async listTasks(filter: 'all' | 'mine' | 'active' = 'all'): Promise<TaskState[]> {
        return new Promise((resolve) => {
            const requestId = randomUUID();
            this.pendingTaskListRequests.set(requestId, resolve);
            this.send({ type: 'task:list', filter } satisfies TaskListRequestMessage);
            setTimeout(() => {
                if (this.pendingTaskListRequests.has(requestId)) {
                    this.pendingTaskListRequests.delete(requestId);
                    resolve([]);
                }
            }, 5000);
        });
    }

    // --- V2: Artifact ---

    publishArtifact(filename: string, artifactType: ArtifactType, summary: string, relatesTo?: string): void {
        this.send({ type: 'artifact:publish', filename, artifactType, summary, relatesTo } satisfies ArtifactPublishMessage);
    }

    async listArtifacts(artifactType?: ArtifactType): Promise<ArtifactMeta[]> {
        return new Promise((resolve) => {
            const requestId = randomUUID();
            this.pendingArtifactListRequests.set(requestId, resolve);
            this.send({ type: 'artifact:list', artifactType } satisfies ArtifactListRequestMessage);
            setTimeout(() => {
                if (this.pendingArtifactListRequests.has(requestId)) {
                    this.pendingArtifactListRequests.delete(requestId);
                    resolve([]);
                }
            }, 5000);
        });
    }

    // --- V2: Contract ---

    publishContract(specPath: string, requiredSigners: string[], contractType?: 'api' | 'interface' | 'schema', schemaValidation?: { format?: string; required_keys?: string[] }): void {
        this.send({
            type: 'contract:publish', specPath, requiredSigners,
            ...(contractType && { contractType }),
            ...(schemaValidation && { schemaValidation }),
        } satisfies ContractPublishMessage);
    }

    signContract(specPath: string, comment?: string): void {
        this.send({ type: 'contract:sign', specPath, comment } satisfies ContractSignMessage);
    }

    async checkContract(specPath?: string): Promise<ContractState[]> {
        return new Promise((resolve) => {
            const requestId = randomUUID();
            this.pendingContractCheckRequests.set(requestId, resolve);
            this.send({ type: 'contract:check', specPath } satisfies ContractCheckMessage);
            setTimeout(() => {
                if (this.pendingContractCheckRequests.has(requestId)) {
                    this.pendingContractCheckRequests.delete(requestId);
                    resolve([]);
                }
            }, 5000);
        });
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

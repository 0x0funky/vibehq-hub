// ============================================================
// Relay Engine — routes messages between agents
// ============================================================

import { WebSocket } from 'ws';
import type { AgentRegistry } from './registry.js';
import type {
    RelayAskMessage,
    RelayAssignMessage,
    RelayAnswerMessage,
    RelayQuestionMessage,
    RelayResponseMessage,
    RelayTaskMessage,
    RelayReplyMessage,
    RelayReplyDeliveredMessage,
    RelayStartMessage,
    RelayDoneMessage,
    TaskPriority,
} from '../shared/types.js';

interface PendingRequest {
    sourceWs: WebSocket;
    fromAgent: string;
    toAgent: string;
    timestamp: number;
}

export class RelayEngine {
    private registry: AgentRegistry;
    private pendingRequests: Map<string, PendingRequest> = new Map();
    private verbose: boolean;

    constructor(registry: AgentRegistry, verbose = false) {
        this.registry = registry;
        this.verbose = verbose;
    }

    handleAsk(sourceWs: WebSocket, msg: RelayAskMessage): void {
        const target = this.registry.getAgentByName(msg.toAgent);
        if (!target) {
            sourceWs.send(JSON.stringify({
                type: 'relay:response', requestId: msg.requestId, fromAgent: msg.toAgent,
                answer: `Error: Agent "${msg.toAgent}" is not connected.`,
            } satisfies RelayResponseMessage));
            return;
        }

        this.pendingRequests.set(msg.requestId, {
            sourceWs, fromAgent: msg.fromAgent, toAgent: msg.toAgent, timestamp: Date.now(),
        });

        this.registry.broadcastToAll({
            type: 'relay:start', fromAgent: msg.fromAgent, toAgent: msg.toAgent, requestId: msg.requestId,
        } satisfies RelayStartMessage);

        const questionPayload = {
            type: 'relay:question', requestId: msg.requestId, fromAgent: msg.fromAgent, question: msg.question,
        } satisfies RelayQuestionMessage;

        target.ws.send(JSON.stringify(questionPayload));
        // Also forward to spawners shadowing this agent
        this.sendToSpawners(msg.toAgent, questionPayload);

        this.log(`Ask: ${msg.fromAgent} → ${msg.toAgent} [${msg.requestId}]`);
    }

    handleAnswer(msg: RelayAnswerMessage): void {
        const pending = this.pendingRequests.get(msg.requestId);
        if (!pending) {
            this.log(`Warning: No pending request for ${msg.requestId}`);
            return;
        }

        this.pendingRequests.delete(msg.requestId);

        if (pending.sourceWs.readyState === WebSocket.OPEN) {
            pending.sourceWs.send(JSON.stringify({
                type: 'relay:response', requestId: msg.requestId, fromAgent: pending.toAgent, answer: msg.answer,
            } satisfies RelayResponseMessage));
        }

        this.registry.broadcastToAll({
            type: 'relay:done', fromAgent: pending.fromAgent, toAgent: pending.toAgent, requestId: msg.requestId,
        } satisfies RelayDoneMessage);

        this.log(`Answer: ${pending.toAgent} → ${pending.fromAgent} [${msg.requestId}]`);
    }

    handleAssign(sourceWs: WebSocket, msg: RelayAssignMessage): void {
        const target = this.registry.getAgentByName(msg.toAgent);
        if (!target) {
            sourceWs.send(JSON.stringify({
                type: 'relay:response', requestId: msg.requestId, fromAgent: msg.toAgent,
                answer: `Error: Agent "${msg.toAgent}" is not connected.`,
            } satisfies RelayResponseMessage));
            return;
        }

        this.registry.broadcastToAll({
            type: 'relay:start', fromAgent: msg.fromAgent, toAgent: msg.toAgent, requestId: msg.requestId,
        } satisfies RelayStartMessage);

        const taskPayload = {
            type: 'relay:task', requestId: msg.requestId, fromAgent: msg.fromAgent,
            task: msg.task, priority: msg.priority ?? 'medium',
        } satisfies RelayTaskMessage;

        target.ws.send(JSON.stringify(taskPayload));
        this.sendToSpawners(msg.toAgent, taskPayload);

        this.registry.broadcastToAll({
            type: 'relay:done', fromAgent: msg.fromAgent, toAgent: msg.toAgent, requestId: msg.requestId,
        } satisfies RelayDoneMessage);

        this.log(`Assign: ${msg.fromAgent} → ${msg.toAgent} [${msg.requestId}] (priority: ${msg.priority ?? 'medium'})`);
    }

    /**
     * Handle relay:reply — async reply from one agent to another.
     */
    handleReply(sourceWs: WebSocket, msg: RelayReplyMessage, fromAgentName: string): void {
        const target = this.registry.getAgentByName(msg.toAgent);
        if (!target) {
            this.log(`Reply failed: Agent "${msg.toAgent}" not connected`);
            return;
        }

        const replyPayload = {
            type: 'relay:reply:delivered',
            fromAgent: fromAgentName,
            message: msg.message,
        } satisfies RelayReplyDeliveredMessage;

        target.ws.send(JSON.stringify(replyPayload));
        // Also forward to spawners shadowing the target agent
        this.sendToSpawners(msg.toAgent, replyPayload);

        this.log(`Reply: ${fromAgentName} → ${msg.toAgent}`);
    }

    /**
     * Forward a message to all spawners subscribed to an agent name.
     */
    private sendToSpawners(agentName: string, payload: any): void {
        const spawners = this.registry.getSpawnersForAgent(agentName);
        const data = JSON.stringify(payload);
        for (const ws of spawners) {
            ws.send(data);
        }
    }

    private log(message: string): void {
        if (this.verbose) {
            console.log(`[Relay] ${message}`);
        }
    }
}


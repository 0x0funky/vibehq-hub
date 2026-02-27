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

    /**
     * Handle a relay:ask message — route question to target agent.
     */
    handleAsk(sourceWs: WebSocket, msg: RelayAskMessage): void {
        const target = this.registry.getAgentByName(msg.toAgent);
        if (!target) {
            // Send error back to source
            sourceWs.send(JSON.stringify({
                type: 'relay:response',
                requestId: msg.requestId,
                fromAgent: msg.toAgent,
                answer: `Error: Agent "${msg.toAgent}" is not connected.`,
            } satisfies RelayResponseMessage));
            return;
        }

        // Track the pending request
        this.pendingRequests.set(msg.requestId, {
            sourceWs,
            fromAgent: msg.fromAgent,
            toAgent: msg.toAgent,
            timestamp: Date.now(),
        });

        // Broadcast relay:start event (for VibeHQ animations)
        this.registry.broadcastToAll({
            type: 'relay:start',
            fromAgent: msg.fromAgent,
            toAgent: msg.toAgent,
            requestId: msg.requestId,
        } satisfies RelayStartMessage);

        // Forward the question to target agent
        target.ws.send(JSON.stringify({
            type: 'relay:question',
            requestId: msg.requestId,
            fromAgent: msg.fromAgent,
            question: msg.question,
        } satisfies RelayQuestionMessage));

        this.log(`Ask: ${msg.fromAgent} → ${msg.toAgent} [${msg.requestId}]`);
    }

    /**
     * Handle a relay:answer message — route answer back to source agent.
     */
    handleAnswer(msg: RelayAnswerMessage): void {
        const pending = this.pendingRequests.get(msg.requestId);
        if (!pending) {
            this.log(`Warning: No pending request for ${msg.requestId}`);
            return;
        }

        this.pendingRequests.delete(msg.requestId);

        // Send response back to the source agent
        if (pending.sourceWs.readyState === WebSocket.OPEN) {
            pending.sourceWs.send(JSON.stringify({
                type: 'relay:response',
                requestId: msg.requestId,
                fromAgent: pending.toAgent,
                answer: msg.answer,
            } satisfies RelayResponseMessage));
        }

        // Broadcast relay:done event
        this.registry.broadcastToAll({
            type: 'relay:done',
            fromAgent: pending.fromAgent,
            toAgent: pending.toAgent,
            requestId: msg.requestId,
        } satisfies RelayDoneMessage);

        this.log(`Answer: ${pending.toAgent} → ${pending.fromAgent} [${msg.requestId}]`);
    }

    /**
     * Handle a relay:assign message — fire-and-forget task delivery.
     */
    handleAssign(sourceWs: WebSocket, msg: RelayAssignMessage): void {
        const target = this.registry.getAgentByName(msg.toAgent);
        if (!target) {
            sourceWs.send(JSON.stringify({
                type: 'relay:response',
                requestId: msg.requestId,
                fromAgent: msg.toAgent,
                answer: `Error: Agent "${msg.toAgent}" is not connected.`,
            } satisfies RelayResponseMessage));
            return;
        }

        // Broadcast relay:start event
        this.registry.broadcastToAll({
            type: 'relay:start',
            fromAgent: msg.fromAgent,
            toAgent: msg.toAgent,
            requestId: msg.requestId,
        } satisfies RelayStartMessage);

        // Forward the task to target agent
        target.ws.send(JSON.stringify({
            type: 'relay:task',
            requestId: msg.requestId,
            fromAgent: msg.fromAgent,
            task: msg.task,
            priority: msg.priority ?? 'medium',
        } satisfies RelayTaskMessage));

        // Immediately broadcast relay:done (fire-and-forget)
        this.registry.broadcastToAll({
            type: 'relay:done',
            fromAgent: msg.fromAgent,
            toAgent: msg.toAgent,
            requestId: msg.requestId,
        } satisfies RelayDoneMessage);

        this.log(`Assign: ${msg.fromAgent} → ${msg.toAgent} [${msg.requestId}] (priority: ${msg.priority ?? 'medium'})`);
    }

    private log(message: string): void {
        if (this.verbose) {
            console.log(`[Relay] ${message}`);
        }
    }
}

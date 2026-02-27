// ============================================================
// Agent Registry — manages agent registration & state
// ============================================================

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import type { ConnectedAgent, ConnectedViewer } from './types.js';
import type {
    AgentRegisterMessage,
    AgentRegisteredMessage,
    AgentStatusBroadcastMessage,
    AgentDisconnectedMessage,
    Agent,
    AgentStatus,
    HubMessage,
} from '../shared/types.js';

export class AgentRegistry {
    private agents: Map<WebSocket, ConnectedAgent> = new Map();
    private viewers: Set<WebSocket> = new Set();
    private verbose: boolean;

    constructor(verbose = false) {
        this.verbose = verbose;
    }

    /**
     * Register a new agent upon WS connection.
     */
    register(ws: WebSocket, msg: AgentRegisterMessage): ConnectedAgent {
        const agentId = randomUUID();
        const agent: ConnectedAgent = {
            id: agentId,
            name: msg.name,
            role: msg.role ?? 'Engineer',
            capabilities: msg.capabilities ?? [],
            status: 'idle',
            ws,
        };

        this.agents.set(ws, agent);

        // Send registration confirmation with current teammates list
        const response: AgentRegisteredMessage = {
            type: 'agent:registered',
            agentId,
            teammates: this.getTeammatesFor(agentId),
        };
        ws.send(JSON.stringify(response));

        // Broadcast status to all others (including viewers)
        this.broadcastToAll({
            type: 'agent:status:broadcast',
            agentId: agent.id,
            name: agent.name,
            status: agent.status,
        } satisfies AgentStatusBroadcastMessage, ws);

        this.log(`Agent registered: ${agent.name} (${agent.role}) [${agentId}]`);
        return agent;
    }

    /**
     * Register a viewer (e.g. VibeHQ frontend).
     */
    registerViewer(ws: WebSocket): void {
        this.viewers.add(ws);
        this.log('Viewer connected');

        // Send current agents state to new viewer
        for (const agent of this.agents.values()) {
            ws.send(JSON.stringify({
                type: 'agent:status:broadcast',
                agentId: agent.id,
                name: agent.name,
                status: agent.status,
            } satisfies AgentStatusBroadcastMessage));
        }
    }

    /**
     * Unregister an agent or viewer when their WS disconnects.
     */
    unregister(ws: WebSocket): void {
        const agent = this.agents.get(ws);
        if (agent) {
            this.agents.delete(ws);
            this.broadcastToAll({
                type: 'agent:disconnected',
                agentId: agent.id,
                name: agent.name,
            } satisfies AgentDisconnectedMessage);
            this.log(`Agent disconnected: ${agent.name}`);
        }

        this.viewers.delete(ws);
    }

    /**
     * Update an agent's status.
     */
    updateStatus(ws: WebSocket, status: AgentStatus): void {
        const agent = this.agents.get(ws);
        if (!agent) return;

        agent.status = status;
        this.broadcastToAll({
            type: 'agent:status:broadcast',
            agentId: agent.id,
            name: agent.name,
            status: agent.status,
        } satisfies AgentStatusBroadcastMessage, ws);

        this.log(`Status update: ${agent.name} → ${status}`);
    }

    /**
     * Get agent by name (case-insensitive).
     */
    getAgentByName(name: string): ConnectedAgent | undefined {
        for (const agent of this.agents.values()) {
            if (agent.name.toLowerCase() === name.toLowerCase()) {
                return agent;
            }
        }
        return undefined;
    }

    /**
     * Get agent by WebSocket connection.
     */
    getAgentByWs(ws: WebSocket): ConnectedAgent | undefined {
        return this.agents.get(ws);
    }

    /**
     * Get all registered agents (without WS refs).
     */
    getAllAgents(): Agent[] {
        return Array.from(this.agents.values()).map(({ ws, ...agent }) => agent);
    }

    /**
     * Get teammates (all agents except the specified one).
     */
    private getTeammatesFor(excludeId: string): Agent[] {
        return this.getAllAgents().filter(a => a.id !== excludeId);
    }

    /**
     * Broadcast a message to all agents and viewers, optionally excluding one.
     */
    broadcastToAll(msg: HubMessage, excludeWs?: WebSocket): void {
        const data = JSON.stringify(msg);

        for (const agent of this.agents.values()) {
            if (agent.ws !== excludeWs && agent.ws.readyState === WebSocket.OPEN) {
                agent.ws.send(data);
            }
        }

        for (const viewer of this.viewers) {
            if (viewer !== excludeWs && viewer.readyState === WebSocket.OPEN) {
                viewer.send(data);
            }
        }
    }

    private log(message: string): void {
        if (this.verbose) {
            console.log(`[Registry] ${message}`);
        }
    }
}

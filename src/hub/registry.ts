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
    /** Spawner connections subscribed to an agent name */
    private spawners: Map<WebSocket, { name: string; team: string }> = new Map();
    private verbose: boolean;

    constructor(verbose = false) {
        this.verbose = verbose;
    }

    /**
     * Register a new agent upon WS connection.
     */
    register(ws: WebSocket, msg: AgentRegisterMessage): ConnectedAgent {
        const agentId = randomUUID();
        const team = msg.team || 'default';
        const agent: ConnectedAgent = {
            id: agentId,
            name: msg.name,
            role: msg.role ?? 'Engineer',
            capabilities: msg.capabilities ?? [],
            status: 'idle',
            team,
            ws,
        };

        this.agents.set(ws, agent);

        // Send registration confirmation with current teammates list
        const response: AgentRegisteredMessage = {
            type: 'agent:registered',
            agentId,
            team,
            teammates: this.getTeammatesFor(agentId, team),
        };
        ws.send(JSON.stringify(response));

        // Broadcast status to all others in same team (including viewers)
        this.broadcastToTeam(team, {
            type: 'agent:status:broadcast',
            agentId: agent.id,
            name: agent.name,
            role: agent.role,
            status: agent.status,
        } satisfies AgentStatusBroadcastMessage, ws);

        this.log(`Agent registered: ${agent.name} (${agent.role}) [${agentId}] team=${team}`);
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
                role: agent.role,
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
            this.broadcastToTeam(agent.team, {
                type: 'agent:disconnected',
                agentId: agent.id,
                name: agent.name,
            } satisfies AgentDisconnectedMessage);
            this.log(`Agent disconnected: ${agent.name}`);
        }

        // Also clean up spawner subscriptions
        if (this.spawners.has(ws)) {
            const info = this.spawners.get(ws);
            this.spawners.delete(ws);
            this.log(`Spawner disconnected for agent: ${info?.name}`);
        }

        this.viewers.delete(ws);
    }

    /**
     * Subscribe a spawner to shadow an agent name.
     */
    subscribeSpawner(ws: WebSocket, agentName: string, team = 'default'): { teammates: Agent[]; team: string } {
        this.spawners.set(ws, { name: agentName, team });
        this.log(`Spawner subscribed to agent: ${agentName} team=${team}`);
        return { teammates: this.getAllAgents(team), team };
    }

    /**
     * Get all spawner WebSocket connections for a given agent name.
     */
    getSpawnersForAgent(agentName: string): WebSocket[] {
        const result: WebSocket[] = [];
        for (const [ws, info] of this.spawners.entries()) {
            if (info.name.toLowerCase() === agentName.toLowerCase() && ws.readyState === WebSocket.OPEN) {
                result.push(ws);
            }
        }
        return result;
    }

    private statusCallbacks: ((agentId: string, status: AgentStatus) => void)[] = [];

    /**
     * Register a callback for agent status changes.
     */
    onStatusChange(cb: (agentId: string, status: AgentStatus) => void): void {
        this.statusCallbacks.push(cb);
    }

    /**
     * Update an agent's status.
     */
    updateStatus(ws: WebSocket, status: AgentStatus): void {
        const agent = this.agents.get(ws);
        if (!agent) return;

        agent.status = status;
        this.broadcastToTeam(agent.team, {
            type: 'agent:status:broadcast',
            agentId: agent.id,
            name: agent.name,
            role: agent.role,
            status: agent.status,
        } satisfies AgentStatusBroadcastMessage, ws);

        // Fire status change callbacks (for idle-aware queue flush)
        for (const cb of this.statusCallbacks) {
            cb(agent.id, status);
        }

        this.log(`Status update: ${agent.name} → ${status}`);
    }

    /**
     * Get agent by ID.
     */
    getAgentById(agentId: string): ConnectedAgent | undefined {
        for (const agent of this.agents.values()) {
            if (agent.id === agentId) return agent;
        }
        return undefined;
    }


    /**
     * Get agent by name (case-insensitive), optionally filtered by team.
     */
    getAgentByName(name: string, team?: string): ConnectedAgent | undefined {
        for (const agent of this.agents.values()) {
            if (agent.name.toLowerCase() === name.toLowerCase()) {
                if (team && agent.team !== team) continue;
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
     * Get agent name by WebSocket connection.
     */
    getAgentNameByWs(ws: WebSocket): string | undefined {
        return this.agents.get(ws)?.name;
    }

    /**
     * Get agent's team by WebSocket connection.
     */
    getAgentTeamByWs(ws: WebSocket): string | undefined {
        return this.agents.get(ws)?.team;
    }

    /**
     * Get all registered agents (without WS refs), optionally filtered by team.
     */
    getAllAgents(team?: string): Agent[] {
        return Array.from(this.agents.values())
            .filter(a => !team || a.team === team)
            .map(({ ws, ...agent }) => agent);
    }

    /**
     * Get teammates (all agents in same team except the specified one).
     */
    private getTeammatesFor(excludeId: string, team: string): Agent[] {
        return this.getAllAgents(team).filter(a => a.id !== excludeId);
    }

    /**
     * Broadcast a message to all agents and viewers in a team, optionally excluding one.
     */
    broadcastToTeam(team: string, msg: HubMessage, excludeWs?: WebSocket): void {
        const data = JSON.stringify(msg);

        for (const agent of this.agents.values()) {
            if (agent.team === team && agent.ws !== excludeWs && agent.ws.readyState === WebSocket.OPEN) {
                agent.ws.send(data);
            }
        }

        // Also send to spawners in the same team
        for (const [ws, info] of this.spawners.entries()) {
            if (info.team === team && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        }

        for (const viewer of this.viewers) {
            if (viewer !== excludeWs && viewer.readyState === WebSocket.OPEN) {
                viewer.send(data);
            }
        }
    }

    /**
     * Broadcast a message to all agents and viewers (all teams).
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

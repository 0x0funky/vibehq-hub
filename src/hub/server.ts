// ============================================================
// Hub Server — Central WebSocket server
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import { AgentRegistry } from './registry.js';
import { RelayEngine } from './relay.js';
import type { HubMessage, TeamUpdate, TeamUpdateBroadcastMessage, TeamUpdateListResponseMessage } from '../shared/types.js';

export interface HubOptions {
    port: number;
    verbose?: boolean;
}

export function startHub(options: HubOptions): WebSocketServer {
    const { port, verbose = false } = options;
    const registry = new AgentRegistry(verbose);
    const relay = new RelayEngine(registry, verbose);

    // Team updates store (in-memory, max 50 per team)
    const teamUpdates: Map<string, TeamUpdate[]> = new Map();

    const wss = new WebSocketServer({ port });

    wss.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`[AgentHub] Error: Port ${port} is already in use.`);
            console.error(`[AgentHub] Kill the process using it or use a different port: vibehq-hub --port <other>`);
            process.exit(1);
        }
        console.error(`[AgentHub] Server error:`, err);
    });

    wss.on('connection', (ws: WebSocket) => {
        if (verbose) {
            console.log(`[Hub] New connection`);
        }

        ws.on('message', (raw) => {
            let msg: HubMessage;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                console.error('[Hub] Invalid JSON received');
                return;
            }

            switch (msg.type) {
                case 'agent:register':
                    registry.register(ws, msg);
                    break;

                case 'relay:ask':
                    relay.handleAsk(ws, msg);
                    break;

                case 'relay:assign':
                    relay.handleAssign(ws, msg);
                    break;

                case 'relay:answer':
                    relay.handleAnswer(msg);
                    break;

                case 'relay:reply':
                    const agentName = registry.getAgentNameByWs(ws);
                    if (agentName) relay.handleReply(ws, msg, agentName);
                    break;

                case 'agent:status':
                    registry.updateStatus(ws, msg.status);
                    break;

                case 'viewer:connect':
                    registry.registerViewer(ws);
                    break;

                case 'spawner:subscribe': {
                    const team = msg.team || 'default';
                    const result = registry.subscribeSpawner(ws, msg.name, team);
                    ws.send(JSON.stringify({
                        type: 'spawner:subscribed',
                        name: msg.name,
                        team: result.team,
                        teammates: result.teammates,
                    }));
                    break;
                }

                case 'team:update:post': {
                    const poster = registry.getAgentByWs(ws);
                    if (!poster) break;

                    const update: TeamUpdate = {
                        from: poster.name,
                        message: msg.message,
                        timestamp: new Date().toISOString(),
                    };

                    // Store update
                    const team = poster.team || 'default';
                    if (!teamUpdates.has(team)) teamUpdates.set(team, []);
                    const updates = teamUpdates.get(team)!;
                    updates.push(update);
                    if (updates.length > 50) updates.shift();

                    // Broadcast to team
                    registry.broadcastToTeam(team, {
                        type: 'team:update:broadcast',
                        update,
                    } satisfies TeamUpdateBroadcastMessage);

                    if (verbose) {
                        console.log(`[Hub] Update from ${poster.name} (${team}): ${msg.message.substring(0, 80)}`);
                    }
                    break;
                }

                case 'team:update:list': {
                    const requester = registry.getAgentByWs(ws);
                    if (!requester) break;

                    const team = requester.team || 'default';
                    const allUpdates = teamUpdates.get(team) || [];
                    const limit = msg.limit || 20;

                    ws.send(JSON.stringify({
                        type: 'team:update:list:response',
                        updates: allUpdates.slice(-limit),
                    } satisfies TeamUpdateListResponseMessage));
                    break;
                }

                default:
                    if (verbose) {
                        console.log(`[Hub] Unknown message type: ${(msg as any).type}`);
                    }
            }
        });

        ws.on('close', () => {
            registry.unregister(ws);
            if (verbose) {
                console.log(`[Hub] Connection closed`);
            }
        });

        ws.on('error', (err) => {
            console.error(`[Hub] WebSocket error:`, err.message);
        });
    });

    console.log(`[AgentHub] Hub server running on ws://localhost:${port}`);
    return wss;
}

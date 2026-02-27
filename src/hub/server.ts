// ============================================================
// Hub Server — Central WebSocket server
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import { AgentRegistry } from './registry.js';
import { RelayEngine } from './relay.js';
import type { HubMessage } from '../shared/types.js';

export interface HubOptions {
    port: number;
    verbose?: boolean;
}

export function startHub(options: HubOptions): WebSocketServer {
    const { port, verbose = false } = options;
    const registry = new AgentRegistry(verbose);
    const relay = new RelayEngine(registry, verbose);

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

                case 'spawner:subscribe':
                    const teammates = registry.subscribeSpawner(ws, (msg as any).name);
                    ws.send(JSON.stringify({
                        type: 'spawner:subscribed',
                        name: (msg as any).name,
                        teammates,
                    }));
                    break;

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

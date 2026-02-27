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

                case 'agent:status':
                    registry.updateStatus(ws, msg.status);
                    break;

                case 'viewer:connect':
                    registry.registerViewer(ws);
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

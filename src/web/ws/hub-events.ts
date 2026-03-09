// ============================================================
// WebSocket: Hub Events — forward hub broadcasts to browser
// ============================================================

import WebSocket from 'ws';
import type { HubContext } from '../../hub/server.js';

const FORWARDED_TYPES = new Set([
    'agent:status:broadcast',
    'agent:disconnected',
    'team:update:broadcast',
    'task:created',
    'task:status:broadcast',
    'artifact:changed',
    'contract:status',
]);

export function handleHubEventsWs(
    browserWs: WebSocket,
    team: string,
    hubContext: HubContext,
    hubPort: number,
): void {
    // Connect to hub as a viewer
    const hubWs = new WebSocket(`ws://localhost:${hubPort}`);

    hubWs.on('open', () => {
        hubWs.send(JSON.stringify({ type: 'viewer:connect' }));
    });

    hubWs.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (FORWARDED_TYPES.has(msg.type)) {
                if (browserWs.readyState === WebSocket.OPEN) {
                    browserWs.send(raw.toString());
                }
            }
        } catch {
            // skip
        }
    });

    hubWs.on('error', () => {
        // Hub connection error — ignore
    });

    browserWs.on('close', () => {
        hubWs.close();
    });

    browserWs.on('error', () => {
        hubWs.close();
    });
}

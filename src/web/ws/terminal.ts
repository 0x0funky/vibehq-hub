// ============================================================
// WebSocket: Terminal — PTY ↔ browser xterm.js
// ============================================================

import type WebSocket from 'ws';
import type { PtyManager } from '../pty-manager.js';

export function handleTerminalWs(
    ws: WebSocket,
    team: string,
    agentName: string,
    ptyManager: PtyManager,
): void {
    if (!agentName) {
        ws.close(1008, 'Agent name required');
        return;
    }

    // Subscribe to PTY output (replays scrollback)
    ptyManager.subscribe(team, agentName, ws);

    ws.on('message', (raw) => {
        const data = raw.toString();

        // Check for JSON control messages
        if (data.startsWith('{')) {
            try {
                const msg = JSON.parse(data);
                if (msg.type === 'resize') {
                    if (msg.cols > 0 && msg.rows > 0) {
                        ptyManager.resize(team, agentName, msg.cols, msg.rows);
                    }
                    return; // always consume resize messages, even invalid ones
                }
            } catch {
                // Not JSON, treat as keyboard input
            }
        }

        // Regular keyboard input
        ptyManager.sendInput(team, agentName, data);
    });

    ws.on('close', () => {
        ptyManager.unsubscribe(team, agentName, ws);
    });
}

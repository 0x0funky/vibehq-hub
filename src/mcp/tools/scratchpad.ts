// ============================================================
// MCP Tool: Scratchpad — private notes only visible to the agent itself
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** In-memory scratchpad per agent (not broadcast to team) */
const notes: string[] = [];

export function registerScratchpad(server: McpServer): void {
    server.tool(
        'scratchpad',
        'Write a private note to yourself. NOT shared with teammates. Use this to think through problems, plan your approach, or draft ideas before posting to the team. Keeps your reasoning private and reduces team channel noise.',
        {
            note: z.string().describe('Your private thought, plan, or draft. Only you can see this.'),
            action: z.enum(['write', 'read', 'clear']).optional().describe('Action: "write" (default) to add a note, "read" to see all notes, "clear" to reset'),
        },
        async ({ note, action }) => {
            const act = action || 'write';

            if (act === 'clear') {
                const count = notes.length;
                notes.length = 0;
                return {
                    content: [{ type: 'text' as const, text: `Scratchpad cleared (${count} notes removed).` }],
                };
            }

            if (act === 'read') {
                if (notes.length === 0) {
                    return {
                        content: [{ type: 'text' as const, text: 'Scratchpad is empty.' }],
                    };
                }
                const formatted = notes.map((n, i) => `[${i + 1}] ${n}`).join('\n');
                return {
                    content: [{ type: 'text' as const, text: `Your private notes:\n${formatted}` }],
                };
            }

            // write
            notes.push(note);
            return {
                content: [{ type: 'text' as const, text: `Noted privately (${notes.length} total). This was NOT shared with the team.` }],
            };
        },
    );
}

// ============================================================
// MCP Tools: Team Updates — bulletin board for team progress
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HubClient } from '../hub-client.js';
import type { TeamUpdate } from '../../shared/types.js';

export function registerPostUpdate(server: McpServer, hubClient: HubClient): void {
    server.tool(
        'post_update',
        'Post a progress update visible to all teammates. Use this to announce completed work, decisions made, or status changes. Keep updates concise.',
        {
            message: z.string().describe('Progress update message (e.g. "API spec completed, saved to api-spec.md")'),
        },
        async ({ message }) => {
            try {
                hubClient.postUpdate(message);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ status: 'posted', message_preview: message.substring(0, 100) }),
                    }],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text' as const, text: `Error posting update: ${(err as Error).message}` }],
                    isError: true,
                };
            }
        },
    );
}

export function registerGetTeamUpdates(server: McpServer, hubClient: HubClient): void {
    server.tool(
        'get_team_updates',
        'Get recent progress updates from all teammates. Use this to check what the team has been working on.',
        {
            limit: z.number().optional().describe('Max number of updates to return (default: 20)'),
        },
        async ({ limit }) => {
            try {
                const updates = await hubClient.getUpdates(limit ?? 20);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ updates }, null, 2),
                    }],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text' as const, text: `Error getting updates: ${(err as Error).message}` }],
                    isError: true,
                };
            }
        },
    );
}

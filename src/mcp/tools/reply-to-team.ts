// ============================================================
// MCP Tool: reply_to_team — send an async reply to a teammate
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HubClient } from '../hub-client.js';

export function registerReplyToTeam(server: McpServer, hubClient: HubClient): void {
    server.tool(
        'reply_to_team',
        'Send a reply or message to a teammate. Use this after receiving a question from a teammate to respond, or to proactively send information to a teammate.',
        {
            teammate_name: z.string().describe('Name of the teammate to reply to'),
            message: z.string().describe('Your reply message'),
        },
        async ({ teammate_name, message }) => {
            try {
                hubClient.reply(teammate_name, message);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            status: 'sent',
                            to: teammate_name,
                            message_preview: message.substring(0, 100),
                        }),
                    }],
                };
            } catch (err) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Error sending reply: ${(err as Error).message}`,
                    }],
                    isError: true,
                };
            }
        },
    );
}

// ============================================================
// MCP Tool: ask_teammate
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HubClient } from '../hub-client.js';

export function registerAskTeammate(server: McpServer, hub: HubClient): void {
    server.tool(
        'ask_teammate',
        'Ask a teammate a question and wait for their response. Use this for quick questions, not for assigning large tasks.',
        {
            teammate_name: z.string().describe("Name of the teammate to ask (e.g. 'Jordan')"),
            question: z.string().describe('The question or request to send'),
        },
        async (args) => {
            try {
                const response = await hub.ask(args.teammate_name, args.question);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify(response, null, 2),
                    }],
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ error: message }),
                    }],
                    isError: true,
                };
            }
        }
    );
}

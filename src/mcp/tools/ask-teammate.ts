// ============================================================
// MCP Tool: ask_teammate — send async question to a teammate
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HubClient } from '../hub-client.js';

export function registerAskTeammate(server: McpServer, hub: HubClient): void {
    server.tool(
        'ask_teammate',
        'Ask a teammate a question. The question is sent asynchronously — you will NOT receive the answer in this call. The teammate\'s reply will appear later in your conversation. Use this for questions; for large work items use assign_task instead.',
        {
            teammate_name: z.string().describe("Name of the teammate to ask (e.g. 'Jordan')"),
            question: z.string().describe('The question or request to send'),
        },
        async (args) => {
            try {
                // Fire-and-forget: send question, don't wait for response
                const requestId = hub.ask(args.teammate_name, args.question);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            status: 'sent',
                            to: args.teammate_name,
                            question_preview: args.question.substring(0, 100),
                            note: 'Question sent. The reply will appear in your conversation when the teammate responds.',
                        }),
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

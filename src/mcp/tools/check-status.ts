// ============================================================
// MCP Tool: check_status
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HubClient } from '../hub-client.js';

export function registerCheckStatus(server: McpServer, hub: HubClient): void {
    server.tool(
        'check_status',
        'Check the current status of a specific teammate or all teammates',
        {
            teammate_name: z.string().optional().describe('Name of teammate. Omit to check all.'),
        },
        async (args) => {
            if (args.teammate_name) {
                const teammate = hub.getTeammate(args.teammate_name);
                if (!teammate) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify({ error: `Teammate "${args.teammate_name}" not found` }),
                        }],
                        isError: true,
                    };
                }
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            name: teammate.name,
                            role: teammate.role,
                            status: teammate.status,
                        }, null, 2),
                    }],
                };
            }

            // Return all teammates
            const teammates = hub.getTeammates();
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        teammates: teammates.map(t => ({
                            name: t.name,
                            role: t.role,
                            status: t.status,
                        })),
                    }, null, 2),
                }],
            };
        }
    );
}

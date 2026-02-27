// ============================================================
// MCP Tool: list_teammates
// ============================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HubClient } from '../hub-client.js';

export function registerListTeammates(server: McpServer, hub: HubClient): void {
    server.tool(
        'list_teammates',
        'List all registered teammates with their current status',
        {},
        async () => {
            const teammates = hub.getTeammates();
            const result = {
                teammates: teammates.map(t => ({
                    name: t.name,
                    role: t.role,
                    status: t.status,
                })),
            };

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(result, null, 2),
                }],
            };
        }
    );
}

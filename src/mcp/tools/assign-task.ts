// ============================================================
// MCP Tool: assign_task
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HubClient } from '../hub-client.js';

export function registerAssignTask(server: McpServer, hub: HubClient): void {
    server.tool(
        'assign_task',
        'Assign a task to a teammate (non-blocking). The task will be delivered but you won\'t wait for completion. Use check_status to monitor progress.',
        {
            teammate_name: z.string().describe('Name of the teammate to assign the task to'),
            task_description: z.string().describe('Description of the task to assign'),
            priority: z.enum(['low', 'medium', 'high']).default('medium').describe('Task priority level'),
        },
        async (args) => {
            try {
                const result = hub.assign(
                    args.teammate_name,
                    args.task_description,
                    args.priority,
                );

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            status: 'delivered',
                            taskId: result.taskId,
                            message: `Task assigned to ${args.teammate_name}`,
                        }, null, 2),
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

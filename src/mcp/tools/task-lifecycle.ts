// ============================================================
// MCP Tools: Task Lifecycle — create, accept, update, complete
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HubClient } from '../hub-client.js';

export function registerCreateTask(server: McpServer, hub: HubClient): void {
    server.tool(
        'create_task',
        'Create a new task and assign it to a teammate. Returns a taskId for tracking. The assignee will receive the task and must accept it before starting. Use this instead of assign_task for trackable work.',
        {
            title: z.string().describe('Short task title (e.g. "Build login API")'),
            description: z.string().describe('Detailed task description with acceptance criteria'),
            assignee: z.string().describe('Name of the teammate to assign this task to'),
            priority: z.enum(['low', 'medium', 'high']).default('medium').describe('Task priority'),
            output_target: z.object({
                directory: z.string().optional().describe('Target directory for output files'),
                filenames: z.array(z.string()).optional().describe('Expected output filenames'),
                integrates_into: z.string().optional().describe('File this work must integrate into'),
            }).optional().describe('Where the assignee should place their output'),
            consumes: z.array(z.object({
                artifact: z.string().describe('Artifact filename to consume'),
                owner: z.string().describe('Who owns this artifact'),
            })).optional().describe('Artifacts this task depends on — assignee should read, not recreate'),
            produces: z.object({
                artifact: z.string().optional().describe('Expected artifact filename to publish'),
                shared_files: z.array(z.string()).optional().describe('Expected shared files to create'),
            }).optional().describe('What this task should produce'),
            depends_on: z.array(z.object({
                task_id: z.string().optional().describe('Task ID to wait for'),
                artifact: z.string().optional().describe('Artifact name to wait for'),
            })).optional().describe('Tasks/artifacts that must be completed before this task starts'),
        },
        async (args) => {
            try {
                hub.createTask(args.title, args.description, args.assignee, args.priority, {
                    outputTarget: args.output_target,
                    consumes: args.consumes,
                    produces: args.produces,
                    dependsOn: args.depends_on,
                });
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            status: 'created',
                            assignee: args.assignee,
                            title: args.title,
                            priority: args.priority,
                            note: 'Task created. The assignee will receive it and must accept/reject. Use list_tasks to track.',
                        }, null, 2),
                    }],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
                    isError: true,
                };
            }
        },
    );
}

export function registerAcceptTask(server: McpServer, hub: HubClient): void {
    server.tool(
        'accept_task',
        'Accept or reject a task that was assigned to you. You must call this after receiving a task before starting work.',
        {
            task_id: z.string().describe('The taskId of the task to accept or reject'),
            accepted: z.boolean().describe('true to accept, false to reject'),
            note: z.string().optional().describe('Optional note (e.g. rejection reason or timeline commitment)'),
        },
        async (args) => {
            try {
                hub.acceptTask(args.task_id, args.accepted, args.note);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            status: args.accepted ? 'accepted' : 'rejected',
                            taskId: args.task_id,
                            note: args.note || null,
                        }),
                    }],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
                    isError: true,
                };
            }
        },
    );
}

export function registerUpdateTask(server: McpServer, hub: HubClient): void {
    server.tool(
        'update_task',
        'Update the status of a task you are working on. Use "in_progress" to signal active work, or "blocked" with a note explaining the blocker.',
        {
            task_id: z.string().describe('The taskId to update'),
            status: z.enum(['in_progress', 'blocked']).describe('New status'),
            note: z.string().optional().describe('Status note (required for "blocked": explain what is blocking you)'),
        },
        async (args) => {
            try {
                hub.updateTask(args.task_id, args.status, args.note);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            status: args.status,
                            taskId: args.task_id,
                            note: args.note || null,
                        }),
                    }],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
                    isError: true,
                };
            }
        },
    );
}

export function registerCompleteTask(server: McpServer, hub: HubClient): void {
    server.tool(
        'complete_task',
        'Mark a task as done. You MUST provide an artifact — either a shared file path or a text summary of deliverables. Tasks without artifacts cannot be completed.',
        {
            task_id: z.string().describe('The taskId to complete'),
            artifact: z.string().describe('Deliverable: shared file path (e.g. "api-spec.md") or text summary of what was built'),
            note: z.string().optional().describe('Optional completion note'),
        },
        async (args) => {
            try {
                hub.completeTask(args.task_id, args.artifact, args.note);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            status: 'done',
                            taskId: args.task_id,
                            artifact: args.artifact,
                        }),
                    }],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
                    isError: true,
                };
            }
        },
    );
}

export function registerListTasks(server: McpServer, hub: HubClient): void {
    server.tool(
        'list_tasks',
        'List all tasks in the team. Filter by "all", "mine" (tasks assigned to you), or "active" (non-done tasks).',
        {
            filter: z.enum(['all', 'mine', 'active']).default('active').describe('Filter: all, mine, or active'),
        },
        async (args) => {
            try {
                const tasks = await hub.listTasks(args.filter);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ filter: args.filter, tasks }, null, 2),
                    }],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
                    isError: true,
                };
            }
        },
    );
}

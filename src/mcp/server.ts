// ============================================================
// MCP Server — Per-CLI MCP server (stdio transport)
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HubClient } from './hub-client.js';
import { registerListTeammates } from './tools/list-teammates.js';
import { registerAskTeammate } from './tools/ask-teammate.js';
import { registerAssignTask } from './tools/assign-task.js';
import { registerCheckStatus } from './tools/check-status.js';
import type { RelayQuestionMessage, RelayTaskMessage } from '../shared/types.js';

export interface AgentOptions {
    name: string;
    role: string;
    hubUrl: string;
    askTimeout?: number;
}

export async function startAgent(options: AgentOptions): Promise<void> {
    const { name, role, hubUrl, askTimeout = 120000 } = options;

    // Create MCP server
    const server = new McpServer({
        name: `agent-hub-${name}`,
        version: '0.1.0',
    });

    // Create Hub client
    const hub = new HubClient(hubUrl, name, role, askTimeout);

    // Register all MCP tools
    registerListTeammates(server, hub);
    registerAskTeammate(server, hub);
    registerAssignTask(server, hub);
    registerCheckStatus(server, hub);

    // Handle incoming questions from teammates via MCP Sampling
    hub.on('relay:question', async (msg: RelayQuestionMessage) => {
        try {
            // Use MCP sampling (createMessage) to get the host CLI to respond
            const result = await (server as any).server.createMessage({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `[Team Message from ${msg.fromAgent}]\n${msg.question}\n\nPlease respond to this question from your teammate.`,
                        },
                    },
                ],
                maxTokens: 4096,
            });

            // Send the response back through Hub
            hub.sendAnswer(msg.requestId, result.content.text || result.content.toString());
        } catch (error) {
            // Fallback: if sampling not supported, send a generic message
            console.error(`[Agent] Sampling not supported or failed:`, error);
            hub.sendAnswer(
                msg.requestId,
                `[Auto-reply] I received your question but couldn't process it automatically. The question was: "${msg.question}"`
            );
        }
    });

    // Handle incoming tasks from teammates
    hub.on('relay:task', async (msg: RelayTaskMessage) => {
        try {
            // Use MCP sampling to notify the CLI about the task
            await (server as any).server.createMessage({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `[Task Assignment from ${msg.fromAgent}] (Priority: ${msg.priority})\n${msg.task}\n\nPlease work on this task from your teammate.`,
                        },
                    },
                ],
                maxTokens: 4096,
            });
        } catch {
            console.error(`[Agent] Could not deliver task via sampling. Task from ${msg.fromAgent}: ${msg.task}`);
        }
    });

    // Connect to Hub
    try {
        await hub.connect();
    } catch (err) {
        console.error(`[Agent] Failed to connect to Hub at ${hubUrl}:`, err);
        console.error(`[Agent] Make sure the Hub is running: vibehq-hub --port <port>`);
        process.exit(1);
    }

    // Start MCP stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error(`[Agent] MCP server "${name}" connected and ready`);
}

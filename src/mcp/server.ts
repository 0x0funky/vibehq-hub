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
import { registerReplyToTeam } from './tools/reply-to-team.js';
import { registerShareFile, registerReadSharedFile, registerListSharedFiles } from './tools/share-file.js';
import { registerPostUpdate, registerGetTeamUpdates } from './tools/team-updates.js';
import { registerCreateTask, registerAcceptTask, registerUpdateTask, registerCompleteTask, registerListTasks } from './tools/task-lifecycle.js';
import { registerPublishArtifact, registerListArtifacts } from './tools/artifact.js';
import { registerPublishContract, registerSignContract, registerCheckContract } from './tools/contract.js';

export interface AgentOptions {
    name: string;
    role: string;
    hubUrl: string;
    team?: string;
    askTimeout?: number;
    cli?: string;
}

export async function startAgent(options: AgentOptions): Promise<void> {
    const { name, role, hubUrl, team = 'default', askTimeout = 120000, cli } = options;

    // Create MCP server
    const server = new McpServer({
        name: `agent-hub-${name}`,
        version: '0.1.0',
    });

    // Create Hub client
    const hub = new HubClient(hubUrl, name, role, team, askTimeout, cli);

    // Register all MCP tools
    registerListTeammates(server, hub);
    registerAskTeammate(server, hub);
    registerAssignTask(server, hub);
    registerCheckStatus(server, hub);
    registerReplyToTeam(server, hub);
    registerShareFile(server, team);
    registerReadSharedFile(server, team);
    registerListSharedFiles(server, team);
    registerPostUpdate(server, hub);
    registerGetTeamUpdates(server, hub);

    // V2: Task lifecycle
    registerCreateTask(server, hub);
    registerAcceptTask(server, hub);
    registerUpdateTask(server, hub);
    registerCompleteTask(server, hub);
    registerListTasks(server, hub);

    // V2: Artifact system
    registerPublishArtifact(server, hub, team);
    registerListArtifacts(server, hub);

    // V2: Contract sign-off
    registerPublishContract(server, hub);
    registerSignContract(server, hub);
    registerCheckContract(server, hub);


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

    console.error(`[Agent] MCP server "${name}" (team: ${team}) connected and ready`);
}

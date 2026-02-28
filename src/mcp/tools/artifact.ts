// ============================================================
// MCP Tools: Artifact — publish, list, get structured artifacts
// ============================================================

import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HubClient } from '../hub-client.js';

function getSharedDir(team: string): string {
    const dir = join(homedir(), '.vibehq', 'teams', team, 'shared');
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}

export function registerPublishArtifact(server: McpServer, hub: HubClient, team: string): void {
    server.tool(
        'publish_artifact',
        'Publish a structured artifact to the team shared folder with metadata. Use this instead of share_file when publishing important documents like specs, plans, or decisions. The team will be notified of the publication.',
        {
            filename: z.string().describe('Filename (e.g. "api-spec.md", "design-plan.md")'),
            content: z.string().describe('File content'),
            artifact_type: z.enum(['spec', 'plan', 'report', 'decision', 'code', 'other']).describe('Type of artifact'),
            summary: z.string().describe('Brief summary of what this artifact contains'),
            relates_to: z.string().optional().describe('Optional taskId this artifact relates to'),
        },
        async (args) => {
            try {
                const dir = getSharedDir(team);
                const filepath = join(dir, args.filename);
                writeFileSync(filepath, args.content, 'utf-8');

                // Notify hub about the artifact
                hub.publishArtifact(args.filename, args.artifact_type, args.summary, args.relates_to);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            status: 'published',
                            filename: args.filename,
                            type: args.artifact_type,
                            summary: args.summary,
                            note: 'Artifact published and team notified.',
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

export function registerListArtifacts(server: McpServer, hub: HubClient): void {
    server.tool(
        'list_artifacts',
        'List all published artifacts with their metadata (type, summary, owner, last updated). Optionally filter by type.',
        {
            artifact_type: z.enum(['spec', 'plan', 'report', 'decision', 'code', 'other']).optional()
                .describe('Optional: filter by artifact type'),
        },
        async (args) => {
            try {
                const artifacts = await hub.listArtifacts(args.artifact_type);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ artifacts }, null, 2),
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

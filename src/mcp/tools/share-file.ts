// ============================================================
// MCP Tools: Shared Files — share/read/list files across team
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

export function registerShareFile(server: McpServer, team: string, hub: HubClient): void {
    server.tool(
        'share_file',
        'Share a file with your team. The file is saved to the shared folder AND automatically registered as an artifact — you do NOT need to call publish_artifact separately.',
        {
            filename: z.string().describe('Filename to save (e.g. "api-spec.md", "sample-response.json")'),
            content: z.string().describe('File content to share'),
        },
        async ({ filename, content }) => {
            try {
                const dir = getSharedDir(team);
                const filepath = join(dir, filename);

                // Content validation: reject stubs and regressions
                const ext = filename.split('.').pop()?.toLowerCase() || '';
                const MIN_SIZE: Record<string, number> = {
                    html: 500, json: 100, md: 200, csv: 100,
                    js: 200, ts: 200, css: 200,
                };
                const minSize = MIN_SIZE[ext];
                const contentSize = Buffer.byteLength(content, 'utf-8');

                // Hard block: never allow empty content
                if (contentSize === 0) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `❌ Empty content rejected. You must provide actual file content. ` +
                                `If the file already exists, use read_shared_file to read it instead.`,
                        }],
                        isError: true,
                    };
                }

                // Regression check: if file already exists, reject if new content is <20% of old
                if (existsSync(filepath)) {
                    const previousSize = statSync(filepath).size;
                    if (previousSize > 500 && contentSize < previousSize * 0.2) {
                        return {
                            content: [{
                                type: 'text' as const,
                                text: `❌ Content regression: ${contentSize} bytes, down from ${previousSize} bytes ` +
                                    `(${Math.round((1 - contentSize / previousSize) * 100)}% smaller). ` +
                                    `This looks truncated. Please share the complete content.`,
                            }],
                            isError: true,
                        };
                    }
                }

                // Stub pattern check for small files
                if (minSize && contentSize < minSize && contentSize > 0) {
                    const STUB_RX = [
                        /^<html>\s*<body>\s*(TODO|placeholder)/i,
                        /^\{\s*"placeholder"/,
                        /^#\s*(TODO|TBD|placeholder)/i,
                    ];
                    if (STUB_RX.some(p => p.test(content.trim()))) {
                        return {
                            content: [{
                                type: 'text' as const,
                                text: `❌ Content appears to be a stub (${contentSize} bytes, min ${minSize} for .${ext}). ` +
                                    `Please provide the FULL content.`,
                            }],
                            isError: true,
                        };
                    }
                }

                writeFileSync(filepath, content, 'utf-8');

                // Auto-register as artifact so orchestrator sees it immediately
                // Infer type from extension (reuse ext from above)
                const typeMap: Record<string, string> = {
                    json: 'code', md: 'spec', html: 'code', css: 'code',
                    js: 'code', ts: 'code', txt: 'other',
                };
                const artifactType = typeMap[ext] || 'other';
                hub.publishArtifact(filename, artifactType as any, `Shared file (${content.length} bytes)`);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            status: 'shared',
                            filename,
                            path: filepath,
                            size: content.length,
                            artifact_registered: true,
                            note: 'File shared AND registered as artifact. No need to call publish_artifact separately.',
                        }),
                    }],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text' as const, text: `Error sharing file: ${(err as Error).message}` }],
                    isError: true,
                };
            }
        },
    );
}

export function registerReadSharedFile(server: McpServer, team: string): void {
    server.tool(
        'read_shared_file',
        'Read a file from the team shared folder. Use this to read API specs, schemas, or other documents shared by teammates.',
        {
            filename: z.string().describe('Filename to read'),
        },
        async ({ filename }) => {
            try {
                const dir = getSharedDir(team);
                const filepath = join(dir, filename);
                if (!existsSync(filepath)) {
                    return {
                        content: [{ type: 'text' as const, text: `File not found: ${filename}. Use list_shared_files to see available files.` }],
                        isError: true,
                    };
                }
                const content = readFileSync(filepath, 'utf-8');
                return {
                    content: [{ type: 'text' as const, text: content }],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text' as const, text: `Error reading file: ${(err as Error).message}` }],
                    isError: true,
                };
            }
        },
    );
}

export function registerListSharedFiles(server: McpServer, team: string): void {
    server.tool(
        'list_shared_files',
        'List all files in the team shared folder.',
        {},
        async () => {
            try {
                const dir = getSharedDir(team);
                const files = readdirSync(dir).map(name => {
                    const stat = statSync(join(dir, name));
                    return {
                        name,
                        size: stat.size,
                        modified: stat.mtime.toISOString(),
                    };
                });
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ team, files }, null, 2),
                    }],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text' as const, text: `Error listing files: ${(err as Error).message}` }],
                    isError: true,
                };
            }
        },
    );
}

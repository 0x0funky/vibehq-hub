// ============================================================
// MCP Tools: Shared Files — share/read/list files across team
// ============================================================

import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function getSharedDir(team: string): string {
    const dir = join(homedir(), '.vibehq', 'teams', team, 'shared');
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}

export function registerShareFile(server: McpServer, team: string): void {
    server.tool(
        'share_file',
        'Share a file with your team. The file will be saved to the team shared folder, accessible by all teammates. Use this for API specs, schemas, sample data, and other documents.',
        {
            filename: z.string().describe('Filename to save (e.g. "api-spec.md", "sample-response.json")'),
            content: z.string().describe('File content to share'),
        },
        async ({ filename, content }) => {
            try {
                const dir = getSharedDir(team);
                const filepath = join(dir, filename);
                writeFileSync(filepath, content, 'utf-8');
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            status: 'shared',
                            filename,
                            path: filepath,
                            size: content.length,
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

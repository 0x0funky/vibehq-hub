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

// --- Content validation: reject stubs and regressions ---

interface ContentValidation {
    valid: boolean;
    reason?: string;
}

const MIN_SIZE_BY_EXT: Record<string, number> = {
    html: 500, json: 100, md: 200, csv: 100,
    js: 200, ts: 200, css: 200,
};

const STUB_PATTERNS = [
    /^<html>\s*<body>\s*(TODO|placeholder|coming soon)/i,
    /^\{\s*"placeholder"\s*:/,
    /^#\s*(TODO|TBD|placeholder)/i,
    /see shared|see file|published as|available via|refer to/i,
];

function validateContent(filename: string, content: string, previousSize?: number): ContentValidation {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const minSize = MIN_SIZE_BY_EXT[ext];
    const size = Buffer.byteLength(content, 'utf-8');

    // Hard block: never allow empty content
    if (size === 0) {
        return {
            valid: false,
            reason: `Empty content rejected. You must provide actual content for "${filename}". ` +
                `If the file was already shared via share_file, omit the content field to keep the existing file.`,
        };
    }

    // Check minimum size for known file types
    if (minSize && size < minSize && size > 0) {
        // Check if content matches stub patterns
        const isStub = STUB_PATTERNS.some(p => p.test(content.trim()));
        if (isStub) {
            return {
                valid: false,
                reason: `Content appears to be a stub (${size} bytes, min ${minSize} for .${ext}). ` +
                    `Please provide the FULL content. If you already used share_file, omit the content field.`,
            };
        }
    }

    // Check for regression (content shrunk >80% from previous version)
    if (previousSize && previousSize > 500 && size < previousSize * 0.2) {
        return {
            valid: false,
            reason: `Content regression detected: ${size} bytes, down from ${previousSize} bytes (${Math.round((1 - size / previousSize) * 100)}% smaller). ` +
                `This looks like a truncated or placeholder version. Please publish the complete content.`,
        };
    }

    return { valid: true };
}

export function registerPublishArtifact(server: McpServer, hub: HubClient, team: string): void {
    server.tool(
        'publish_artifact',
        'Publish a structured artifact with metadata. If a shared file with this name already exists (from share_file), it will NOT be overwritten — only the metadata is registered. If the file does not exist yet, you must provide content.',
        {
            filename: z.string().describe('Filename (e.g. "api-spec.md", "design-plan.md")'),
            content: z.string().optional().describe('File content (optional if file was already created via share_file)'),
            artifact_type: z.enum(['spec', 'plan', 'report', 'decision', 'code', 'other']).describe('Type of artifact'),
            summary: z.string().describe('Brief summary of what this artifact contains'),
            relates_to: z.string().optional().describe('Optional taskId this artifact relates to'),
        },
        async (args) => {
            try {
                const dir = getSharedDir(team);
                const filepath = join(dir, args.filename);
                const fileExists = existsSync(filepath);

                if (fileExists) {
                    // File already exists (from share_file or prior publish) — do NOT overwrite
                    // Only register metadata with the Hub

                    // But validate if new content is provided (update case)
                    if (args.content) {
                        const previousSize = statSync(filepath).size;
                        const validation = validateContent(args.filename, args.content, previousSize);
                        if (!validation.valid) {
                            return {
                                content: [{
                                    type: 'text' as const,
                                    text: `❌ ${validation.reason}`,
                                }],
                                isError: true,
                            };
                        }
                        writeFileSync(filepath, args.content, 'utf-8');
                    }
                } else if (args.content) {
                    // New file — validate content quality
                    const validation = validateContent(args.filename, args.content);
                    if (!validation.valid) {
                        return {
                            content: [{
                                type: 'text' as const,
                                text: `❌ ${validation.reason}`,
                            }],
                            isError: true,
                        };
                    }
                    writeFileSync(filepath, args.content, 'utf-8');
                } else {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `Error: File "${args.filename}" does not exist and no content was provided. Use share_file first or provide content.`,
                        }],
                        isError: true,
                    };
                }

                // Notify hub about the artifact metadata
                hub.publishArtifact(args.filename, args.artifact_type, args.summary, args.relates_to);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            status: 'published',
                            filename: args.filename,
                            type: args.artifact_type,
                            summary: args.summary,
                            file_existed: fileExists,
                            note: fileExists
                                ? 'Metadata registered. Existing file was NOT overwritten.'
                                : 'File created and metadata registered.',
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

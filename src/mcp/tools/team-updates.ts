// ============================================================
// MCP Tools: Team Updates — bulletin board for team progress
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HubClient } from '../hub-client.js';
import type { McpRateLimiter } from '../rate-limiter.js';
import type { TeamUpdate } from '../../shared/types.js';

/** Max characters allowed per post_update. Enforces concise team communication. */
const POST_UPDATE_MAX_CHARS = 500;

export function registerPostUpdate(server: McpServer, hubClient: HubClient): void {
    server.tool(
        'post_update',
        `Post a progress update visible to all teammates. Keep it concise (max ${POST_UPDATE_MAX_CHARS} chars). Use scratchpad for private thinking first, then post only the conclusion here.`,
        {
            message: z.string().describe('Progress update message (e.g. "API spec completed, saved to api-spec.md")'),
        },
        async ({ message }) => {
            // Enforce size limit — reject verbose updates
            if (message.length > POST_UPDATE_MAX_CHARS) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Update rejected: ${message.length} chars exceeds ${POST_UPDATE_MAX_CHARS} char limit. Use scratchpad for detailed thinking, then post a concise summary here.`,
                    }],
                    isError: true,
                };
            }

            try {
                hubClient.postUpdate(message);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ status: 'posted', message_preview: message.substring(0, 100) }),
                    }],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text' as const, text: `Error posting update: ${(err as Error).message}` }],
                    isError: true,
                };
            }
        },
    );
}

export function registerGetTeamUpdates(server: McpServer, hubClient: HubClient, rateLimiter?: McpRateLimiter): void {
    server.tool(
        'get_team_updates',
        'Get recent progress updates from all teammates. Hub sends proactive update notifications — avoid calling this repeatedly.',
        {
            limit: z.number().optional().describe('Max number of updates to return (default: 20)'),
        },
        async ({ limit }) => {
            // Rate limit check
            if (rateLimiter) {
                const check = rateLimiter.check('get_team_updates');
                if (check.limited && check.cachedResponse) {
                    const { McpRateLimiter: RL } = await import('../rate-limiter.js');
                    return {
                        content: [{
                            type: 'text' as const,
                            text: RL.buildWarning('get_team_updates', check.callCount) + '\n' + check.cachedResponse,
                        }],
                    };
                }
            }

            try {
                const updates = await hubClient.getUpdates(limit ?? 20);
                const responseText = JSON.stringify({ updates }, null, 2);
                rateLimiter?.recordResponse('get_team_updates', responseText);
                return {
                    content: [{
                        type: 'text' as const,
                        text: responseText,
                    }],
                };
            } catch (err) {
                return {
                    content: [{ type: 'text' as const, text: `Error getting updates: ${(err as Error).message}` }],
                    isError: true,
                };
            }
        },
    );
}

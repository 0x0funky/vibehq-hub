// ============================================================
// MCP Tools: Contract — publish, sign, check sign-off status
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HubClient } from '../hub-client.js';

export function registerPublishContract(server: McpServer, hub: HubClient): void {
    server.tool(
        'publish_contract',
        'Publish a spec/contract for team sign-off. Specify which teammates must approve before coding begins. Use this after writing an API spec, schema, or design doc that requires alignment.',
        {
            spec_path: z.string().describe('Path of the shared file to sign off on (e.g. "api-spec.md")'),
            required_signers: z.array(z.string()).describe('List of teammate names who must sign (e.g. ["Jordan", "Riley"])'),
            contract_type: z.enum(['api', 'interface', 'schema']).optional()
                .describe('Type of contract: "api" for API spec, "interface" for agent-to-agent data contract, "schema" for data format'),
            schema_validation: z.object({
                format: z.string().optional().describe('Expected data format (e.g. "json", "yaml")'),
                required_keys: z.array(z.string()).optional().describe('Required top-level keys in the data'),
            }).optional().describe('Optional schema validation rules for artifacts related to this contract'),
        },
        async (args) => {
            try {
                hub.publishContract(args.spec_path, args.required_signers, args.contract_type, args.schema_validation);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            status: 'published',
                            specPath: args.spec_path,
                            requiredSigners: args.required_signers,
                            note: `Contract published. Waiting for ${args.required_signers.join(', ')} to sign.`,
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

export function registerSignContract(server: McpServer, hub: HubClient): void {
    server.tool(
        'sign_contract',
        'Sign/approve a published contract. Once all required signers approve, the contract is marked as approved and the team is notified.',
        {
            spec_path: z.string().describe('Path of the shared file to sign off on'),
            comment: z.string().optional().describe('Optional comment (e.g. "LGTM", "Approved with minor notes")'),
        },
        async (args) => {
            try {
                hub.signContract(args.spec_path, args.comment);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            status: 'signed',
                            specPath: args.spec_path,
                            comment: args.comment || null,
                            note: 'Your signature recorded. If all required signers have signed, the contract will be approved.',
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

export function registerCheckContract(server: McpServer, hub: HubClient): void {
    server.tool(
        'check_contract',
        'Check the sign-off status of contracts. See who has signed and who is still pending.',
        {
            spec_path: z.string().optional().describe('Optional: check a specific contract. Omit to list all.'),
        },
        async (args) => {
            try {
                const contracts = await hub.checkContract(args.spec_path);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ contracts }, null, 2),
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

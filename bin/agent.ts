// ============================================================
// CLI Entry: vibehq-agent
// ============================================================

import { startAgent } from '../src/mcp/server.js';

function parseArgs(): { name: string; role: string; hub: string; timeout: number } {
    const args = process.argv.slice(2);
    let name = '';
    let role = 'Engineer';
    let hub = 'ws://localhost:3001';
    let timeout = 120000;

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '-n':
            case '--name':
                name = args[++i];
                break;
            case '-r':
            case '--role':
                role = args[++i];
                break;
            case '-u':
            case '--hub':
                hub = args[++i];
                break;
            case '-t':
            case '--timeout':
                timeout = parseInt(args[++i], 10);
                if (isNaN(timeout)) {
                    console.error('Error: --timeout requires a number (ms)');
                    process.exit(1);
                }
                break;
            case '-h':
            case '--help':
                console.log(`
Usage: vibehq-agent [options]

Start an MCP agent that connects to a Hub

Options:
  -n, --name <string>     Agent name (required)
  -r, --role <string>     Agent role (default: "Engineer")
  -u, --hub <url>         Hub WebSocket URL (default: ws://localhost:3001)
  -t, --timeout <ms>      Ask timeout in ms (default: 120000)
  -h, --help              Show help
`);
                process.exit(0);
        }
    }

    if (!name) {
        console.error('Error: --name is required');
        console.error('Usage: vibehq-agent --name <name> [--role <role>] [--hub <url>]');
        process.exit(1);
    }

    return { name, role, hub, timeout };
}

const { name, role, hub, timeout } = parseArgs();
startAgent({ name, role, hubUrl: hub, askTimeout: timeout });

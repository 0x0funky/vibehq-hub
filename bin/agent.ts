// ============================================================
// CLI Entry: vibehq-agent
// ============================================================

import { startAgent } from '../src/mcp/server.js';

function parseArgs(): { name: string; role: string; hub: string; team: string; timeout: number; cli: string } {
    const args = process.argv.slice(2);
    let name = '';
    let role = 'Engineer';
    let hub = 'ws://localhost:3001';
    let team = 'default';
    let timeout = 120000;
    let cli = '';

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
            case '--team':
                team = args[++i];
                break;
            case '-t':
            case '--timeout':
                timeout = parseInt(args[++i], 10);
                if (isNaN(timeout)) {
                    console.error('Error: --timeout requires a number (ms)');
                    process.exit(1);
                }
                break;
            case '--cli':
                cli = args[++i];
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
      --team <string>     Team name (default: "default")
  -t, --timeout <ms>      Ask timeout in ms (default: 120000)
  -h, --help              Show help
`);
                process.exit(0);
        }
    }

    if (!name) {
        console.error('Error: --name is required');
        console.error('Usage: vibehq-agent --name <name> [--role <role>] [--hub <url>] [--team <team>]');
        process.exit(1);
    }

    return { name, role, hub, team, timeout, cli };
}

const { name, role, hub, team, timeout, cli } = parseArgs();
startAgent({ name, role, hubUrl: hub, team, askTimeout: timeout, cli });

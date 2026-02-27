// ============================================================
// CLI Entry: vibehq-spawn
// ============================================================

import { AgentSpawner } from '../src/spawner/spawner.js';

function printHelp() {
    console.log(`
Usage: vibehq-spawn [options] -- <command> [args...]

Spawn a CLI agent wrapped with Hub connectivity.
The CLI process runs normally, but teammate messages are injected via stdin.

Options:
  -n, --name <string>     Agent name (required)
  -r, --role <string>     Agent role (default: "Engineer")
  -u, --hub <url>         Hub WebSocket URL (default: ws://localhost:3001)
  -t, --timeout <ms>      Response timeout in ms (default: 120000)
  -h, --help              Show help

Examples:
  vibehq-spawn --name Claude --role "Backend Engineer" -- claude
  vibehq-spawn --name Codex --role "Frontend Engineer" -- codex
  vibehq-spawn -n Gemini -r "Full Stack" -- gemini
`);
}

function parseArgs(): { name: string; role: string; hub: string; timeout: number; command: string; commandArgs: string[] } {
    const args = process.argv.slice(2);
    let name = '';
    let role = 'Engineer';
    let hub = 'ws://localhost:3001';
    let timeout = 120000;
    let command = '';
    let commandArgs: string[] = [];

    // Find the -- separator
    const separatorIdx = args.indexOf('--');
    const ourArgs = separatorIdx >= 0 ? args.slice(0, separatorIdx) : args;
    const cliArgs = separatorIdx >= 0 ? args.slice(separatorIdx + 1) : [];

    if (cliArgs.length > 0) {
        command = cliArgs[0];
        commandArgs = cliArgs.slice(1);
    }

    for (let i = 0; i < ourArgs.length; i++) {
        switch (ourArgs[i]) {
            case '-n':
            case '--name':
                name = ourArgs[++i];
                break;
            case '-r':
            case '--role':
                role = ourArgs[++i];
                break;
            case '-u':
            case '--hub':
                hub = ourArgs[++i];
                break;
            case '-t':
            case '--timeout':
                timeout = parseInt(ourArgs[++i], 10);
                if (isNaN(timeout)) {
                    console.error('Error: --timeout requires a number (ms)');
                    process.exit(1);
                }
                break;
            case '-h':
            case '--help':
                printHelp();
                process.exit(0);
        }
    }

    if (!name) {
        console.error('Error: --name is required');
        printHelp();
        process.exit(1);
    }

    if (!command) {
        console.error('Error: command is required after --');
        console.error('Example: vibehq-spawn --name Claude -- claude');
        printHelp();
        process.exit(1);
    }

    return { name, role, hub, timeout, command, commandArgs };
}

const { name, role, hub, timeout, command, commandArgs } = parseArgs();

const spawner = new AgentSpawner({
    name,
    role,
    hubUrl: hub,
    command,
    args: commandArgs,
    askTimeout: timeout,
});

spawner.start().catch(() => {
    process.exit(1);
});

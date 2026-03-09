// ============================================================
// CLI Entry: vibehq-web — Web Dashboard Server
// ============================================================

import { startHub } from '../src/hub/server.js';
import { startWebServer } from '../src/web/server.js';
import { createServer } from 'net';

function parseArgs(): { hubPort: number; webPort: number; configPath: string; verbose: boolean } {
    const args = process.argv.slice(2);
    let hubPort = 3001;
    let webPort = 3100;
    let configPath = 'vibehq.config.json';
    let verbose = false;

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--hub-port':
                hubPort = parseInt(args[++i], 10);
                break;
            case '-p':
            case '--port':
                webPort = parseInt(args[++i], 10);
                break;
            case '-c':
            case '--config':
                configPath = args[++i];
                break;
            case '-v':
            case '--verbose':
                verbose = true;
                break;
            case '-h':
            case '--help':
                console.log(`
Usage: vibehq-web [options]

Start VibeHQ web dashboard

Options:
  -p, --port <number>       Web dashboard port (default: 3100)
  --hub-port <number>       Hub WebSocket port (default: 3001)
  -c, --config <path>       Config file (default: vibehq.config.json)
  -v, --verbose             Enable verbose logging
  -h, --help                Show help
`);
                process.exit(0);
        }
    }

    return { hubPort, webPort, configPath, verbose };
}

async function tryPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => { server.close(); resolve(true); });
        server.listen(port, '127.0.0.1');
    });
}

async function findPort(start: number): Promise<number> {
    for (let p = start; p < start + 100; p++) {
        if (await tryPort(p)) return p;
    }
    throw new Error(`No available port found near ${start}`);
}

async function main() {
    const { hubPort, webPort, configPath, verbose } = parseArgs();

    // Find available hub port
    const actualHubPort = await findPort(hubPort);
    if (actualHubPort !== hubPort && verbose) {
        console.log(`[Web] Hub port ${hubPort} in use, using ${actualHubPort}`);
    }

    // Start hub
    const hubContext = startHub({ port: actualHubPort, verbose, team: 'default' });

    // Find available web port
    const actualWebPort = await findPort(webPort);

    // Start web server
    const { server, ptyManager } = startWebServer({
        port: actualWebPort,
        hubContext,
        hubPort: actualHubPort,
        team: 'default',
        configPath,
    });

    console.log(`[VibeHQ] Hub: ws://localhost:${actualHubPort}`);
    console.log(`[VibeHQ] Web: http://localhost:${actualWebPort}`);

    // Graceful shutdown — kill all agent PTY processes before exiting
    const shutdown = () => {
        console.log('\n[VibeHQ] Shutting down — killing all agent sessions...');
        ptyManager.stopAll('*');  // kill everything
        hubContext.wss.close();
        server.close();
        setTimeout(() => process.exit(0), 500);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
});

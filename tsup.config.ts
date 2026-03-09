import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        'index': 'src/index.ts',
        'bin/hub': 'bin/hub.ts',
        'bin/agent': 'bin/agent.ts',
        'bin/spawn': 'bin/spawn.ts',
        'bin/start': 'bin/start.ts',
        'bin/analyze': 'bin/analyze.ts',
        'bin/web': 'bin/web.ts',
    },
    format: ['esm'],
    target: 'node18',
    platform: 'node',
    dts: {
        entry: 'src/index.ts',
    },
    splitting: false,
    sourcemap: true,
    clean: true,
    shims: false,
    external: ['node-pty', 'express'],
    banner: ({ format }) => {
        // Add shebang for bin entry points
        return { js: '' };
    },
    onSuccess: async () => {
        // Add shebang to bin files and set executable permission (needed on Mac/Linux)
        const fs = await import('fs');
        const binFiles = ['dist/bin/hub.js', 'dist/bin/agent.js', 'dist/bin/spawn.js', 'dist/bin/start.js', 'dist/bin/analyze.js', 'dist/bin/web.js'];
        for (const file of binFiles) {
            try {
                const content = fs.readFileSync(file, 'utf-8');
                if (!content.startsWith('#!/')) {
                    fs.writeFileSync(file, `#!/usr/bin/env node\n${content}`);
                }
                fs.chmodSync(file, 0o755);
            } catch {
                // File might not exist yet, or chmod not supported (Windows)
            }
        }
    },
});

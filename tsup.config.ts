import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        'index': 'src/index.ts',
        'bin/hub': 'bin/hub.ts',
        'bin/agent': 'bin/agent.ts',
        'bin/spawn': 'bin/spawn.ts',
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
    banner: ({ format }) => {
        // Add shebang for bin entry points
        return { js: '' };
    },
    onSuccess: async () => {
        // Add shebang to bin files after build
        const fs = await import('fs');
        const binFiles = ['dist/bin/hub.js', 'dist/bin/agent.js', 'dist/bin/spawn.js'];
        for (const file of binFiles) {
            try {
                const content = fs.readFileSync(file, 'utf-8');
                if (!content.startsWith('#!/')) {
                    fs.writeFileSync(file, `#!/usr/bin/env node\n${content}`);
                }
            } catch {
                // File might not exist yet
            }
        }
    },
});

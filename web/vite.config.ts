import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    root: '.',
    build: {
        outDir: '../web-dist',
        emptyOutDir: true,
    },
    server: {
        port: 3200,
        proxy: {
            '/api': 'http://localhost:3100',
            '/ws': {
                target: 'ws://localhost:3100',
                ws: true,
            },
        },
    },
});

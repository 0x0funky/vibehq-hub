// ============================================================
// PtyManager — manages in-process agent PTY instances for web
// ============================================================

import { AgentSpawner } from '../spawner/spawner.js';
import type WebSocket from 'ws';

interface AgentConfig {
    name: string;
    role: string;
    cli: string;
    cwd: string;
    systemPrompt?: string;
    dangerouslySkipPermissions?: boolean;
    additionalDirs?: string[];
}

interface ManagedAgent {
    spawner: AgentSpawner;
    subscribers: Set<WebSocket>;
    scrollback: string[];
    scrollbackSize: number;
    status: 'running' | 'stopped';
}

const MAX_SCROLLBACK_SIZE = 50 * 1024; // ~50KB

export class PtyManager {
    private agents: Map<string, ManagedAgent> = new Map();

    private key(team: string, agentName: string): string {
        return `${team}:${agentName}`;
    }

    async startAgent(team: string, agentConfig: AgentConfig, hubUrl: string): Promise<void> {
        const k = this.key(team, agentConfig.name);
        if (this.agents.has(k) && this.agents.get(k)!.status === 'running') {
            return; // Already running
        }

        const managed: ManagedAgent = {
            spawner: null as any,
            subscribers: new Set(),
            scrollback: [],
            scrollbackSize: 0,
            status: 'running',
        };

        const spawner = new AgentSpawner({
            name: agentConfig.name,
            role: agentConfig.role,
            hubUrl,
            team,
            command: agentConfig.cli,
            args: [],
            cwd: agentConfig.cwd,
            systemPrompt: agentConfig.systemPrompt,
            dangerouslySkipPermissions: agentConfig.dangerouslySkipPermissions,
            additionalDirs: agentConfig.additionalDirs,
            webMode: true,
            cols: 120,
            rows: 30,
            onData: (data: string) => {
                // Buffer in scrollback
                managed.scrollback.push(data);
                managed.scrollbackSize += data.length;
                // Trim scrollback if too large
                while (managed.scrollbackSize > MAX_SCROLLBACK_SIZE && managed.scrollback.length > 1) {
                    managed.scrollbackSize -= managed.scrollback.shift()!.length;
                }
                // Forward to all subscribers
                for (const ws of managed.subscribers) {
                    if (ws.readyState === 1) { // WebSocket.OPEN
                        ws.send(data);
                    }
                }
            },
            onExit: (_exitCode: number) => {
                managed.status = 'stopped';
            },
        });

        managed.spawner = spawner;
        this.agents.set(k, managed);

        await spawner.start();
    }

    stopAgent(team: string, agentName: string): void {
        const k = this.key(team, agentName);
        const managed = this.agents.get(k);
        if (!managed) return;
        managed.spawner.kill();
        managed.status = 'stopped';
    }

    subscribe(team: string, agentName: string, ws: WebSocket): void {
        const k = this.key(team, agentName);
        const managed = this.agents.get(k);
        if (!managed) return;

        managed.subscribers.add(ws);

        // Replay scrollback buffer
        for (const chunk of managed.scrollback) {
            if (ws.readyState === 1) {
                ws.send(chunk);
            }
        }
    }

    unsubscribe(team: string, agentName: string, ws: WebSocket): void {
        const k = this.key(team, agentName);
        const managed = this.agents.get(k);
        if (!managed) return;
        managed.subscribers.delete(ws);
    }

    sendInput(team: string, agentName: string, text: string): void {
        const k = this.key(team, agentName);
        const managed = this.agents.get(k);
        if (!managed || managed.status !== 'running') return;
        managed.spawner.writeInput(text);
    }

    resize(team: string, agentName: string, cols: number, rows: number): void {
        const k = this.key(team, agentName);
        const managed = this.agents.get(k);
        if (!managed || managed.status !== 'running') return;
        managed.spawner.resize(cols, rows);
    }

    getStatus(team: string, agentName: string): 'running' | 'stopped' | 'unknown' {
        const k = this.key(team, agentName);
        const managed = this.agents.get(k);
        return managed?.status ?? 'unknown';
    }

    stopAll(team: string): void {
        for (const [k, managed] of this.agents) {
            if (team === '*' || k.startsWith(`${team}:`)) {
                if (managed.status === 'running') {
                    managed.spawner.kill();
                    managed.status = 'stopped';
                }
            }
        }
    }

    getRunningAgents(team: string): string[] {
        const result: string[] = [];
        for (const [k, managed] of this.agents) {
            if (k.startsWith(`${team}:`) && managed.status === 'running') {
                result.push(k.split(':').slice(1).join(':'));
            }
        }
        return result;
    }
}

// ============================================================
// REST API: Lifecycle — start/stop teams and agents
// ============================================================

import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import type { PtyManager } from '../pty-manager.js';

export const lifecycleRouter = Router();

function loadTeams(configPath: string): any[] {
    if (!existsSync(configPath)) return [];
    try {
        const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (raw.teams) return raw.teams;
        if (raw.team) return [{ name: raw.team, hub: raw.hub, agents: raw.agents }];
    } catch {}
    return [];
}

// POST /api/teams/:team/start
lifecycleRouter.post('/:team/start', async (req, res) => {
    const configPath = (req as any).configPath;
    const ptyManager: PtyManager = (req as any).ptyManager;
    const hubPort: number = (req as any).hubPort;
    const teams = loadTeams(configPath);
    const team = teams.find((t: any) => t.name === req.params.team);
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

    const hubUrl = `ws://localhost:${hubPort}`;
    const started: string[] = [];

    for (const agent of team.agents) {
        try {
            await ptyManager.startAgent(team.name, agent, hubUrl);
            started.push(agent.name);
        } catch (err) {
            console.error(`[Web] Failed to start ${agent.name}:`, (err as Error).message);
        }
    }

    res.json({ started, total: team.agents.length });
});

// POST /api/teams/:team/stop
lifecycleRouter.post('/:team/stop', (req, res) => {
    const ptyManager: PtyManager = (req as any).ptyManager;
    ptyManager.stopAll(req.params.team);
    res.json({ stopped: true });
});

// POST /api/teams/:team/agents/:name/start
lifecycleRouter.post('/:team/agents/:name/start', async (req, res) => {
    const configPath = (req as any).configPath;
    const ptyManager: PtyManager = (req as any).ptyManager;
    const hubPort: number = (req as any).hubPort;
    const teams = loadTeams(configPath);
    const team = teams.find((t: any) => t.name === req.params.team);
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

    const agent = team.agents.find((a: any) => a.name === req.params.name);
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

    const hubUrl = `ws://localhost:${hubPort}`;
    try {
        await ptyManager.startAgent(team.name, agent, hubUrl);
        res.json({ started: agent.name });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// POST /api/teams/:team/agents/:name/stop
lifecycleRouter.post('/:team/agents/:name/stop', (req, res) => {
    const ptyManager: PtyManager = (req as any).ptyManager;
    ptyManager.stopAgent(req.params.team, req.params.name);
    res.json({ stopped: req.params.name });
});

// POST /api/teams/:team/agents/:name/send
lifecycleRouter.post('/:team/agents/:name/send', (req, res) => {
    const ptyManager: PtyManager = (req as any).ptyManager;
    const { text } = req.body;
    if (!text) { res.status(400).json({ error: 'text is required' }); return; }
    ptyManager.sendInput(req.params.team, req.params.name, text);
    res.json({ sent: true });
});

// ============================================================
// REST API: /api/teams — CRUD for team config
// ============================================================

import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';

export const teamsRouter = Router();

interface TeamConfig {
    name: string;
    hub: { port: number };
    agents: Array<{
        name: string;
        role: string;
        cli: string;
        cwd: string;
        systemPrompt?: string;
        dangerouslySkipPermissions?: boolean;
        additionalDirs?: string[];
    }>;
}

function loadConfig(configPath: string): { teams: TeamConfig[] } {
    if (!existsSync(configPath)) return { teams: [] };
    try {
        const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (raw.teams && Array.isArray(raw.teams)) return { teams: raw.teams };
        if (raw.team && raw.agents) {
            return { teams: [{ name: raw.team, hub: raw.hub, agents: raw.agents }] };
        }
    } catch {}
    return { teams: [] };
}

function saveConfig(configPath: string, teams: TeamConfig[]): void {
    writeFileSync(configPath, JSON.stringify({ teams }, null, 4) + '\n');
}

// GET /api/teams
teamsRouter.get('/', (req, res) => {
    const configPath = (req as any).configPath;
    const { teams } = loadConfig(configPath);
    res.json(teams);
});

// POST /api/teams
teamsRouter.post('/', (req, res) => {
    const configPath = (req as any).configPath;
    const { teams } = loadConfig(configPath);
    const newTeam: TeamConfig = {
        name: req.body.name,
        hub: req.body.hub || { port: 3001 },
        agents: req.body.agents || [],
    };
    if (!newTeam.name) {
        res.status(400).json({ error: 'Team name is required' });
        return;
    }
    if (teams.find(t => t.name === newTeam.name)) {
        res.status(409).json({ error: 'Team already exists' });
        return;
    }
    teams.push(newTeam);
    saveConfig(configPath, teams);
    res.status(201).json(newTeam);
});

// GET /api/teams/:name
teamsRouter.get('/:name', (req, res) => {
    const configPath = (req as any).configPath;
    const { teams } = loadConfig(configPath);
    const team = teams.find(t => t.name === req.params.name);
    if (!team) {
        res.status(404).json({ error: 'Team not found' });
        return;
    }
    const ptyManager = (req as any).ptyManager;
    const running = ptyManager.getRunningAgents(team.name);
    res.json({ ...team, runningAgents: running });
});

// PUT /api/teams/:name
teamsRouter.put('/:name', (req, res) => {
    const configPath = (req as any).configPath;
    const { teams } = loadConfig(configPath);
    const idx = teams.findIndex(t => t.name === req.params.name);
    if (idx === -1) {
        res.status(404).json({ error: 'Team not found' });
        return;
    }
    teams[idx] = { ...teams[idx], ...req.body, name: req.params.name };
    saveConfig(configPath, teams);
    res.json(teams[idx]);
});

// DELETE /api/teams/:name
teamsRouter.delete('/:name', (req, res) => {
    const configPath = (req as any).configPath;
    const { teams } = loadConfig(configPath);
    const idx = teams.findIndex(t => t.name === req.params.name);
    if (idx === -1) {
        res.status(404).json({ error: 'Team not found' });
        return;
    }
    teams.splice(idx, 1);
    saveConfig(configPath, teams);
    res.status(204).send();
});

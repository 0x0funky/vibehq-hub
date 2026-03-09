// ============================================================
// REST API: /api/teams/:team/agents — CRUD for agents
// ============================================================

import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';

export const agentsRouter = Router();

function loadTeams(configPath: string): any[] {
    if (!existsSync(configPath)) return [];
    try {
        const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (raw.teams) return raw.teams;
        if (raw.team) return [{ name: raw.team, hub: raw.hub, agents: raw.agents }];
    } catch {}
    return [];
}

function saveTeams(configPath: string, teams: any[]): void {
    writeFileSync(configPath, JSON.stringify({ teams }, null, 4) + '\n');
}

function findTeam(teams: any[], name: string) {
    return teams.find((t: any) => t.name === name);
}

// GET /api/teams/:team/agents
agentsRouter.get('/:team/agents', (req, res) => {
    const configPath = (req as any).configPath;
    const teams = loadTeams(configPath);
    const team = findTeam(teams, req.params.team);
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

    const ptyManager = (req as any).ptyManager;
    const agents = (team.agents || []).map((a: any) => ({
        ...a,
        ptyStatus: ptyManager.getStatus(team.name, a.name),
    }));
    res.json(agents);
});

// POST /api/teams/:team/agents
agentsRouter.post('/:team/agents', (req, res) => {
    const configPath = (req as any).configPath;
    const teams = loadTeams(configPath);
    const team = findTeam(teams, req.params.team);
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

    const agent = {
        name: req.body.name,
        role: req.body.role || 'Engineer',
        cli: req.body.cli || 'claude',
        cwd: req.body.cwd,
        systemPrompt: req.body.systemPrompt,
        dangerouslySkipPermissions: req.body.dangerouslySkipPermissions,
        additionalDirs: req.body.additionalDirs,
    };
    if (!agent.name || !agent.cwd) {
        res.status(400).json({ error: 'Agent name and cwd are required' });
        return;
    }
    if (team.agents.find((a: any) => a.name === agent.name)) {
        res.status(409).json({ error: 'Agent already exists' });
        return;
    }
    team.agents.push(agent);
    saveTeams(configPath, teams);
    res.status(201).json(agent);
});

// PUT /api/teams/:team/agents/:name
agentsRouter.put('/:team/agents/:name', (req, res) => {
    const configPath = (req as any).configPath;
    const teams = loadTeams(configPath);
    const team = findTeam(teams, req.params.team);
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

    const idx = team.agents.findIndex((a: any) => a.name === req.params.name);
    if (idx === -1) { res.status(404).json({ error: 'Agent not found' }); return; }

    team.agents[idx] = { ...team.agents[idx], ...req.body, name: req.params.name };
    saveTeams(configPath, teams);
    res.json(team.agents[idx]);
});

// DELETE /api/teams/:team/agents/:name
agentsRouter.delete('/:team/agents/:name', (req, res) => {
    const configPath = (req as any).configPath;
    const teams = loadTeams(configPath);
    const team = findTeam(teams, req.params.team);
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

    const idx = team.agents.findIndex((a: any) => a.name === req.params.name);
    if (idx === -1) { res.status(404).json({ error: 'Agent not found' }); return; }

    team.agents.splice(idx, 1);
    saveTeams(configPath, teams);
    res.status(204).send();
});

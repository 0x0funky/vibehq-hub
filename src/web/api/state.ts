// ============================================================
// REST API: Hub State — tasks, artifacts, updates (read-only)
// ============================================================

import { Router } from 'express';
import type { HubContext } from '../../hub/server.js';

export const stateRouter = Router();

// GET /api/teams/:team/tasks
stateRouter.get('/:team/tasks', (req, res) => {
    const hubContext: HubContext = (req as any).hubContext;
    const teamName = req.params.team;
    let tasks = Array.from(hubContext.stores.tasks.values())
        .filter(t => t.team === teamName);

    const filter = req.query.filter as string;
    if (filter === 'active') {
        tasks = tasks.filter(t => t.status !== 'done' && t.status !== 'rejected');
    }

    res.json(tasks);
});

// GET /api/teams/:team/artifacts
stateRouter.get('/:team/artifacts', (req, res) => {
    const hubContext: HubContext = (req as any).hubContext;
    const teamName = req.params.team;
    const artifacts = Array.from(hubContext.stores.artifacts.values())
        .filter(a => a.team === teamName);
    res.json(artifacts);
});

// GET /api/teams/:team/updates
stateRouter.get('/:team/updates', (req, res) => {
    const hubContext: HubContext = (req as any).hubContext;
    const teamName = req.params.team;
    const updates = hubContext.stores.teamUpdates.get(teamName) || [];
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(updates.slice(-limit));
});

// GET /api/teams/:team/agents-live
stateRouter.get('/:team/agents-live', (req, res) => {
    const hubContext: HubContext = (req as any).hubContext;
    const teamName = req.params.team;
    const agents = hubContext.registry.getAllAgents(teamName);
    res.json(agents);
});

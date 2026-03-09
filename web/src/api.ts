const BASE = '/api';

async function request(path: string, options?: RequestInit) {
    const res = await fetch(`${BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (res.status === 204) return null;
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
    }
    return res.json();
}

// Teams
export const getTeams = () => request('/teams');
export const getTeam = (name: string) => request(`/teams/${encodeURIComponent(name)}`);
export const createTeam = (data: any) => request('/teams', { method: 'POST', body: JSON.stringify(data) });
export const updateTeam = (name: string, data: any) => request(`/teams/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTeam = (name: string) => request(`/teams/${encodeURIComponent(name)}`, { method: 'DELETE' });

// Agents
export const getAgents = (team: string) => request(`/teams/${encodeURIComponent(team)}/agents`);
export const createAgent = (team: string, data: any) => request(`/teams/${encodeURIComponent(team)}/agents`, { method: 'POST', body: JSON.stringify(data) });
export const updateAgent = (team: string, name: string, data: any) => request(`/teams/${encodeURIComponent(team)}/agents/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteAgent = (team: string, name: string) => request(`/teams/${encodeURIComponent(team)}/agents/${encodeURIComponent(name)}`, { method: 'DELETE' });

// Lifecycle
export const startTeam = (team: string) => request(`/teams/${encodeURIComponent(team)}/start`, { method: 'POST' });
export const stopTeam = (team: string) => request(`/teams/${encodeURIComponent(team)}/stop`, { method: 'POST' });
export const startAgent = (team: string, name: string) => request(`/teams/${encodeURIComponent(team)}/agents/${encodeURIComponent(name)}/start`, { method: 'POST' });
export const stopAgent = (team: string, name: string) => request(`/teams/${encodeURIComponent(team)}/agents/${encodeURIComponent(name)}/stop`, { method: 'POST' });
export const sendToAgent = (team: string, name: string, text: string) => request(`/teams/${encodeURIComponent(team)}/agents/${encodeURIComponent(name)}/send`, { method: 'POST', body: JSON.stringify({ text }) });

// State
export const getTasks = (team: string, filter?: string) => request(`/teams/${encodeURIComponent(team)}/tasks${filter ? `?filter=${filter}` : ''}`);
export const getArtifacts = (team: string) => request(`/teams/${encodeURIComponent(team)}/artifacts`);
export const getUpdates = (team: string) => request(`/teams/${encodeURIComponent(team)}/updates`);
export const getAgentsLive = (team: string) => request(`/teams/${encodeURIComponent(team)}/agents-live`);

// Summary — stats for a team
export const getTeamSummary = (team: string) => Promise.all([
    getTasks(team).catch(() => []),
    getUpdates(team).catch(() => []),
    getAgents(team).catch(() => []),
]).then(([tasks, updates, agents]) => {
    // Find most recent timestamp from updates and tasks
    const timestamps: number[] = [];
    if (updates.length > 0) {
        const last = updates[updates.length - 1]?.timestamp;
        if (last) timestamps.push(new Date(last).getTime());
    }
    for (const t of tasks) {
        if (t.updatedAt) timestamps.push(new Date(t.updatedAt).getTime());
    }
    const lastActivity = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;

    const runningAgents = agents.filter((a: any) => a.ptyStatus === 'running').length;

    return {
        totalTasks: tasks.length,
        activeTasks: tasks.filter((t: any) => t.status !== 'done' && t.status !== 'rejected').length,
        lastActivity,
        agents: agents.map((a: any) => ({ name: a.name, ptyStatus: a.ptyStatus })),
        runningAgents,
    };
});

// Filesystem — opens native OS folder picker on the server
export const pickFolder = () => request('/fs/pick-folder', { method: 'POST' });

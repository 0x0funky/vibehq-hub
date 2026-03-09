import React, { useEffect, useState } from 'react';
import { getTeams, getTeamSummary } from '../api';
import { TeamCard } from '../components/TeamCard';
import { CreateTeamModal } from '../components/CreateTeamModal';

const s: Record<string, React.CSSProperties> = {
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
    },
    title: {
        fontSize: '24px',
        fontWeight: 700,
        color: '#f0f6fc',
    },
    createBtn: {
        padding: '8px 16px',
        background: '#238636',
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: 600,
    },
    overview: {
        display: 'flex',
        gap: '12px',
        marginBottom: '24px',
    },
    overviewCard: {
        flex: 1,
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '8px',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column' as const,
    },
    overviewValue: {
        fontSize: '28px',
        fontWeight: 700,
        color: '#f0f6fc',
        lineHeight: 1,
    },
    overviewLabel: {
        fontSize: '12px',
        color: '#8b949e',
        marginTop: '4px',
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '16px',
    },
    empty: {
        textAlign: 'center' as const,
        padding: '48px',
        color: '#8b949e',
    },
};

export function Home() {
    const [teams, setTeams] = useState<any[]>([]);
    const [showCreate, setShowCreate] = useState(false);
    const [loading, setLoading] = useState(true);
    const [overview, setOverview] = useState({ teams: 0, agents: 0, runningAgents: 0, activeTasks: 0, totalTasks: 0 });

    const loadTeams = () => {
        setLoading(true);
        getTeams().then(async (teams) => {
            setTeams(teams);
            // Compute overview stats
            let totalAgents = 0;
            let runningAgents = 0;
            let totalActive = 0;
            let totalTasks = 0;
            for (const t of teams) {
                totalAgents += t.agents?.length || 0;
            }
            const summaries = await Promise.all(
                teams.map((t: any) => getTeamSummary(t.name).catch(() => ({ totalTasks: 0, activeTasks: 0, runningAgents: 0, lastActivity: null, agents: [] })))
            );
            for (const sm of summaries) {
                totalActive += sm.activeTasks;
                totalTasks += sm.totalTasks;
                runningAgents += sm.runningAgents;
            }
            setOverview({ teams: teams.length, agents: totalAgents, runningAgents, activeTasks: totalActive, totalTasks });
        }).finally(() => setLoading(false));
    };

    useEffect(() => {
        loadTeams();
        const interval = setInterval(loadTeams, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div>
            <div style={s.header}>
                <h1 style={s.title}>Teams</h1>
                <button style={s.createBtn} onClick={() => setShowCreate(true)}>
                    + New Team
                </button>
            </div>

            {/* Overview stats */}
            {!loading && teams.length > 0 && (
                <div className="vhq-overview" style={s.overview}>
                    <div style={s.overviewCard}>
                        <span style={s.overviewValue}>{overview.teams}</span>
                        <span style={s.overviewLabel}>Teams</span>
                    </div>
                    <div style={s.overviewCard}>
                        <span style={{ ...s.overviewValue, color: overview.runningAgents > 0 ? '#3fb950' : '#f0f6fc' }}>
                            {overview.runningAgents}/{overview.agents}
                        </span>
                        <span style={s.overviewLabel}>Agents Running</span>
                    </div>
                    <div style={s.overviewCard}>
                        <span style={{ ...s.overviewValue, color: overview.activeTasks > 0 ? '#f0883e' : '#f0f6fc' }}>
                            {overview.activeTasks}
                        </span>
                        <span style={s.overviewLabel}>Active Tasks</span>
                    </div>
                    <div style={s.overviewCard}>
                        <span style={{ ...s.overviewValue, color: '#484f58' }}>{overview.totalTasks}</span>
                        <span style={s.overviewLabel}>Total Tasks</span>
                    </div>
                </div>
            )}

            {loading ? (
                <div style={s.empty}>Loading...</div>
            ) : teams.length === 0 ? (
                <div style={s.empty}>
                    <p>No teams configured yet.</p>
                    <p style={{ marginTop: '8px' }}>Create a team to get started.</p>
                </div>
            ) : (
                <div className="vhq-team-grid" style={s.grid}>
                    {teams.map((team: any) => (
                        <TeamCard key={team.name} team={team} onDeleted={loadTeams} />
                    ))}
                </div>
            )}

            {showCreate && (
                <CreateTeamModal
                    onClose={() => setShowCreate(false)}
                    onCreated={() => { setShowCreate(false); loadTeams(); }}
                />
            )}
        </div>
    );
}

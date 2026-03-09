import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteTeam, getTeamSummary } from '../api';

const s: Record<string, React.CSSProperties> = {
    card: {
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '8px',
        padding: '20px',
        transition: 'border-color 0.2s',
        position: 'relative' as const,
    },
    name: {
        fontSize: '18px',
        fontWeight: 600,
        color: '#58a6ff',
        marginBottom: '12px',
        textDecoration: 'none',
    },
    statsRow: {
        display: 'flex',
        gap: '16px',
        marginBottom: '14px',
    },
    stat: {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center' as const,
        minWidth: '48px',
    },
    statValue: {
        fontSize: '20px',
        fontWeight: 700,
        color: '#f0f6fc',
        lineHeight: 1,
    },
    statLabel: {
        fontSize: '11px',
        color: '#8b949e',
        marginTop: '2px',
    },
    agents: {
        display: 'flex',
        flexWrap: 'wrap' as const,
        gap: '6px',
        marginBottom: '10px',
    },
    badge: {
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        padding: '2px 8px',
        background: '#1c2128',
        border: '1px solid #30363d',
        borderRadius: '12px',
        fontSize: '12px',
        color: '#c9d1d9',
    },
    dot: {
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        display: 'inline-block',
    },
    footer: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '11px',
        color: '#484f58',
    },
    deleteBtn: {
        position: 'absolute' as const,
        top: '12px',
        right: '12px',
        background: 'none',
        border: 'none',
        color: '#8b949e',
        cursor: 'pointer',
        fontSize: '16px',
        padding: '4px 8px',
        borderRadius: '4px',
        lineHeight: 1,
    },
};

function timeAgo(ts: string | null): string {
    if (!ts) return 'No activity';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

interface Props {
    team: any;
    onDeleted: () => void;
}

export function TeamCard({ team, onDeleted }: Props) {
    const [summary, setSummary] = useState<any>(null);

    useEffect(() => {
        getTeamSummary(team.name).then(setSummary).catch(() => {});
        const interval = setInterval(() => {
            getTeamSummary(team.name).then(setSummary).catch(() => {});
        }, 5000);
        return () => clearInterval(interval);
    }, [team.name]);

    const handleDelete = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm(`Delete team "${team.name}"? This removes it from config.`)) return;
        try {
            await deleteTeam(team.name);
            onDeleted();
        } catch (err) {
            alert((err as Error).message);
        }
    };

    const agentCount = team.agents?.length || 0;

    return (
        <Link to={`/team/${encodeURIComponent(team.name)}`} style={{ textDecoration: 'none' }}>
            <div style={s.card}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#58a6ff')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#30363d')}
            >
                <button
                    style={s.deleteBtn}
                    onClick={handleDelete}
                    title="Delete team"
                    onMouseEnter={e => (e.currentTarget.style.color = '#f85149')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#8b949e')}
                >
                    x
                </button>

                <div style={s.name}>{team.name}</div>

                {/* Stats row */}
                <div style={s.statsRow}>
                    <div style={s.stat}>
                        <span style={{ ...s.statValue, color: (summary?.runningAgents ?? 0) > 0 ? '#3fb950' : '#f0f6fc' }}>
                            {summary ? `${summary.runningAgents}/${agentCount}` : agentCount}
                        </span>
                        <span style={s.statLabel}>Running</span>
                    </div>
                    <div style={s.stat}>
                        <span style={{ ...s.statValue, color: summary?.activeTasks ? '#f0883e' : '#484f58' }}>
                            {summary?.activeTasks ?? '-'}
                        </span>
                        <span style={s.statLabel}>Active</span>
                    </div>
                    <div style={s.stat}>
                        <span style={{ ...s.statValue, color: '#484f58' }}>
                            {summary?.totalTasks ?? '-'}
                        </span>
                        <span style={s.statLabel}>Tasks</span>
                    </div>
                </div>

                {/* Agent badges with live status dot */}
                {agentCount > 0 && (
                    <div style={s.agents}>
                        {(team.agents || []).map((a: any) => {
                            const agentStatus = summary?.agents?.find((sa: any) => sa.name === a.name);
                            const isRunning = agentStatus?.ptyStatus === 'running';
                            return (
                                <span key={a.name} style={s.badge}>
                                    <span style={{ ...s.dot, background: isRunning ? '#3fb950' : '#484f58' }} />
                                    {a.name}
                                    <span style={{ color: '#484f58' }}>({a.cli})</span>
                                </span>
                            );
                        })}
                    </div>
                )}

                {/* Footer */}
                <div style={s.footer}>
                    <span>port {team.hub?.port}</span>
                    <span>{summary ? timeAgo(summary.lastActivity) : ''}</span>
                </div>
            </div>
        </Link>
    );
}

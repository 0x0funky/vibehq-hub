import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTeam, getAgents, startTeam, stopTeam, deleteTeam } from '../api';
import { connectHubEvents } from '../ws';
import { AgentCard } from '../components/AgentCard';
import { TaskBoard } from '../components/TaskBoard';
import { UpdatesFeed } from '../components/UpdatesFeed';
import { Terminal } from '../components/Terminal';
import { AddAgentModal } from '../components/AddAgentModal';

const styles: Record<string, React.CSSProperties> = {
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        flexWrap: 'wrap' as const,
        gap: '10px',
    },
    title: { fontSize: '22px', fontWeight: 700, color: '#f0f6fc' },
    controls: { display: 'flex', gap: '8px' },
    btn: {
        padding: '6px 14px',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: 600,
        color: '#fff',
    },
    startBtn: { background: '#238636' },
    stopBtn: { background: '#da3633' },
    deleteBtn: { background: '#21262d', border: '1px solid #da3633', color: '#f85149' },
    agentHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
    },
    agentTitle: { fontSize: '15px', fontWeight: 600, color: '#c9d1d9' },
    addAgentBtn: {
        padding: '5px 12px',
        background: '#21262d',
        border: '1px solid #30363d',
        borderRadius: '6px',
        color: '#c9d1d9',
        cursor: 'pointer',
        fontSize: '13px',
    },
    agentGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '12px',
        marginBottom: '20px',
    },
    tabs: {
        display: 'flex',
        gap: '4px',
        marginBottom: '16px',
        borderBottom: '1px solid #30363d',
        paddingBottom: '0',
    },
    tab: {
        padding: '8px 16px',
        background: 'none',
        border: 'none',
        borderBottom: '2px solid transparent',
        color: '#8b949e',
        cursor: 'pointer',
        fontSize: '14px',
    },
    activeTab: {
        color: '#f0f6fc',
        borderBottomColor: '#1f6feb',
    },
    terminalSection: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 500px), 1fr))',
        gap: '12px',
    },
    emptyAgents: {
        padding: '32px',
        textAlign: 'center' as const,
        color: '#8b949e',
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '8px',
        marginBottom: '20px',
    },
};

type Tab = 'terminals' | 'tasks' | 'updates';

export function TeamDashboard() {
    const { name } = useParams<{ name: string }>();
    const navigate = useNavigate();
    const [team, setTeam] = useState<any>(null);
    const [agents, setAgents] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<Tab>('terminals');
    const [liveAgents, setLiveAgents] = useState<Map<string, any>>(new Map());
    const [, setTick] = useState(0);
    const [showAddAgent, setShowAddAgent] = useState(false);

    const loadData = useCallback(() => {
        if (!name) return;
        getTeam(name).then(setTeam);
        getAgents(name).then(setAgents);
    }, [name]);

    useEffect(() => { loadData(); }, [loadData]);

    // Hub events WebSocket
    useEffect(() => {
        if (!name) return;
        const ws = connectHubEvents(name, (msg) => {
            if (msg.type === 'agent:status:broadcast') {
                setLiveAgents(prev => {
                    const next = new Map(prev);
                    next.set(msg.name, msg);
                    return next;
                });
            } else if (msg.type === 'agent:disconnected') {
                setLiveAgents(prev => {
                    const next = new Map(prev);
                    next.delete(msg.name);
                    return next;
                });
            }
            setTick(t => t + 1);
        });
        return () => ws.close();
    }, [name]);

    if (!name || !team) return <div style={{ color: '#8b949e' }}>Loading...</div>;

    const handleStart = async () => {
        await startTeam(name);
        loadData();
    };
    const handleStop = async () => {
        await stopTeam(name);
        loadData();
    };
    const handleDeleteTeam = async () => {
        if (!confirm(`Delete team "${name}"? This removes it from config permanently.`)) return;
        try {
            await deleteTeam(name);
            navigate('/');
        } catch (err) {
            alert((err as Error).message);
        }
    };

    const tabs: { id: Tab; label: string }[] = [
        { id: 'terminals', label: 'Terminals' },
        { id: 'tasks', label: 'Tasks' },
        { id: 'updates', label: 'Updates' },
    ];

    return (
        <div>
            <div style={styles.header}>
                <h1 style={styles.title}>{team.name}</h1>
                <div style={styles.controls}>
                    <button style={{ ...styles.btn, ...styles.startBtn }} onClick={handleStart}>
                        Start All
                    </button>
                    <button style={{ ...styles.btn, ...styles.stopBtn }} onClick={handleStop}>
                        Stop All
                    </button>
                    <button style={{ ...styles.btn, ...styles.deleteBtn }} onClick={handleDeleteTeam}>
                        Delete Team
                    </button>
                </div>
            </div>

            <div style={styles.agentHeader}>
                <span style={styles.agentTitle}>
                    Agents ({agents.length})
                </span>
                <button style={styles.addAgentBtn} onClick={() => setShowAddAgent(true)}>
                    + Add Agent
                </button>
            </div>

            {agents.length === 0 ? (
                <div style={styles.emptyAgents}>
                    <p>No agents yet. Add an agent to get started.</p>
                </div>
            ) : (
                <div className="vhq-agent-grid" style={styles.agentGrid}>
                    {agents.map((agent: any) => (
                        <AgentCard
                            key={agent.name}
                            agent={agent}
                            team={name}
                            liveStatus={liveAgents.get(agent.name)}
                            onRefresh={loadData}
                        />
                    ))}
                </div>
            )}

            <div style={styles.tabs}>
                {tabs.map(t => (
                    <button
                        key={t.id}
                        style={{
                            ...styles.tab,
                            ...(activeTab === t.id ? styles.activeTab : {}),
                        }}
                        onClick={() => setActiveTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {activeTab === 'terminals' && (
                <div className="vhq-terminal-grid" style={styles.terminalSection}>
                    {agents.map((agent: any) => (
                        <Terminal
                            key={agent.name}
                            team={name}
                            agentName={agent.name}
                            isRunning={agent.ptyStatus === 'running'}
                        />
                    ))}
                </div>
            )}
            {activeTab === 'tasks' && <TaskBoard team={name} />}
            {activeTab === 'updates' && <UpdatesFeed team={name} />}

            {showAddAgent && (
                <AddAgentModal
                    team={name}
                    onClose={() => setShowAddAgent(false)}
                    onCreated={() => { setShowAddAgent(false); loadData(); }}
                />
            )}
        </div>
    );
}

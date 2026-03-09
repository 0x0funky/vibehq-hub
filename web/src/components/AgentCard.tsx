import React from 'react';
import { startAgent, stopAgent, deleteAgent } from '../api';

const statusColors: Record<string, string> = {
    idle: '#3fb950',
    working: '#d29922',
    busy: '#f85149',
    running: '#3fb950',
    stopped: '#8b949e',
    unknown: '#8b949e',
};

const styles: Record<string, React.CSSProperties> = {
    card: {
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '8px',
        padding: '14px 16px',
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '8px',
    },
    name: { fontSize: '15px', fontWeight: 600, color: '#f0f6fc' },
    role: { fontSize: '12px', color: '#8b949e', marginBottom: '4px' },
    cwd: { fontSize: '11px', color: '#6e7681', marginBottom: '8px', wordBreak: 'break-all' as const },
    statusRow: {
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        fontSize: '12px',
    },
    dot: {
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        display: 'inline-block',
    },
    controls: { display: 'flex', gap: '4px' },
    smallBtn: {
        padding: '3px 8px',
        border: '1px solid #30363d',
        borderRadius: '4px',
        background: '#21262d',
        color: '#c9d1d9',
        cursor: 'pointer',
        fontSize: '11px',
    },
    deleteBtn: {
        padding: '3px 8px',
        border: '1px solid #da3633',
        borderRadius: '4px',
        background: 'none',
        color: '#f85149',
        cursor: 'pointer',
        fontSize: '11px',
    },
};

interface Props {
    agent: any;
    team: string;
    liveStatus?: any;
    onRefresh: () => void;
}

export function AgentCard({ agent, team, liveStatus, onRefresh }: Props) {
    const hubStatus = liveStatus?.status || 'offline';
    const ptyStatus = agent.ptyStatus || 'unknown';

    const handleStart = async () => { await startAgent(team, agent.name); onRefresh(); };
    const handleStop = async () => { await stopAgent(team, agent.name); onRefresh(); };
    const handleDelete = async () => {
        if (!confirm(`Remove agent "${agent.name}" from team "${team}"?`)) return;
        try {
            await deleteAgent(team, agent.name);
            onRefresh();
        } catch (err) {
            alert((err as Error).message);
        }
    };

    return (
        <div style={styles.card}>
            <div style={styles.header}>
                <span style={styles.name}>{agent.name}</span>
                <div style={styles.controls}>
                    {ptyStatus !== 'running' ? (
                        <button style={styles.smallBtn} onClick={handleStart}>Start</button>
                    ) : (
                        <button style={styles.smallBtn} onClick={handleStop}>Stop</button>
                    )}
                    <button style={styles.deleteBtn} onClick={handleDelete}>Remove</button>
                </div>
            </div>
            <div style={styles.role}>{agent.role} &middot; {agent.cli}</div>
            <div style={styles.cwd}>{agent.cwd}</div>
            <div style={styles.statusRow}>
                <span style={{ ...styles.dot, background: statusColors[ptyStatus] || '#8b949e' }} />
                <span>PTY: {ptyStatus}</span>
                {liveStatus && (
                    <>
                        <span style={{ ...styles.dot, background: statusColors[hubStatus] || '#8b949e', marginLeft: '8px' }} />
                        <span>Hub: {hubStatus}</span>
                    </>
                )}
            </div>
        </div>
    );
}

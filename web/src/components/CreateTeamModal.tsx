import React, { useState } from 'react';
import { createTeam } from '../api';

const styles: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
    },
    modal: {
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '12px',
        padding: '24px',
        width: '420px',
        maxWidth: '90vw',
    },
    title: { fontSize: '18px', fontWeight: 600, color: '#f0f6fc', marginBottom: '16px' },
    label: { display: 'block', fontSize: '13px', color: '#c9d1d9', marginBottom: '4px' },
    input: {
        width: '100%',
        padding: '8px 12px',
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: '6px',
        color: '#c9d1d9',
        fontSize: '14px',
        marginBottom: '12px',
    },
    buttons: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' },
    cancelBtn: {
        padding: '8px 16px',
        background: '#21262d',
        border: '1px solid #30363d',
        borderRadius: '6px',
        color: '#c9d1d9',
        cursor: 'pointer',
    },
    createBtn: {
        padding: '8px 16px',
        background: '#238636',
        border: 'none',
        borderRadius: '6px',
        color: '#fff',
        cursor: 'pointer',
        fontWeight: 600,
    },
    error: { color: '#f85149', fontSize: '13px', marginBottom: '8px' },
};

interface Props {
    onClose: () => void;
    onCreated: () => void;
}

export function CreateTeamModal({ onClose, onCreated }: Props) {
    const [name, setName] = useState('');
    const [port, setPort] = useState('3001');
    const [error, setError] = useState('');

    const handleCreate = async () => {
        if (!name.trim()) { setError('Team name is required'); return; }
        try {
            await createTeam({
                name: name.trim(),
                hub: { port: parseInt(port) || 3001 },
                agents: [],
            });
            onCreated();
        } catch (err) {
            setError((err as Error).message);
        }
    };

    return (
        <div style={styles.overlay} onClick={onClose}>
            <div style={styles.modal} onClick={e => e.stopPropagation()}>
                <div style={styles.title}>Create Team</div>
                {error && <div style={styles.error}>{error}</div>}
                <label style={styles.label}>Team Name</label>
                <input
                    style={styles.input}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="my-team"
                    autoFocus
                />
                <label style={styles.label}>Hub Port</label>
                <input
                    style={styles.input}
                    value={port}
                    onChange={e => setPort(e.target.value)}
                    placeholder="3001"
                />
                <div style={styles.buttons}>
                    <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
                    <button style={styles.createBtn} onClick={handleCreate}>Create</button>
                </div>
            </div>
        </div>
    );
}

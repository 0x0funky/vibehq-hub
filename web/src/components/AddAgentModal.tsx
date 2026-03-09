import React, { useState } from 'react';
import { createAgent, pickFolder } from '../api';

const ROLE_PRESETS = [
    { role: 'Project Manager', description: 'Orchestrates team, defines tasks, tracks progress' },
    { role: 'Frontend Engineer', description: 'Builds UI, connects to backend APIs' },
    { role: 'Backend Engineer', description: 'Builds APIs, database, business logic' },
    { role: 'Full Stack Engineer', description: 'Handles both frontend and backend' },
    { role: 'AI Engineer', description: 'Builds AI/ML features, integrations, prompts' },
    { role: 'Product Designer', description: 'UX/UI design, user research, prototypes' },
    { role: 'QA Engineer', description: 'Testing, quality assurance, bug tracking' },
    { role: 'Marketing Strategist', description: 'Brand strategy, campaigns, growth' },
    { role: 'Custom', description: 'Define your own role' },
];

const CLI_OPTIONS = ['claude', 'codex', 'gemini', 'aider', 'cursor'];

const s: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    },
    modal: {
        background: '#161b22', border: '1px solid #30363d', borderRadius: '12px',
        padding: '24px', width: '520px', maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto' as const,
    },
    title: { fontSize: '18px', fontWeight: 600, color: '#f0f6fc', marginBottom: '16px' },
    label: { display: 'block', fontSize: '13px', color: '#c9d1d9', marginBottom: '4px', marginTop: '12px' },
    input: {
        width: '100%', padding: '8px 12px', background: '#0d1117',
        border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '14px',
    },
    select: {
        width: '100%', padding: '8px 12px', background: '#0d1117',
        border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '14px',
        cursor: 'pointer',
    },
    cwdRow: {
        display: 'flex', gap: '8px', alignItems: 'center',
    },
    browseBtn: {
        padding: '8px 14px', background: '#21262d', border: '1px solid #30363d',
        borderRadius: '6px', color: '#c9d1d9', cursor: 'pointer', fontSize: '13px',
        whiteSpace: 'nowrap' as const, flexShrink: 0,
    },
    roleGrid: {
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '4px',
    },
    roleOption: {
        padding: '8px 10px', background: '#0d1117', border: '1px solid #30363d',
        borderRadius: '6px', cursor: 'pointer', textAlign: 'left' as const,
    },
    roleOptionActive: {
        borderColor: '#1f6feb', background: '#0d1117',
    },
    roleName: { fontSize: '13px', fontWeight: 600, color: '#c9d1d9' },
    roleDesc: { fontSize: '11px', color: '#8b949e', marginTop: '2px' },
    buttons: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' },
    cancelBtn: {
        padding: '8px 16px', background: '#21262d', border: '1px solid #30363d',
        borderRadius: '6px', color: '#c9d1d9', cursor: 'pointer',
    },
    createBtn: {
        padding: '8px 16px', background: '#238636', border: 'none',
        borderRadius: '6px', color: '#fff', cursor: 'pointer', fontWeight: 600,
    },
    error: { color: '#f85149', fontSize: '13px', marginTop: '8px' },
    hint: { fontSize: '11px', color: '#8b949e', marginTop: '4px' },
    textarea: {
        width: '100%', padding: '8px 12px', background: '#0d1117',
        border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9',
        fontSize: '13px', minHeight: '80px', resize: 'vertical' as const, fontFamily: 'inherit',
    },
};

interface Props {
    team: string;
    onClose: () => void;
    onCreated: () => void;
}

export function AddAgentModal({ team, onClose, onCreated }: Props) {
    const [name, setName] = useState('');
    const [selectedRole, setSelectedRole] = useState('');
    const [customRole, setCustomRole] = useState('');
    const [cli, setCli] = useState('claude');
    const [cwd, setCwd] = useState('');
    const [systemPrompt, setSystemPrompt] = useState('');
    const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(false);
    const [error, setError] = useState('');
    const [browsing, setBrowsing] = useState(false);

    const effectiveRole = selectedRole === 'Custom' ? customRole : selectedRole;

    const handleBrowse = async () => {
        if (browsing) return;
        setBrowsing(true);
        setError('');
        try {
            // Server opens native OS folder picker (PowerShell / osascript / zenity)
            const result = await pickFolder();
            if (result?.path) setCwd(result.path);
        } catch (err: any) {
            setError(err?.message || 'Failed to select folder');
        } finally {
            setBrowsing(false);
        }
    };

    const handleCreate = async () => {
        setError('');
        if (!name.trim()) { setError('Agent name is required'); return; }
        if (!effectiveRole) { setError('Please select a role'); return; }
        if (!cwd.trim()) { setError('Project directory (CWD) is required'); return; }

        try {
            await createAgent(team, {
                name: name.trim(),
                role: effectiveRole,
                cli,
                cwd: cwd.trim(),
                systemPrompt: systemPrompt.trim() || undefined,
                dangerouslySkipPermissions: dangerouslySkipPermissions || undefined,
            });
            onCreated();
        } catch (err) {
            setError((err as Error).message);
        }
    };

    return (
        <>
            <div style={s.overlay} onClick={onClose}>
                <div style={s.modal} onClick={e => e.stopPropagation()}>
                    <div style={s.title}>Add Agent to {team}</div>

                    {/* Name */}
                    <label style={{ ...s.label, marginTop: 0 }}>Agent Name</label>
                    <input style={s.input} value={name} onChange={e => setName(e.target.value)}
                        placeholder="Alex" autoFocus />

                    {/* Role */}
                    <label style={s.label}>Role</label>
                    <div style={s.roleGrid}>
                        {ROLE_PRESETS.map(r => (
                            <button key={r.role}
                                style={{
                                    ...s.roleOption,
                                    ...(selectedRole === r.role ? s.roleOptionActive : {}),
                                }}
                                onClick={() => setSelectedRole(r.role)}
                            >
                                <div style={s.roleName}>{r.role}</div>
                                <div style={s.roleDesc}>{r.description}</div>
                            </button>
                        ))}
                    </div>
                    {selectedRole === 'Custom' && (
                        <>
                            <label style={s.label}>Custom Role Title</label>
                            <input style={s.input} value={customRole}
                                onChange={e => setCustomRole(e.target.value)}
                                placeholder="Data Engineer" />
                        </>
                    )}

                    {/* CLI */}
                    <label style={s.label}>CLI Type</label>
                    <select style={s.select} value={cli} onChange={e => setCli(e.target.value)}>
                        {CLI_OPTIONS.map(c => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>

                    {/* CWD with folder picker */}
                    <label style={s.label}>Project Directory (CWD)</label>
                    <div style={s.cwdRow}>
                        <input style={{ ...s.input, flex: 1 }} value={cwd}
                            onChange={e => setCwd(e.target.value)}
                            placeholder="D:\my-project\backend" />
                        <button style={s.browseBtn} onClick={handleBrowse} type="button" disabled={browsing}>
                            {browsing ? 'Selecting...' : 'Browse...'}
                        </button>
                    </div>
                    <div style={s.hint}>
                        Full path to the agent's working directory.
                    </div>

                    {/* System Prompt */}
                    <label style={s.label}>System Prompt (optional)</label>
                    <textarea style={s.textarea} value={systemPrompt}
                        onChange={e => setSystemPrompt(e.target.value)}
                        placeholder="Additional instructions for this agent..." />
                    <div style={s.hint}>
                        Leave empty to use the default system prompt for the selected role.
                    </div>

                    {/* Skip Permissions */}
                    <label style={{ ...s.label, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={dangerouslySkipPermissions}
                            onChange={e => setDangerouslySkipPermissions(e.target.checked)} />
                        <span>Skip permissions (Claude only, --dangerously-skip-permissions)</span>
                    </label>

                    {error && <div style={s.error}>{error}</div>}

                    <div style={s.buttons}>
                        <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
                        <button style={s.createBtn} onClick={handleCreate}>Add Agent</button>
                    </div>
                </div>
            </div>

        </>
    );
}

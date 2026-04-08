import React, { useEffect, useState } from 'react';
import { createAgent, pickFolder } from '../api';
import { ROLE_PRESETS, getPresetByRole } from '../../../src/tui/role-presets.ts';
import { normalizeAgentCwd } from '../../../src/shared/path-utils.ts';

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
    const [codexDangerouslyBypassApprovalsAndSandbox, setCodexDangerouslyBypassApprovalsAndSandbox] = useState(false);
    const [error, setError] = useState('');
    const [browsing, setBrowsing] = useState(false);

    const effectiveRole = selectedRole === 'Custom' ? customRole : selectedRole;

    useEffect(() => {
        if (!selectedRole) return;
        setSystemPrompt(getPresetByRole(selectedRole)?.defaultSystemPrompt ?? '');
    }, [selectedRole]);

    const handleBrowse = async () => {
        if (browsing) return;
        setBrowsing(true);
        setError('');
        try {
            // Server opens native OS folder picker (PowerShell / osascript / zenity)
            const result = await pickFolder();
            if (result?.path) setCwd(normalizeAgentCwd(result.path));
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
        const normalizedCwd = normalizeAgentCwd(cwd);

        try {
            await createAgent(team, {
                name: name.trim(),
                role: effectiveRole,
                rolePreset: selectedRole,
                cli,
                cwd: normalizedCwd,
                systemPrompt: systemPrompt.trim() || undefined,
                dangerouslySkipPermissions: dangerouslySkipPermissions || undefined,
                codexDangerouslyBypassApprovalsAndSandbox: cli === 'codex' && codexDangerouslyBypassApprovalsAndSandbox
                    ? true
                    : undefined,
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
                    <label style={s.label}>System Prompt</label>
                    <textarea style={s.textarea} value={systemPrompt}
                        onChange={e => setSystemPrompt(e.target.value)}
                        placeholder="Role preset prompt will appear here..." />
                    <div style={s.hint}>
                        Selecting a preset loads the same default system prompt used by TUI. You can edit it before creating the agent.
                    </div>

                    {/* Skip Permissions */}
                    <label style={{ ...s.label, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={dangerouslySkipPermissions}
                            onChange={e => setDangerouslySkipPermissions(e.target.checked)} />
                        <span>Skip permissions (Claude only, --dangerously-skip-permissions)</span>
                    </label>
                    <label style={{ ...s.label, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={codexDangerouslyBypassApprovalsAndSandbox}
                            disabled={cli !== 'codex'}
                            onChange={e => setCodexDangerouslyBypassApprovalsAndSandbox(e.target.checked)}
                        />
                        <span>Bypass approvals and sandbox (Codex only)</span>
                    </label>
                    <div style={s.hint}>
                        Starts Codex with <code>--dangerously-bypass-approvals-and-sandbox</code>. This gives Codex full access and stops permission prompts.
                    </div>

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

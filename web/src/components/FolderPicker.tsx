import React, { useEffect, useState } from 'react';
import { browseDirs } from '../api';

const s: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    },
    modal: {
        background: '#161b22', border: '1px solid #30363d', borderRadius: '12px',
        padding: '20px', width: '500px', maxWidth: '90vw', maxHeight: '70vh',
        display: 'flex', flexDirection: 'column' as const,
    },
    title: { fontSize: '16px', fontWeight: 600, color: '#f0f6fc', marginBottom: '12px' },
    currentPath: {
        padding: '8px 12px', background: '#0d1117', border: '1px solid #30363d',
        borderRadius: '6px', color: '#58a6ff', fontSize: '13px', marginBottom: '12px',
        wordBreak: 'break-all' as const, minHeight: '36px', display: 'flex', alignItems: 'center',
    },
    list: {
        flex: 1, overflowY: 'auto' as const, border: '1px solid #30363d',
        borderRadius: '6px', background: '#0d1117', marginBottom: '12px', minHeight: '200px',
    },
    item: {
        padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#c9d1d9',
        borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: '8px',
    },
    itemHover: {
        background: '#1c2128',
    },
    folderIcon: { color: '#d29922', fontSize: '14px', flexShrink: 0 },
    backItem: {
        padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#8b949e',
        borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '8px',
        fontStyle: 'italic' as const,
    },
    buttons: { display: 'flex', gap: '8px', justifyContent: 'flex-end' },
    cancelBtn: {
        padding: '8px 16px', background: '#21262d', border: '1px solid #30363d',
        borderRadius: '6px', color: '#c9d1d9', cursor: 'pointer',
    },
    selectBtn: {
        padding: '8px 16px', background: '#1f6feb', border: 'none',
        borderRadius: '6px', color: '#fff', cursor: 'pointer', fontWeight: 600,
    },
    loading: { padding: '20px', textAlign: 'center' as const, color: '#8b949e' },
    error: { padding: '12px', color: '#f85149', fontSize: '13px' },
    empty: { padding: '20px', textAlign: 'center' as const, color: '#6e7681', fontSize: '13px' },
};

interface Props {
    initialPath?: string;
    onSelect: (path: string) => void;
    onClose: () => void;
}

interface DirEntry { name: string; path: string; }
interface BrowseResult { path: string; parent: string | null; dirs: DirEntry[]; }

export function FolderPicker({ initialPath, onSelect, onClose }: Props) {
    const [currentPath, setCurrentPath] = useState(initialPath || '');
    const [dirs, setDirs] = useState<DirEntry[]>([]);
    const [parent, setParent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [hoveredIdx, setHoveredIdx] = useState(-1);

    const loadDir = (path: string) => {
        setLoading(true);
        setError('');
        browseDirs(path)
            .then((result: BrowseResult) => {
                setCurrentPath(result.path);
                setDirs(result.dirs);
                setParent(result.parent);
            })
            .catch((err: Error) => setError(err.message))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        loadDir(initialPath || '');
    }, []);

    const handleNavigate = (path: string) => {
        loadDir(path);
    };

    const handleSelect = () => {
        if (currentPath) {
            onSelect(currentPath);
        }
    };

    return (
        <div style={s.overlay} onClick={onClose}>
            <div style={s.modal} onClick={e => e.stopPropagation()}>
                <div style={s.title}>Select Folder</div>

                <div style={s.currentPath}>
                    {currentPath || 'Drives'}
                </div>

                <div style={s.list}>
                    {loading ? (
                        <div style={s.loading}>Loading...</div>
                    ) : error ? (
                        <div style={s.error}>{error}</div>
                    ) : (
                        <>
                            {parent !== null && (
                                <div style={s.backItem} onClick={() => handleNavigate(parent)}>
                                    <span>{'<-'}</span>
                                    <span>.. (up)</span>
                                </div>
                            )}
                            {dirs.length === 0 ? (
                                <div style={s.empty}>No subdirectories</div>
                            ) : (
                                dirs.map((dir, i) => (
                                    <div key={dir.path}
                                        style={{
                                            ...s.item,
                                            ...(hoveredIdx === i ? s.itemHover : {}),
                                        }}
                                        onClick={() => handleNavigate(dir.path)}
                                        onMouseEnter={() => setHoveredIdx(i)}
                                        onMouseLeave={() => setHoveredIdx(-1)}
                                    >
                                        <span style={s.folderIcon}>{'>'}</span>
                                        <span>{dir.name}</span>
                                    </div>
                                ))
                            )}
                        </>
                    )}
                </div>

                <div style={s.buttons}>
                    <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
                    <button style={s.selectBtn} onClick={handleSelect}
                        disabled={!currentPath}>
                        Select This Folder
                    </button>
                </div>
            </div>
        </div>
    );
}

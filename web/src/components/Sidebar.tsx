import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getTeams } from '../api';

interface Props {
    open: boolean;
    onClose: () => void;
}

export function Sidebar({ open, onClose }: Props) {
    const [teams, setTeams] = useState<any[]>([]);
    const location = useLocation();

    useEffect(() => {
        getTeams().then(setTeams).catch(() => {});
        const interval = setInterval(() => {
            getTeams().then(setTeams).catch(() => {});
        }, 10000);
        return () => clearInterval(interval);
    }, []);

    // Close sidebar on navigation (mobile)
    useEffect(() => { onClose(); }, [location.pathname]);

    return (
        <>
            {open && <div style={s.overlay} onClick={onClose} />}

            <nav className={`vhq-sidebar${open ? ' open' : ''}`} style={s.sidebar}>
                <div style={s.logo}>
                    <Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}>
                        VibeHQ
                    </Link>
                    <button className="vhq-sidebar-close" style={s.closeBtn} onClick={onClose}>
                        &times;
                    </button>
                </div>
                <div style={s.section}>
                    <Link to="/" style={s.sectionTitle}>Teams</Link>
                    {teams.map((t: any) => (
                        <Link
                            key={t.name}
                            to={`/team/${encodeURIComponent(t.name)}`}
                            style={{
                                ...s.link,
                                ...(location.pathname === `/team/${encodeURIComponent(t.name)}` ? s.activeLink : {}),
                            }}
                        >
                            {t.name}
                        </Link>
                    ))}
                </div>
            </nav>
        </>
    );
}

const s: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 49,
    },
    sidebar: {
        width: '240px',
        minWidth: '240px',
        background: '#161b22',
        borderRight: '1px solid #30363d',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'auto',
        transition: 'transform 0.2s ease',
    },
    logo: {
        padding: '16px 20px',
        fontSize: '18px',
        fontWeight: 700,
        color: '#58a6ff',
        borderBottom: '1px solid #30363d',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    closeBtn: {
        display: 'none',  // shown via .vhq-sidebar-close on mobile
        background: 'none',
        border: 'none',
        color: '#8b949e',
        fontSize: '24px',
        cursor: 'pointer',
        padding: '0 4px',
        lineHeight: 1,
    },
    section: {
        padding: '12px 0',
    },
    sectionTitle: {
        display: 'block',
        padding: '4px 20px 8px',
        fontSize: '11px',
        fontWeight: 600,
        color: '#8b949e',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
        textDecoration: 'none',
        cursor: 'pointer',
    },
    link: {
        display: 'block',
        padding: '6px 20px',
        color: '#c9d1d9',
        textDecoration: 'none',
        fontSize: '14px',
        borderLeft: '2px solid transparent',
    },
    activeLink: {
        color: '#f0f6fc',
        background: '#1c2128',
        borderLeftColor: '#1f6feb',
    },
};

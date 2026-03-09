import React, { useEffect, useState } from 'react';
import { getUpdates } from '../api';

const styles: Record<string, React.CSSProperties> = {
    update: {
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '8px',
        padding: '12px 16px',
        marginBottom: '8px',
    },
    from: { fontSize: '13px', fontWeight: 600, color: '#58a6ff', marginBottom: '4px' },
    message: { fontSize: '13px', color: '#c9d1d9', lineHeight: '1.4' },
    time: { fontSize: '11px', color: '#8b949e', marginTop: '4px' },
    empty: { color: '#8b949e', textAlign: 'center' as const, padding: '32px' },
};

export function UpdatesFeed({ team }: { team: string }) {
    const [updates, setUpdates] = useState<any[]>([]);

    useEffect(() => {
        const load = () => getUpdates(team).then(setUpdates);
        load();
        const interval = setInterval(load, 5000);
        return () => clearInterval(interval);
    }, [team]);

    if (updates.length === 0) {
        return <div style={styles.empty}>No team updates yet</div>;
    }

    return (
        <div>
            {[...updates].reverse().map((u: any, i: number) => (
                <div key={i} style={styles.update}>
                    <div style={styles.from}>{u.from}</div>
                    <div style={styles.message}>{u.message}</div>
                    <div style={styles.time}>{new Date(u.timestamp).toLocaleString()}</div>
                </div>
            ))}
        </div>
    );
}

import React, { useEffect, useState } from 'react';
import { getTasks } from '../api';

const statusColors: Record<string, string> = {
    created: '#58a6ff',
    queued: '#d29922',
    accepted: '#3fb950',
    rejected: '#f85149',
    in_progress: '#d29922',
    blocked: '#f85149',
    done: '#3fb950',
};

const styles: Record<string, React.CSSProperties> = {
    container: { },
    filters: {
        display: 'flex',
        gap: '8px',
        marginBottom: '12px',
    },
    filterBtn: {
        padding: '4px 12px',
        border: '1px solid #30363d',
        borderRadius: '16px',
        background: 'none',
        color: '#8b949e',
        cursor: 'pointer',
        fontSize: '12px',
    },
    activeFilter: {
        background: '#1f6feb',
        color: '#fff',
        borderColor: '#1f6feb',
    },
    task: {
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '8px',
        padding: '12px 16px',
        marginBottom: '8px',
    },
    taskHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '6px',
    },
    taskTitle: { fontSize: '14px', fontWeight: 600, color: '#f0f6fc' },
    statusBadge: {
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: 600,
    },
    taskMeta: { fontSize: '12px', color: '#8b949e' },
    empty: { color: '#8b949e', textAlign: 'center' as const, padding: '32px' },
};

export function TaskBoard({ team }: { team: string }) {
    const [tasks, setTasks] = useState<any[]>([]);
    const [filter, setFilter] = useState<string>('all');

    useEffect(() => {
        const load = () => getTasks(team, filter === 'all' ? undefined : filter).then(setTasks);
        load();
        const interval = setInterval(load, 5000);
        return () => clearInterval(interval);
    }, [team, filter]);

    const filters = ['all', 'active'];

    return (
        <div style={styles.container}>
            <div style={styles.filters}>
                {filters.map(f => (
                    <button
                        key={f}
                        style={{ ...styles.filterBtn, ...(filter === f ? styles.activeFilter : {}) }}
                        onClick={() => setFilter(f)}
                    >
                        {f}
                    </button>
                ))}
            </div>

            {tasks.length === 0 ? (
                <div style={styles.empty}>No tasks</div>
            ) : (
                tasks.map((task: any) => (
                    <div key={task.taskId} style={styles.task}>
                        <div style={styles.taskHeader}>
                            <span style={styles.taskTitle}>{task.title}</span>
                            <span style={{
                                ...styles.statusBadge,
                                background: statusColors[task.status] || '#8b949e',
                                color: '#fff',
                            }}>
                                {task.status}
                            </span>
                        </div>
                        <div style={styles.taskMeta}>
                            {task.creator} &rarr; {task.assignee} &middot; {task.priority} priority &middot; {task.taskId}
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}

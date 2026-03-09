import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { connectTerminal } from '../ws';
import 'xterm/css/xterm.css';

const s: Record<string, React.CSSProperties> = {
    container: {
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: '8px',
        overflow: 'hidden',
    },
    header: {
        padding: '8px 12px',
        background: '#161b22',
        borderBottom: '1px solid #30363d',
        fontSize: '13px',
        fontWeight: 600,
        color: '#c9d1d9',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    termArea: {
        height: '350px',
        padding: '4px',
    },
    offline: {
        height: '350px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#8b949e',
        fontSize: '14px',
    },
    toolbar: {
        display: 'flex',
        gap: '4px',
        padding: '6px 8px',
        background: '#161b22',
        borderTop: '1px solid #30363d',
        flexWrap: 'wrap' as const,
        justifyContent: 'center',
    },
    tbtn: {
        padding: '6px 10px',
        minWidth: '36px',
        background: '#21262d',
        border: '1px solid #30363d',
        borderRadius: '4px',
        color: '#c9d1d9',
        fontSize: '13px',
        fontFamily: 'monospace',
        cursor: 'pointer',
        textAlign: 'center' as const,
        userSelect: 'none' as const,
        WebkitTapHighlightColor: 'transparent',
    },
};

// ANSI escape sequences
const KEYS: [string, string][] = [
    ['\u2191', '\x1b[A'],    // ↑
    ['\u2193', '\x1b[B'],    // ↓
    ['\u2190', '\x1b[D'],    // ←
    ['\u2192', '\x1b[C'],    // →
    ['Tab', '\t'],
    ['Esc', '\x1b'],
    ['Ctrl+C', '\x03'],
    ['Ctrl+D', '\x04'],
    ['Ctrl+Z', '\x1a'],
    ['Enter', '\r'],
];

interface Props {
    team: string;
    agentName: string;
    isRunning: boolean;
}

export function Terminal({ team, agentName, isRunning }: Props) {
    const termRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const [connected, setConnected] = useState(false);
    const [isTouch] = useState(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0);

    const sendKey = useCallback((seq: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(seq);
        }
    }, []);

    useEffect(() => {
        if (!isRunning || !termRef.current) return;

        const xterm = new XTerm({
            theme: {
                background: '#0d1117',
                foreground: '#c9d1d9',
                cursor: '#c9d1d9',
                selectionBackground: '#264f78',
            },
            fontSize: 13,
            fontFamily: "'Cascadia Code', 'Fira Code', Menlo, monospace",
            cursorBlink: true,
            convertEol: true,
        });

        const fitAddon = new FitAddon();
        xterm.loadAddon(fitAddon);
        xterm.open(termRef.current);
        fitAddon.fit();

        xtermRef.current = xterm;
        fitRef.current = fitAddon;

        const ws = connectTerminal(team, agentName);
        wsRef.current = ws;

        ws.onopen = () => {
            setConnected(true);
            const dims = fitAddon.proposeDimensions();
            if (dims?.cols && dims?.rows) {
                ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
            }
        };

        ws.onmessage = (event) => {
            xterm.write(event.data);
        };

        ws.onclose = () => setConnected(false);
        ws.onerror = () => setConnected(false);

        xterm.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        });

        const observer = new ResizeObserver(() => {
            fitAddon.fit();
            const dims = fitAddon.proposeDimensions();
            if (dims?.cols && dims?.rows && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
            }
        });
        observer.observe(termRef.current);

        return () => {
            observer.disconnect();
            ws.close();
            xterm.dispose();
            xtermRef.current = null;
            wsRef.current = null;
            fitRef.current = null;
        };
    }, [team, agentName, isRunning]);

    return (
        <div style={s.container}>
            <div style={s.header}>
                <span>{agentName}</span>
                <span style={{ fontSize: '11px', color: connected ? '#3fb950' : '#8b949e' }}>
                    {connected ? 'connected' : isRunning ? 'connecting...' : 'offline'}
                </span>
            </div>
            {isRunning ? (
                <>
                    <div ref={termRef} style={s.termArea} />
                    {isTouch && (
                        <div style={s.toolbar}>
                            {KEYS.map(([label, seq]) => (
                                <button
                                    key={label}
                                    style={s.tbtn}
                                    onTouchStart={(e) => { e.preventDefault(); sendKey(seq); }}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}
                </>
            ) : (
                <div style={s.offline}>Agent not running</div>
            )}
        </div>
    );
}

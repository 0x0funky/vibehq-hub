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
        width: '100%',
        maxWidth: '100vw',
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
        overflow: 'hidden',
        position: 'relative' as const,
    },
    bottomBtn: {
        padding: '8px 10px',
        background: '#21262d',
        border: '1px solid #30363d',
        borderRadius: '18px',
        color: '#c9d1d9',
        fontSize: '14px',
        cursor: 'pointer',
        flexShrink: 0,
        WebkitTapHighlightColor: 'transparent',
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
        overflow: 'hidden',
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
    inputBar: {
        display: 'flex',
        gap: '8px',
        padding: '8px',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        background: '#161b22',
        borderTop: '1px solid #30363d',
        overflow: 'hidden',
    },
    containerFullscreen: {
        position: 'fixed' as const,
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9999,
        borderRadius: 0,
        display: 'flex',
        flexDirection: 'column' as const,
        background: '#0d1117',
    },
    termAreaFullscreen: {
        flex: 1,
        height: 'auto',
        padding: '4px',
        overflow: 'hidden',
        position: 'relative' as const,
    },
    chatInput: {
        flex: 1,
        minWidth: 0,
        padding: '8px 12px',
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: '18px',
        color: '#c9d1d9',
        fontSize: '16px',
        fontFamily: "'Cascadia Code', 'Fira Code', Menlo, monospace",
        outline: 'none',
        boxSizing: 'border-box' as const,
    },
    sendBtn: {
        padding: '8px 16px',
        background: '#238636',
        border: 'none',
        borderRadius: '18px',
        color: '#ffffff',
        fontSize: '14px',
        fontWeight: 600,
        cursor: 'pointer',
        flexShrink: 0,
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
    const atBottomRef = useRef(true);
    const [atBottom, setAtBottom] = useState(true);
    const [connected, setConnected] = useState(false);
    const [isTouch] = useState(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0);
    const [cmdInput, setCmdInput] = useState('');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const isFullscreenRef = useRef(false);

    useEffect(() => { isFullscreenRef.current = isFullscreen; }, [isFullscreen]);

    const sendKey = useCallback((seq: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(seq);
            xtermRef.current?.scrollToBottom();
            atBottomRef.current = true;
            setAtBottom(true);
        }
    }, []);

    const handleSendCmd = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (cmdInput.trim() && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(cmdInput + '\r');
            setCmdInput('');
            xtermRef.current?.scrollToBottom();
            atBottomRef.current = true;
            setAtBottom(true);
        }
    }, [cmdInput]);

    const scrollHalf = useCallback((direction: 'up' | 'down') => {
        const xterm = xtermRef.current;
        if (!xterm) return;
        const half = Math.max(1, Math.floor(xterm.rows / 2));
        xterm.scrollLines(direction === 'up' ? -half : half);
        const buf = (xterm as any).buffer;
        if (buf) {
            const isAt = buf.active.viewportY >= buf.active.baseY;
            atBottomRef.current = isAt;
            setAtBottom(isAt);
        }
    }, []);

    const toggleFullscreen = useCallback(() => {
        setIsFullscreen(prev => {
            const next = !prev;
            isFullscreenRef.current = next;
            setTimeout(() => {
                fitRef.current?.fit();
                const dims = fitRef.current?.proposeDimensions();
                if (dims?.cols && dims?.rows && wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
                }
            }, 50);
            if (!next) document.body.style.overflow = '';
            else document.body.style.overflow = 'hidden';
            return next;
        });
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
            fontSize: 15,
            fontFamily: "'Cascadia Code', 'Fira Code', Menlo, monospace",
            cursorBlink: true,
            convertEol: true,
        });

        const fitAddon = new FitAddon();
        xterm.loadAddon(fitAddon);
        xterm.open(termRef.current);
        fitAddon.fit();

        xterm.onScroll(() => {
            const isAt = xterm.buffer.active.viewportY >= xterm.buffer.active.baseY;
            atBottomRef.current = isAt;
            setAtBottom(isAt);
        });

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
            const wasAtBottom = atBottomRef.current;
            xterm.write(event.data, () => {
                if (wasAtBottom) xterm.scrollToBottom();
            });
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
            atBottomRef.current = true;
            setAtBottom(true);
            document.body.style.overflow = '';
        };
    }, [team, agentName, isRunning]);

    return (
        <div style={isFullscreen ? { ...s.container, ...s.containerFullscreen } : s.container}>
            <div style={s.header}>
                <span>{agentName}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {isTouch && isRunning && (
                        <>
                            <button
                                type="button"
                                style={s.bottomBtn}
                                onTouchStart={(e) => { e.preventDefault(); scrollHalf('up'); }}
                                onClick={() => scrollHalf('up')}
                                aria-label="Scroll up half page"
                            >
                                ⬆
                            </button>
                            <button
                                type="button"
                                style={s.bottomBtn}
                                onTouchStart={(e) => { e.preventDefault(); scrollHalf('down'); }}
                                onClick={() => scrollHalf('down')}
                                aria-label="Scroll down half page"
                            >
                                ⬇
                            </button>
                        </>
                    )}
                    <span style={{ fontSize: '11px', color: connected ? '#3fb950' : '#8b949e' }}>
                        {connected ? 'connected' : isRunning ? 'connecting...' : 'offline'}
                    </span>
                    {isRunning && (
                        <button
                            style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}
                            onTouchStart={(e) => { e.preventDefault(); toggleFullscreen(); }}
                            onClick={toggleFullscreen}
                            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                        >
                            {isFullscreen ? '✕' : '⛶'}
                        </button>
                    )}
                </div>
            </div>
            {isRunning ? (
                <>
                    <div
                        ref={termRef}
                        style={isFullscreen ? { ...s.termArea, ...s.termAreaFullscreen } : s.termArea}
                    />
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
                    {isTouch && (
                        <form style={s.inputBar} onSubmit={handleSendCmd}>
                            <input
                                style={s.chatInput}
                                value={cmdInput}
                                onChange={(e) => setCmdInput(e.target.value)}
                                placeholder="Type a command…"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                            />
                            <button type="submit" style={s.sendBtn}>Send</button>
                        </form>
                    )}
                </>
            ) : (
                <div style={s.offline}>Agent not running</div>
            )}
        </div>
    );
}

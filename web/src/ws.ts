export function connectTerminal(team: string, agentName: string): WebSocket {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/terminal/${encodeURIComponent(team)}/${encodeURIComponent(agentName)}`;
    return new WebSocket(url);
}

export function connectHubEvents(team: string, onMessage: (msg: any) => void): WebSocket {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/events/${encodeURIComponent(team)}`;
    const ws = new WebSocket(url);

    ws.onmessage = (event) => {
        try {
            onMessage(JSON.parse(event.data));
        } catch {}
    };

    return ws;
}

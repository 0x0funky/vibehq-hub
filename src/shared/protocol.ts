// ============================================================
// WS Message Protocol Constants
// ============================================================

export const MessageTypes = {
    // Agent lifecycle
    AGENT_REGISTER: 'agent:register',
    AGENT_REGISTERED: 'agent:registered',
    AGENT_STATUS: 'agent:status',
    AGENT_STATUS_BROADCAST: 'agent:status:broadcast',
    AGENT_DISCONNECTED: 'agent:disconnected',

    // Relay: ask (synchronous)
    RELAY_ASK: 'relay:ask',
    RELAY_QUESTION: 'relay:question',
    RELAY_ANSWER: 'relay:answer',
    RELAY_RESPONSE: 'relay:response',

    // Relay: assign (async)
    RELAY_ASSIGN: 'relay:assign',
    RELAY_TASK: 'relay:task',

    // Relay: events (VibeHQ integration)
    RELAY_START: 'relay:start',
    RELAY_DONE: 'relay:done',

    // Viewer
    VIEWER_CONNECT: 'viewer:connect',
} as const;

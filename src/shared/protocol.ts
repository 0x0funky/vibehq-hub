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

    // Relay: ask (async)
    RELAY_ASK: 'relay:ask',
    RELAY_QUESTION: 'relay:question',
    RELAY_ANSWER: 'relay:answer',
    RELAY_RESPONSE: 'relay:response',

    // Relay: reply (async response from agent)
    RELAY_REPLY: 'relay:reply',
    RELAY_REPLY_DELIVERED: 'relay:reply:delivered',

    // Relay: assign (async)
    RELAY_ASSIGN: 'relay:assign',
    RELAY_TASK: 'relay:task',

    // Relay: events (VibeHQ integration)
    RELAY_START: 'relay:start',
    RELAY_DONE: 'relay:done',

    // Viewer
    VIEWER_CONNECT: 'viewer:connect',
} as const;

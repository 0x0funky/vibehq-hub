// ============================================================
// Shared Types for @vibehq/agent-hub
// ============================================================

// --- Agent ---

export type AgentStatus = 'idle' | 'working' | 'busy';

export interface Agent {
    id: string;
    name: string;
    role: string;
    capabilities: string[];
    status: AgentStatus;
    team?: string;
}

// --- WS Messages: Agent Registration ---

export interface AgentRegisterMessage {
    type: 'agent:register';
    name: string;
    role?: string;
    capabilities?: string[];
    team?: string;
}

export interface AgentRegisteredMessage {
    type: 'agent:registered';
    agentId: string;
    team: string;
    teammates: Agent[];
}

// --- WS Messages: Status ---

export interface AgentStatusMessage {
    type: 'agent:status';
    status: AgentStatus;
}

export interface AgentStatusBroadcastMessage {
    type: 'agent:status:broadcast';
    agentId: string;
    name: string;
    status: AgentStatus;
}

export interface AgentDisconnectedMessage {
    type: 'agent:disconnected';
    agentId: string;
    name: string;
}

// --- WS Messages: Relay Ask (async) ---

export interface RelayAskMessage {
    type: 'relay:ask';
    requestId: string;
    fromAgent: string;
    toAgent: string;
    question: string;
}

export interface RelayQuestionMessage {
    type: 'relay:question';
    requestId: string;
    fromAgent: string;
    question: string;
}

export interface RelayAnswerMessage {
    type: 'relay:answer';
    requestId: string;
    answer: string;
}

export interface RelayResponseMessage {
    type: 'relay:response';
    requestId: string;
    fromAgent: string;
    answer: string;
}

// --- WS Messages: Relay Assign (async, fire-and-forget) ---

export type TaskPriority = 'low' | 'medium' | 'high';

export interface RelayAssignMessage {
    type: 'relay:assign';
    requestId: string;
    fromAgent: string;
    toAgent: string;
    task: string;
    priority?: TaskPriority;
}

export interface RelayTaskMessage {
    type: 'relay:task';
    requestId: string;
    fromAgent: string;
    task: string;
    priority: TaskPriority;
}

// --- WS Messages: Relay Reply (async response) ---

export interface RelayReplyMessage {
    type: 'relay:reply';
    toAgent: string;
    message: string;
}

export interface RelayReplyDeliveredMessage {
    type: 'relay:reply:delivered';
    fromAgent: string;
    message: string;
}

// --- WS Messages: Relay Events (VibeHQ integration) ---

export interface RelayStartMessage {
    type: 'relay:start';
    fromAgent: string;
    toAgent: string;
    requestId: string;
}

export interface RelayDoneMessage {
    type: 'relay:done';
    fromAgent: string;
    toAgent: string;
    requestId: string;
}

// --- WS Messages: Viewer ---

export interface ViewerConnectMessage {
    type: 'viewer:connect';
}

// --- WS Messages: Spawner ---

export interface SpawnerSubscribeMessage {
    type: 'spawner:subscribe';
    name: string;
    team?: string;
}

export interface SpawnerSubscribedMessage {
    type: 'spawner:subscribed';
    name: string;
    team: string;
    teammates: Agent[];
}

// --- WS Messages: Team Updates ---

export interface TeamUpdate {
    from: string;
    message: string;
    timestamp: string;
}

export interface TeamUpdatePostMessage {
    type: 'team:update:post';
    message: string;
}

export interface TeamUpdateBroadcastMessage {
    type: 'team:update:broadcast';
    update: TeamUpdate;
}

export interface TeamUpdateListRequestMessage {
    type: 'team:update:list';
    limit?: number;
}

export interface TeamUpdateListResponseMessage {
    type: 'team:update:list:response';
    updates: TeamUpdate[];
}

// --- Union type for all messages ---

export type HubMessage =
    | AgentRegisterMessage
    | AgentRegisteredMessage
    | AgentStatusMessage
    | AgentStatusBroadcastMessage
    | AgentDisconnectedMessage
    | RelayAskMessage
    | RelayQuestionMessage
    | RelayAnswerMessage
    | RelayResponseMessage
    | RelayAssignMessage
    | RelayTaskMessage
    | RelayReplyMessage
    | RelayReplyDeliveredMessage
    | RelayStartMessage
    | RelayDoneMessage
    | ViewerConnectMessage
    | SpawnerSubscribeMessage
    | SpawnerSubscribedMessage
    | TeamUpdatePostMessage
    | TeamUpdateBroadcastMessage
    | TeamUpdateListRequestMessage
    | TeamUpdateListResponseMessage;

// ============================================================
// @vibehq/agent-hub — Public API
// ============================================================

// Hub Server
export { startHub } from './hub/server.js';
export { AgentRegistry } from './hub/registry.js';
export { RelayEngine } from './hub/relay.js';

// MCP Agent
export { startAgent } from './mcp/server.js';
export { HubClient } from './mcp/hub-client.js';

// Shared Types
export type {
    Agent,
    AgentStatus,
    TaskPriority,
    HubMessage,
    AgentRegisterMessage,
    AgentRegisteredMessage,
    AgentStatusMessage,
    AgentStatusBroadcastMessage,
    AgentDisconnectedMessage,
    RelayAskMessage,
    RelayQuestionMessage,
    RelayAnswerMessage,
    RelayResponseMessage,
    RelayAssignMessage,
    RelayTaskMessage,
    RelayStartMessage,
    RelayDoneMessage,
    ViewerConnectMessage,
} from './shared/types.js';

export { MessageTypes } from './shared/protocol.js';

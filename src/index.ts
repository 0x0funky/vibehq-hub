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

// Spawner
export { AgentSpawner } from './spawner/spawner.js';

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
    RelayReplyMessage,
    RelayReplyDeliveredMessage,
    RelayStartMessage,
    RelayDoneMessage,
    ViewerConnectMessage,
    SpawnerSubscribeMessage,
    SpawnerSubscribedMessage,
    TeamUpdate,
    TeamUpdatePostMessage,
    TeamUpdateBroadcastMessage,
    TeamUpdateListRequestMessage,
    TeamUpdateListResponseMessage,
} from './shared/types.js';

export { MessageTypes } from './shared/protocol.js';

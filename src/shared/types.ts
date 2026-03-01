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
    cli?: string;
}

// --- WS Messages: Agent Registration ---

export interface AgentRegisterMessage {
    type: 'agent:register';
    name: string;
    role?: string;
    capabilities?: string[];
    team?: string;
    cli?: string;
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
    role: string;
    status: AgentStatus;
    cli?: string;
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

// --- WS Messages: Task Lifecycle ---

export type TaskStatus = 'created' | 'queued' | 'accepted' | 'rejected' | 'in_progress' | 'blocked' | 'done';

export interface TaskOutputTarget {
    directory?: string;
    filenames?: string[];
    integrates_into?: string;
}

export interface TaskConsumes {
    artifact: string;
    owner: string;
}

export interface TaskProduces {
    artifact?: string;
    shared_files?: string[];
}

export interface TaskDependency {
    task_id?: string;    // wait for this task to complete
    artifact?: string;   // wait for this artifact to be published
}

export interface TaskState {
    taskId: string;
    title: string;
    description: string;
    assignee: string;
    creator: string;
    priority: TaskPriority;
    status: TaskStatus;
    artifact?: string;   // shared file path or summary on completion
    statusNote?: string;  // reason for blocked, rejection note, etc.
    outputTarget?: TaskOutputTarget;
    consumes?: TaskConsumes[];
    produces?: TaskProduces;
    dependsOn?: TaskDependency[];
    blockedBy?: string[];  // task IDs still pending
    createdAt: string;
    updatedAt: string;
}

export interface TaskCreateMessage {
    type: 'task:create';
    title: string;
    description: string;
    assignee: string;
    priority?: TaskPriority;
    outputTarget?: TaskOutputTarget;
    consumes?: TaskConsumes[];
    produces?: TaskProduces;
    dependsOn?: TaskDependency[];
}

export interface TaskCreatedBroadcast {
    type: 'task:created';
    task: TaskState;
}

export interface TaskAcceptMessage {
    type: 'task:accept';
    taskId: string;
    accepted: boolean;   // true = accept, false = reject
    note?: string;
}

export interface TaskUpdateMessage {
    type: 'task:update';
    taskId: string;
    status: 'in_progress' | 'blocked';
    note?: string;
}

export interface TaskCompleteMessage {
    type: 'task:complete';
    taskId: string;
    artifact: string;    // required — shared file path or summary
    note?: string;
}

export interface TaskStatusBroadcast {
    type: 'task:status:broadcast';
    task: TaskState;
}

export interface TaskListRequestMessage {
    type: 'task:list';
    filter?: 'all' | 'mine' | 'active';
}

export interface TaskListResponseMessage {
    type: 'task:list:response';
    tasks: TaskState[];
}

// --- WS Messages: Artifact System ---

export type ArtifactType = 'spec' | 'plan' | 'report' | 'decision' | 'code' | 'other';

export interface ArtifactMeta {
    filename: string;
    type: ArtifactType;
    summary: string;
    owner: string;
    relatesTo?: string;  // taskId
    publishedAt: string;
    updatedAt: string;
}

export interface ArtifactPublishMessage {
    type: 'artifact:publish';
    filename: string;
    artifactType: ArtifactType;
    summary: string;
    relatesTo?: string;
}

export interface ArtifactChangedBroadcast {
    type: 'artifact:changed';
    artifact: ArtifactMeta;
    action: 'created' | 'updated';
}

export interface ArtifactListRequestMessage {
    type: 'artifact:list';
    artifactType?: ArtifactType;
}

export interface ArtifactListResponseMessage {
    type: 'artifact:list:response';
    artifacts: ArtifactMeta[];
}

// --- WS Messages: Contract ---

export type ContractType = 'api' | 'interface' | 'schema';

export interface SchemaValidation {
    format?: string;         // e.g. 'json', 'yaml'
    required_keys?: string[];  // top-level keys the artifact must have
}

export interface ContractState {
    specPath: string;
    requiredSigners: string[];
    signers: { name: string; comment?: string; signedAt: string }[];
    approved: boolean;
    publishedBy: string;
    publishedAt: string;
    contractType?: ContractType;
    schemaValidation?: SchemaValidation;
}

export interface ContractPublishMessage {
    type: 'contract:publish';
    specPath: string;
    requiredSigners: string[];
    contractType?: ContractType;
    schemaValidation?: SchemaValidation;
}

export interface ContractSignMessage {
    type: 'contract:sign';
    specPath: string;
    comment?: string;
}

export interface ContractStatusBroadcast {
    type: 'contract:status';
    contract: ContractState;
}

export interface ContractCheckMessage {
    type: 'contract:check';
    specPath?: string;
}

export interface ContractCheckResponseMessage {
    type: 'contract:check:response';
    contracts: ContractState[];
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
    | TeamUpdateListResponseMessage
    | TaskCreateMessage
    | TaskCreatedBroadcast
    | TaskAcceptMessage
    | TaskUpdateMessage
    | TaskCompleteMessage
    | TaskStatusBroadcast
    | TaskListRequestMessage
    | TaskListResponseMessage
    | ArtifactPublishMessage
    | ArtifactChangedBroadcast
    | ArtifactListRequestMessage
    | ArtifactListResponseMessage
    | ContractPublishMessage
    | ContractSignMessage
    | ContractStatusBroadcast
    | ContractCheckMessage
    | ContractCheckResponseMessage;

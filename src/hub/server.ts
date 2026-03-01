// ============================================================
// Hub Server — Central WebSocket server
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { AgentRegistry } from './registry.js';
import { RelayEngine } from './relay.js';
import type {
    HubMessage,
    TeamUpdate,
    TeamUpdateBroadcastMessage,
    TeamUpdateListResponseMessage,
    TaskState,
    TaskCreatedBroadcast,
    TaskStatusBroadcast,
    TaskListResponseMessage,
    ArtifactMeta,
    ArtifactChangedBroadcast,
    ArtifactListResponseMessage,
    ContractState,
    ContractStatusBroadcast,
    ContractCheckResponseMessage,
    TaskPriority,
} from '../shared/types.js';

export interface HubOptions {
    port: number;
    verbose?: boolean;
    team?: string;
}

// --- Queued message for idle-aware delivery ---
interface QueuedMessage {
    payload: any;
    timestamp: number;
}

export function startHub(options: HubOptions): WebSocketServer {
    const { port, verbose = false, team = 'default' } = options;
    const registry = new AgentRegistry(verbose);
    // relay is created below, after queueOrDeliver is defined

    // --- Persistence ---
    const stateDir = join(homedir(), '.vibehq', 'teams', team);
    const stateFile = join(stateDir, 'hub-state.json');

    interface HubState {
        teamUpdates: Record<string, TeamUpdate[]>;
        tasks: Record<string, TaskState>;
        artifacts: Record<string, ArtifactMeta>;
        contracts: Record<string, ContractState>;
    }

    function loadState(): HubState {
        try {
            if (existsSync(stateFile)) {
                const raw = readFileSync(stateFile, 'utf-8');
                return JSON.parse(raw);
            }
        } catch (err) {
            if (verbose) console.log(`[Hub] Could not load state: ${(err as Error).message}`);
        }
        return { teamUpdates: {}, tasks: {}, artifacts: {}, contracts: {} };
    }

    function saveState(): void {
        try {
            if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
            const state: HubState = {
                teamUpdates: Object.fromEntries(teamUpdates),
                tasks: Object.fromEntries(taskStore),
                artifacts: Object.fromEntries(artifactStore),
                contracts: Object.fromEntries(contractStore),
            };
            writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
        } catch (err) {
            if (verbose) console.error(`[Hub] Could not save state: ${(err as Error).message}`);
        }
    }

    // Load persisted state
    const saved = loadState();

    // --- Stores ---
    const teamUpdates: Map<string, TeamUpdate[]> = new Map(Object.entries(saved.teamUpdates));
    const taskStore: Map<string, TaskState> = new Map(Object.entries(saved.tasks));
    const artifactStore: Map<string, ArtifactMeta> = new Map(Object.entries(saved.artifacts));
    const contractStore: Map<string, ContractState> = new Map(Object.entries(saved.contracts));
    const messageQueue: Map<string, QueuedMessage[]> = new Map(); // NOT persisted

    if (verbose) {
        console.log(`[Hub] Loaded state: ${taskStore.size} tasks, ${artifactStore.size} artifacts, ${contractStore.size} contracts`);
    }

    // --- Idle-aware delivery helpers ---
    function queueOrDeliver(targetName: string, team: string, payload: any): boolean {
        const target = registry.getAgentByName(targetName, team);
        if (!target) return false;

        if (target.status === 'idle') {
            // Deliver immediately
            if (target.ws.readyState === WebSocket.OPEN) {
                target.ws.send(JSON.stringify(payload));
                // Also forward to spawners
                const spawners = registry.getSpawnersForAgent(targetName);
                const data = JSON.stringify(payload);
                for (const ws of spawners) ws.send(data);
            }
        } else {
            // Queue for later
            if (!messageQueue.has(target.id)) messageQueue.set(target.id, []);
            messageQueue.get(target.id)!.push({ payload, timestamp: Date.now() });
            if (verbose) console.log(`[Hub] Queued message for ${targetName} (${target.status})`);
        }
        return true;
    }

    function flushQueue(agentId: string): void {
        const queued = messageQueue.get(agentId);
        if (!queued || queued.length === 0) return;

        const agent = registry.getAgentById(agentId);
        if (!agent || agent.ws.readyState !== WebSocket.OPEN) return;

        if (verbose) console.log(`[Hub] Flushing ${queued.length} queued messages for ${agent.name}`);

        for (const msg of queued) {
            agent.ws.send(JSON.stringify(msg.payload));
            // Also forward to spawners
            const spawners = registry.getSpawnersForAgent(agent.name);
            const data = JSON.stringify(msg.payload);
            for (const ws of spawners) ws.send(data);
        }
        messageQueue.delete(agentId);
    }

    // Create relay engine with idle-aware delivery
    const relay = new RelayEngine(registry, queueOrDeliver, verbose);

    // Hook into registry status changes for idle flush
    registry.onStatusChange((agentId, status) => {
        if (status === 'idle') {
            flushQueue(agentId);
        }
    });

    const wss = new WebSocketServer({ port });

    wss.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`[AgentHub] Port ${port} is already in use.`);
        } else {
            console.error(`[AgentHub] Server error:`, err);
        }
    });

    wss.on('connection', (ws: WebSocket) => {
        if (verbose) {
            console.log(`[Hub] New connection`);
        }

        ws.on('message', (raw) => {
            let msg: HubMessage;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                console.error('[Hub] Invalid JSON received');
                return;
            }

            switch (msg.type) {
                case 'agent:register':
                    registry.register(ws, msg);
                    break;

                case 'relay:ask':
                    relay.handleAsk(ws, msg);
                    break;

                case 'relay:assign':
                    relay.handleAssign(ws, msg);
                    break;

                case 'relay:answer':
                    relay.handleAnswer(msg);
                    break;

                case 'relay:reply': {
                    const agentName = registry.getAgentNameByWs(ws);
                    if (agentName) relay.handleReply(ws, msg, agentName);
                    break;
                }

                case 'agent:status': {
                    // Accept status updates from both agents and spawners
                    const directAgent = registry.getAgentByWs(ws);
                    if (directAgent) {
                        registry.updateStatus(ws, msg.status);
                    } else {
                        // Check if this is from a spawner — update the shadowed agent
                        const spawnerInfo = registry.getSpawnerInfo(ws);
                        if (spawnerInfo) {
                            const agent = registry.getAgentByName(spawnerInfo.name, spawnerInfo.team);
                            if (agent) {
                                registry.updateStatus(agent.ws, msg.status);
                            }
                        }
                    }
                    break;
                }

                case 'viewer:connect':
                    registry.registerViewer(ws);
                    break;

                case 'spawner:subscribe': {
                    const team = msg.team || 'default';
                    const result = registry.subscribeSpawner(ws, msg.name, team);
                    ws.send(JSON.stringify({
                        type: 'spawner:subscribed',
                        name: msg.name,
                        team: result.team,
                        teammates: result.teammates,
                    }));
                    break;
                }

                case 'team:update:post': {
                    const poster = registry.getAgentByWs(ws);
                    if (!poster) break;

                    const update: TeamUpdate = {
                        from: poster.name,
                        message: msg.message,
                        timestamp: new Date().toISOString(),
                    };

                    const team = poster.team || 'default';
                    if (!teamUpdates.has(team)) teamUpdates.set(team, []);
                    const updates = teamUpdates.get(team)!;
                    updates.push(update);
                    if (updates.length > 50) updates.shift();

                    registry.broadcastToTeam(team, {
                        type: 'team:update:broadcast',
                        update,
                    } satisfies TeamUpdateBroadcastMessage);

                    if (verbose) {
                        console.log(`[Hub] Update from ${poster.name} (${team}): ${msg.message.substring(0, 80)}`);
                    }
                    saveState();
                    break;
                }

                case 'team:update:list': {
                    const requester = registry.getAgentByWs(ws);
                    if (!requester) break;

                    const team = requester.team || 'default';
                    const allUpdates = teamUpdates.get(team) || [];
                    const limit = msg.limit || 20;

                    ws.send(JSON.stringify({
                        type: 'team:update:list:response',
                        updates: allUpdates.slice(-limit),
                    } satisfies TeamUpdateListResponseMessage));
                    break;
                }

                // ==========================================
                // V2: Task Lifecycle
                // ==========================================

                case 'task:create': {
                    const creator = registry.getAgentByWs(ws);
                    if (!creator) break;

                    const taskId = randomUUID().slice(0, 8);
                    const now = new Date().toISOString();
                    const task: TaskState = {
                        taskId,
                        title: msg.title,
                        description: msg.description,
                        assignee: msg.assignee,
                        creator: creator.name,
                        priority: (msg.priority as TaskPriority) || 'medium',
                        status: 'created',
                        createdAt: now,
                        updatedAt: now,
                    };
                    taskStore.set(taskId, task);

                    // Broadcast to entire team
                    registry.broadcastToTeam(creator.team, {
                        type: 'task:created', task,
                    } satisfies TaskCreatedBroadcast);

                    // Send task notification to assignee (idle-aware)
                    queueOrDeliver(msg.assignee, creator.team, {
                        type: 'relay:task',
                        requestId: taskId,
                        fromAgent: creator.name,
                        task: `[TASK ${taskId}] ${msg.title}\n\nPriority: ${task.priority}\n\n${msg.description}\n\nPlease call accept_task(task_id="${taskId}", accepted=true) to accept, or reject with a note.`,
                        priority: task.priority,
                    });

                    if (verbose) console.log(`[Hub] Task ${taskId}: ${creator.name} → ${msg.assignee} "${msg.title}"`);
                    saveState();
                    break;
                }

                case 'task:accept': {
                    const agent = registry.getAgentByWs(ws);
                    if (!agent) break;

                    const task = taskStore.get(msg.taskId);
                    if (!task) break;

                    task.status = msg.accepted ? 'accepted' : 'rejected';
                    task.statusNote = msg.note;
                    task.updatedAt = new Date().toISOString();

                    registry.broadcastToTeam(agent.team, {
                        type: 'task:status:broadcast', task,
                    } satisfies TaskStatusBroadcast);

                    // Notify creator
                    queueOrDeliver(task.creator, agent.team, {
                        type: 'relay:reply:delivered',
                        fromAgent: agent.name,
                        message: `[TASK ${task.taskId}] ${msg.accepted ? '✅ ACCEPTED' : '❌ REJECTED'}: "${task.title}"${msg.note ? `\nNote: ${msg.note}` : ''}`,
                    });

                    if (verbose) console.log(`[Hub] Task ${msg.taskId}: ${msg.accepted ? 'accepted' : 'rejected'} by ${agent.name}`);
                    saveState();
                    break;
                }

                case 'task:update': {
                    const agent = registry.getAgentByWs(ws);
                    if (!agent) break;

                    const task = taskStore.get(msg.taskId);
                    if (!task) break;

                    task.status = msg.status;
                    task.statusNote = msg.note;
                    task.updatedAt = new Date().toISOString();

                    registry.broadcastToTeam(agent.team, {
                        type: 'task:status:broadcast', task,
                    } satisfies TaskStatusBroadcast);

                    // If blocked, notify creator
                    if (msg.status === 'blocked') {
                        queueOrDeliver(task.creator, agent.team, {
                            type: 'relay:reply:delivered',
                            fromAgent: agent.name,
                            message: `[TASK ${task.taskId}] ⚠️ BLOCKED: "${task.title}"\nBlocker: ${msg.note || 'No details provided'}`,
                        });
                    }

                    if (verbose) console.log(`[Hub] Task ${msg.taskId}: ${msg.status} by ${agent.name}`);
                    saveState();
                    break;
                }

                case 'task:complete': {
                    const agent = registry.getAgentByWs(ws);
                    if (!agent) break;

                    const task = taskStore.get(msg.taskId);
                    if (!task) break;

                    task.status = 'done';
                    task.artifact = msg.artifact;
                    task.statusNote = msg.note;
                    task.updatedAt = new Date().toISOString();

                    registry.broadcastToTeam(agent.team, {
                        type: 'task:status:broadcast', task,
                    } satisfies TaskStatusBroadcast);

                    // Notify creator
                    queueOrDeliver(task.creator, agent.team, {
                        type: 'relay:reply:delivered',
                        fromAgent: agent.name,
                        message: `[TASK ${task.taskId}] ✅ DONE: "${task.title}"\nArtifact: ${msg.artifact}${msg.note ? `\nNote: ${msg.note}` : ''}`,
                    });

                    if (verbose) console.log(`[Hub] Task ${msg.taskId}: completed by ${agent.name}, artifact: ${msg.artifact}`);
                    saveState();
                    break;
                }

                case 'task:list': {
                    const agent = registry.getAgentByWs(ws);
                    if (!agent) break;

                    let tasks = Array.from(taskStore.values());
                    if (msg.filter === 'mine') {
                        tasks = tasks.filter(t => t.assignee === agent.name || t.creator === agent.name);
                    } else if (msg.filter === 'active') {
                        tasks = tasks.filter(t => t.status !== 'done' && t.status !== 'rejected');
                    }

                    ws.send(JSON.stringify({
                        type: 'task:list:response', tasks,
                    } satisfies TaskListResponseMessage));
                    break;
                }

                // ==========================================
                // V2: Artifact System
                // ==========================================

                case 'artifact:publish': {
                    const agent = registry.getAgentByWs(ws);
                    if (!agent) break;

                    const now = new Date().toISOString();
                    const existing = artifactStore.get(msg.filename);
                    const action = existing ? 'updated' : 'created';

                    const meta: ArtifactMeta = {
                        filename: msg.filename,
                        type: msg.artifactType,
                        summary: msg.summary,
                        owner: agent.name,
                        relatesTo: msg.relatesTo,
                        publishedAt: existing?.publishedAt || now,
                        updatedAt: now,
                    };
                    artifactStore.set(msg.filename, meta);

                    registry.broadcastToTeam(agent.team, {
                        type: 'artifact:changed',
                        artifact: meta,
                        action,
                    } satisfies ArtifactChangedBroadcast);

                    if (verbose) console.log(`[Hub] Artifact ${action}: ${msg.filename} by ${agent.name}`);
                    saveState();
                    break;
                }

                case 'artifact:list': {
                    let artifacts = Array.from(artifactStore.values());
                    if (msg.artifactType) {
                        artifacts = artifacts.filter(a => a.type === msg.artifactType);
                    }

                    ws.send(JSON.stringify({
                        type: 'artifact:list:response', artifacts,
                    } satisfies ArtifactListResponseMessage));
                    break;
                }

                // ==========================================
                // V2: Contract Sign-Off
                // ==========================================

                case 'contract:publish': {
                    const agent = registry.getAgentByWs(ws);
                    if (!agent) break;

                    const now = new Date().toISOString();
                    const contract: ContractState = {
                        specPath: msg.specPath,
                        requiredSigners: msg.requiredSigners,
                        signers: [],
                        approved: false,
                        publishedBy: agent.name,
                        publishedAt: now,
                    };
                    contractStore.set(msg.specPath, contract);

                    registry.broadcastToTeam(agent.team, {
                        type: 'contract:status', contract,
                    } satisfies ContractStatusBroadcast);

                    // Notify each required signer
                    for (const signer of msg.requiredSigners) {
                        queueOrDeliver(signer, agent.team, {
                            type: 'relay:reply:delivered',
                            fromAgent: agent.name,
                            message: `[CONTRACT] 📋 "${msg.specPath}" needs your sign-off.\nPublished by: ${agent.name}\nCall sign_contract(spec_path="${msg.specPath}") to approve.`,
                        });
                    }

                    if (verbose) console.log(`[Hub] Contract published: ${msg.specPath} by ${agent.name}, needs: ${msg.requiredSigners.join(', ')}`);
                    saveState();
                    break;
                }

                case 'contract:sign': {
                    const agent = registry.getAgentByWs(ws);
                    if (!agent) break;

                    const contract = contractStore.get(msg.specPath);
                    if (!contract) {
                        ws.send(JSON.stringify({
                            type: 'relay:reply:delivered',
                            fromAgent: 'Hub',
                            message: `Error: No contract found for "${msg.specPath}"`,
                        }));
                        break;
                    }

                    // Add signature (avoid duplicates)
                    if (!contract.signers.find(s => s.name === agent.name)) {
                        contract.signers.push({
                            name: agent.name,
                            comment: msg.comment,
                            signedAt: new Date().toISOString(),
                        });
                    }

                    // Check if all required signers have signed
                    const allSigned = contract.requiredSigners.every(
                        req => contract.signers.some(s => s.name === req)
                    );
                    if (allSigned) {
                        contract.approved = true;
                    }

                    registry.broadcastToTeam(agent.team, {
                        type: 'contract:status', contract,
                    } satisfies ContractStatusBroadcast);

                    if (allSigned) {
                        // Broadcast approval notification
                        const approvalMsg = `[CONTRACT] ✅ "${msg.specPath}" APPROVED! All signers: ${contract.signers.map(s => s.name).join(', ')}. You may proceed with implementation.`;
                        registry.broadcastToTeam(agent.team, {
                            type: 'relay:reply:delivered',
                            fromAgent: 'Hub',
                            message: approvalMsg,
                        } as any);
                    }

                    if (verbose) console.log(`[Hub] Contract signed: ${msg.specPath} by ${agent.name}${allSigned ? ' → APPROVED' : ''}`);
                    saveState();
                    break;
                }

                case 'contract:check': {
                    let contracts = Array.from(contractStore.values());
                    if (msg.specPath) {
                        contracts = contracts.filter(c => c.specPath === msg.specPath);
                    }

                    ws.send(JSON.stringify({
                        type: 'contract:check:response', contracts,
                    } satisfies ContractCheckResponseMessage));
                    break;
                }

                default:
                    if (verbose) {
                        console.log(`[Hub] Unknown message type: ${(msg as any).type}`);
                    }
            }
        });

        ws.on('close', () => {
            registry.unregister(ws);
            if (verbose) {
                console.log(`[Hub] Connection closed`);
            }
        });

        ws.on('error', (err) => {
            console.error(`[Hub] WebSocket error:`, err.message);
        });
    });

    console.log(`[AgentHub] Hub server running on ws://localhost:${port}`);
    return wss;
}

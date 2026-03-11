// ============================================================
// Hub Server — Central WebSocket server
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
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
    TaskReassignMessage,
} from '../shared/types.js';

export interface HubOptions {
    port: number;
    verbose?: boolean;
    team?: string;
}

export interface HubContext {
    wss: WebSocketServer;
    registry: AgentRegistry;
    stores: {
        tasks: Map<string, TaskState>;
        artifacts: Map<string, ArtifactMeta>;
        contracts: Map<string, ContractState>;
        teamUpdates: Map<string, TeamUpdate[]>;
    };
}

// --- Queued message for idle-aware delivery ---
interface QueuedMessage {
    payload: any;
    timestamp: number;
}

export function startHub(options: HubOptions): HubContext {
    const { port, verbose = false, team = 'default' } = options;
    const registry = new AgentRegistry(verbose);
    // relay is created below, after queueOrDeliver is defined

    // --- Persistence ---
    const teamsBaseDir = join(homedir(), '.vibehq', 'teams');
    const stateDir = join(teamsBaseDir, team);
    const stateFile = join(stateDir, 'hub-state.json');

    interface HubState {
        teamUpdates: Record<string, TeamUpdate[]>;
        tasks: Record<string, TaskState>;
        artifacts: Record<string, ArtifactMeta>;
        contracts: Record<string, ContractState>;
    }

    function loadTeamState(teamDir: string): HubState {
        const file = join(teamDir, 'hub-state.json');
        try {
            if (existsSync(file)) {
                const raw = readFileSync(file, 'utf-8');
                return JSON.parse(raw);
            }
        } catch (err) {
            if (verbose) console.log(`[Hub] Could not load state from ${file}: ${(err as Error).message}`);
        }
        return { teamUpdates: {}, tasks: {}, artifacts: {}, contracts: {} };
    }

    function loadAllTeamsState(): HubState {
        const merged: HubState = { teamUpdates: {}, tasks: {}, artifacts: {}, contracts: {} };
        try {
            if (!existsSync(teamsBaseDir)) return merged;
            const dirs = readdirSync(teamsBaseDir, { withFileTypes: true })
                .filter(d => d.isDirectory());
            for (const dir of dirs) {
                const ts = loadTeamState(join(teamsBaseDir, dir.name));
                Object.assign(merged.teamUpdates, ts.teamUpdates);
                Object.assign(merged.tasks, ts.tasks);
                Object.assign(merged.artifacts, ts.artifacts);
                Object.assign(merged.contracts, ts.contracts);
            }
        } catch (err) {
            if (verbose) console.log(`[Hub] Could not scan teams: ${(err as Error).message}`);
        }
        return merged;
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

    // Load persisted state — merge all teams so web platform can see everything
    const saved = loadAllTeamsState();

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

    // --- Heartbeat / Liveness Monitor ---
    const HEARTBEAT_INTERVAL = 30_000;   // Check every 30 seconds
    const HEARTBEAT_TIMEOUT = 120_000;   // 120 seconds without activity = offline (agents need time for startup + long spec writes)
    const STARTUP_GRACE_MS = 180_000;    // 3 min grace period after hub start — agents are booting
    const hubStartTime = Date.now();
    const offlineNotified = new Set<string>(); // Track already-notified agents

    const heartbeatTimer = setInterval(() => {
        const allAgents = registry.getAllAgents();
        for (const agent of allAgents) {
            // Get ConnectedAgent with lastActivity
            const connected = registry.getAgentByName(agent.name);
            if (!connected) continue;

            const lastSeen = connected.lastActivity || 0;
            const elapsed = Date.now() - lastSeen;

            // Skip unresponsive checks during startup grace period
            const inStartupGrace = (Date.now() - hubStartTime) < STARTUP_GRACE_MS;
            if (!inStartupGrace && lastSeen > 0 && elapsed > HEARTBEAT_TIMEOUT && !offlineNotified.has(agent.name)) {
                offlineNotified.add(agent.name);

                // Notify orchestrator (PM role agents)
                const pmAgents = allAgents.filter(a => a.role === 'Project Manager' && a.name !== agent.name);
                for (const pm of pmAgents) {
                    queueOrDeliver(pm.name, connected.team, {
                        type: 'relay:reply:delivered',
                        fromAgent: 'Hub',
                        message: `⚠️ [AGENT UNRESPONSIVE] ${agent.name} has not responded for ${Math.round(elapsed / 1000)}s. ` +
                            `Any tasks assigned to ${agent.name} should be reassigned to another agent.`,
                    });
                }

                // Auto-reassign: find tasks assigned to dead agent and reassign to idle workers
                const deadAgentTasks = Array.from(taskStore.values()).filter(
                    t => t.assignee === agent.name && t.status !== 'done' && t.status !== 'rejected'
                );

                // Find available workers (idle, not the dead agent, same team)
                const availableWorkers = allAgents.filter(a =>
                    a.name !== agent.name &&
                    a.status === 'idle' &&
                    !['Project Manager', 'Chief Strategist'].some(r => a.role.includes(r))
                );

                for (const task of deadAgentTasks) {
                    if (availableWorkers.length > 0) {
                        // Pick the first idle worker
                        const newAssignee = availableWorkers[0];
                        const oldAssignee = task.assignee;
                        task.assignee = newAssignee.name;
                        task.status = 'created';
                        task.statusNote = `auto-reassigned from ${oldAssignee} (unresponsive)`;
                        task.updatedAt = new Date().toISOString();

                        // Send task to new assignee
                        queueOrDeliver(newAssignee.name, connected.team, {
                            type: 'relay:task',
                            requestId: task.taskId,
                            fromAgent: task.creator,
                            task: `[TASK ${task.taskId}] ${task.title} — REASSIGNED (${oldAssignee} unresponsive)\n\n` +
                                `Priority: ${task.priority}\n\n${task.description}\n\n` +
                                `Please call accept_task(task_id="${task.taskId}", accepted=true) to accept.`,
                            priority: task.priority,
                        });

                        // Notify old assignee to stop working
                        queueOrDeliver(oldAssignee, connected.team, {
                            type: 'relay:reply:delivered',
                            fromAgent: 'Hub',
                            message: `[TASK ${task.taskId}] ⛔ REASSIGNED — You were unresponsive, so "${task.title}" has been reassigned to ${newAssignee.name}. STOP working on this task immediately.`,
                        });

                        registry.broadcastToTeam(connected.team, {
                            type: 'task:status:broadcast', task,
                        } satisfies TaskStatusBroadcast);

                        if (verbose) console.log(`[Hub] Task ${task.taskId}: auto-reassigned from ${oldAssignee} → ${newAssignee.name}`);
                    } else {
                        // No idle workers — mark as blocked
                        task.status = 'blocked';
                        task.statusNote = 'agent_unresponsive — no idle workers for reassignment';
                        task.updatedAt = new Date().toISOString();
                    }
                }

                if (verbose) console.log(`[Hub] Agent ${agent.name}: UNRESPONSIVE (${Math.round(elapsed / 1000)}s), ${deadAgentTasks.length} tasks affected`);
                saveState();
            } else if (lastSeen > 0 && elapsed <= HEARTBEAT_TIMEOUT && offlineNotified.has(agent.name)) {
                // Agent came back
                offlineNotified.delete(agent.name);
                if (verbose) console.log(`[Hub] Agent ${agent.name}: back online`);
            }
        }
    }, HEARTBEAT_INTERVAL);

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

            // Track activity for heartbeat/liveness detection
            const sender = registry.getAgentByWs(ws);
            if (sender) sender.lastActivity = Date.now();

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

                    // --- Description injection: output_target + consumes ---
                    let enrichedDescription = msg.description;

                    if (msg.outputTarget) {
                        const ot = msg.outputTarget;
                        const parts: string[] = [];
                        if (ot.directory) parts.push(`Your output must be created in: ${ot.directory}`);
                        if (ot.filenames?.length) parts.push(`Files to create: ${ot.filenames.join(', ')}`);
                        if (ot.integrates_into) parts.push(`Must integrate into: ${ot.integrates_into}`);
                        if (parts.length > 0) {
                            enrichedDescription = `⚠️ OUTPUT TARGET:\n${parts.join('\n')}\n\n${enrichedDescription}`;
                        }
                    }

                    if (msg.consumes?.length) {
                        const consumeLines = msg.consumes.map((c: any) =>
                            `- READ and follow: ${c.artifact} (owned by ${c.owner}). Do NOT create your own version.`
                        ).join('\n');
                        enrichedDescription += `\n\n📥 REQUIRED INPUTS (do not recreate these):\n${consumeLines}`;
                    }

                    if (msg.produces) {
                        const parts: string[] = [];
                        if (msg.produces.artifact) parts.push(`Publish artifact: ${msg.produces.artifact}`);
                        if (msg.produces.shared_files?.length) parts.push(`Create shared files: ${msg.produces.shared_files.join(', ')}`);
                        if (parts.length > 0) {
                            enrichedDescription += `\n\n📤 EXPECTED OUTPUT:\n${parts.join('\n')}`;
                        }
                    }

                    const task: TaskState = {
                        taskId,
                        team: creator.team,
                        title: msg.title,
                        description: enrichedDescription,
                        assignee: msg.assignee,
                        creator: creator.name,
                        priority: (msg.priority as TaskPriority) || 'medium',
                        status: 'created',
                        outputTarget: msg.outputTarget,
                        consumes: msg.consumes,
                        produces: msg.produces,
                        dependsOn: msg.dependsOn,
                        createdAt: now,
                        updatedAt: now,
                    };

                    // --- Dependency check ---
                    if (msg.dependsOn?.length) {
                        const pendingDeps = msg.dependsOn.filter((dep: any) => {
                            if (dep.task_id) {
                                const depTask = taskStore.get(dep.task_id);
                                return !depTask || depTask.status !== 'done';
                            }
                            if (dep.artifact) {
                                return !artifactStore.has(dep.artifact);
                            }
                            return false;
                        });

                        if (pendingDeps.length > 0) {
                            task.status = 'queued';
                            task.blockedBy = pendingDeps
                                .filter((d: any) => d.task_id)
                                .map((d: any) => d.task_id);
                            taskStore.set(taskId, task);

                            // Notify assignee — minimal info only, NO full description
                            // Full task details will be sent when all dependencies are ready
                            queueOrDeliver(msg.assignee, creator.team, {
                                type: 'relay:reply:delivered',
                                fromAgent: creator.name,
                                message: `[TASK ${taskId}] QUEUED — waiting for ${pendingDeps.length} dependenc${pendingDeps.length === 1 ? 'y' : 'ies'}.\n` +
                                    `You will receive the full task description when all inputs are ready. Please stand by.`,
                            });

                            // Broadcast to team
                            registry.broadcastToTeam(creator.team, {
                                type: 'task:created', task,
                            } satisfies TaskCreatedBroadcast);

                            if (verbose) console.log(`[Hub] Task ${taskId}: ${creator.name} → ${msg.assignee} "${msg.title}" (QUEUED — ${pendingDeps.length} deps)`);
                            saveState();
                            break;
                        }
                    }

                    // No pending dependencies — dispatch immediately
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
                        task: `[TASK ${taskId}] ${msg.title}\n\nPriority: ${task.priority}\n\n${enrichedDescription}\n\nPlease call accept_task(task_id="${taskId}", accepted=true) to accept, or reject with a note.`,
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

                    // Notify creator on status changes (reduces polling need)
                    if (msg.status === 'blocked') {
                        queueOrDeliver(task.creator, agent.team, {
                            type: 'relay:reply:delivered',
                            fromAgent: agent.name,
                            message: `[TASK ${task.taskId}] ⚠️ BLOCKED: "${task.title}"\nBlocker: ${msg.note || 'No details provided'}`,
                        });
                    } else if (msg.status === 'in_progress') {
                        queueOrDeliver(task.creator, agent.team, {
                            type: 'relay:reply:delivered',
                            fromAgent: agent.name,
                            message: `[TASK ${task.taskId}] 🔄 IN PROGRESS: "${task.title}"${msg.note ? `\nNote: ${msg.note}` : ''}`,
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

                    // --- Auto-unblock: check queued tasks that depend on this task ---
                    for (const [, queuedTask] of taskStore) {
                        if (queuedTask.status !== 'queued' || !queuedTask.blockedBy?.length) continue;

                        // Remove this completed task from blockers
                        queuedTask.blockedBy = queuedTask.blockedBy.filter(id => id !== task.taskId);

                        // Also check artifact-based dependencies
                        if (queuedTask.dependsOn?.length) {
                            const stillPending = queuedTask.dependsOn.some(dep => {
                                if (dep.task_id) {
                                    const depTask = taskStore.get(dep.task_id);
                                    return !depTask || depTask.status !== 'done';
                                }
                                if (dep.artifact) {
                                    return !artifactStore.has(dep.artifact);
                                }
                                return false;
                            });
                            if (stillPending) continue;
                        } else if (queuedTask.blockedBy.length > 0) {
                            continue;
                        }

                        // All dependencies satisfied — dispatch!
                        queuedTask.status = 'created';
                        queuedTask.blockedBy = undefined;
                        queuedTask.updatedAt = new Date().toISOString();

                        const inputRefs = queuedTask.dependsOn?.map(d =>
                            d.artifact ? `- ${d.artifact} (use read_shared_file)` : `- Output of task ${d.task_id}`
                        ).join('\n') || '';

                        queueOrDeliver(queuedTask.assignee, agent.team, {
                            type: 'relay:task',
                            requestId: queuedTask.taskId,
                            fromAgent: queuedTask.creator,
                            task: `[TASK ${queuedTask.taskId}] ${queuedTask.title} — UNBLOCKED ✅\n` +
                                `All dependencies are now ready. You may begin.\n\n` +
                                (inputRefs ? `📥 Available inputs:\n${inputRefs}\n\n` : '') +
                                `Priority: ${queuedTask.priority}\n\n${queuedTask.description}\n\n` +
                                `Please call accept_task(task_id="${queuedTask.taskId}", accepted=true) to accept.`,
                            priority: queuedTask.priority,
                        });

                        if (verbose) console.log(`[Hub] Task ${queuedTask.taskId}: UNBLOCKED → ${queuedTask.assignee}`);
                    }

                    if (verbose) console.log(`[Hub] Task ${msg.taskId}: completed by ${agent.name}, artifact: ${msg.artifact}`);
                    saveState();
                    break;
                }

                case 'task:reassign': {
                    const agent = registry.getAgentByWs(ws);
                    if (!agent) break;

                    const task = taskStore.get(msg.taskId);
                    if (!task) {
                        ws.send(JSON.stringify({
                            type: 'relay:reply:delivered',
                            fromAgent: 'Hub',
                            message: `Error: Task "${msg.taskId}" not found.`,
                        }));
                        break;
                    }

                    const oldAssignee = task.assignee;
                    task.assignee = msg.newAssignee;
                    task.status = 'created';
                    task.statusNote = msg.reason || `reassigned from ${oldAssignee} by ${agent.name}`;
                    task.updatedAt = new Date().toISOString();

                    // Send task to new assignee
                    queueOrDeliver(msg.newAssignee, agent.team, {
                        type: 'relay:task',
                        requestId: task.taskId,
                        fromAgent: task.creator,
                        task: `[TASK ${task.taskId}] ${task.title} — REASSIGNED from ${oldAssignee}\n\n` +
                            `Priority: ${task.priority}\n\n${task.description}\n\n` +
                            `Please call accept_task(task_id="${task.taskId}", accepted=true) to accept.`,
                        priority: task.priority,
                    });

                    // Notify old assignee
                    queueOrDeliver(oldAssignee, agent.team, {
                        type: 'relay:reply:delivered',
                        fromAgent: 'Hub',
                        message: `[TASK ${task.taskId}] ↗️ Reassigned to ${msg.newAssignee}. You no longer need to work on "${task.title}".`,
                    });

                    registry.broadcastToTeam(agent.team, {
                        type: 'task:status:broadcast', task,
                    } satisfies TaskStatusBroadcast);

                    // Notify requester
                    ws.send(JSON.stringify({
                        type: 'relay:reply:delivered',
                        fromAgent: 'Hub',
                        message: `[TASK ${task.taskId}] Reassigned: ${oldAssignee} → ${msg.newAssignee}`,
                    }));

                    if (verbose) console.log(`[Hub] Task ${msg.taskId}: reassigned ${oldAssignee} → ${msg.newAssignee} by ${agent.name}`);
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

                    // Ownership lock: only the original owner can update an artifact
                    if (existing && existing.owner !== agent.name) {
                        ws.send(JSON.stringify({
                            type: 'relay:reply:delivered',
                            fromAgent: 'Hub',
                            message: `❌ Cannot overwrite "${msg.filename}" — owned by ${existing.owner}. Use read_shared_file("${msg.filename}") to consume it instead.`,
                        }));
                        if (verbose) console.log(`[Hub] Artifact ownership conflict: ${agent.name} tried to overwrite "${msg.filename}" owned by ${existing.owner}`);
                        break;
                    }

                    const action = existing ? 'updated' : 'created';

                    const meta: ArtifactMeta = {
                        filename: msg.filename,
                        team: agent.team,
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

                    // --- Auto-unblock: check queued tasks waiting for this artifact ---
                    for (const [, queuedTask] of taskStore) {
                        if (queuedTask.status !== 'queued') continue;

                        const waitingForThis = queuedTask.dependsOn?.some(
                            dep => dep.artifact === msg.filename
                        );
                        if (!waitingForThis) continue;

                        // Re-check all dependencies
                        const stillPending = queuedTask.dependsOn!.some(dep => {
                            if (dep.task_id) {
                                const depTask = taskStore.get(dep.task_id);
                                return !depTask || depTask.status !== 'done';
                            }
                            if (dep.artifact) {
                                return !artifactStore.has(dep.artifact);
                            }
                            return false;
                        });

                        if (!stillPending) {
                            queuedTask.status = 'created';
                            queuedTask.blockedBy = undefined;
                            queuedTask.updatedAt = new Date().toISOString();

                            const inputRefs = queuedTask.dependsOn?.map(d =>
                                d.artifact ? `- ${d.artifact} (use read_shared_file)` : `- Output of task ${d.task_id}`
                            ).join('\n') || '';

                            queueOrDeliver(queuedTask.assignee, agent.team, {
                                type: 'relay:task',
                                requestId: queuedTask.taskId,
                                fromAgent: queuedTask.creator,
                                task: `[TASK ${queuedTask.taskId}] ${queuedTask.title} — UNBLOCKED ✅\n` +
                                    `All dependencies are now ready. You may begin.\n\n` +
                                    (inputRefs ? `📥 Available inputs:\n${inputRefs}\n\n` : '') +
                                    `Priority: ${queuedTask.priority}\n\n${queuedTask.description}\n\n` +
                                    `Please call accept_task(task_id="${queuedTask.taskId}", accepted=true) to accept.`,
                                priority: queuedTask.priority,
                            });

                            if (verbose) console.log(`[Hub] Task ${queuedTask.taskId}: UNBLOCKED by artifact "${msg.filename}" → ${queuedTask.assignee}`);
                        }
                    }

                    // --- Notify active tasks that consume this artifact ---
                    for (const [, activeTask] of taskStore) {
                        if (activeTask.status === 'done' || activeTask.status === 'rejected' || activeTask.status === 'queued') continue;
                        const consumesThis = activeTask.consumes?.some(c => c.artifact === msg.filename);
                        if (consumesThis) {
                            queueOrDeliver(activeTask.assignee, agent.team, {
                                type: 'relay:reply:delivered',
                                fromAgent: 'Hub',
                                message: `[ARTIFACT READY] "${msg.filename}" has been ${action} by ${agent.name}. This is a required input for your task ${activeTask.taskId}. Use read_shared_file("${msg.filename}") to access it.`,
                            });
                        }
                    }

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
                        contractType: msg.contractType,
                        schemaValidation: msg.schemaValidation,
                    };
                    contractStore.set(msg.specPath, contract);

                    registry.broadcastToTeam(agent.team, {
                        type: 'contract:status', contract,
                    } satisfies ContractStatusBroadcast);

                    // Notify each required signer
                    const typeLabel = msg.contractType ? ` (${msg.contractType})` : '';
                    for (const signer of msg.requiredSigners) {
                        queueOrDeliver(signer, agent.team, {
                            type: 'relay:reply:delivered',
                            fromAgent: agent.name,
                            message: `[CONTRACT]${typeLabel} 📋 "${msg.specPath}" needs your sign-off.\nPublished by: ${agent.name}${msg.schemaValidation ? `\nSchema: format=${msg.schemaValidation.format || 'any'}, required keys: ${msg.schemaValidation.required_keys?.join(', ') || 'none'}` : ''}\nCall sign_contract(spec_path="${msg.specPath}") to approve.`,
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
                        // Targeted approval notification to publisher
                        queueOrDeliver(contract.publishedBy, agent.team, {
                            type: 'relay:reply:delivered',
                            fromAgent: 'Hub',
                            message: `[CONTRACT] ✅ "${msg.specPath}" APPROVED! All signers: ${contract.signers.map(s => s.name).join(', ')}. You may proceed with implementation.`,
                        });
                    } else {
                        // Partial sign — push progress to publisher so they don't need to poll
                        const remaining = contract.requiredSigners.filter(
                            req => !contract.signers.some(s => s.name === req)
                        );
                        queueOrDeliver(contract.publishedBy, agent.team, {
                            type: 'relay:reply:delivered',
                            fromAgent: 'Hub',
                            message: `[CONTRACT] "${msg.specPath}" signed by ${agent.name}. Progress: ${contract.signers.length}/${contract.requiredSigners.length}. Remaining: ${remaining.join(', ')}.`,
                        });
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
    return {
        wss,
        registry,
        stores: {
            tasks: taskStore,
            artifacts: artifactStore,
            contracts: contractStore,
            teamUpdates,
        },
    };
}

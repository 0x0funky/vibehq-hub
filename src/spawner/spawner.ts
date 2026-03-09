import * as pty from 'node-pty';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, watch, statSync } from 'fs';
import { open } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import WebSocket from 'ws';
import type {
    AgentStatusBroadcastMessage,
    AgentDisconnectedMessage,
    RelayQuestionMessage,
    RelayTaskMessage,
    RelayReplyDeliveredMessage,
    SpawnerSubscribedMessage,
    Agent,
} from '../shared/types.js';

/**
 * Resolve a command name to its full path on Windows.
 */
function resolveCommand(command: string): string {
    if (process.platform !== 'win32') return command;
    try {
        const result = execSync(`where.exe ${command}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const lines = result.split(/\r?\n/);
        return lines.find(l => l.endsWith('.cmd') || l.endsWith('.exe')) || lines[0] || command;
    } catch {
        return command;
    }
}

export interface SpawnerOptions {
    name: string;
    role: string;
    hubUrl: string;
    team: string;
    command: string;
    args: string[];
    systemPrompt?: string;
    dangerouslySkipPermissions?: boolean;
    additionalDirs?: string[];
    cwd?: string;
}

export class AgentSpawner {
    private ptyProcess: pty.IPty | null = null;
    private ws: WebSocket | null = null;
    private options: SpawnerOptions;
    private agentId: string | null = null;
    private teammates: Map<string, Agent> = new Map();
    private currentStatus: 'idle' | 'working' = 'idle';
    private ptyIdleTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly PTY_IDLE_TIMEOUT = 10000; // 10s of PTY silence = idle
    private useJsonlDetection = false; // true for Claude/Codex (JSONL-based idle detection)
    private pendingMessages: Array<{ type: string; msg: any }> = [];
    private endTurnDebounce: ReturnType<typeof setTimeout> | null = null;
    private currentLogFile: string | null = null;

    constructor(options: SpawnerOptions) {
        this.options = options;
    }

    async start(): Promise<void> {
        this.autoConfigureMcp();
        this.spawnCli();
        await this.connectToHub();

        // Inject system prompt using CLI-native mechanisms
        if (this.options.systemPrompt) {
            this.injectSystemPrompt();
        }

        // Start idle detection based on CLI type
        const cmd = this.options.command.toLowerCase();
        if (cmd === 'claude' || cmd.includes('claude')) {
            this.useJsonlDetection = true;
            this.watchClaudeTranscript();
        } else if (cmd === 'codex' || cmd.includes('codex')) {
            this.useJsonlDetection = true;
            this.watchCodexTranscript();
        } else {
            // Gemini: use PTY output timeout
            this.startPtyIdleTimer();
        }
    }

    /**
     * Inject system prompt using the correct mechanism for each CLI.
     * - Claude: --append-system-prompt flag (added to spawn args)
     * - Codex: writes codex.md in project root
     * - Gemini: writes .gemini/GEMINI.md in project root
     */
    private injectSystemPrompt(): void {
        const { command, systemPrompt } = this.options;
        if (!systemPrompt) return;
        const cmd = command.toLowerCase();

        if (cmd === 'claude' || cmd.includes('claude')) {
            // Claude: handled via spawn args in spawnCli()
            // Nothing to do here — args already added
        } else if (cmd === 'codex' || cmd.includes('codex')) {
            // Codex: write codex.md in project root (cwd)
            const codexMdPath = join(process.cwd(), 'codex.md');
            const marker = '<!-- vibehq-system-prompt -->';
            let existing = '';
            if (existsSync(codexMdPath)) {
                existing = readFileSync(codexMdPath, 'utf-8');
                // Remove previous VibHQ block if present
                const markerIdx = existing.indexOf(marker);
                if (markerIdx >= 0) {
                    existing = existing.substring(0, markerIdx).trimEnd();
                }
            }
            const vibehqBlock = `\n\n${marker}\n## VibHQ Agent Instructions\n\n${systemPrompt}\n`;
            writeFileSync(codexMdPath, existing + vibehqBlock);
            console.error(`[Spawner] System prompt written to ${codexMdPath}`);
        } else if (cmd === 'gemini' || cmd.includes('gemini')) {
            // Gemini: write .gemini/GEMINI.md in project root (cwd)
            const geminiDir = join(process.cwd(), '.gemini');
            if (!existsSync(geminiDir)) {
                mkdirSync(geminiDir, { recursive: true });
            }
            const geminiMdPath = join(geminiDir, 'GEMINI.md');
            const marker = '<!-- vibehq-system-prompt -->';
            let existing = '';
            if (existsSync(geminiMdPath)) {
                existing = readFileSync(geminiMdPath, 'utf-8');
                const markerIdx = existing.indexOf(marker);
                if (markerIdx >= 0) {
                    existing = existing.substring(0, markerIdx).trimEnd();
                }
            }
            const vibehqBlock = `\n\n${marker}\n## VibHQ Agent Instructions\n\n${systemPrompt}\n`;
            writeFileSync(geminiMdPath, existing + vibehqBlock);
            console.error(`[Spawner] System prompt written to ${geminiMdPath}`);
        }
    }

    /**
     * Auto-configure MCP for the CLI being spawned.
     * Detects CLI type and writes config with matching name/role/hub.
     */
    private autoConfigureMcp(): void {
        const { name, role, hubUrl, team, command } = this.options;
        const cmd = command.toLowerCase();

        // Run migration cleanup on every spawn (safe + idempotent)
        if (cmd === 'claude' || cmd.includes('claude')) {
            this.migrateClaudeMcpConfig();
            this.configureClaudeMcp(name, role, hubUrl, team);
        } else if (cmd === 'codex' || cmd.includes('codex')) {
            this.configureCodexMcp(name, role, hubUrl, team);
        } else if (cmd === 'gemini' || cmd.includes('gemini')) {
            this.configureGeminiMcp(name, role, hubUrl, team);
        }
    }

    /**
     * Migration: clean up stale vibehq_* MCP entries and duplicate project keys.
     * Safe to run on every startup — only modifies if duplicates or bad paths found.
     */
    private migrateClaudeMcpConfig(): void {
        const claudeJsonPath = join(homedir(), '.claude.json');
        if (!existsSync(claudeJsonPath)) return;

        let config: any;
        try { config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8')); } catch { return; }
        if (!config.projects) return;

        let modified = false;

        // 1. Remove duplicate vibehq_* entries per project (keep none — fresh spawn will write correct one)
        for (const key of Object.keys(config.projects)) {
            const ms = config.projects[key]?.mcpServers;
            if (!ms) continue;
            const vkeys = Object.keys(ms).filter(k => k.startsWith('vibehq_'));
            if (vkeys.length > 1) {
                for (const vk of vkeys) {
                    delete ms[vk];
                }
                modified = true;
            }
        }

        // 2. Clean vibehq_* entries on root-level paths (C:/, D:/, /) to prevent drive-wide pollution
        for (const key of Object.keys(config.projects)) {
            const norm = key.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '');
            if (/^[A-Za-z]:$/.test(norm) || norm === '' || norm === '/') {
                const ms = config.projects[key]?.mcpServers;
                if (!ms) continue;
                for (const vk of Object.keys(ms).filter(k => k.startsWith('vibehq_'))) {
                    delete ms[vk];
                    modified = true;
                }
            }
        }

        // 3. Deduplicate project keys with equivalent paths (D://x → D:/x)
        const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '').toLowerCase();
        const seen = new Map<string, string>(); // normalized → first key
        for (const key of Object.keys(config.projects)) {
            const norm = normalize(key);
            if (seen.has(norm)) {
                // Merge mcpServers into the first seen key, then delete this duplicate
                const primary = seen.get(norm)!;
                const srcServers = config.projects[key]?.mcpServers || {};
                if (!config.projects[primary].mcpServers) config.projects[primary].mcpServers = {};
                Object.assign(config.projects[primary].mcpServers, srcServers);
                delete config.projects[key];
                modified = true;
            } else {
                seen.set(norm, key);
            }
        }

        if (modified) {
            writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2));
        }
    }

    /**
     * Update ~/.claude.json project-scoped MCP config for Claude Code.
     * Claude Code stores MCP config at: projects["<cwd>"].mcpServers
     * Uses agent-specific key `vibehq_{name}` to avoid race conditions.
     */
    private configureClaudeMcp(name: string, role: string, hubUrl: string, team: string): void {
        const claudeJsonPath = join(homedir(), '.claude.json');
        if (!existsSync(claudeJsonPath)) return;

        let config: any;
        try { config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8')); } catch { return; }
        if (!config.projects) config.projects = {};

        // Claude Code uses forward-slash path keys on Windows
        const cwd = this.options.cwd || process.cwd();
        // Normalize: backslash→forward, collapse double slashes, remove trailing slash
        const cwdForward = cwd.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '');

        // Guard: never register MCP at drive root — it would infect ALL sessions on that drive
        if (/^[A-Za-z]:$/.test(cwdForward) || cwdForward === '/') {
            console.warn(`[Spawner] Refusing to register MCP at root path: ${cwdForward}`);
            return;
        }

        // Agent-specific key prevents concurrent spawn overwrites
        const serverKey = `vibehq_${name.toLowerCase().replace(/\s+/g, '_')}`;

        const teamServer = {
            type: 'stdio',
            command: 'vibehq-agent',
            args: ['--name', name, '--role', role, '--hub', hubUrl, '--team', team, '--cli', this.options.command],
            env: {},
        };

        // Update all matching project keys (both / and \ variants)
        let found = false;
        for (const key of Object.keys(config.projects)) {
            const normalizedKey = key.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '').toLowerCase();
            if (normalizedKey === cwdForward.toLowerCase()) {
                if (!config.projects[key].mcpServers) config.projects[key].mcpServers = {};
                // Remove legacy shared 'team' key if present
                delete config.projects[key].mcpServers.team;
                // Remove ALL old vibehq_* entries to prevent duplicates from name changes
                for (const k of Object.keys(config.projects[key].mcpServers)) {
                    if (k.startsWith('vibehq_')) {
                        delete config.projects[key].mcpServers[k];
                    }
                }
                // Write only the current agent's entry
                config.projects[key].mcpServers[serverKey] = teamServer;
                found = true;
            }
        }

        // If no matching project, create one with forward-slash path
        if (!found) {
            config.projects[cwdForward] = {
                allowedTools: [],
                mcpServers: { [serverKey]: teamServer },
                hasTrustDialogAccepted: true,
            };
        }

        writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2));
    }

    /**
     * Update ~/.codex/config.toml for Codex CLI.
     * Uses agent-specific key `vibehq_{name}` to avoid race conditions.
     * Cleans ALL vibehq_* entries first (global config → only this agent's entry needed).
     */
    private configureCodexMcp(name: string, role: string, hubUrl: string, team: string): void {
        const configPath = join(homedir(), '.codex', 'config.toml');
        if (!existsSync(configPath)) return;

        let content = readFileSync(configPath, 'utf-8');

        // Agent-specific key
        const serverKey = `vibehq_${name.toLowerCase().replace(/\s+/g, '_')}`;

        // Remove ALL vibehq_* entries (stale entries from other teams/agents)
        content = content.replace(/\[mcp_servers\.vibehq_[^\]]+\]\s*\n(?:(?!\[).*\n)*/g, '');
        // Also remove legacy shared 'team' key
        content = content.replace(/\[mcp_servers\.team\]\s*\n(?:(?!\[).*\n)*/g, '');
        content = content.trimEnd();

        // Append only this agent's config
        const teamBlock = `\n\n[mcp_servers.${serverKey}]\ncommand = "vibehq-agent"\nargs = ["--name", "${name}", "--role", "${role}", "--hub", "${hubUrl}", "--team", "${team}", "--cli", "${this.options.command}"]\n`;
        content += teamBlock;

        writeFileSync(configPath, content);
    }

    /**
     * Update ~/.gemini/settings.json for Gemini CLI.
     * Uses agent-specific key `vibehq_{name}` to avoid race conditions.
     * Cleans ALL vibehq_* entries first (global config → only this agent's entry needed).
     */
    private configureGeminiMcp(name: string, role: string, hubUrl: string, team: string): void {
        const configPath = join(homedir(), '.gemini', 'settings.json');
        let config: any = {};

        if (existsSync(configPath)) {
            try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { config = {}; }
        }

        if (!config.mcpServers) config.mcpServers = {};

        // Agent-specific key
        const serverKey = `vibehq_${name.toLowerCase().replace(/\s+/g, '_')}`;

        // Remove ALL vibehq_* entries and legacy 'team' key
        for (const key of Object.keys(config.mcpServers)) {
            if (key.startsWith('vibehq_') || key === 'team') {
                delete config.mcpServers[key];
            }
        }

        // Write only this agent's entry
        config.mcpServers[serverKey] = {
            command: 'vibehq-agent',
            args: ['--name', name, '--role', role, '--hub', hubUrl, '--team', team, '--cli', this.options.command],
        };

        writeFileSync(configPath, JSON.stringify(config, null, 2));
    }

    private spawnCli(): void {
        const { command, args, systemPrompt } = this.options;
        const resolvedCommand = resolveCommand(command);
        const cols = process.stdout.columns || 80;
        const rows = process.stdout.rows || 24;
        const cmd = command.toLowerCase();

        // Build spawn args — append system prompt flag for Claude
        let spawnArgs = [...args];
        if (systemPrompt && (cmd === 'claude' || cmd.includes('claude'))) {
            spawnArgs.push('--append-system-prompt', systemPrompt);
        }
        // Add --dangerously-skip-permissions for Claude if enabled
        if (this.options.dangerouslySkipPermissions && (cmd === 'claude' || cmd.includes('claude'))) {
            spawnArgs.push('--dangerously-skip-permissions');
        }
        // Add --add-dir flags for Claude
        if (this.options.additionalDirs?.length && (cmd === 'claude' || cmd.includes('claude'))) {
            for (const dir of this.options.additionalDirs) {
                spawnArgs.push('--add-dir', dir);
            }
        }

        this.ptyProcess = pty.spawn(resolvedCommand, spawnArgs, {
            name: 'xterm-color',
            cols,
            rows,
            cwd: this.options.cwd || process.cwd(),
            env: process.env as { [key: string]: string },
        });

        process.stdout.on('resize', () => {
            this.ptyProcess?.resize(
                process.stdout.columns || 80,
                process.stdout.rows || 24,
            );
        });

        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdin.resume();

        // User stdin → PTY (direct passthrough)
        process.stdin.on('data', (data) => {
            this.ptyProcess?.write(data.toString());
        });

        // PTY output → user stdout (direct passthrough, no parsing)
        this.ptyProcess.onData((data: string) => {
            process.stdout.write(data);
            // Layer 3: PTY silence fallback for ALL CLIs
            // JSONL CLIs use longer timeout (30s) and don't auto-set 'working'
            // PTY-only CLIs use shorter timeout (10s) and do auto-set 'working'
            this.resetPtyIdleTimer();
        });

        this.ptyProcess.onExit(({ exitCode }) => {
            this.cleanup();
            process.exit(exitCode);
        });
    }

    private connectToHub(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.options.hubUrl);

            this.ws.on('open', () => {
                // Subscribe as spawner — don't register as a new agent
                this.ws!.send(JSON.stringify({
                    type: 'spawner:subscribe',
                    name: this.options.name,
                    team: this.options.team,
                }));
            });

            this.ws.on('message', (raw) => {
                let msg: any;
                try { msg = JSON.parse(raw.toString()); } catch { return; }

                switch (msg.type) {
                    case 'spawner:subscribed':
                        this.handleSubscribed(msg);
                        resolve();
                        break;
                    case 'agent:status:broadcast':
                        this.handleStatusBroadcast(msg);
                        break;
                    case 'agent:disconnected':
                        this.handleDisconnected(msg);
                        break;
                    case 'relay:question':
                        this.handleQuestion(msg);
                        break;
                    case 'relay:task':
                        this.handleTask(msg);
                        break;
                    case 'relay:reply:delivered':
                        this.handleReplyDelivered(msg);
                        break;
                }
            });

            this.ws.on('close', () => {
                setTimeout(() => this.connectToHub().catch(() => { }), 3000);
            });

            this.ws.on('error', (err) => {
                if (!this.agentId) reject(err);
            });
        });
    }

    /**
     * Write text to PTY in chunks, then press Enter.
     * PTY input buffers are limited (~4096 bytes), so long messages must be chunked.
     */
    private writeToPty(text: string): void {
        const CHUNK_SIZE = 512;
        const chunks: string[] = [];

        for (let i = 0; i < text.length; i += CHUNK_SIZE) {
            chunks.push(text.substring(i, i + CHUNK_SIZE));
        }

        const writeChunk = (index: number) => {
            if (index >= chunks.length) {
                // All chunks written — wait longer for large messages before pressing Enter
                const enterDelay = Math.max(300, chunks.length * 100);
                setTimeout(() => {
                    this.ptyProcess?.write('\r');
                }, enterDelay);
                return;
            }
            this.ptyProcess?.write(chunks[index]);
            // Delay between chunks to let PTY buffer drain
            setTimeout(() => writeChunk(index + 1), 80);
        };

        writeChunk(0);
    }

    /**
     * Inject a teammate's question into the CLI's PTY.
     * The agent should use reply_to_team MCP tool to respond.
     * Queues the message if the agent is currently working.
     */
    private handleQuestion(msg: RelayQuestionMessage): void {
        if (this.currentStatus !== 'idle') {
            this.pendingMessages.push({ type: 'question', msg });
            return;
        }
        const prompt = `[Team question from ${msg.fromAgent}]: ${msg.question} — Use the reply_to_team tool to respond to ${msg.fromAgent}.`;
        this.writeToPty(prompt);
    }

    /**
     * Inject a task assignment (fire-and-forget).
     * Queues the message if the agent is currently working.
     */
    private handleTask(msg: RelayTaskMessage): void {
        if (this.currentStatus !== 'idle') {
            this.pendingMessages.push({ type: 'task', msg });
            return;
        }
        const prompt = `[Task from ${msg.fromAgent}, priority: ${msg.priority}]: ${msg.task}`;
        this.writeToPty(prompt);
    }

    /**
     * Inject a teammate's reply into the CLI's PTY.
     * Queues the message if the agent is currently working.
     */
    private handleReplyDelivered(msg: RelayReplyDeliveredMessage): void {
        if (this.currentStatus !== 'idle') {
            this.pendingMessages.push({ type: 'reply', msg });
            return;
        }
        const prompt = `[Reply from ${msg.fromAgent}]: ${msg.message}`;
        this.writeToPty(prompt);
    }

    // --- Hub handlers ---

    private handleSubscribed(msg: SpawnerSubscribedMessage): void {
        this.agentId = msg.name;
        this.teammates.clear();
        for (const agent of msg.teammates) {
            this.teammates.set(agent.id, agent);
        }
    }

    private handleStatusBroadcast(msg: AgentStatusBroadcastMessage): void {
        if (msg.agentId === this.agentId) return;
        const existing = this.teammates.get(msg.agentId);
        if (existing) {
            existing.status = msg.status;
        } else {
            this.teammates.set(msg.agentId, {
                id: msg.agentId, name: msg.name, role: '', capabilities: [], status: msg.status,
            });
        }
    }

    private handleDisconnected(msg: AgentDisconnectedMessage): void {
        this.teammates.delete(msg.agentId);
    }

    private sendToHub(msg: any): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    // =========================================================
    // Idle Detection
    // =========================================================

    /**
     * Send agent status to Hub.
     */
    private sendStatus(status: 'idle' | 'working'): void {
        if (status === this.currentStatus) return;
        this.currentStatus = status;
        this.sendToHub({ type: 'agent:status', status });
        // Flush any queued messages when becoming idle
        if (status === 'idle') {
            this.flushPendingMessages();
        }
    }

    /**
     * Deliver queued messages that arrived while the agent was busy.
     */
    private flushPendingMessages(): void {
        if (this.pendingMessages.length === 0) return;
        const messages = [...this.pendingMessages];
        this.pendingMessages = [];
        for (const { type, msg } of messages) {
            switch (type) {
                case 'question': this.handleQuestion(msg); break;
                case 'task': this.handleTask(msg); break;
                case 'reply': this.handleReplyDelivered(msg); break;
            }
        }
    }

    /**
     * Claude Code JSONL transcript watcher.
     * Watches ~/.claude/projects/<encoded-path>/sessions/ for JSONL files.
     * Detects: turn_duration → idle, assistant message → working.
     */
    private watchClaudeTranscript(): void {
        // Use the configured cwd (from vibehq.config), not process.cwd()
        const cwd = this.options.cwd || this.options.args.find((_, i, arr) => i > 0 && arr[i - 1] === '--cwd') || process.cwd();
        // Claude Code encodes project paths by replacing path separators with dashes
        // Windows: D:\\testuse\\B -> D--testuse-B (: -> -, \\ -> -)
        // Unix:    /home/user/project -> -home-user-project (/ -> -)
        const encodedPath = cwd.replace(/[\\\\//:]/g, '-');
        // Claude Code v2.1+ stores sessions directly in the project directory (no /sessions/ subdir)
        const sessionsDir = join(homedir(), '.claude', 'projects', encodedPath);

        let watching = false;
        let currentFile = '';
        let fileOffset = 0;

        const findLatestJsonl = (): string | null => {
            if (!existsSync(sessionsDir)) return null;
            const files = readdirSync(sessionsDir)
                .filter(f => f.endsWith('.jsonl'))
                .map(f => ({ name: f, mtime: statSync(join(sessionsDir, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
            return files.length > 0 ? join(sessionsDir, files[0].name) : null;
        };

        const tailFile = async (filepath: string) => {
            try {
                const stat = statSync(filepath);
                if (stat.size <= fileOffset) return;

                const fh = await open(filepath, 'r');
                const buf = Buffer.alloc(stat.size - fileOffset);
                await fh.read(buf, 0, buf.length, fileOffset);
                await fh.close();
                fileOffset = stat.size;

                const lines = buf.toString('utf-8').split('\n').filter(l => l.trim());
                for (const line of lines) {
                    try {
                        const msg = JSON.parse(line);
                        // Claude v2.1+ JSONL format:
                        // type:'user' with userType:'external' = new user input -> working
                        // type:'system' with subtype:'turn_duration' = entire turn complete -> idle
                        //   (fires ONCE after all tool calls are done, unlike stop_reason:'end_turn'
                        //    which can fire multiple times during a single turn with tool use)
                        // Layer 1: turn_duration — most reliable, fires once per turn
                        if (msg.type === 'user' && msg.userType === 'external') {
                            this.sendStatus('working');
                            // Cancel any pending end_turn debounce
                            if (this.endTurnDebounce) {
                                clearTimeout(this.endTurnDebounce);
                                this.endTurnDebounce = null;
                            }
                        } else if (msg.type === 'system' && msg.subtype === 'turn_duration') {
                            // Cancel debounce — turn_duration is authoritative
                            if (this.endTurnDebounce) {
                                clearTimeout(this.endTurnDebounce);
                                this.endTurnDebounce = null;
                            }
                            this.sendStatus('idle');
                        } else if (msg.type === 'assistant' && msg.message?.stop_reason === 'end_turn') {
                            // Layer 2: end_turn with debounce (3s) — fallback when turn_duration is missing
                            // Cancel previous debounce if any
                            if (this.endTurnDebounce) clearTimeout(this.endTurnDebounce);
                            this.endTurnDebounce = setTimeout(() => {
                                this.endTurnDebounce = null;
                                // Only fire if we're still in 'working' state
                                if (this.currentStatus === 'working') {
                                    this.sendStatus('idle');
                                }
                            }, 3000);
                        }
                    } catch {
                        // skip malformed lines
                    }
                }
            } catch {
                // file might be temporarily locked
            }
        };

        const startWatch = () => {
            if (watching) return;

            const latest = findLatestJsonl();
            if (latest) {
                currentFile = latest;
                fileOffset = statSync(latest).size; // start from end
                this.saveLogPath(latest);
                watching = true;
            }

            // Watch the sessions directory for new/modified files
            try {
                const dirToWatch = existsSync(sessionsDir) ? sessionsDir : join(homedir(), '.claude', 'projects', encodedPath);
                if (!existsSync(dirToWatch)) {
                    // Claude hasn't created dirs yet — retry later
                    setTimeout(startWatch, 5000);
                    return;
                }

                watch(dirToWatch, { recursive: true }, (_event, filename) => {
                    if (!filename || !filename.endsWith('.jsonl')) return;

                    const fullPath = join(sessionsDir, typeof filename === 'string' ? filename : '');
                    if (existsSync(fullPath)) {
                        if (fullPath !== currentFile) {
                            currentFile = fullPath;
                            fileOffset = 0;
                            this.saveLogPath(fullPath);
                        }
                        tailFile(fullPath);
                    }
                });

                watching = true;
            } catch {
                // fs.watch might fail on some systems — fall back to polling
                setInterval(() => {
                    const latest = findLatestJsonl();
                    if (latest) {
                        if (latest !== currentFile) {
                            currentFile = latest;
                            fileOffset = 0;
                        }
                        tailFile(latest);
                    }
                }, 3000);
            }
        };

        // Delay to let Claude Code create session files
        setTimeout(startWatch, 3000);
    }

    /**
     * Codex CLI JSONL transcript watcher.
     * Watches ~/.codex/sessions/YYYY/MM/DD/ for rollout-*.jsonl files.
     * Detects: task_started → working, task_complete → idle.
     */
    private watchCodexTranscript(): void {
        const sessionsDir = join(homedir(), '.codex', 'sessions');

        let watching = false;
        let currentFile = '';
        let fileOffset = 0;

        // Scan all recent rollout files, return sorted by mtime desc
        const scanAllRollouts = (): { path: string; mtime: number; size: number }[] => {
            if (!existsSync(sessionsDir)) return [];
            try {
                const results: { path: string; mtime: number; size: number }[] = [];
                const years = readdirSync(sessionsDir).filter(f => /^\d{4}$/.test(f)).sort().reverse();
                for (const year of years) {
                    const yearDir = join(sessionsDir, year);
                    const months = readdirSync(yearDir).filter(f => /^\d{2}$/.test(f)).sort().reverse();
                    for (const month of months) {
                        const monthDir = join(yearDir, month);
                        const days = readdirSync(monthDir).filter(f => /^\d{2}$/.test(f)).sort().reverse();
                        for (const day of days) {
                            const dayDir = join(monthDir, day);
                            readdirSync(dayDir)
                                .filter(f => f.startsWith('rollout-') && f.endsWith('.jsonl'))
                                .forEach(f => {
                                    const fullPath = join(dayDir, f);
                                    const st = statSync(fullPath);
                                    results.push({ path: fullPath, mtime: st.mtimeMs, size: st.size });
                                });
                        }
                    }
                }
                return results.sort((a, b) => b.mtime - a.mtime);
            } catch {
                return [];
            }
        };

        // Snapshot all rollout files BEFORE Codex starts writing, so we can detect which new file it creates
        const preExistingFiles = new Set(scanAllRollouts().map(f => f.path));
        let lockedOn = false;
        let lastKnownSize = 0;
        let staleTicks = 0;
        // After lock-on, snapshot sizes of all files to detect session switches via /resume
        const sizeSnapshot = new Map<string, number>();
        for (const f of scanAllRollouts()) sizeSnapshot.set(f.path, f.size);

        const tailFile = async (filepath: string) => {
            try {
                const stat = statSync(filepath);
                if (stat.size <= fileOffset) return;

                const fh = await open(filepath, 'r');
                const buf = Buffer.alloc(stat.size - fileOffset);
                await fh.read(buf, 0, buf.length, fileOffset);
                await fh.close();
                fileOffset = stat.size;

                const lines = buf.toString('utf-8').split('\n').filter(l => l.trim());
                for (const line of lines) {
                    try {
                        const msg = JSON.parse(line);
                        // Codex event_msg types for turn lifecycle
                        if (msg.type === 'event_msg' && msg.payload?.type === 'task_started') {
                            this.sendStatus('working');
                        } else if (msg.type === 'event_msg' && msg.payload?.type === 'task_complete') {
                            this.sendStatus('idle');
                        }
                    } catch {
                        // skip malformed lines
                    }
                }
            } catch {
                // file might be temporarily locked
            }
        };

        const startWatch = () => {
            if (watching) return;

            // Phase 1: Wait for our Codex process to create its rollout file.
            // It will be a NEW file that didn't exist in preExistingFiles.
            setInterval(() => {
                if (!lockedOn) {
                    const all = scanAllRollouts();
                    const newFile = all.find(f => !preExistingFiles.has(f.path));
                    if (newFile) {
                        currentFile = newFile.path;
                        fileOffset = 0;
                        lastKnownSize = newFile.size;
                        lockedOn = true;
                        this.saveLogPath(currentFile);
                        watching = true;
                        // Update snapshot with the new file
                        sizeSnapshot.set(newFile.path, newFile.size);
                    }
                    return;
                }

                // Phase 2: Locked on — tail our file, but detect session switches.
                if (currentFile && existsSync(currentFile)) {
                    const st = statSync(currentFile);
                    if (st.size > lastKnownSize) {
                        // Our file is still growing — all good
                        lastKnownSize = st.size;
                        staleTicks = 0;
                        tailFile(currentFile);
                        // Update snapshot
                        sizeSnapshot.set(currentFile, st.size);
                        return;
                    }
                }

                staleTicks++;

                if (staleTicks < 5) {
                    // Grace period (10s) — user might just be thinking
                    if (currentFile) tailFile(currentFile);
                    return;
                }

                // Our file has been stale for 10s+ — check if user did /resume
                // (switched to a different rollout file)
                const all = scanAllRollouts();
                for (const f of all) {
                    const prevSize = sizeSnapshot.get(f.path) ?? 0;
                    if (f.size > prevSize && f.path !== currentFile) {
                        // A different file is growing — user switched sessions
                        currentFile = f.path;
                        fileOffset = prevSize; // read only the new data
                        lastKnownSize = f.size;
                        staleTicks = 0;
                        this.saveLogPath(currentFile);
                    }
                    sizeSnapshot.set(f.path, f.size);
                }

                if (currentFile) tailFile(currentFile);
            }, 2000);
        };

        // Delay to let Codex CLI create session files
        setTimeout(startWatch, 3000);
    }

    /**
     * PTY-based idle detection for Gemini (only).
     * Claude and Codex use JSONL-based detection instead.
     * If PTY output stops for N seconds, mark as idle.
     */
    private startPtyIdleTimer(): void {
        // Start the first idle timer immediately
        this.resetPtyIdleTimer();
    }

    private resetPtyIdleTimer(): void {
        if (this.ptyIdleTimer) clearTimeout(this.ptyIdleTimer);
        // For PTY-only CLIs: any output means working
        // For JSONL CLIs: don't override JSONL-based status, just reset the fallback timer
        if (!this.useJsonlDetection && this.currentStatus === 'idle') {
            this.sendStatus('working');
        }
        // Start countdown to idle — longer for JSONL CLIs (fallback only)
        const timeout = this.useJsonlDetection ? 30000 : this.PTY_IDLE_TIMEOUT;
        this.ptyIdleTimer = setTimeout(() => {
            this.sendStatus('idle');
        }, timeout);
    }

    /**
     * Record the active log file path to disk for post-run analysis.
     * Writes to ~/.vibehq/teams/<team>/agent-logs.json
     */
    private saveLogPath(logPath: string): void {
        if (logPath === this.currentLogFile) return;
        this.currentLogFile = logPath;

        const team = this.options.team || 'default';
        const logsFile = join(homedir(), '.vibehq', 'teams', team, 'agent-logs.json');

        try {
            let logs: Record<string, { path: string; cli: string; updatedAt: string }> = {};
            if (existsSync(logsFile)) {
                logs = JSON.parse(readFileSync(logsFile, 'utf-8'));
            }
            logs[this.options.name] = {
                path: logPath,
                cli: this.options.command,
                updatedAt: new Date().toISOString(),
            };
            const dir = join(homedir(), '.vibehq', 'teams', team);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(logsFile, JSON.stringify(logs, null, 2));
        } catch {
            // non-critical, don't crash spawner
        }
    }

    private cleanup(): void {
        if (this.ptyIdleTimer) clearTimeout(this.ptyIdleTimer);
        this.ws?.close();
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
    }
}

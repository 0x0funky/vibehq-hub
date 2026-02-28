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
            this.watchClaudeTranscript();
        } else {
            // Codex / Gemini: use PTY output timeout
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

        if (cmd === 'claude' || cmd.includes('claude')) {
            this.configureClaudeMcp(name, role, hubUrl, team);
        } else if (cmd === 'codex' || cmd.includes('codex')) {
            this.configureCodexMcp(name, role, hubUrl, team);
        } else if (cmd === 'gemini' || cmd.includes('gemini')) {
            this.configureGeminiMcp(name, role, hubUrl, team);
        }
    }

    /**
     * Update ~/.claude.json project-scoped MCP config for Claude Code.
     * Claude Code stores MCP config at: projects["<cwd>"].mcpServers
     */
    private configureClaudeMcp(name: string, role: string, hubUrl: string, team: string): void {
        const claudeJsonPath = join(homedir(), '.claude.json');
        if (!existsSync(claudeJsonPath)) return;

        let config: any;
        try { config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8')); } catch { return; }
        if (!config.projects) config.projects = {};

        // Claude Code uses forward-slash path keys on Windows
        const cwd = process.cwd();
        const cwdForward = cwd.replace(/\\/g, '/');

        const teamServer = {
            type: 'stdio',
            command: 'vibehq-agent',
            args: ['--name', name, '--role', role, '--hub', hubUrl, '--team', team],
            env: {},
        };

        // Update all matching project keys (both / and \ variants)
        let found = false;
        for (const key of Object.keys(config.projects)) {
            const normalizedKey = key.replace(/\\/g, '/').toLowerCase();
            if (normalizedKey === cwdForward.toLowerCase()) {
                if (!config.projects[key].mcpServers) config.projects[key].mcpServers = {};
                config.projects[key].mcpServers.team = teamServer;
                found = true;
            }
        }

        // If no matching project, create one with forward-slash path
        if (!found) {
            config.projects[cwdForward] = {
                allowedTools: [],
                mcpServers: { team: teamServer },
                hasTrustDialogAccepted: true,
            };
        }

        writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2));
    }

    /**
     * Update ~/.codex/config.toml for Codex CLI.
     */
    private configureCodexMcp(name: string, role: string, hubUrl: string, team: string): void {
        const configPath = join(homedir(), '.codex', 'config.toml');
        if (!existsSync(configPath)) return;

        let content = readFileSync(configPath, 'utf-8');

        // Remove existing [mcp_servers.team] block if present
        content = content.replace(/\[mcp_servers\.team\]\s*\n(?:(?!\[).*\n)*/g, '');
        content = content.trimEnd();

        // Append new team config
        const teamBlock = `\n\n[mcp_servers.team]\ncommand = "vibehq-agent"\nargs = ["--name", "${name}", "--role", "${role}", "--hub", "${hubUrl}", "--team", "${team}"]\n`;
        content += teamBlock;

        writeFileSync(configPath, content);
    }

    /**
     * Update ~/.gemini/settings.json for Gemini CLI.
     */
    private configureGeminiMcp(name: string, role: string, hubUrl: string, team: string): void {
        const configPath = join(homedir(), '.gemini', 'settings.json');
        let config: any = {};

        if (existsSync(configPath)) {
            try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { config = {}; }
        }

        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers.team = {
            command: 'vibehq-agent',
            args: ['--name', name, '--role', role, '--hub', hubUrl, '--team', team],
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
            spawnArgs.push('-y', '--dangerously-skip-permissions');
        }

        this.ptyProcess = pty.spawn(resolvedCommand, spawnArgs, {
            name: 'xterm-color',
            cols,
            rows,
            cwd: process.cwd(),
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
            // Reset PTY idle timer on any output (for Codex/Gemini)
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
     */
    private handleQuestion(msg: RelayQuestionMessage): void {
        const prompt = `[Team question from ${msg.fromAgent}]: ${msg.question} — Use the reply_to_team tool to respond to ${msg.fromAgent}.`;
        this.writeToPty(prompt);
    }

    /**
     * Inject a task assignment (fire-and-forget).
     */
    private handleTask(msg: RelayTaskMessage): void {
        const prompt = `[Task from ${msg.fromAgent}, priority: ${msg.priority}]: ${msg.task}`;
        this.writeToPty(prompt);
    }

    /**
     * Inject a teammate's reply into the CLI's PTY.
     */
    private handleReplyDelivered(msg: RelayReplyDeliveredMessage): void {
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
    }

    /**
     * Claude Code JSONL transcript watcher.
     * Watches ~/.claude/projects/<encoded-path>/sessions/ for JSONL files.
     * Detects: turn_duration → idle, assistant message → working.
     */
    private watchClaudeTranscript(): void {
        const cwd = this.options.args.find((_, i, arr) => i > 0 && arr[i - 1] === '--cwd') || process.cwd();
        // Claude encodes the path: / → %2F on unix, \ → %5C on windows
        const encodedPath = cwd.replace(/[\\/:]/g, (c) => encodeURIComponent(c));
        const sessionsDir = join(homedir(), '.claude', 'projects', encodedPath, 'sessions');

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
                        if (msg.type === 'system' && msg.subtype === 'turn_duration') {
                            this.sendStatus('idle');
                        } else if (msg.type === 'assistant') {
                            this.sendStatus('working');
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

                    const fullPath = join(sessionsDir, typeof filename === 'string' ? filename.replace(/^sessions[\\/]/, '') : '');
                    if (existsSync(fullPath)) {
                        if (fullPath !== currentFile) {
                            currentFile = fullPath;
                            fileOffset = 0;
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
     * PTY-based idle detection for Codex/Gemini.
     * If PTY output stops for N seconds, mark as idle.
     */
    private startPtyIdleTimer(): void {
        // Start the first idle timer immediately
        this.resetPtyIdleTimer();
    }

    private resetPtyIdleTimer(): void {
        if (this.ptyIdleTimer) clearTimeout(this.ptyIdleTimer);
        // Any PTY output means the CLI is working
        if (this.currentStatus === 'idle') {
            this.sendStatus('working');
        }
        // Start countdown to idle
        this.ptyIdleTimer = setTimeout(() => {
            this.sendStatus('idle');
        }, this.PTY_IDLE_TIMEOUT);
    }

    private cleanup(): void {
        if (this.ptyIdleTimer) clearTimeout(this.ptyIdleTimer);
        this.ws?.close();
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
    }
}

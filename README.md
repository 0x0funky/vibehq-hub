<p align="center">
  <strong>🌐 Language:</strong>
  English |
  <a href="README.zh-TW.md">繁體中文</a> |
  <a href="README.ja.md">日本語</a>
</p>

<h1 align="center">⚡ VibeHQ</h1>

<p align="center">
  <strong>Running 5 AI agents in parallel is easy.<br/>Making them not break each other's code is the hard part.</strong>
</p>

<p align="center">
  <em>VibeHQ adds contracts, task tracking, and idle-aware messaging to Claude Code, Codex & Gemini CLI — so they work like an actual engineering team, not 5 interns editing the same file.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/agents-Claude%20%7C%20Codex%20%7C%20Gemini-purple?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" />
</p>

---

## The Problem Nobody Talks About

Every "multi-agent" tool lets you run multiple CLI agents in parallel. But parallel ≠ collaboration. Here's what actually happens when 5 agents build the same app:

| What Goes Wrong | Real Example from Our Logs |
|---|---|
| **Schema conflicts** — each agent invents its own JSON format | Frontend expects `{ data: [] }`, backend writes `{ results: [] }`, third agent creates its own copy |
| **Orchestrator role drift** — the PM starts writing code | PM spent 6 manual JS patches fixing integration bugs instead of coordinating |
| **Ghost files** — agents publish 43-byte stubs instead of real content | Agent writes full file via `share_file`, then puts `"See local file..."` in `publish_artifact`. Loop repeats for 68 minutes |
| **Premature execution** — agents start before dependencies are ready | Agent sees `QUEUED` task description, ignores the status, starts coding with hardcoded data |
| **Silent failures** — crashed agents produce no signal | Orchestrator waits 18 minutes for a response from a dead process |

These aren't edge cases. They're **LLM-native behavioral patterns** that reliably appear across model families. We documented 7 of them with full session logs.

📖 **[Read the full analysis: 7 LLM-Native Problems →](blog/llm-native-problems-to-controllable-framework-en.md)**

---

## What VibeHQ Actually Does

VibeHQ is a **teamwork protocol layer** that sits on top of real CLI agents. Each agent stays a full Claude Code / Codex / Gemini process with all native features — VibeHQ adds the coordination they're missing:

| Problem | VibeHQ's Fix |
|---|---|
| Schema conflicts | **Contract system** — agents must sign API specs before coding begins |
| Role drift | **Structured task lifecycle** — `create → accept → in_progress → done` with required artifacts |
| Ghost files | **Hub-side validation** — rejects `publish_artifact` calls with stub content (<200 bytes) |
| Premature execution | **Idle-aware queue** — withholds task details until dependencies are ready |
| Silent failures | **Heartbeat monitoring** — auto-detects offline agents, notifies orchestrator |
| No quality check | **Independent QA** — separate agent validates data against source docs |
| No post-mortem | **13 automated detection rules** — analyzes session logs for failure patterns |

---

## Self-Improving Coordination: The Framework That Debugs Itself

VibeHQ doesn't just coordinate agents — it **analyzes its own failures and writes code to fix them.** Fully automated, zero human intervention.

We built a closed-loop system: run a benchmark → analyze the logs → `/optimize-protocol` reads the analysis and implements real code changes → rebuild → run again and measure:

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Benchmark   │────▶│  vibehq-analyze   │────▶│ /optimize-protocol│
│  (run team)  │     │  --with-llm       │     │   (Claude skill)  │
└─────────────┘     └──────────────────┘     └───────────────────┘
       ▲                                              │
       │              writes real code changes        │
       └──────────────────────────────────────────────┘
```

### Benchmark Results: Todo App (V1 → V5, 4 agents)

| Metric | V1 | V2 | V3 | V4 | V5 |
|--------|----|----|----|----|-----|
| **Total Tokens** | 7.2M | 3.9M | 14.6M | 15.0M | **5.7M** |
| **PM Tokens** | 0.3M | 0.2M | 10.1M | 9.8M | **1.8M** |
| **PM % of Total** | 4% | 5% | 69% | 65% | **32%** |
| **Turns** | 233 | 164 | 326 | 308 | 216 |
| **Duration** | 47min | 13min | 10min | 9min | 14min |
| **Flags (issues)** | 4 | 3 | 5 | 3 | **0** |
| **Context Bloat (PM)** | 7.07x | 10.56x | 6.62x | 7.04x | **2.84x** |

### Benchmark Results: Classroom Quiz (fully automated loop)

| Metric | V1 (Before) | V2 (After Loop) | Change |
|--------|-------------|-----------------|--------|
| **Total Tokens** | 23.1M | 13.8M | **-40%** |
| **PM Tokens** | ~15.2M | ~1.3M | **-91%** |
| **Turns** | 460 | 353 | -23% |
| **Flags** | 14 | 3 | **-79%** |
| **STUB_FILE** | 8 | 0 | eliminated |
| **Context Bloat (PM)** | 7.87x | 2.84x | -64% |

### What the system learned and built

| Iteration | Problem Found | What Was Built |
|---|---|---|
| V1→V2 | Hub falsely kills agents during boot; PM writes code | Startup grace period (180s); role presets with tool bans |
| V2→V3 | Codex PM ignores prompt constraints (shell_command 4→42x) | `--disallowedTools` CLI enforcement; switched PM to Claude |
| V3→V4 | PM uses Glob to monitor workers; artifacts overwritten to 0 bytes | Expanded disallowed tools; 0-byte content rejection at MCP layer |
| V4→V5 | PM polling explodes (28x check_status); stubs pass validation | `McpRateLimiter` (5 calls/60s); `CODE_MIN` enforcement; post-completion quiesce |
| CQ V1→V2 | 8 stub files; PM 66% of tokens on polling | Same fixes applied automatically — stubs eliminated, tokens -40% |

```
       23.1M ┤                         * CQ-V1
             │
       15.0M ┤               * V3  * V4
       13.8M ┤                            * CQ-V2
             │
        7.2M ┤  * V1
        5.7M ┤                                  * V5
        3.9M ┤      * V2
             │
           0 ┼──────────────────────────────────────
             V1   V2   V3   V4  CQ1  CQ2   V5
```

**Key insight:** Prompt constraints are suggestions. CLI-level enforcement is law. Agents adapt and route around soft limits — the fix must be architectural.

📖 **[Full blog post: Self-Improving Multi-Agent Coordination →](blog/self-improving-agents.md)**

---

## 📱 Web Dashboard — Desktop & Mobile

Start agents on your PC, monitor from your phone.

### Mobile

https://github.com/user-attachments/assets/9d056e18-44ea-418a-8831-dafc5cb724b8

### Desktop

https://github.com/user-attachments/assets/6f0fe691-bef8-49f9-a0ce-a65b215d264f

---

## 🚀 Quick Start

```bash
git clone https://github.com/0x0funky/vibehq-hub.git
cd vibehq-hub && npm install
npm run build
```

### Terminal (TUI)

<p align="center">
  <img src="images/vibehq_index.png" alt="VibeHQ TUI" width="700" />
</p>

```bash
vibehq
```

Interactive menu — select a team, configure agents, start. Everything runs in your terminal.

### Web Dashboard

```bash
npm run build:web
vibehq-web
```

Open `http://localhost:3100` — create a team, add agents, hit Start. Manage everything from a browser.

```bash
# With auth (recommended for LAN/mobile access)
VIBEHQ_AUTH=admin:secret vibehq-web
```

The server prints your LAN IP — open it on your phone and you're in.

---

## 🔧 20 MCP Tools

Every agent gets 20 collaboration tools auto-injected via Model Context Protocol:

**Communication (6):** `ask_teammate`, `reply_to_team`, `post_update`, `get_team_updates`, `list_teammates`, `check_status`

**Tasks (5):** `create_task`, `accept_task`, `update_task`, `complete_task`, `list_tasks`

**Artifacts (5):** `publish_artifact`, `list_artifacts`, `share_file`, `read_shared_file`, `list_shared_files`

**Contracts (3):** `publish_contract`, `sign_contract`, `check_contract`

**System (1):** `get_hub_info`

> 🎬 **[Watch 7 agents collaborate in real-time →](https://drive.google.com/file/d/1zzY3f8iCthb_s240rV67uiA9VpskZr2s/view?usp=sharing)**

<details>
<summary><strong>MCP tools in action (videos)</strong></summary>

#### List Teammates
https://github.com/user-attachments/assets/b4e20201-dc32-4ab4-b5fe-84b165d44e23

#### Teammate Talk
https://github.com/user-attachments/assets/ea254931-9981-4eb6-8db3-44480ec88041

#### Assign Task
https://github.com/user-attachments/assets/fec7634e-976a-4100-8b78-bd63ad1dbec0

</details>

---

## 📊 Post-Run Analytics & Auto-Optimization

### Analyze

```bash
vibehq-analyze ./data                        # Analyze session logs
vibehq-analyze --team my-team --with-llm     # Auto-resolve team logs + LLM insights
vibehq-analyze --team my-team --with-llm --save --run-id v1  # Save for optimization
vibehq-analyze compare v1 v2                 # Compare two runs side-by-side
vibehq-analyze history --last 10             # View past runs
```

**13 automated detection rules:** artifact regression, orchestrator role drift, stub files, task timeout, incomplete tasks, coordination overhead, unresponsive agents, zero artifacts, context bloat, duplicate artifacts, premature task accept, excessive MCP polling, task reassignment.

### Skills: `/run-teamwork`, `/benchmark-loop` & `/optimize-protocol`

VibeHQ ships three skills. Skills work on both **Claude Code** and **Codex CLI** — same format, different directory.

#### Cross-Platform Skill Locations

| Platform | Project-level | User-level |
|----------|--------------|------------|
| **Claude Code** | `.claude/skills/<name>/SKILL.md` | `~/.claude/skills/` |
| **Codex CLI** | `.agents/skills/<name>/SKILL.md` | `~/.codex/skills/` |

The `SKILL.md` format is an emerging cross-platform standard — same frontmatter (`name`, `description`), same markdown body. A skill created for one platform works on the other.

#### Setup

**Claude Code** — skills are already included in `.claude/skills/`. Just use them:

```bash
# In Claude Code, type:
/run-teamwork "Build an AI investment analysis platform"
/benchmark-loop "Build a todo app" --grade A
/optimize-protocol v1
```

**Codex CLI** — copy the skills to Codex's directory:

```bash
# Project-level (committed to repo)
mkdir -p .agents/skills
cp -r .claude/skills/run-teamwork .agents/skills/
cp -r .claude/skills/optimize-protocol .agents/skills/
cp -r .claude/skills/benchmark-loop .agents/skills/

# Or user-level (available in all projects)
cp -r .claude/skills/run-teamwork ~/.codex/skills/
cp -r .claude/skills/optimize-protocol ~/.codex/skills/
cp -r .claude/skills/benchmark-loop ~/.codex/skills/
```

Then in Codex CLI, invoke with `/skills` or type `$` to mention a skill.

#### `/run-teamwork` — One-Shot Team Builder

Give it a project description — it designs the team, spawns agents, and builds it. No analysis, no loop.

```bash
/run-teamwork "Build an e-commerce site with payments and admin panel"
```

1. Analyzes the prompt to determine required domains and team size
2. Generates PM system prompt with research-first workflow (research before implementation)
3. Spawns agents in tmux (macOS/Linux) or Windows Terminal
4. Waits for all tasks to complete
5. Reports the output directory and file count

#### `/optimize-protocol` — Framework Engineer

Reads analysis data and **writes real code fixes** (not parameter tuning):

```bash
/optimize-protocol v1    # Read analysis for run v1, implement fixes
```

1. Loads current run + all previous optimization reports
2. Builds cross-run trend table (what's improving, what regressed, what's a side-effect)
3. Classifies each problem as NEW, RECURRING, or SIDE-EFFECT of a previous fix
4. Implements real TypeScript changes to the framework
5. Verifies build passes
6. Saves a detailed changelog to `~/.vibehq/analytics/optimizations/`

#### `/benchmark-loop` — Autonomous Runner

Runs the full self-improving cycle automatically:

```bash
/benchmark-loop "Build a Todo app with REST API, React frontend, and WebSocket real-time updates"
```

1. Spawns a fresh team with a standardized project
2. Waits for the team to finish (heartbeat monitoring)
3. Analyzes session logs (13 rules + LLM grading)
4. Triggers `/optimize-protocol` to write code fixes
5. Rebuilds the framework (`npx tsup`)
6. Repeats with a new team — zero human intervention

#### Manual Step-by-Step (works with any CLI)

The underlying tools are regular CLI commands — **no skills required**:

```bash
# 1. Run a benchmark
vibehq start --team your-team

# 2. Analyze
vibehq-analyze --team your-team --with-llm --save --run-id v1

# 3. Auto-optimize (Claude Code / Codex skill)
/optimize-protocol v1

# 4. Run again, compare
vibehq start --team your-team
vibehq-analyze --team your-team --with-llm --save --run-id v2
vibehq-analyze compare v1 v2
```

All optimization reports are saved to `~/.vibehq/analytics/optimizations/` for tracking and auditing.

Supports both Claude Code and Codex CLI native JSONL log formats.

<details>
<summary><strong>📱 Remote Access</strong></summary>

The web platform is accessible on your LAN by default. For external access:

> ⚠️ **Always set `VIBEHQ_AUTH` before exposing remotely** — the web UI gives full terminal access.

| Method | Best For |
|--------|----------|
| **[Tailscale](https://tailscale.com/)** | Personal use — private VPN, no config, free |
| **[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)** | Sharing — public URL behind Cloudflare, free |
| **[ngrok](https://ngrok.com/)** | Quick testing — `ngrok http 3100`, temporary URL |
| **SSH Tunnel** | VPS — `ssh -R 8080:localhost:3100 your-server` |

**Tailscale (recommended):** Install on PC + phone → sign in both → `VIBEHQ_AUTH=admin:secret vibehq-web` → open `http://<tailscale-ip>:3100` on phone.

</details>

<details>
<summary><strong>📝 Configuration</strong></summary>

### `vibehq.config.json`

```jsonc
{
  "teams": [{
    "name": "my-project",
    "hub": { "port": 3001 },
    "agents": [
      { "name": "Alex", "role": "Project Manager", "cli": "codex", "cwd": "D:\\project" },
      { "name": "Jordan", "role": "Frontend Engineer", "cli": "claude", "cwd": "D:\\project\\frontend",
        "dangerouslySkipPermissions": true, "additionalDirs": ["D:\\project\\shared"] }
    ]
  }]
}
```

| Field | Description |
|-------|-------------|
| `name` | Agent display name (unique per team) |
| `role` | Role — auto-loads preset if no `systemPrompt` set |
| `cli` | `claude`, `codex`, or `gemini` |
| `cwd` | Working directory (isolated per agent) |
| `systemPrompt` | Custom prompt (overrides preset) |
| `dangerouslySkipPermissions` | Auto-approve Claude permissions |
| `additionalDirs` | Extra directories agent can access |

**Built-in presets:** Project Manager, Product Designer, Frontend Engineer, Backend Engineer, AI Engineer, QA Engineer

</details>

<details>
<summary><strong>🛠 CLI Reference</strong></summary>

```bash
vibehq              # Interactive TUI
vibehq-web          # Web platform (browser + mobile)
vibehq-hub          # Standalone hub server
vibehq-spawn        # Spawn single agent
vibehq-analyze      # Post-run analytics
```

### Manual Spawn

```bash
vibehq-spawn --name "Jordan" --role "Frontend Engineer" \
  --team "my-team" --hub "ws://localhost:3001" \
  --skip-permissions --add-dir "/shared" -- claude
```

</details>

<details>
<summary><strong>🏗 Architecture</strong></summary>

```
┌──────────────────────────────────────────────────┐
│                   VibeHQ Hub                      │
│               (WebSocket Server)                  │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌─────────┐ │
│  │ Tasks  │ │Artifacts │ │Contract│ │ Message │ │
│  │ Store  │ │ Registry │ │ Store  │ │  Queue  │ │
│  └────────┘ └──────────┘ └────────┘ └─────────┘ │
│  ┌──────────────────────────────────────────────┐│
│  │  Agent Registry — idle/working detection     ││
│  └──────────────────────────────────────────────┘│
└────────┬──────────┬──────────┬──────────┬────────┘
    ┌────▼───┐ ┌────▼───┐ ┌───▼────┐ ┌───▼────┐
    │ Claude │ │ Claude │ │ Codex  │ │ Claude │
    │  (FE)  │ │  (BE)  │ │  (PM)  │ │  (QA)  │
    │ 20 MCP │ │ 20 MCP │ │ 20 MCP │ │ 20 MCP │
    └────────┘ └────────┘ └────────┘ └────────┘
         ▲          ▲          ▲          ▲
         └──────────┴────┬─────┴──────────┘
                    ┌────▼─────────────┐
                    │  Web Dashboard   │
                    │ Desktop & Mobile │
                    └──────────────────┘
```

**Key design:**
- **Process isolation** — each agent is a separate OS process. Crashes don't cascade.
- **Contract-driven** — specs must be signed before coding begins.
- **Idle-aware queue** — messages queue when busy, flush when idle (JSONL watcher + PTY timeout).
- **State persistence** — all data survives hub restarts (`~/.vibehq/teams/<team>/hub-state.json`).
- **MCP-native** — 20 purpose-built tools, type-safe, auto-configured per agent.
- **Orchestrator enforcement** — Claude PMs get `--disallowedTools` (CLI-level hard block on Bash/Write/Edit/Read/Glob); Codex PMs get `--sandbox read-only`.
- **Content validation** — MCP rejects 0-byte artifacts, stub patterns, and >80% size regressions at the tool level.
- **Self-improving** — analyze→optimize loop with cross-run trend tracking and automated changelogs.

</details>

<details>
<summary><strong>⚠️ Platform Support</strong></summary>

| Feature | Windows | Mac | Linux |
|---------|---------|-----|-------|
| Web Platform | ✅ Tested | ✅ Should work | ✅ Should work |
| TUI | ✅ Tested | ✅ Tested | ⚠️ Untested |
| Hub + Spawn | ✅ Tested | ✅ Tested | ✅ Should work |
| JSONL Watcher | ✅ Tested | ✅ Tested | ⚠️ Path encoding |
| node-pty | ✅ Tested | ✅ Tested | ⚠️ Untested |

**Mac:** requires `xcode-select --install`. If `posix_spawnp failed`: `chmod +x node_modules/node-pty/prebuilds/*/spawn-helper`

**Linux:** requires `build-essential` and `python3`.

</details>

<details>
<summary><strong>📁 Project Structure</strong></summary>

```
agent-hub/
├── bin/                  # CLI entry points (start, spawn, hub, web, analyze)
├── src/
│   ├── hub/              # WebSocket hub, agent registry, message relay
│   ├── spawner/          # PTY manager, JSONL watcher, idle detection
│   ├── web/              # Express server, REST API, WebSocket handlers
│   ├── mcp/              # 20 MCP tools + hub-client bridge
│   ├── analyzer/         # Post-run analytics pipeline (13 rules)
│   ├── shared/           # TypeScript types
│   └── tui/              # Terminal UI screens + role presets
├── web/                  # React frontend (Vite + xterm.js)
├── blog/                 # Technical articles on LLM behavioral patterns
└── benchmarks/           # V1 vs V2 comparison reports
```

</details>

---

## 🤝 Contributing

PRs welcome. Modular architecture:
- **New MCP tool?** → `src/mcp/tools/` + register in `hub-client.ts`
- **New CLI?** → detection in `spawner.ts` + MCP config in `autoConfigureMcp()`
- **New widget?** → `web/src/components/` or `src/tui/screens/`

## 📄 License

MIT

---

<p align="center">
  <a href="https://x.com/0x0funky">𝕏 @0x0funky</a>
</p>

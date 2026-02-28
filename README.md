<p align="center">
  <img src="images/vibehq_index.png" alt="VibHQ" width="100%" />
</p>

<h1 align="center">⚡ VibHQ</h1>

<p align="center">
  <strong>Multi-Agent AI Collaboration Platform</strong><br/>
  <em>Orchestrate Claude, Codex & Gemini agents working as a real team.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Mac%20%7C%20Linux-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/agents-Claude%20%7C%20Codex%20%7C%20Gemini-purple?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" />
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#%EF%B8%8F-quickstart">Quickstart</a> •
  <a href="#-how-it-works">How It Works</a> •
  <a href="#-configuration">Configuration</a> •
  <a href="#-v2-collaboration-framework">V2 Framework</a> •
  <a href="#-demo">Demo</a>
</p>

---

## 🤔 What is VibHQ?

VibHQ lets you spin up a **team of AI coding agents** — each running in its own terminal — and have them **collaborate like a real engineering team**. A PM assigns tasks, engineers write specs and code, designers create specs, and QA tests everything. All coordinated through a central Hub.

**This is not "multi-agent chat".** This is structured, contract-driven collaboration with task tracking, artifact management, and idle-aware message queuing.

```
You give ONE prompt to the PM.
7 agents build an entire application.
```

<p align="center">
  <img src="images/vibehq_dashboard.png" alt="VibHQ Dashboard" width="100%" />
</p>

---

## ✨ Features

### 🎯 Core
- **Multi-CLI Support** — Claude Code, Codex CLI, Gemini CLI running side by side
- **Real-time Dashboard** — Live agent status, team updates, message routing
- **MCP Integration** — 20 purpose-built tools injected into every agent via Model Context Protocol
- **Per-Agent Terminals** — Each agent gets its own terminal window, fully interactive

### 🔄 V2 Collaboration Framework
- **Task Lifecycle** — `create → accept → in_progress → blocked → done` with artifact requirements
- **Contract System** — Publish API/design specs, require sign-offs before coding begins
- **Artifact Registry** — Structured document publishing with metadata and versioning
- **Idle-Aware Queue** — Messages queue when agents are busy, flush when idle

### 🧠 Smart Detection
- **Claude JSONL Watcher** — Parses transcript files to detect idle/working status in real-time
- **PTY Output Timeout** — Fallback idle detection for Codex/Gemini via terminal output monitoring
- **Auto Preset Loading** — Role-based system prompts loaded automatically from built-in presets

### 🔒 Agent Isolation
- **Per-agent working directories** — Each agent only sees its own code
- **`--add-dir` support** — Grant selective cross-directory access (e.g., shared mock data)
- **`--dangerously-skip-permissions`** — Optional auto-approve for Claude agents

---

## ⚡️ Quickstart

### Prerequisites
- Node.js ≥ 18
- At least one AI CLI installed: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli)

### Install

```bash
npm install -g @vibehq/agent-hub
```

### Initialize

```bash
vibehq init
```

This creates a `vibehq.config.json` in your project root.

### Launch

```bash
vibehq
```

Select a team → Start → watch the magic happen.

---

## 🏗 How It Works

```
┌──────────────────────────────────────────────────────────┐
│                      VibHQ Hub                           │
│                  (WebSocket Server)                      │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌─────────┐ │
│  │  Task    │  │ Artifact │  │ Contract  │  │ Message │ │
│  │  Store   │  │ Registry │  │  Store    │  │  Queue  │ │
│  └─────────┘  └──────────┘  └───────────┘  └─────────┘ │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Agent Registry                         │ │
│  │  idle/working detection • status broadcasts         │ │
│  └─────────────────────────────────────────────────────┘ │
└────────┬──────────┬──────────┬──────────┬───────────────┘
         │          │          │          │
    ┌────▼───┐ ┌────▼───┐ ┌───▼────┐ ┌───▼────┐
    │ Claude │ │ Claude │ │ Codex  │ │ Claude │
    │  (FE)  │ │  (BE)  │ │  (PM)  │ │  (QA)  │
    └────────┘ └────────┘ └────────┘ └────────┘
```

1. **Hub** starts a WebSocket server and manages all state
2. **Spawners** launch each agent CLI in a dedicated terminal
3. **MCP Tools** are auto-configured so agents can communicate via the Hub
4. **Idle Detection** monitors agent activity to enable smart message queuing
5. **State Persistence** saves all tasks, artifacts, and contracts to disk

---

## 📝 Configuration

### `vibehq.config.json`

```jsonc
{
  "teams": [
    {
      "name": "my-project",
      "hub": { "port": 3001 },
      "agents": [
        {
          "name": "Alex",
          "role": "Project Manager",    // Auto-loads preset system prompt
          "cli": "codex",
          "cwd": "D:\\my-project"
        },
        {
          "name": "Jordan",
          "role": "Frontend Engineer",
          "cli": "claude",
          "cwd": "D:\\my-project\\frontend",
          "dangerouslySkipPermissions": true,
          "additionalDirs": ["D:\\my-project\\shared"]
        }
      ]
    }
  ]
}
```

### Agent Options

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Agent display name |
| `role` | `string` | Role — auto-loads matching preset prompt if no `systemPrompt` |
| `cli` | `string` | `claude`, `codex`, or `gemini` |
| `cwd` | `string` | Working directory (isolated per agent) |
| `systemPrompt` | `string?` | Custom system prompt (overrides preset) |
| `dangerouslySkipPermissions` | `bool?` | Skip Claude permission prompts (default: `false`) |
| `additionalDirs` | `string[]?` | Extra directories the agent can access (`--add-dir`) |

### Built-in Role Presets

| Role | Includes |
|------|----------|
| Project Manager | Task delegation, spec-first workflow, progress tracking |
| Product Designer | Design specs, contract review, visual QA |
| Frontend Engineer | UI development, contract-first API integration |
| Backend Engineer | API-first development, contract publishing |
| AI Engineer | ML pipeline, model integration |
| QA Engineer | Test planning, cross-module verification |

---

## 🚀 V2 Collaboration Framework

### 20 MCP Tools

<details>
<summary><strong>Communication (6)</strong></summary>

| Tool | Description |
|------|-------------|
| `ask_teammate` | Ask a teammate a question (async) |
| `reply_to_team` | Send a reply/message |
| `post_update` | Broadcast status to entire team |
| `get_team_updates` | Read recent team updates |
| `list_teammates` | See all teammates with status |
| `check_status` | Check if teammate is idle/working |

</details>

<details>
<summary><strong>Task Management (5)</strong></summary>

| Tool | Description |
|------|-------------|
| `create_task` | Create tracked task with assignee and priority |
| `accept_task` | Accept or reject an assigned task |
| `update_task` | Update status to `in_progress` or `blocked` |
| `complete_task` | Mark done — requires artifact |
| `list_tasks` | List all/mine/active tasks |

</details>

<details>
<summary><strong>Artifacts & Files (5)</strong></summary>

| Tool | Description |
|------|-------------|
| `publish_artifact` | Publish structured document with metadata |
| `list_artifacts` | List published artifacts |
| `share_file` | Save file to shared folder |
| `read_shared_file` | Read from shared folder |
| `list_shared_files` | List shared files |

</details>

<details>
<summary><strong>Contract Sign-Off (3)</strong></summary>

| Tool | Description |
|------|-------------|
| `publish_contract` | Publish spec requiring sign-offs |
| `sign_contract` | Approve a contract |
| `check_contract` | Check sign-off status |

</details>

### Workflow

```
PM creates task ──► Engineer accepts ──► Writes spec
                                              │
                                    publish_contract
                                              │
                              Team signs off ◄─┘
                                    │
                              Code begins
                                    │
                          complete_task + artifact
                                    │
                              QA verification
```

---

## 🎬 Demo

Want to see 7 AI agents build a full-stack hospital system from scratch?

```bash
# 1. Select the medvault team
vibehq

# 2. Give the PM one prompt
# 3. Watch 7 agents collaborate: specs → contracts → code → QA

# Total time: ~30 minutes for a complete application
```

**What gets built:**
- 🔐 JWT authentication with role-based access
- 📋 Patient records with medical history
- 🏥 Medical imaging viewer (CT/X-Ray with zoom, brightness, annotations)
- 🤖 AI-powered diagnosis with confidence scores
- 📊 Real-time dashboard

---

## 🛠 CLI Commands

```bash
vibehq              # Interactive mode (select team, start, dashboard)
vibehq start        # Start a team directly
vibehq init         # Create config file
vibehq dashboard    # Dashboard only (connect to existing hub)
```

### Respawn a single agent

```bash
vibehq-spawn --name "Casey" --role "QA Engineer" \
  --team "medvault" --hub "ws://localhost:3002" \
  --skip-permissions \
  --add-dir "D:\project\src" \
  -- claude
```

---

## 📁 Project Structure

```
agent-hub/
├── bin/
│   ├── start.ts          # Main CLI entry (TUI, team management)
│   ├── spawn.ts          # Single agent spawner CLI
│   ├── hub.ts            # Standalone hub server
│   └── agent.ts          # MCP agent server
├── src/
│   ├── hub/
│   │   ├── server.ts     # WebSocket hub + state persistence
│   │   ├── registry.ts   # Agent registry + idle detection routing
│   │   └── relay.ts      # Message relay engine
│   ├── spawner/
│   │   └── spawner.ts    # PTY manager + JSONL watcher + idle detection
│   ├── mcp/
│   │   ├── hub-client.ts # MCP ↔ Hub bridge
│   │   └── tools/        # 20 MCP tool implementations
│   ├── shared/
│   │   └── types.ts      # Shared TypeScript types
│   └── tui/
│       ├── role-presets.ts    # Built-in role system prompts
│       └── screens/           # Dashboard, welcome, settings UI
├── vibehq.config.json    # Team configuration
└── images/               # Screenshots
```

---

## 🤝 Contributing

PRs welcome. The architecture is modular — adding new MCP tools, CLI support, or dashboard features is straightforward.

## 📄 License

MIT

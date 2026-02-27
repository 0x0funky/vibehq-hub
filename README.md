# vibehq-hub

> **Universal Multi-Agent Communication via MCP**  
> Let any AI CLI agent (Claude Code, Gemini CLI, Codex CLI) talk to each other — with team isolation, shared files, and a team bulletin board.

---

## ✨ What is this?

`agent-hub` is a standalone npm package with three components:

1. **Hub Server** — Central WebSocket server (agent registry, message relay, team updates)  
2. **MCP Agent** — Per-CLI MCP server (stdio) that gives each AI agent collaboration tools  
3. **Spawner** — Wraps any CLI process with Hub connectivity and auto-configures MCP

When configured, your AI agents gain these tools:

| Tool | Description |
|------|-------------|
| `list_teammates` | See who's online and their current status |
| `ask_teammate` | Ask a teammate a question (async) |
| `assign_task` | Assign a task to a teammate |
| `reply_to_team` | Send an async reply to a teammate |
| `check_status` | Check the current status of any teammate |
| `share_file` | Share a file with your team |
| `read_shared_file` | Read a file shared by a teammate |
| `list_shared_files` | List all files in the team shared folder |
| `post_update` | Post a progress update to the team bulletin board |
| `get_team_updates` | Get recent progress updates from the team |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   Hub Server (WS :3001)                       │
│                                                              │
│  Agent Registry     Relay Engine     Team Updates Store       │
│  (team-scoped)      (team-scoped)   (in-memory, per team)    │
└───────┬──────────────────┬──────────────────┬────────────────┘
        │ WS                │ WS                │ WS
   ┌────┴────┐        ┌────┴────┐        ┌────┴────┐
   │ MCP #1  │        │ MCP #2  │        │ MCP #3  │
   │ (Alex)  │        │(Jordan) │        │  (Bob)  │
   │ team:   │        │ team:   │        │ team:   │
   │ dexless │        │ dexless │        │  other  │
   └────┬────┘        └────┬────┘        └────┬────┘
        │ stdio             │ stdio             │ stdio
   ┌────┴────┐        ┌────┴────┐        ┌────┴────┐
   │ Claude  │        │  Codex  │        │ Gemini  │
   │  Code   │        │   CLI   │        │   CLI   │
   └─────────┘        └─────────┘        └─────────┘
   
Shared Files: ~/.vibehq/teams/<team>/shared/
```

**Key Principles:**
- **Team Isolation** — Agents only see/communicate with teammates in the same team
- **Shared Files** — `~/.vibehq/teams/<team>/shared/` per team for document exchange
- **Auto-Config** — Spawner auto-writes MCP config for Claude/Codex/Gemini

---

## 🚀 Quick Start

### 1. Install

```bash
npm install -g @vibehq/agent-hub
```

### 2. Start the Hub

```bash
vibehq-hub --port 3001 --verbose
```

### 3. Spawn Agents (Recommended)

The easiest way — `vibehq-spawn` auto-configures MCP for each CLI:

```bash
# Terminal 1: Backend engineer (Claude Code)
vibehq-spawn --name Alex --role "Backend Engineer" --team dexless -- claude

# Terminal 2: Frontend engineer (Codex CLI)
vibehq-spawn --name Jordan --role "Frontend Engineer" --team dexless -- codex

# Terminal 3: AI engineer (Gemini CLI)
vibehq-spawn --name Bob --role "AI Engineer" --team dexless -- gemini
```

That's it! Each agent now has 10 team collaboration tools. Try asking one to `list_teammates`.

### Alternative: Manual MCP Config

If you prefer manual setup, add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "team": {
      "command": "vibehq-agent",
      "args": [
        "--name", "Jordan",
        "--role", "Frontend Engineer",
        "--hub", "ws://localhost:3001",
        "--team", "dexless"
      ]
    }
  }
}
```

---

## 👥 Team Workflow

### Best Practice: Shared Specs + Updates

The most token-efficient way for agents to collaborate:

```
1. PM: share_file("task-spec.md", "...")     → Everyone can read it
2. Backend: reads spec → works → share_file("api-spec.md", "...")
3. Backend: post_update("API spec done, see api-spec.md")
4. Frontend: get_team_updates → sees the announcement
5. Frontend: read_shared_file("api-spec.md") → starts building
6. Only ask_teammate when spec is unclear
```

**Why?**
- `share_file` = write once, read many (~500 tokens each)
- `ask_teammate` round-trip = ~5000-7000 tokens
- Shared files persist across agent restarts

---

## 📖 CLI Reference

### `vibehq-hub`

Start the central Hub server.

```
Options:
  -p, --port <number>    Port number (default: 3001)
  -v, --verbose          Enable verbose logging
  -h, --help             Show help
```

### `vibehq-spawn`

Spawn a CLI agent with auto-MCP configuration.

```
Options:
  -n, --name <string>     Agent name (required)
  -r, --role <string>     Agent role (default: "Engineer")
  -u, --hub <url>         Hub WebSocket URL (default: ws://localhost:3001)
      --team <string>     Team name (default: "default")
  -h, --help              Show help

Examples:
  vibehq-spawn --name Claude --role "Backend Engineer" --team myteam -- claude
  vibehq-spawn --name Codex --role "Frontend Engineer" --team myteam -- codex
  vibehq-spawn --name Gemini --role "AI Engineer" --team myteam -- gemini
```

### `vibehq-agent`

Start an MCP agent (auto-spawned by CLI via MCP config).

```
Options:
  -n, --name <string>     Agent name (required)
  -r, --role <string>     Agent role (default: "Engineer")
  -u, --hub <url>         Hub WebSocket URL (default: ws://localhost:3001)
      --team <string>     Team name (default: "default")
  -t, --timeout <ms>      Ask timeout in ms (default: 120000)
  -h, --help              Show help
```

---

## 🖥️ VibeHQ Integration

VibeHQ connects to the same Hub as a **viewer** to receive real-time events:

```typescript
const ws = new WebSocket('ws://localhost:3001');
ws.send(JSON.stringify({ type: 'viewer:connect' }));

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    switch (msg.type) {
        case 'agent:status:broadcast':  // Update agent status in UI
        case 'relay:start':             // Start walking animation
        case 'relay:done':              // End walking animation
    }
});
```

---

## 📁 Project Structure

```
agent-hub/
├── bin/
│   ├── hub.ts              # CLI: vibehq-hub
│   ├── agent.ts            # CLI: vibehq-agent
│   └── spawn.ts            # CLI: vibehq-spawn
├── src/
│   ├── index.ts            # Public API
│   ├── hub/
│   │   ├── server.ts       # WebSocket Hub + team updates store
│   │   ├── registry.ts     # Agent registration (team-scoped)
│   │   ├── relay.ts        # Message relay engine
│   │   └── types.ts        # Hub-specific types
│   ├── mcp/
│   │   ├── server.ts       # MCP server (10 tools)
│   │   ├── hub-client.ts   # WS client to Hub
│   │   └── tools/
│   │       ├── list-teammates.ts
│   │       ├── ask-teammate.ts
│   │       ├── assign-task.ts
│   │       ├── check-status.ts
│   │       ├── reply-to-team.ts
│   │       ├── share-file.ts      # share/read/list shared files
│   │       └── team-updates.ts    # post/get team updates
│   ├── spawner/
│   │   └── spawner.ts      # PTY wrapper + auto MCP config
│   └── shared/
│       ├── types.ts        # Shared interfaces
│       └── protocol.ts     # Message type constants
└── tests/
    └── integration.ts
```

---

## 📝 Tech Stack

| Layer | Tech |
|-------|------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js 18+ |
| MCP SDK | `@modelcontextprotocol/sdk` |
| WebSocket | `ws` |
| PTY | `node-pty` |
| Build | `tsup` |

---

## 🛠️ Development

```bash
npm install       # Install dependencies
npm run build     # Build
npm run dev       # Dev mode (watch)
npm link          # Link globally for CLI access
```

---

## 📄 License

MIT

# vibehq-hub

> **Universal Multi-Agent Communication via MCP**  
> Let any AI CLI agent (Claude Code, Gemini CLI, Codex CLI, Cursor) talk to each other.

---

## ✨ What is this?

`agent-hub` is a standalone npm package with two components:

1. **Hub Server** — A central WebSocket server that manages agent registry and message relay  
2. **MCP Agent** — A per-CLI MCP server (stdio) that gives each AI agent collaboration tools

When configured, your AI agents gain these superpowers:

| Tool | Description |
|------|-------------|
| `list_teammates` | See who's online and their current status |
| `ask_teammate` | Ask a teammate a question and wait for their response |
| `assign_task` | Assign a task to a teammate (non-blocking) |
| `check_status` | Check the current status of any teammate |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Hub Server (WS :3001)                       │
│                                                             │
│  Agent Registry     Relay Engine      Event Bus             │
└───────┬─────────────────┬─────────────────┬─────────────────┘
        │ WS               │ WS               │ WS
   ┌────┴────┐       ┌────┴────┐       ┌────┴────┐
   │ MCP #1  │       │ MCP #2  │       │ MCP #3  │
   │ (Alex)  │       │(Jordan) │       │ (Riley) │
   └────┬────┘       └────┬────┘       └────┬────┘
        │ stdio           │ stdio           │ stdio
   ┌────┴────┐       ┌────┴────┐       ┌────┴────┐
   │ Claude  │       │ Gemini  │       │ Codex   │
   │ Code    │       │ CLI     │       │ CLI     │
   └─────────┘       └─────────┘       └─────────┘
```

**Key Principle:**
- **Hub Server** = Central controller (agent registry, message relay, state tracking)
- **MCP Agent** = Per-CLI communication module (exposes tools, connects to Hub)
- Hub ↔ MCP Agent: **WebSocket**
- MCP Agent ↔ CLI: **stdio (MCP protocol)**

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

### 3. Configure Your AI CLI

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "team": {
      "command": "vibehq-agent",
      "args": [
        "--name", "Jordan",
        "--role", "Frontend Engineer",
        "--hub", "ws://localhost:3001"
      ]
    }
  }
}
```

### 4. Done!

Your AI agent now has team collaboration tools. Ask it to `list_teammates` or `ask_teammate` and watch the magic happen.

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

### `vibehq-agent`

Start an MCP agent (auto-spawned by CLI via `.mcp.json`).

```
Options:
  -n, --name <string>     Agent name (required)
  -r, --role <string>     Agent role (default: "Engineer")
  -u, --hub <url>         Hub WebSocket URL (default: ws://localhost:3001)
  -t, --timeout <ms>      Ask timeout in ms (default: 120000)
  -h, --help              Show help
```

---

## 🔌 Programmatic Usage

```typescript
import { startHub, HubClient } from '@vibehq/agent-hub';

// Start a hub programmatically
const wss = startHub({ port: 3001, verbose: true });

// Or use the client directly
const client = new HubClient('ws://localhost:3001', 'MyBot', 'Engineer');
await client.connect();

const teammates = client.getTeammates();
const response = await client.ask('Jordan', 'What framework are we using?');
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

| Hub Event | VibeHQ Action |
|-----------|---------------|
| `agent:status:broadcast` | Update agent dot color |
| `relay:start` | Start walking animation |
| `relay:done` | End walking animation |
| `agent:registered` | Add agent to canvas |
| `agent:disconnected` | Grey out agent |

---

## 🛠️ Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Dev mode (watch)
npm run dev

# Run integration tests
npx tsx tests/integration.ts
```

---

## 📁 Project Structure

```
agent-hub/
├── bin/
│   ├── hub.ts              # CLI: vibehq-hub
│   └── agent.ts            # CLI: vibehq-agent
├── src/
│   ├── index.ts            # Public API
│   ├── hub/
│   │   ├── server.ts       # WebSocket Hub server
│   │   ├── registry.ts     # Agent registration & state
│   │   ├── relay.ts        # Message relay engine
│   │   └── types.ts        # Hub-specific types
│   ├── mcp/
│   │   ├── server.ts       # MCP server (stdio transport)
│   │   ├── hub-client.ts   # WS client to Hub
│   │   └── tools/
│   │       ├── list-teammates.ts
│   │       ├── ask-teammate.ts
│   │       ├── assign-task.ts
│   │       └── check-status.ts
│   └── shared/
│       ├── types.ts        # Shared interfaces
│       └── protocol.ts     # Message type constants
├── examples/
│   └── .mcp.json.example
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
| Build | `tsup` |

---

## 📄 License

MIT

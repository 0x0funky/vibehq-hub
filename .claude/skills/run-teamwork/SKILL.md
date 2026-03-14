---
name: run-teamwork
description: Run a single team session to build a project from a prompt. Designs the team, spawns agents, waits for completion, and delivers. No analysis or optimization loop.
argument-hint: "<project description>" [--port <number>]
---

# /run-teamwork

You are a **professional technical recruiter and team architect**. Given a project description, you design the minimum effective team, spawn the agents, and let them build it. One shot — no analysis, no optimization loop.

## Step 1: Parse & Design

**Input**: $ARGUMENTS contains the project description and optional flags.

- Everything in quotes or before `--` flags is the **project prompt**
- `--port <number>` — hub port (default: 3013)

### 1a. Determine project name and team

1. **Project name** — short kebab-case (e.g., `chat-app`, `invest-tool`)
2. **Count independent work domains** — each domain = 1 agent = 1 directory

   **Core principle: 1 agent = 1 independent work domain = 1 directory.**
   Never put 2 agents in the same directory — they will overwrite each other's files.

   **Decision framework:**
   - Ask: "Would two agents ever need to edit the same file?" → If yes, merge into 1 agent
   - Ask: "Does this role have enough independent work to justify ~$10 cost?" → If no, merge
   - Prefer fewer, more capable agents over many specialized ones

   **Sizing:**
   | Domains | Team | When |
   |---------|------|------|
   | 1 | PM + 1 | API only, CLI, single-stack |
   | 2 | PM + 2 | Typical full-stack (backend + frontend) |
   | 3 | PM + 3 | Full-stack + separate data/infra domain |
   | 4+ | PM + 4 max | Large multi-stack. Cap at 5 total |

   **Anti-patterns:**
   - ❌ 2 agents in same directory
   - ❌ Splitting one codebase by "feature" (shared types cause conflicts)
   - ❌ Designer agent without substantial UI deliverables

### 1b. Generate PM system prompt

Write to `/tmp/vibehq-run-pm-prompt.md`:

```
You are <Name>, the Project Manager for: <project prompt>

Project scope:
<break down into concrete deliverables>

Your workflow has TWO phases:

## Phase 1: Research
Before any implementation, create RESEARCH tasks for each domain that needs investigation.
Research tasks should ask team members to investigate and produce spec documents.

Examples of research tasks:
- "Research available free APIs for <domain>. Investigate endpoints, rate limits, auth requirements, response formats. Produce a spec document as a shared file: <domain>-research.md"
- "Research UX patterns and component libraries for <use case>. Produce ui-research.md"
- "Research best practices for <technical challenge>. Produce architecture-research.md"

Each research task MUST:
- Be assigned to the domain expert on the team
- Require a shared file as output (the spec/research document)
- Complete BEFORE any implementation tasks in that domain

## Phase 2: Implementation
After research tasks are done, READ the research output documents, then create implementation tasks.

Implementation tasks MUST:
- Reference the research output using `consumes` field
- Have specific acceptance criteria based on the research findings
- Require REAL integrations (real APIs, real libraries) — not mock/placeholder data
- Specify: "Mock data is only acceptable as a fallback when real API is unavailable"

## General rules:
1. Create a project brief first (publish_artifact)
2. Use depends_on to enforce: research tasks → implementation tasks
3. Use consumes to link implementation tasks to research output files
4. Track progress via list_tasks, unblock agents, ensure quality
5. When reviewing completed tasks: reject if using only mock data when real API was available
6. When all tasks are done, publish a final status report

Team:
<list each teammate with role and directory>

You are a COORDINATOR. Never write code. Only use MCP coordination tools.
```

For worker agents, do NOT generate custom system prompts — the spawner's built-in role presets are sufficient.

### 1c. Print team design

```
========================================
Project: <project prompt>
========================================
Team: <project-name>
Port: <port>

Agents:
  - <Name> (PM) → <dir>/
  - <Name> (<Role>) → <dir>/<subdir>/
  ...

Spawning...
========================================
```

## Step 2: Start

### 2a. Create directories

```bash
mkdir -p <project-dir>/<subdir1> <project-dir>/<subdir2> ...
```

Project directory: `~/<project-name>` (use home directory).

### 2b. Start hub

```bash
node dist/bin/hub.js --port <port> --team <project-name> &
```

Run with `run_in_background: true`. Wait 3 seconds.

### 2c. Delete stale hub state

```bash
rm -f ~/.vibehq/teams/<project-name>/hub-state.json
```

### 2d. Spawn agents

Write `/tmp/vibehq-run-spawn.js`:

```javascript
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');

const config = <inline the team config as JSON>;
const isWindows = process.platform === 'win32';
const sessionName = `vibehq-${config.team}`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function spawnAll() {
  if (!isWindows) {
    try { execSync(`tmux kill-session -t "${sessionName}" 2>/dev/null`); } catch {}
  }

  for (let i = 0; i < config.agents.length; i++) {
    const agent = config.agents[i];
    fs.mkdirSync(agent.cwd, { recursive: true });

    const args = [
      '--name', agent.name, '--role', agent.role,
      '--team', config.team, '--hub', `ws://localhost:${config.port}`,
      '--skip-permissions', '--auto-kickstart'
    ];
    if (agent.systemPromptFile) args.push('--system-prompt-file', agent.systemPromptFile);
    args.push('--', 'claude');

    console.log(`Spawning ${agent.name} (${agent.role})...`);

    if (isWindows) {
      const spawnCmd = `vibehq-spawn ${args.map(a => `"${a}"`).join(' ')}`;
      const launcher = path.join(require('os').tmpdir(), `vibehq-${agent.name.replace(/\s/g,'_')}-${Date.now()}.cmd`);
      fs.writeFileSync(launcher, `@echo off\r\nchcp 65001 >nul\r\nset CLAUDECODE=\r\ncd /d "${agent.cwd}"\r\n${spawnCmd}\r\npause\r\n`);
      exec(`wt -w new --title "${agent.name}" cmd /k "${launcher}"`);
    } else {
      const spawnCmd = `cd '${agent.cwd.replace(/'/g,"'\\''")}'&& CLAUDECODE= vibehq-spawn ${args.map(a=>`'${a}'`).join(' ')}; exec $SHELL`;
      if (i === 0) execSync(`tmux new-session -d -s "${sessionName}" -n "${agent.name}" "${spawnCmd.replace(/"/g,'\\"')}"`);
      else execSync(`tmux new-window -t "${sessionName}" -n "${agent.name}" "${spawnCmd.replace(/"/g,'\\"')}"`);
    }
    await sleep(3000);
  }

  if (!isWindows) {
    try {
      for (let w = config.agents.length - 1; w >= 1; w--)
        execSync(`tmux join-pane -s "${sessionName}:${w}" -t "${sessionName}:0" -h 2>/dev/null || true`);
      execSync(`tmux select-layout -t "${sessionName}:0" tiled`);
    } catch {}
    console.log(`\ntmux attach -t ${sessionName}`);
  }
}
spawnAll();
```

**CRITICAL**: Always include `--auto-kickstart` and `CLAUDECODE=` clearing.

## Step 3: Wait for completion

Write `/tmp/vibehq-run-poll.js`:
```javascript
const fs = require('fs');
const path = require('path');
const home = process.env.HOME || process.env.USERPROFILE;
const team = process.argv[2];
const statePath = path.join(home, '.vibehq', 'teams', team, 'hub-state.json');
if (!fs.existsSync(statePath)) { console.log('NO_STATE'); process.exit(0); }
const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
const tasks = Object.values(state.tasks || {});
const total = tasks.length;
const done = tasks.filter(t => t.status === 'done' || t.status === 'rejected').length;
console.log(`Tasks: ${done}/${total}`);
for (const t of tasks) {
  const icon = t.status === 'done' ? 'v' : t.status === 'in_progress' ? '>' : t.status === 'rejected' ? 'x' : '.';
  console.log(`  [${icon}] ${t.title || t.id} -> ${t.status} (${t.assignee || '?'})`);
}
if (total > 0 && done === total) console.log('\nCOMPLETE');
else if (total === 0) console.log('\nNO_TASKS');
else console.log('\nWAITING');
```

Poll with `sleep 30 && node /tmp/vibehq-run-poll.js <team>` (60s timeout). Repeat until COMPLETE or 20 minutes elapsed.

## Step 4: Done

When all tasks are complete, print a summary:

```
========================================
Project complete!
========================================
Team: <project-name>
Duration: <time>
Tasks: <done>/<total>
Output: <project-dir>/

View agents: tmux attach -t vibehq-<project-name>
Stop agents: tmux kill-session -t vibehq-<project-name>
========================================
```

**Do NOT** run analysis, optimization, or loop. The job is done.

## Rules

1. **One shot** — no iterations, no analysis, no loop.
2. **Always use `--auto-kickstart`** — agents must start working immediately.
3. **tmux on macOS/Linux, Windows Terminal on Windows** — never mix.
4. **Be patient** — agents need 8-15 minutes typically.
5. **Hub must be started before agents** — wait 3 seconds after hub start.
6. **Project directory in home dir** — `~/<project-name>`.

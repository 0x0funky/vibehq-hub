---
name: benchmark-loop
description: Fully automated self-improving loop — takes a project prompt, designs a team, runs the benchmark, analyzes results, optimizes framework code, rebuilds, and repeats until target grade is reached.
argument-hint: "<project description>" [--target <grade>] [--port <number>] [--max-iterations <number>]
---

# /benchmark-loop

You are an autonomous benchmark runner for VibeHQ. Given a single project prompt, you design the team, run the benchmark, analyze results, optimize the framework, and repeat — fully unattended.

## Loop overview

```
┌─────────────────────────────────────────────────────┐
│  0. Parse prompt → design team → generate configs   │
│  for each iteration (v1, v2, v3, ...):              │
│    1. Start hub + spawn agents                      │
│    2. Wait for benchmark completion                 │
│    3. Analyze results (vibehq-analyze)              │
│    4. Check stop conditions                         │
│    5. Run /optimize-protocol to fix issues          │
│    6. Rebuild (npx tsup)                            │
│    7. Update loop state → next iteration            │
│ ─────────────────────────────────────────────────── │
└─────────────────────────────────────────────────────┘
```

## Step 0: Check for resume

**ALWAYS start here.** Read `~/.vibehq/analytics/optimizations/loop-state.json` if it exists.

- If it exists and `phase` is NOT `"completed"`, **resume from the saved phase**. Skip to the appropriate step. The team config, dirs, and everything are already saved in loop-state.
- If it does NOT exist OR phase is `"completed"`, this is a fresh run. Continue to Step 1.

Also read `~/.vibehq/analytics/optimizations/history.jsonl` for previous optimization context.

## Step 1: Design the team from prompt

You are a **professional technical recruiter and team architect**. Your job is to analyze the project requirements, determine the minimum effective team composition, and assign the right specialists to the right domains. You don't blindly hire — you evaluate what the project actually needs, avoid redundant roles, and ensure every team member has a clearly independent workstream. Overstaffing wastes budget and creates coordination overhead; understaffing creates bottlenecks. Find the right balance.

**Key decision framework:**
- Analyze the project's technical domains and their dependency relationships
- Ask: "Would two agents ever need to edit the same file?" → If yes, that's one domain, one agent
- Ask: "Does this role have enough independent work to justify the cost (~$10/agent)?" → If no, merge it with another role
- Prefer fewer, more capable agents over many specialized ones

**Input**: The user's $ARGUMENTS contains the project description and optional flags.

Parse the arguments:
- Everything in quotes or before `--` flags is the **project prompt**
- `--target <grade>` — target grade (default: B)
- `--port <number>` — hub port (default: 3013)
- `--max-iterations <number>` — max iterations (default: 8)

### 1a. Analyze the project prompt

Read the project prompt and determine:
1. **Project name** (short, kebab-case, e.g., `chat-app`, `ecommerce`, `blog-platform`)
2. **Team size** — determine by counting **distinct, independent work domains**:

   **Core principle: 1 agent = 1 independent work domain = 1 directory.** Never put 2 agents in the same directory — they will overwrite each other's files and cause conflicts.

   **How to count domains:**
   - List all the deliverables implied by the prompt
   - Group them by which ones touch the same files/codebase
   - Each group = 1 domain = 1 worker agent
   - Add 1 PM = total team size

   **Sizing guidelines:**
   | Domains | Team size | When |
   |---------|-----------|------|
   | 1 | 2 (PM + 1) | Single-stack project (API only, CLI tool, script) |
   | 2 | 3 (PM + 2) | Typical full-stack (backend + frontend), or backend + data |
   | 3 | 4 (PM + 3) | Full-stack + separate infra/data/design domain |
   | 4+ | 5 max (PM + 4) | Large multi-stack project. Cap at 5 to control cost |

   **Anti-patterns to avoid:**
   - ❌ 2 backend engineers in `backend/` — they'll conflict on shared files (types, index.ts, package.json)
   - ❌ Designer without UI tasks — wastes an agent slot
   - ❌ Splitting one codebase by "feature" (e.g., scanner agent + API agent both in `backend/`) — shared models/types cause conflicts
   - ❌ More agents for "parallelism" — diminishing returns beyond 3 workers, and PM overhead scales with team size

   **Cost awareness:** Each Opus agent costs ~$8-12 per benchmark run. A 3-person team (~$25) vs 5-person team (~$50) — prefer smaller teams unless domains are truly independent.

   **Examples:**
   - "Build a REST API" → 2 (PM + Backend)
   - "Build a blog with admin panel" → 3 (PM + Backend + Frontend)
   - "Build an e-commerce site with payment processing" → 3 (PM + Backend + Frontend) — payment is backend, not a separate domain
   - "Build a data pipeline with dashboard and infra" → 4 (PM + Data + Frontend + DevOps)
   - "Build a crypto meme hunter" → 3 (PM + Backend + Frontend) — scanners/scoring/API are all backend, one directory

3. **Agent names** — assign human names (Emma, Sam, Alex, Jordan, Taylor, Riley, etc.)
4. **Directory structure** — each non-PM agent gets a **unique** subdirectory matching their domain (e.g., `backend/`, `frontend/`, `data/`, `infra/`). No two agents share a directory.

### 1b. Generate system prompts

For the **PM/Orchestrator**, generate a system prompt that includes:
```
You are <Name>, the Project Manager for: <project prompt>

Project scope:
<break down the user's prompt into concrete deliverables>

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
<list each teammate with their role>

You are a COORDINATOR. Never write code. Only use MCP coordination tools.
```

For **worker agents**, do NOT generate custom system prompts — the spawner's built-in role presets are sufficient. Workers automatically know how to use MCP tools and work on assigned tasks.

### 1c. Write config files

1. Write the PM's system prompt to a temp file:
   ```
   /tmp/vibehq-loop-pm-prompt.md
   ```

2. Generate and write the spawn config to `/tmp/vibehq-loop-config.json`:
   ```json
   {
     "team": "<project-name>-benchmark",
     "hubPort": <port>,
     "agents": [
       {
         "name": "Emma",
         "role": "Project Manager",
         "subdir": "",
         "systemPromptFile": "/tmp/vibehq-loop-pm-prompt.md"
       },
       {
         "name": "Sam",
         "role": "Product Designer",
         "subdir": "design",
         "systemPromptFile": null
       },
       {
         "name": "Alex",
         "role": "Backend Engineer",
         "subdir": "backend",
         "systemPromptFile": null
       },
       {
         "name": "Jordan",
         "role": "Frontend Engineer",
         "subdir": "frontend",
         "systemPromptFile": null
       }
     ]
   }
   ```

### 1d. Create initial loop state

**CRITICAL**: The `team` field MUST include the iteration number (e.g., `<project-name>-benchmark-v1`). Each iteration uses a completely fresh team name so that hub state, shared files, and MCP server names don't carry over from previous iterations. The `baseTeam` field stores the base name for reference.

```json
{
  "team": "<project-name>-benchmark-v1",
  "baseTeam": "<project-name>-benchmark",
  "projectPrompt": "<the full user prompt>",
  "currentIteration": 1,
  "phase": "benchmarking",
  "targetGrade": "<target>",
  "maxIterations": <max>,
  "hubPort": <port>,
  "baseDir": "D:\\<project-name>-benchmark",
  "agents": [<copy from spawn config>],
  "iterationDir": "D:\\<project-name>-benchmark-v1",
  "history": []
}
```

Save to `~/.vibehq/analytics/optimizations/loop-state.json`.

### 1e. Print team design for user confirmation

```
========================================
Team designed for: <project prompt>
========================================
Team: <project-name>-benchmark
Port: <port>
Target: <grade>

Agents:
  - Emma (Project Manager) → D:\<project>-benchmark-v1\
  - Sam (Product Designer) → D:\<project>-benchmark-v1\design\
  - Alex (Backend Engineer) → D:\<project>-benchmark-v1\backend\
  - Jordan (Frontend Engineer) → D:\<project>-benchmark-v1\frontend\

Starting iteration 1...
========================================
```

Then immediately proceed to Step 2 (do NOT wait for user confirmation — this is full auto).

## Step 2: Start benchmark

### 2a. Create fresh directories

For iteration N, create a brand new directory tree:

```bash
ITER_DIR="D:\<project-name>-benchmark-v<N>"
mkdir -p "$ITER_DIR"
# Create subdirectories for each agent that has a subdir
mkdir -p "$ITER_DIR/design"
mkdir -p "$ITER_DIR/backend"
mkdir -p "$ITER_DIR/frontend"
```

Also delete the hub-state.json for the team if it exists:
`~/.vibehq/teams/<team-name>/hub-state.json`

### 2b. Start the hub

```bash
node dist/bin/hub.js --port <hubPort> --team <team-name> &
```

Run with `run_in_background: true`. Wait 3 seconds for startup.

### 2c. Spawn agents

Write a Node.js spawn script to `/tmp/vibehq-loop-spawn.js` that reads the config from loop-state and spawns all agents. The script should:

1. Read loop-state.json to get team config, iteration dir, hub port
2. For each agent, build the spawn command with these flags:
   - `--name`, `--role`, `--team`, `--hub ws://localhost:<port>`
   - `--skip-permissions` — benchmark mode, no human approval
   - `--auto-kickstart` — **CRITICAL**: auto-injects initial prompt after 8s so agents start working immediately
   - `--system-prompt-file` (if applicable)
3. **Platform-specific terminal management:**

   **Windows**: Write a `.cmd` launcher file per agent:
   ```
   @echo off
   chcp 65001 >nul
   set CLAUDECODE=
   cd /d "<agent-cwd>"
   vibehq-spawn --name "<name>" --role "<role>" --team "<team>" --hub "ws://localhost:<port>" --skip-permissions --auto-kickstart [--system-prompt-file "<path>"] -- claude
   pause
   ```
   Launch with: `wt -w new --title "<name>" cmd /k "<launcher-path>"`

   **macOS/Linux**: Use **tmux** to manage all agents in one session:
   ```javascript
   const sessionName = `vibehq-${team}`;
   // Kill existing session if any
   try { execSync(`tmux kill-session -t "${sessionName}" 2>/dev/null`); } catch {}

   // First agent: create new session
   execSync(`tmux new-session -d -s "${sessionName}" -n "${agent.name}" "${spawnCmd}"`);
   // Subsequent agents: new window in same session
   execSync(`tmux new-window -t "${sessionName}" -n "${agent.name}" "${spawnCmd}"`);

   // After all agents: join windows into tiled panes
   for (let w = agents.length - 1; w >= 1; w--) {
     execSync(`tmux join-pane -s "${sessionName}:${w}" -t "${sessionName}:0" -h`);
   }
   execSync(`tmux select-layout -t "${sessionName}:0" tiled`);
   ```
   On macOS/Linux, set `CLAUDECODE=` in the spawn command (env var prefix).

4. Wait 3 seconds between each agent spawn

**CRITICAL**: The `.cmd` files must use Windows syntax (`>nul` not `>/dev/null`, `\r\n` line endings). Use Node.js `fs.writeFileSync()` and `child_process.exec()` — do NOT use bash heredocs to write .cmd files.

**CRITICAL**: Include `set CLAUDECODE=` in every launcher (Windows .cmd) or as env prefix (macOS/Linux) to clear the env var that prevents nested Claude Code sessions.

**CRITICAL**: Always include `--auto-kickstart` — without it, agents spawn but sit idle waiting for manual input.

Run the spawn script:
```bash
node /tmp/vibehq-loop-spawn.js
```

After spawning, print the tmux attach command (macOS/Linux):
```
tmux attach -t <sessionName>    # to view agents
tmux kill-session -t <sessionName>  # to stop all
```

### 2d. Update loop state

Set `phase: "benchmarking"`, save loop-state.json.

## Step 3: Wait for completion

Poll `~/.vibehq/teams/<team-name>/hub-state.json` every 30 seconds.

**Completion check logic:**
- If hub-state.json doesn't exist AND less than 3 minutes passed → keep waiting (agents still loading)
- If hub-state.json doesn't exist AND more than 5 minutes passed → something's wrong, alert user
- Count tasks: if ALL tasks have status `"done"` or `"rejected"` → **COMPLETE**
- If any task is still active → keep waiting

Write a poll script to `/tmp/vibehq-loop-poll.js`:
```javascript
const fs = require('fs');
const path = require('path');
const home = process.env.USERPROFILE || process.env.HOME;
const team = process.argv[2] || 'default';
const statePath = path.join(home, '.vibehq', 'teams', team, 'hub-state.json');

if (!fs.existsSync(statePath)) {
  console.log('NO_STATE');
  process.exit(0);
}

const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
const tasks = Object.values(state.tasks || {});
const total = tasks.length;
const done = tasks.filter(t => t.status === 'done' || t.status === 'rejected').length;
const agents = Object.values(state.agents || {});

console.log('Agents: ' + agents.map(a => a.name + '(' + a.status + ')').join(', '));
console.log('Tasks: ' + done + '/' + total);

for (const t of tasks) {
  const icon = t.status === 'done' ? 'v' : t.status === 'in_progress' ? '>' : t.status === 'rejected' ? 'x' : '.';
  console.log('  [' + icon + '] ' + t.title + ' -> ' + t.status + ' (' + (t.assignee || 'unassigned') + ')');
}

if (total > 0 && done === total) console.log('\nCOMPLETE');
else if (total === 0) console.log('\nNO_TASKS');
else console.log('\nWAITING');
```

Use: `node /tmp/vibehq-loop-poll.js <team-name>`

**Polling pattern**: Use `sleep 30 && node /tmp/vibehq-loop-poll.js <team>` with a 60s timeout. Repeat until COMPLETE or 20 minutes elapsed.

**Timeout**: If waiting > 20 minutes, stop and proceed to analysis. Benchmark is likely stuck.

## Step 4: Analyze results

### 4a. Run static analysis (no LLM API)

First, find the agent JSONL log files. They are in `~/.claude/projects/` under directories matching the agent working directories (path separators replaced with `-`). Read `~/.vibehq/teams/<team-name>/agent-logs.json` to find recorded log paths.

Run the analyzer in static mode (no `--with-llm`):
```bash
node dist/bin/analyze.js <log1.jsonl> <log2.jsonl> ... --team <team-name> --save --run-id <project-name>-v<N>
```

### 4b. Direct analysis by Claude Code

**Do NOT call external LLM APIs.** Instead, read the analysis outputs and hub-state directly, then produce the report card yourself:

1. Read `~/.vibehq/analytics/runs/<project-name>-v<N>/run_metrics.json` — durations, tokens, per-agent stats, utilization
2. Read `~/.vibehq/analytics/runs/<project-name>-v<N>/detected_flags.json` — flag counts and details
3. Read `~/.vibehq/teams/<team-name>/hub-state.json` — task details, team updates, artifacts
4. Check actual code output: `find <iterationDir> -name "*.ts" -o -name "*.tsx" | grep -v node_modules` and `wc -l`

Evaluate on 4 dimensions (each 0-100):
- **Coordination** (weight 30%): PM stayed pure coordinator? Tasks routed correctly? Contract sign-offs used? Workload balanced?
- **Parallelism** (weight 25%): Per-agent utilization? Overall parallel efficiency? Any agents idle?
- **Output Quality** (weight 25%): LOC produced? Files count? Does it build? Architecture completeness?
- **Cost Efficiency** (weight 20%): Total cost? PM cost as % of total? Token waste (ToolSearch overhead, context bloat)?

Grade scale: A (90+), A- (85-89), B+ (80-84), B (75-79), B- (70-74), C+ (65-69), C (60-64), D (50-59), F (<50)

### 4c. Write report card

Save to `~/.vibehq/analytics/runs/<project-name>-v<N>/report_card.json` with this structure:
```json
{
  "overall_grade": "<grade>",
  "score": <0-100>,
  "analyzedBy": "claude-code-direct",
  "grade_reasoning": "<summary>",
  "coordination_assessment": { ... },
  "output_assessment": { "total_loc": N, "total_files": N, "frontend_builds": bool, ... },
  "token_assessment": { ... },
  "per_agent_scores": [ { "agent_id": "...", "score": N, "strengths": [...], "issues": [...] } ],
  "improvement_suggestions": [ { "priority": "P1|P2|P3", "target": "framework|orchestrator_prompt|analyzer_bug", "suggestion": "...", "expected_impact": "..." } ],
  "fix_actions": [ { "priority": "P1|P2|P3", "target_file": "...", "action": "modify|fix|add", "description": "...", "detection_rule": "..." } ]
}
```

### 4d. Update loop state

Add this iteration to the history array and set `phase: "analyzed"`.

### 4e. Report

```
========================================
Iteration <N> complete
Grade: <grade>  |  Score: <score>/100
Duration: <time>  |  Tasks: <done>/<total>  |  Cost: $<cost>
Parallel Efficiency: <value>%  |  LOC: <loc>  |  Files: <files>

Flags: C:<n> H:<n> M:<n> L:<n>
Top issues:
  - <issue 1>
  - <issue 2>

History:
  v1: B+ (9m, $35, 57% eff)
  → v<N>: <grade> (<time>, $<cost>, <eff>% eff)
========================================
```

## Step 5: Check stop conditions

| Condition | Action |
|-----------|--------|
| Grade >= targetGrade | **SUCCESS** — target reached |
| 2 consecutive iterations with no grade improvement | **PLATEAU** — incremental fixes aren't working |
| Grade dropped for 2 consecutive iterations | **REGRESSION** — stop and alert user |
| currentIteration >= maxIterations | **LIMIT** — safety cap reached |
| Previous optimize produced 0 code changes | **EXHAUSTED** — nothing left to fix |

If stopping:
1. Set `phase: "completed"` in loop-state
2. Print final summary with full history
3. Exit

If continuing, proceed to Step 6.

## Step 6: Optimize

### 6a. Kill benchmark processes

**Windows:**
```bash
wmic process where "commandline like '%vibehq-spawn%'" call terminate 2>/dev/null
wmic process where "commandline like '%hub.js%--port <hubPort>%'" call terminate 2>/dev/null
```

**macOS/Linux:**
```bash
tmux kill-session -t vibehq-<team-name> 2>/dev/null
pkill -f 'vibehq-spawn' 2>/dev/null
pkill -f 'hub.js.*<hubPort>' 2>/dev/null
```

### 6b. Run /optimize-protocol

Set `phase: "optimizing"` in loop-state.

**Option A (preferred): Inline optimization**
Read and follow `.claude/skills/optimize-protocol/SKILL.md` with run-id `<project-name>-v<N>`.

**Option B (fallback): If context is getting large (>50% window)**
Save state, tell user to run `/optimize-protocol <project-name>-v<N>` then `/benchmark-loop` to resume.

### 6c. Rebuild

```bash
npx tsup
```

Must succeed. Fix any build errors before continuing.

### 6d. Update loop state

Increment `currentIteration`, update `team` to include new iteration number (e.g., `<baseTeam>-v<N+1>`), update `iterationDir`, set `phase: "benchmarking"`, save loop-state.

## Step 7: Next iteration

Go back to Step 2.

## Important rules

1. **Always save loop-state before and after each major step.** If context compresses, the next session can resume.
2. **Read loop-state.json at the START of every major step.** Context compaction may erase memory.
3. **Do NOT skip analysis.** Always run full analysis for proper metrics.
4. **One iteration at a time.** No parallel benchmarks.
5. **Fresh hub-state per iteration.** Delete old hub-state.json before starting.
6. **Be patient.** Agents need 8-15 minutes typically.
7. **If context is large, prefer Option B in Step 6b.**
8. **The spawn script MUST use Node.js** to write .cmd files — never use bash heredocs for Windows batch files.
9. **Always include `set CLAUDECODE=`** in launcher .cmd files.
10. **CRITICAL: Each iteration MUST use a unique team name** (e.g., `project-benchmark-v1`, `project-benchmark-v2`). This ensures fresh hub state, shared files, and MCP server names. Never reuse a team name across iterations — agents will see stale tasks/artifacts from previous runs.

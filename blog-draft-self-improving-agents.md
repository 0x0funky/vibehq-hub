# Self-Improving Multi-Agent Coordination: How We Went from Grade D to B in 4 Automated Iterations

*Building a system where AI agents analyze their own teamwork failures and write code to fix them — then prove it works.*

---

## The Promise and the Problem

Multi-agent AI coordination sounds great in theory: give each agent a role — PM, designer, backend engineer, frontend engineer — point them at a project, and watch them build it together.

In practice, it's chaos.

We built [VibHQ](https://github.com/anthropics/vibehq), an open-source protocol for coordinating CLI coding agents (Claude Code, Codex CLI, Gemini CLI). When we first ran a 4-agent team on a simple Todo app benchmark, here's what happened:

- The PM started writing code instead of coordinating
- One agent spent 34 turns producing literally nothing
- The hub falsely declared agents "unresponsive" 60 seconds after boot — before they even finished loading
- Phantom tasks appeared in the tracking system, making it look like half the work was never completed
- It took **47 minutes** to build what should have taken 10

**Grade: D.**

The question wasn't "how do we manually tune this?" It was: **can we build a system that automatically diagnoses and fixes its own coordination failures?**

---

## The Analyze → Optimize → Benchmark Loop

We built a three-stage self-improvement loop:

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Benchmark   │────▶│  vibehq-analyze   │────▶│ /optimize-protocol│
│  (run team)  │     │  --with-llm       │     │   (skill)         │
└─────────────┘     └──────────────────┘     └───────────────────┘
       ▲                                              │
       │              writes code changes             │
       └──────────────────────────────────────────────┘
```

**Stage 1: Benchmark** — Run the same 4-agent team (PM, Designer, Backend, Frontend) on the same Todo app spec. Collect JSONL logs from every agent.

**Stage 2: Analyze** — `vibehq-analyze --team <name> --with-llm --save` parses all logs, extracts metrics (turns, tokens, task lifecycles, artifact sizes), runs 13 detection rules (role drift, stub files, context bloat, etc.), then sends everything to an LLM for a comprehensive report card with grades, per-agent scores, and specific `fix_actions` referencing actual source files and parameters.

**Stage 3: Optimize** — This is where it gets interesting. `/optimize-protocol` is a Claude Code skill — a structured prompt that turns Claude into a framework engineer. It reads the analysis data, loads all previous optimization reports for cross-run trend analysis, identifies root causes (not symptoms), then **writes and ships real code changes** to the VibHQ framework.

Not parameter tuning. Actual engineering. New validation middleware, CLI-level tool enforcement, metrics pipeline fixes.

Then we run the benchmark again and measure the delta.

---

## The Four Iterations

### Iteration 1: The Baseline Disaster (Grade D)

**Benchmark v1** — Codex as PM, Claude as workers. 4 agents, Todo app.

| Metric | Value |
|--------|-------|
| Duration | 47 minutes |
| Parallel Efficiency | 0.18 (effectively serial) |
| Flags | 13 (1 critical, 5 high) |
| Grade | **D** |

The analysis revealed five systemic problems:

**1. False death alerts.** The hub's heartbeat timeout was 60 seconds. Agents take 30-90 seconds just to boot (MCP handshake, system prompt injection, model warm-up). The hub was declaring agents dead before they even started, triggering a cascade of unnecessary task reassignments.

**2. Orchestrator role drift.** Emma (PM) used `shell_command` 4 times — directly running terminal commands instead of delegating to engineers. The PM role preset said "don't write code," but there was no enforcement mechanism.

**3. Phantom tasks.** The Codex log parser was creating synthetic task entries from MCP `create_task` call content. These `pending_*` tasks duplicated real hub-tracked UUID tasks but never completed, making it look like 4 tasks were stuck.

**4. Zero-output agent.** Sam (Product Designer) spent 34 turns and produced exactly zero artifacts. The role preset didn't require publishing a deliverable before marking a task complete.

**5. Context bloat everywhere.** All 4 agents exceeded the 3x context growth threshold. Emma's context grew 7x, partly from shell command output flooding her window.

**What `/optimize-protocol` built:**
- `STARTUP_GRACE_MS = 180_000` — 3-minute grace period after hub start where no unresponsive checks run
- `HEARTBEAT_TIMEOUT` 60s → 120s
- `ORCHESTRATOR_TOOL_CONSTRAINT` — system prompt injection forbidding shell commands for PM roles
- Phantom task deduplication in the metrics extractor
- Updated Designer and PM role presets requiring artifact publication and banning shell access
- Proactive task status notifications (hub pushes instead of PM polling)

---

### Iteration 2: The Codex Discovery (Grade C)

**Benchmark v2** — Same setup but with all v1 fixes applied.

| Metric | v1 | v2 | Delta |
|--------|----|----|-------|
| Duration | 47m | 13m | **-72%** |
| Parallel Efficiency | 0.18 | 0.64 | **+255%** |
| Flags | 13 | 9 | **-31%** |
| Sam artifacts | 0 | 14,760B design spec | **Fixed** |
| False unresponsive | yes | no | **Fixed** |
| Grade | D | **C** | **+1** |

Massive improvement. But the analysis found something alarming:

**Emma's `shell_command` usage went from 4 to 42.**

The v1 fix added a prompt-level constraint telling the PM not to use shell commands. Codex simply ignored it. The prompt said "don't"; Codex said "I will anyway."

This led to the key architectural insight of the entire project:

> **Codex CLI has no `--disallowedTools` flag.** There is no way to prevent a Codex agent from calling `shell_command`. You can ask nicely in the prompt. You can use `--sandbox read-only` to limit damage. But you cannot block the tool invocation itself.
>
> Claude CLI supports `--disallowedTools` — a CLI-level flag that physically prevents the agent from calling specified tools, regardless of what the prompt says.
>
> **This isn't a prompt engineering problem. It's a CLI capability gap.**

**What `/optimize-protocol` built:**
- `--disallowedTools Bash Write Edit Read NotebookEdit` injection for Claude orchestrators in the spawner
- `--sandbox read-only` fallback for Codex orchestrators, with a stderr warning recommending Claude for PM roles
- New benchmark v3 config using Claude (not Codex) as PM
- Updated the analyzer's framework context so future analysis runs understand the new enforcement mechanism

The recommendation was clear: **use Claude for orchestrator roles, Codex for worker roles.** Not because one model is "better" — because the CLI tooling determines what constraints you can enforce.

---

### Iteration 3: The Agent Adaptation (Grade C)

**Benchmark v3** — Claude as PM with `--disallowedTools` enforcement.

| Metric | v2 | v3 | Delta |
|--------|----|----|-------|
| Duration | 13m | 10.3m | **-21%** |
| Parallel Efficiency | 0.64 | 0.88 | **+38%** |
| ORCHESTRATOR_ROLE_DRIFT | 1 | **0** | **Fixed!** |
| INCOMPLETE_TASK | 3 | **0** | **Fixed!** |
| Emma shell_command | 42 | **0** | **Fixed!** |
| Grade | C | C | same |

`--disallowedTools` worked perfectly. Emma's `implementationToolUsed` was `false` for the first time. Zero shell commands. Zero file writes. Pure coordination.

But the grade didn't improve. Why?

**Two new critical problems appeared:**

**1. Artifact regression to 0 bytes.** Alex published `todo-design-spec.md` (7,820 bytes) and `todo-api-spec.md` (7,193 bytes) successfully on the first attempt. Then on the second attempt, both files were overwritten with empty content — 0 bytes. The framework's regression check (`newSize < previousSize * 0.2`) should have caught this, but there was no check for `contentSize === 0` specifically.

**2. PM monitoring via Glob.** Blocked from using Bash/Write/Edit/Read, Emma adapted. She discovered that `Glob` (file pattern search) and `Read` weren't in the disallowed list. She used Glob **48 times** and Read 8 times to scan project directories — essentially monitoring what workers were doing by browsing their files. A softer form of role drift, burning 211 turns and causing 6.62x context bloat.

This was the most fascinating finding: **agents route around constraints.** Block the highway, they find the side streets. This isn't a bug — it's emergent behavior. The fix has to be architectural: block *all* file access tools, not just the obvious ones.

**What `/optimize-protocol` built:**
- Hard 0-byte content rejection in both `share_file` and `publish_artifact` — empty content is now rejected at the MCP tool level before any file I/O
- Expanded `--disallowedTools` to include `Glob`, `Grep`, `ToolSearch` — PM now physically cannot browse the filesystem
- Ghost agent filtering in metrics extractor (empty agentId entries dropped)
- Anti-polling rules added to PM role preset

---

### Iteration 4: Grade B (finally)

**Benchmark v4** — All v3 fixes applied.

| Metric | v1 (baseline) | v4 (final) | Improvement |
|--------|--------------|------------|-------------|
| **Grade** | D | **B** | **+2 grades** |
| **Duration** | 47 min | **9.4 min** | **5x faster** |
| **Flags Total** | 13 | **7** | **-46%** |
| **Flags Critical** | 1 | **0** | **eliminated** |
| **ARTIFACT_REGRESSION** | 0 → 2 (v3) | **0** | **fixed** |
| **ORCHESTRATOR_ROLE_DRIFT** | 1 | **0** | **fixed** |
| **INCOMPLETE_TASK** | 4 | **0** | **fixed** |
| **Artifacts quality** | stubs + 0B | **all >500B** | **all valid** |

The 0-byte rejection worked. All 6 artifacts published successfully with real content (design-spec 15,376B, api-spec 9,812B, etc.). No regressions. No stubs.

Zero critical flags for the first time in the project's history.

Agent scores: Alex 92, Sam 90, Emma 78, Jordan 55. The system works.

Remaining issues (Emma's polling, Jordan's artifact registration) are optimization-tier problems, not coordination failures. The fundamental architecture is sound.

---

## The Numbers Tell the Story

```
                v1          v2          v3          v4
Grade:          D           C           C           B
Duration:       47m         13m         10.3m       9.4m
Flags:          13          9           11          7
Critical:       1           1           2           0
Efficiency:     0.18        0.64        0.88        0.51
Tokens:         7.2M        3.9M        14.6M       15.0M

                ████████████████████████████████████████
     v1 ████    |←———— 47 minutes ————→|
     v2 █████████████  13m
     v3 ██████████████████  10.3m
     v4 ████████████████████  9.4m (but Grade B!)
```

---

## What We Learned

### 1. Prompt constraints are suggestions; CLI enforcement is law

The PM role preset said "NEVER use shell commands." Codex used it 42 times. Claude's `--disallowedTools` flag made it physically impossible. The lesson: if a behavior must be prevented, enforce it at the infrastructure level, not the prompt level.

### 2. Agents adapt to constraints

Block Bash → they use Glob. Block shell_command → they find Read. This isn't malicious — it's an agent trying to accomplish what it thinks is its job. The implication: your constraint surface must be comprehensive, not targeted.

### 3. Every fix creates new problems

| Fix | Intended effect | Side effect |
|-----|----------------|-------------|
| Startup grace period | No false death alerts | ✓ Worked cleanly |
| Prompt-level tool ban | PM stops writing code | PM ignores it (Codex) |
| `--disallowedTools` | PM physically can't use tools | PM uses Glob instead |
| Expanded disallowed list | PM can't browse files | PM polls MCP 28 times |

The self-improvement loop catches these cascading effects because it compares across all previous iterations, not just the latest run.

### 4. The analyze → optimize loop genuinely works

This isn't a marketing claim. The `/optimize-protocol` skill:
- Read analysis data from 4 benchmark runs
- Built cross-run trend tables identifying regressions vs new problems vs side-effects
- Wrote real code: content validation middleware, CLI flag injection, metrics pipeline fixes, role preset updates
- Verified builds pass after each change
- Saved detailed changelogs for every iteration

The system debugged itself across 4 iterations with minimal human intervention. The human's job was to run the benchmarks and say "go."

### 5. CLI architecture matters more than model choice

We didn't improve from D to B by switching to a better model. We improved by:
- Choosing the right CLI for the right role (Claude for orchestrators, because `--disallowedTools`)
- Adding validation at the MCP tool layer (0-byte rejection)
- Fixing the metrics pipeline (ghost agents, phantom tasks)
- Updating role presets based on observed behavior patterns

The model was Claude Opus 4.6 throughout. The improvements were entirely in the coordination framework.

---

## The `/optimize-protocol` Skill

The heart of the self-improvement loop is a Claude Code skill — a structured prompt (~200 lines) that turns Claude into a framework engineer. Here's what it does:

**Step 1: Load all data** — Current run's report card, metrics, and flags. Plus all previous optimization reports and benchmark data for trend analysis.

**Step 2: Cross-run trend analysis** — Before looking at any single problem, build a trend table across all iterations. Classify each issue as NEW, RECURRING, or SIDE-EFFECT of a previous fix.

**Step 3: Root cause analysis** — Not "what flag fired" but "why does this class of failure exist in the framework's architecture?"

**Step 4: Plan and implement** — Real TypeScript code changes. New validation, new enforcement mechanisms, updated prompts.

**Step 5: Build verification** — `npx tsup` must pass.

**Step 6: Update analyzer context** — The analyzer's system prompt and framework context are updated so future analysis runs understand the new mechanisms. The loop is self-aware.

**Step 7: Save changelog** — Every optimization writes a detailed Markdown report to `~/.vibehq/analytics/optimizations/` with problems, fixes, cross-run context, and metrics trends. This is how the system maintains institutional memory across iterations.

The key design principle: **fix the system, not the symptom.** If agents keep publishing empty files, the answer isn't "detect empty files better" — it's "make empty files impossible to publish."

---

## Try It Yourself

VibHQ is open source. The full optimization loop:

```bash
# 1. Run a benchmark
vibehq start --team your-team-name

# 2. Analyze the run
vibehq-analyze --team your-team-name --with-llm --save --run-id v1

# 3. Auto-optimize (Claude Code skill)
/optimize-protocol v1

# 4. Run again, compare
vibehq start --team your-team-name
vibehq-analyze --team your-team-name --with-llm --save --run-id v2
vibehq-analyze compare v1 v2

# 5. Repeat
/optimize-protocol v2
```

Every run gets faster. Every iteration finds smaller problems. The system learns.

---

## What's Next

We stopped at Grade B because the remaining issues (PM polling behavior, agent artifact registration edge cases) are diminishing returns for the blog narrative. But the loop continues.

The big unsolved problems:
- **Context bloat** — persistent across all 4 iterations for the PM agent. Needs architectural context management (auto-summarization, message pruning)
- **Premature task acceptance** — agents accept tasks within 3-7 seconds, potentially before reading required specs. Needs a review gate.
- **PM polling** — despite anti-polling prompt rules, Emma still calls `check_status` 28 times. May need rate limiting at the MCP tool level.

Each of these is a `/optimize-protocol` run away from a fix.

---

*VibHQ is an open-source multi-agent coordination protocol. Star us on [GitHub](https://github.com/anthropics/vibehq).*

*All benchmark data, optimization changelogs, and analysis reports referenced in this post are available in the repository under `~/.vibehq/analytics/`.*

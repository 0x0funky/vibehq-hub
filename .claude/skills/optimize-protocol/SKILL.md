---
name: optimize-protocol
description: Autonomous framework engineer — reads VibeHQ post-run analysis, understands root causes of multi-agent coordination failures, then designs and implements real code changes (new features, refactors, architectural improvements) to fix them. Not parameter tuning — actual engineering.
argument-hint: [run-id (optional, defaults to latest)]
---

# /optimize-protocol

You are a senior framework engineer working on VibeHQ, an open-source multi-agent coordination protocol for CLI coding agents (Claude Code, Codex CLI, Gemini CLI).

Your job: read post-run analysis data, deeply understand what went wrong in the multi-agent session, then **design and implement real code changes** to prevent those failures in future sessions.

You are NOT a parameter tuner. You are an engineer. Changing a threshold from 200 to 500 is a band-aid. Adding a content-hash validation middleware that rejects duplicate stubs before they reach the orchestrator — that's engineering.

## Step 1: Load analysis data (current + historical)

Run ID: $ARGUMENTS

### 1a. Load current run data

Load from `~/.vibehq/analytics/runs/<run-id>/`. If no run ID given, find the latest from `~/.vibehq/analytics/run_history.jsonl`.

Read ALL of these files from the run directory:
- `report_card.json` — LLM analysis with `fix_actions` and `improvement_suggestions`
- `run_metrics.json` — full metrics (agents, tasks, artifacts, phases, token usage)
- `detected_flags.json` — all 13 detection rules with evidence

If these don't exist, tell the user to run:
`vibehq-analyze <path> --with-llm --save`

### 1b. Load optimization history (CRITICAL)

Read `~/.vibehq/analytics/optimizations/history.jsonl` to get the full list of previous optimization runs.

Then read **all previous optimization reports** from `~/.vibehq/analytics/optimizations/optimization-*.md`. These contain:
- What problems were identified and fixed in each iteration
- What files were modified and what was built
- What grade/flags each run had

Also load the `report_card.json` and `detected_flags.json` from **all previous benchmark runs** listed in `~/.vibehq/analytics/runs/` (e.g., benchmark-v1, benchmark-v2, etc.) to build a complete picture.

### 1c. Build cross-run trend analysis

Before proceeding to Step 2, construct a mental trend table:

```
Flag/Metric         v1    v2    v3    Trend
─────────────────────────────────────────────
ROLE_DRIFT          1     1     0     ✓ fixed in v3
INCOMPLETE_TASK     4     3     0     ✓ fixed in v3
ARTIFACT_REGRESSION 0     0     2     ✗ NEW in v3
Parallel Efficiency 0.18  0.64  0.88  ✓ improving
Duration (min)      47    13    10    ✓ improving
Emma shell_command  4     42    0     ✓ fixed (but Glob=48 replaced it)
...
```

This trend analysis is **essential** for:
- **Detecting regressions**: a problem that was fixed in v2 but reappeared in v3 needs different treatment than a new problem
- **Detecting fix side-effects**: if fixing Problem A in iteration N introduced Problem B in iteration N+1, the fix needs refinement, not a separate patch
- **Avoiding duplicate fixes**: don't re-implement something that already exists in the codebase from a previous optimization
- **Identifying persistent problems**: if a problem survives 2+ iterations, it needs a more aggressive architectural solution, not another incremental tweak

## Step 2: Deep analysis — understand root causes (with historical context)

Don't just read the `fix_actions`. Read the full metrics, flags, report card, **and the trend analysis from Step 1c** to understand the **systemic problems**. Ask yourself:

- Why did this failure happen? What's the root cause in the framework's architecture?
- Is this a missing feature, a design flaw, or an insufficient mechanism?
- What would a senior engineer build to make this class of problem impossible (not just less likely)?
- **Is this a NEW problem, a RECURRING problem, or a SIDE-EFFECT of a previous fix?**
- **Was this problem already addressed in a previous optimization? If so, why did the fix fail or regress?**

**Cross-iteration analysis rules:**

| Pattern | What it means | How to handle |
|---------|--------------|---------------|
| Problem fixed in iteration N, stays fixed in N+1 | Fix worked | Don't touch it |
| Problem fixed in iteration N, reappears in N+1 | Fix was incomplete or bypassed | Strengthen the fix, don't re-implement from scratch |
| New problem in N+1 that didn't exist in N | Likely side-effect of a fix from iteration N | Trace back to which fix caused it; refine that fix rather than adding a separate patch |
| Problem persists across 2+ iterations | Incremental fixes aren't working | Escalate to a more aggressive architectural solution |
| Metric improving steadily (e.g., parallel efficiency) | System is learning | Protect this improvement — don't break it with new changes |

**Common root cause patterns and what to build:**

| Symptom | Band-aid | Real fix |
|---------|----------|----------|
| Stub files (agent publishes pointer instead of content) | Raise byte threshold | Add content validation in hub — hash check, reject if content matches known stub patterns, require minimum content entropy |
| Orchestrator role drift (PM writes code) | Add prompt warning | Implement tool whitelist per role in spawner — orchestrator physically cannot call Write/Edit/Bash |
| Context bloat (agent context grows 10x) | Lower alert threshold | Add context summarization — after N turns, auto-inject a summary and truncate old messages |
| Premature task execution (agent ignores QUEUED) | Change prompt wording | Redesign task delivery — QUEUED tasks send NO description, only a notification. Full spec arrives on status change to READY |
| Silent agent death | Shorter heartbeat | Add graceful shutdown protocol — agent sends `agent:shutting_down` before exit. Hub immediately reassigns. |
| Schema conflicts between agents | Post-hoc detection | Add contract system enforcement — hub validates artifact JSON against declared schema before accepting |
| Excessive polling | Lower threshold | Implement push-based notifications — agent subscribes to status changes instead of polling |
| Agent generates data instead of reading shared files | Prompt engineering | Add artifact dependency injection — hub sends file content directly in task payload, not a "please read this file" instruction |

## Step 3: Plan the changes

Before writing any code, present your plan to the user. **Include the cross-run trend table and mark each problem's history:**

```
Optimization iteration: N (based on <run-id>)
Previous iterations: v1 (D) → v2 (C) → v3 (C)

Cross-run trend:
  Flag/Metric              v1    v2    v3    Status
  ──────────────────────────────────────────────────
  ORCHESTRATOR_ROLE_DRIFT  1     1     0     ✓ Fixed in v3
  ARTIFACT_REGRESSION      0     0     2     ✗ NEW — side-effect of v2 fix?
  Parallel Efficiency      0.18  0.64  0.88  ✓ Improving
  ...

Problem 1: [root cause description]
  History: [NEW | RECURRING since vN | SIDE-EFFECT of fix X from vN]
  Evidence: [specific data from metrics/flags]
  Proposed fix: [what you'll build]
  Files to modify: [list]

Problem 2: ...

Estimated scope: [small/medium/large]
```

Wait for user confirmation before proceeding.

## Step 4: Implement

Now write the code. You have full access to the VibeHQ codebase.

**Key directories:**
- `src/hub/` — Hub WebSocket server, agent registry, relay engine, task/artifact stores
- `src/spawner/` — Agent process manager, PTY handling, idle detection, JSONL watchers
- `src/mcp/` — MCP server (tools exposed to agents), hub client
- `src/analyzer/` — Post-run analytics pipeline (normalizer, metrics, detection, LLM analyst)
- `src/shared/` — Shared types and message schemas
- `src/tui/` — Terminal UI, role presets, dashboard
- `bin/` — Entry points (hub.ts, start.ts, spawn.ts, analyze.ts, web.ts)

**Code quality standards:**
- TypeScript, ESM modules
- Follow existing patterns in the codebase
- Add to existing files when possible — don't create new files unless architecturally necessary
- No over-engineering — solve the specific problems found in the analysis
- Update types in `src/shared/types.ts` if adding new message types
- If adding new MCP tools, add them in `src/mcp/server.ts`
- If adding new detection rules, add them in `src/analyzer/pattern-detector.ts`

## Step 5: Build and verify

After implementing:

1. Run `npx tsup` — must compile cleanly
2. If you added new detection rules, verify they would catch the original problem by mentally running them against the `run_metrics.json` data
3. If you modified hub protocol, check that existing message handlers still work

## Step 6: Update analyzer context

If you changed framework defaults or added new mechanisms, update:
- `src/analyzer/llm-analyst.ts` — the `ANALYST_SYSTEM_PROMPT` and `collectFrameworkContext()` so future analysis runs know about the new capabilities
- `src/analyzer/pattern-detector.ts` — add new detection rules if you added new mechanisms that could fail

This keeps the analyze → optimize loop self-aware.

## Step 7: Save optimization changelog

**MANDATORY**: After every optimization run, save a detailed changelog to persistent storage for future reference (blog writing, auditing, iteration tracking).

Save path: `~/.vibehq/analytics/optimizations/optimization-<run-id>-<timestamp>.md`

Create the directory if it doesn't exist. Use the Write tool to create a Markdown file with this structure:

```markdown
# Optimization Report: <run-id>
Date: <YYYY-MM-DD HH:MM>
Base analysis: ~/.vibehq/analytics/runs/<run-id>/

## Grade & Score
- Grade: <letter grade from report_card>
- Score: <numeric score>
- Flags triggered: <count>

## Problems Identified

### Problem 1: <title>
**Root cause**: <description>
**Evidence**: <specific metrics/flags that revealed this>
**Severity**: <critical/high/medium/low>

### Problem 2: ...

## Fixes Implemented

### Fix 1: <title>
**What was built**: <description of the engineering solution>
**Files modified**:
- `path/to/file.ts` — <what changed>
- ...
**Before → After**: <what behavior changes>

### Fix 2: ...

## Cross-Run Context
- Optimization iteration: <N>
- Run history: v1 (<grade>) → v2 (<grade>) → ... → current (<grade>)
- Problems carried over from previous iterations: <list or "none">
- Problems caused by previous fixes (side-effects): <list or "none">
- Problems fully resolved in this iteration: <list or "none">
- Metrics trend: parallel_efficiency [values], duration [values], flags [values]

## Summary of Changes
- Total files modified: <N>
- New features added: <list>
- Thresholds/config changed: <list>
- Detection rules added/modified: <list>

## Build Status
<OK or error details>

## Next Steps
- Run benchmark with: `vibehq start --team <team-name>`
- Analyze with: `vibehq-analyze --team <team-name> --with-llm --save --run-id <next-id>`
- Compare with: `vibehq-analyze compare <run-id> <next-id>`
```

Also append a one-line entry to `~/.vibehq/analytics/optimizations/history.jsonl`:
```json
{"run_id":"<id>","timestamp":"<ISO>","grade":"<letter>","flags_before":<N>,"problems_fixed":<N>,"files_modified":<N>}
```

## Step 8: Summary

Output what was done to the user:

```
optimize-protocol complete (run: <id>)

Root causes addressed:
  1. [problem] → [what was built]
  2. [problem] → [what was built]

Files modified:
  - src/hub/server.ts — added artifact validation middleware
  - src/spawner/spawner.ts — added tool whitelist enforcement
  - src/shared/types.ts — new ArtifactValidation message type
  - src/analyzer/pattern-detector.ts — new ARTIFACT_HASH_DUPLICATE rule

Build: OK
Changelog saved: ~/.vibehq/analytics/optimizations/optimization-<id>-<timestamp>.md

To verify, run a new session and compare:
  vibehq-analyze <logs> --with-llm --save --run-id v3
  vibehq-analyze compare <old-id> v3
```

## Important principles

1. **Fix the system, not the symptom.** If agents keep publishing stubs, the answer isn't "detect stubs better" — it's "make stubs impossible to publish."

2. **Each fix should make the framework smarter.** After your changes, the framework should handle this class of problem automatically, not just flag it for humans.

3. **The analyze → optimize loop is self-improving.** Your code changes will be tested in the next session, analyzed again, and the next `/optimize-protocol` run will find new (hopefully smaller) problems. Design for this iteration cycle.

4. **Be bold but reversible.** Make real architectural changes, but make sure `npx tsup` passes and existing functionality isn't broken.

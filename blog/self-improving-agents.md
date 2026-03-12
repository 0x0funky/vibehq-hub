# Self-Improving Multi-Agent Teams: How We Built a Framework That Debugs Itself

*Inspired by Karpathy's "autoresearch" — applied to multi-agent coordination.*

---

## The Problem Nobody Talks About

Running 5 AI agents in parallel is easy. Making them actually work together — without breaking each other's code, duplicating work, or burning millions of tokens on nothing — is the hard part.

We've been building [VibeHQ](https://github.com/0x0funky/vibehq-hub), a coordination protocol for multi-agent CLI teams (Claude Code, Codex, Gemini CLI). After months of watching agents fail in the same predictable ways, we realized something:

**Multi-agent failures are not random. They are systematic, measurable, and fixable — if you have the right feedback loop.**

This post is about how we built that feedback loop, and the real data from running it.

---

## The Inspiration: Karpathy's Autoresearch

Andrej Karpathy's [autoresearch](https://github.com/karpathy/autoresearch) demonstrated a powerful idea: AI systems that evaluate their own output and iteratively improve. The research agent doesn't just generate — it critiques, measures, and refines.

We asked: **What if we applied the same principle to multi-agent teamwork?**

Instead of a single agent improving its research quality, we wanted a *team* of agents improving how they coordinate. The optimization target isn't a paper — it's the protocol itself: the hub, the message routing, the task lifecycle, the artifact validation.

---

## The Self-Improving Loop

This is the core of the system. We built two skills that work together in a fully automated cycle:

```
┌─→ Benchmark (spawn team, run project) ─→ Analyze (extract metrics, detect flags)
│                                                          │
└──── Rebuild (tsup) ←── Optimize (write real code) ←──────┘
```

### `/benchmark-loop` — The Autonomous Runner

This is the fully automated pipeline. One command kicks off the entire cycle:

1. **Spawn** a fresh team with a standardized project (e.g., "Build a Todo app with REST API, React frontend, WebSocket real-time updates")
2. **Wait** for the team to finish — monitoring heartbeats, detecting completion
3. **Analyze** — extract metrics from every agent's session log, run 13 anti-pattern detection rules, LLM grading
4. **Optimize** — trigger `/optimize-protocol` to read the analysis and write code fixes
5. **Rebuild** — compile the framework with the new changes
6. **Repeat** — spawn a new team with the updated framework, run again

Each iteration uses a unique team name (e.g., `todo-benchmark-v1`, `todo-benchmark-v2`) to ensure complete state isolation — no stale tasks, no contaminated artifact stores, no shared MCP server names.

The loop continues until the target grade is reached or max iterations hit. **Zero human intervention required.**

### `/optimize-protocol` — The Framework Engineer

This is the key insight. When `/optimize-protocol` reads the analysis report, **it doesn't adjust prompts or tune parameters. It writes real code:**

- Wrote `McpRateLimiter` class — server-side enforcement limiting polling tools to 5 calls per 60s window, returning cached responses after threshold
- Added `CODE_MIN` enforcement — hard minimum file sizes for code files (.js/.ts ≥500B, .css ≥300B) regardless of stub pattern match
- Built post-completion quiesce — hub sends `ALL_TASKS_COMPLETE` when all agent tasks are done, preventing false "unresponsive" alerts
- Added `--disallowedTools` CLI enforcement — blocks implementation tools (Write/Edit/Bash) for orchestrator roles at the CLI level, not just in the prompt

**Prompt constraints are suggestions. CLI-level enforcement is law.**

An agent can ignore "please don't write code" in a system prompt. It cannot bypass `--disallowedTools Write,Edit,Bash` — the CLI physically rejects those tool calls.

---

## What We Measure

Before we could optimize, we needed to see. We built a post-run analyzer that extracts structured metrics from every team session:

### Per-Run Metrics
- **Token Usage** — total and per-agent, broken down by type (input/output/cache read/cache write)
- **Parallel Efficiency** — what fraction of agents are concurrently active (sampled at 5s intervals)
- **Agent Utilization** — each agent's active time vs. wall clock time
- **Context Bloat** — how much each agent's context window grows during the session
- **Coordination Overhead** — what percentage of tokens go to the orchestrator vs. actual workers

### Detected Anti-Patterns (13 Automated Flags)

We codified the failure modes we kept seeing into detection rules:

| Flag | Severity | What It Catches |
|------|----------|----------------|
| `ORCHESTRATOR_ROLE_DRIFT` | Critical | PM starts writing code instead of coordinating |
| `ARTIFACT_REGRESSION` | Critical | Agent overwrites a 17KB spec with an empty file |
| `STUB_FILE` | High | Agent publishes a 43-byte placeholder instead of real content |
| `CONTEXT_BLOAT` | Medium | Agent's context grows >5x (polling loop) |
| `EXCESSIVE_MCP_POLLING` | Low | Agent calls `check_status` 28 times in one session |
| `PREMATURE_TASK_ACCEPT` | Medium | Agent accepts task in <10s without reading dependencies |
| `DUPLICATE_SHARED_FILE` | Medium | Same content published as `backend/server.js` and `backend-server.js` |
| `NO_ARTIFACTS_PRODUCED` | High | Agent runs many turns but writes zero files |
| `INCOMPLETE_TASK` | High | Task never reached "done" state |
| `TASK_TIMEOUT` | High | Task took >15 minutes |
| `HIGH_COORDINATION_OVERHEAD` | High | PM consumed >30% of total output tokens |
| `AGENT_UNRESPONSIVE` | High | Agent never connected or stopped responding |
| `TASK_REASSIGNED` | Info | Task was reassigned to a different agent (fallback) |

Each flag has a severity level and machine-readable details (agent name, task ID, exact numbers). This isn't a vibe check — it's a structured diagnosis.

---

## The Data

We ran the same benchmark project (Todo App: REST API + React SPA + WebSocket + Design Spec, 4 agents) across 5 iterations with progressive framework improvements.

### Todo App: V1 → V5

| Metric | V1 | V2 | V3 | V4 | V5 |
|--------|----|----|----|----|-----|
| **Total Tokens** | 7.2M | 3.9M | 14.6M | 15.0M | **5.7M** |
| **PM Tokens** | 0.3M | 0.2M | 10.1M | 9.8M | **1.8M** |
| **PM % of Total** | 4% | 5% | 69% | 65% | **32%** |
| **Turns** | 233 | 164 | 326 | 308 | 216 |
| **Duration** | 47min | 13min | 10min | 9min | 14min |
| **Flags** | 4 | 3 | 5 | 3 | **0** |
| **Context Bloat (PM)** | 7.07x | 10.56x | 6.62x | 7.04x | **2.84x** |

### What Happened at Each Version

**V1 → V2** (PM: Codex/GPT-5.4)
- Fixed orchestrator role drift with role presets
- Tokens dropped 46% (7.2M → 3.9M)
- PM was lightweight but kept using `shell_command` to write code — `ORCHESTRATOR_ROLE_DRIFT` critical flag

**V2 → V3** (PM switched to Claude Opus)
- Claude PM is smarter at coordination but more token-hungry
- PM polling exploded: `check_status` 12x, `list_shared_files` 33x
- Tokens tripled to 14.6M — **PM alone consumed 69% of total tokens**
- This is the "naive Claude PM" baseline — the problem the self-improving loop would fix

**V3 → V4** (Manual optimization)
- Added `--disallowedTools` CLI enforcement for PM
- Expanded artifact validation (0-byte content rejection)
- Tokens still high at 15.0M — polling remained unchecked

**V4 → V5** (After self-improving loop learnings)
- `McpRateLimiter` enforced: 5 calls per 60s window, cached responses after
- Post-completion quiesce: agents stop polling after all tasks done
- `CODE_MIN` enforcement: rejects undersized code files
- **Result: 5.7M tokens (62% reduction), zero flags, PM context bloat from 7.04x → 2.84x**

### The Token Curve

```
       23.1M ┤                         ● CQ-V1
             │
       15.0M ┤               ● V3  ● V4
       13.8M ┤                            ● CQ-V2
             │
        7.2M ┤  ● V1
        5.7M ┤                                  ● V5
        3.9M ┤      ● V2
             │
           0 ┼──────────────────────────────────────
             V1   V2   V3   V4  CQ1  CQ2   V5
```

V3/V4 was the "expensive middle" — Claude PM without guardrails. The self-improving loop found and fixed the root cause (polling waste), bringing V5 back to V2-level efficiency but with zero coordination failures.

---

## Classroom Quiz: The Fully Automated Loop in Action

To prove the loop works autonomously on a different project, we ran it on a Classroom Quiz App (real-time quiz platform with WebSocket, 4 agents):

| Metric | V1 (Before) | V2 (After Loop) | Change |
|--------|-------------|-----------------|--------|
| **Total Tokens** | 23.1M | 13.8M | **-40%** |
| **PM Tokens** | ~15.2M | ~1.3M | **-91%** |
| **Turns** | 460 | 353 | -23% |
| **Flags** | 14 | 3 | **-79%** |
| **STUB_FILE** | 8 | 0 | eliminated |
| **DUPLICATE_SHARED_FILE** | 4 | 2 | -50% |
| **Polling Issues** | 1 | 0 | eliminated |
| **Context Bloat (PM)** | 7.87x | 2.84x | -64% |

**What the loop did — automatically, with no human input:**

1. Ran the Classroom Quiz benchmark with 4 agents
2. Analyzed the results: found 14 flags, PM consuming 66% of tokens on polling, 8 stub files
3. `/optimize-protocol` read the analysis and wrote:
   - `McpRateLimiter` class (new file: `src/mcp/rate-limiter.ts`)
   - `CODE_MIN` content validation in `share-file.ts` and `artifact.ts`
   - Post-completion quiesce logic in `hub/server.ts`
4. Rebuilt the framework (`npx tsup`)
5. Ran the benchmark again with the updated framework
6. Result: 40% fewer tokens, 79% fewer flags, stub files eliminated

The entire cycle — benchmark, analyze, write code, rebuild, re-benchmark — ran without human intervention.

---

## Per-Agent Token Distribution: Finding the Bottleneck

### V4 (Before Optimization)
```
emma (PM):     9.8M tokens  ████████████████████████████████  65%
sam (Design):  2.3M tokens  ████████  15%
jordan (FE):   1.7M tokens  █████  11%
alex (BE):     1.2M tokens  ████  8%
```

### V5 (After Optimization)
```
jordan (FE):   2.9M tokens  ████████████████████  51%
emma (PM):     1.8M tokens  ████████████  32%
sam (Design):  0.5M tokens  ███  9%
alex (BE):     0.5M tokens  ███  9%
```

V4's token usage was dominated by the PM doing nothing useful — 28 `check_status` calls, 25 `list_shared_files` calls, context growing to 7.04x. After the rate limiter, the token distribution shifted to the actual workers doing real implementation.

---

## Agent Utilization: Are Your Agents Actually Working?

We track what percentage of wall-clock time each agent is actively working (vs. idle/waiting):

### V5 Agent Utilization
```
alex (BE):     100%  ████████████████████  (1m23s active / 1m23s total)
jordan (FE):    86%  █████████████████  (4m08s / 4m47s)
emma (PM):      35%  ███████  (4m50s / 13m52s)
sam (Design):   28%  █████  (0m44s / 2m38s)
```

Alex and Jordan are highly utilized — they work and stop. Emma (PM) has 35% utilization because coordination inherently involves waiting for others. Sam finishes the design spec fast and then idles. This is expected behavior for a well-functioning team — not everyone needs to be 100% utilized.

---

## What We Learned

### 1. Multi-agent failures are predictable and measurable

We found the same failure patterns across different projects, different team sizes, and different models. They're not bugs — they're emergent behaviors of LLMs working in a shared environment. Once you instrument them, you can fix them.

### 2. Prompts are not enough

The most important lesson: **prompt-level constraints get ignored under pressure**. When an agent's context fills up and it's trying to complete a task, it will drift from its role, skip validation steps, and publish stubs.

The fixes that actually worked were all architectural:
- Rate limiter (server-side enforcement, not "please don't poll")
- `--disallowedTools` (CLI-level, physically impossible to bypass)
- `CODE_MIN` (middleware rejection, not "please write full files")
- Post-completion quiesce (hub-level, not "please stop working")

### 3. The orchestrator is usually the bottleneck

Across every benchmark, the PM/orchestrator consumed 60-70% of total tokens. The fix wasn't switching to a smaller model — it was making the PM *do less unnecessary work* through rate limiting, proactive notifications, and quiesce signals.

### 4. Self-improvement needs engineering, not tuning

The `/optimize-protocol` skill doesn't tweak numbers. It reads the analysis, understands root causes, and writes new code: new middleware classes, new validation logic, new protocol features. This is the difference between "set temperature to 0.7" and "write a rate limiter class that returns cached responses after 5 calls in 60 seconds."

### 5. The loop compounds

Each iteration doesn't just fix one thing — it creates the conditions for the next improvement to be visible. Once polling is fixed, you can see the real coordination patterns. Once stubs are rejected, you can measure actual artifact quality. The self-improving loop is a ratchet, not a wheel.

---

## The Architecture

```
┌─────────────────────────────────────────────────────┐
│                    VibHQ Hub                         │
│  ┌──────────┐  ┌───────────┐  ┌─────────────────┐  │
│  │ Task Mgr │  │ Artifact  │  │  Rate Limiter   │  │
│  │ (CRUD +  │  │ Store +   │  │ (5/60s window,  │  │
│  │ depends) │  │ Validator │  │  cached resp.)  │  │
│  └──────────┘  └───────────┘  └─────────────────┘  │
│  ┌──────────┐  ┌───────────┐  ┌─────────────────┐  │
│  │ Contract │  │ Heartbeat │  │   Quiesce       │  │
│  │ Registry │  │ Monitor   │  │   Controller    │  │
│  └──────────┘  └───────────┘  └─────────────────┘  │
│                20 MCP Tools                          │
└────────┬──────────┬──────────┬──────────┬────────────┘
         │          │          │          │
    ┌────▼───┐ ┌───▼────┐ ┌──▼─────┐ ┌──▼─────┐
    │   PM   │ │Designer│ │Backend │ │Frontend│
    │(Claude)│ │(Claude)│ │(Claude)│ │(Claude)│
    │        │ │        │ │        │ │        │
    │ --dis- │ │ --skip │ │ --skip │ │ --skip │
    │ allow  │ │ -perms │ │ -perms │ │ -perms │
    └────┬───┘ └───┬────┘ └───┬────┘ └───┬────┘
         │         │          │          │
         └─────────┴──────────┴──────────┘
                        │
                  Session Logs
                        │
         ┌──────────────▼──────────────────┐
         │       Analyzer Pipeline          │
         │                                  │
         │  Stage 1: Metrics Extraction     │
         │    → tokens, turns, utilization  │
         │    → per-agent cost, bloat ratio │
         │                                  │
         │  Stage 2: Pattern Detection      │
         │    → 13 rules, severity grading  │
         │    → cross-ref shared files      │
         │                                  │
         │  Stage 3: LLM Analysis           │
         │    → per-agent scores, grade     │
         │    → fix_actions (machine-       │
         │      readable code changes)      │
         └──────────────┬──────────────────┘
                        │
               ┌────────▼─────────┐
               │  /optimize-      │
               │   protocol       │
               │                  │
               │  Reads analysis, │
               │  writes real     │
               │  code changes    │
               └────────┬─────────┘
                        │
               ┌────────▼─────────┐
               │  Rebuild + Rerun │
               │  (next iteration)│
               └──────────────────┘
```

---

## The Full Timeline

```
Todo V1 (7.2M tokens, 4 flags)
  │  PM using Codex — cheap but role drift (CRITICAL)
  ▼  Manual fix: role presets
Todo V2 (3.9M tokens, 3 flags)
  │  Best token efficiency, but PM still has role drift
  ▼  PM switched to Claude Opus
Todo V3 (14.6M tokens, 5 flags)
  │  PM polling explodes — 69% of tokens wasted on coordination
  ▼  Manual fix: --disallowedTools
Todo V4 (15.0M tokens, 3 flags)
  │  Role drift fixed, but polling still unchecked
  ▼  Built /benchmark-loop, tested on different project
Classroom Quiz V1 (23.1M tokens, 14 flags)
  │  8 stub files, PM context bloat 7.87x
  ▼  /optimize-protocol writes rate limiter + CODE_MIN + quiesce
Classroom Quiz V2 (13.8M tokens, 3 flags)
  │  Stubs eliminated, polling eliminated, -40% tokens
  ▼  Applied learnings back to Todo benchmark
Todo V5 (5.7M tokens, 0 flags) ✓
    Zero flags. PM tokens -82%. Context bloat 2.84x.
    The framework debugged itself.
```

---

## Why This Matters

Multi-agent systems are becoming the default way to build software with AI. But right now, most teams are flying blind:

- No way to measure coordination quality
- No way to detect when agents are wasting tokens on polling loops
- No way to systematically improve how agents work together
- No visibility into per-agent token attribution
- No automated feedback loop to turn failures into fixes

VibHQ provides the **instrumentation layer** that turns multi-agent chaos into measurable, improvable teamwork.

The self-improving loop is proof that this works — and that the improvements compound: 14 flags → 0, PM tokens from 69% → 32% of total, context bloat from 7.87x → 2.84x.

The framework is open-source. The analyzer, the benchmark loop, the optimization skill — all of it.

**Multi-agent coordination isn't a solved problem. But it's a measurable one. And what you can measure, you can fix.**

---

## Try It

```bash
npm install -g vibehq

# Start a team
vibehq

# After a run, analyze it
vibehq-analyze --team my-team --with-llm

# See token breakdown, utilization, flags
# Then let the framework improve itself
/optimize-protocol
```

GitHub: [VibeHQ](https://github.com/0x0funky/vibehq-hub)

---

*Built by engineers who got tired of watching AI agents poll `check_status` 28 times in a row.*

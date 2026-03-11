---
title: "7 LLM Behaviors That Break Multi-Agent Systems (With Real Session Logs)"
published: true
tags: ai, programming, webdev, opensource
cover_image: # add a cover image URL
---

*I ran 4 AI agents in parallel to build an app. Here's every way it broke — and what actually fixed it.*

---

Running multiple AI coding agents in parallel is easy. Tools like Manaflow, agent-os, and Claude Code Agent Teams all let you spawn 5+ agents and watch them go.

But **parallel ≠ collaboration**. After 100+ hours of multi-agent session logs — using Claude Opus 4.6 and GPT-5.3 Codex on the same controlled task — I documented 7 LLM-native behavioral patterns that reliably break multi-agent coordination.

These aren't bugs. They're natural consequences of how LLMs process instructions, and they appear across model families.

## The Experiment

Same task, same team composition, same user prompt:

> "Analyze $NVDA and build an interactive HTML dashboard"

- 1 orchestrator (Codex) + 3 workers (Claude Opus 4.6)
- Five phases: research → data packs → static dashboard → QA → interactive dashboard

## Problem 1: Three Agents, Three Schemas

I asked 3 agents to "deliver NVDA data as JSON." Each produced reasonable output:

```
Sarah: { "meta": {}, "kpis": {}, "valuation": {} }
Mike:  { "nvda.sentiment.composite": 6.2, "nvda.gammaZones": [...] }
Dave:  { "meta": {}, "financials": {} }  // ignored Sarah's, built his own
```

Three versions of "reasonable." Mutually incompatible.

The orchestrator (Emma) detected the conflict at 13:50 and spent the next 9 minutes writing JavaScript adapter code — 6 manual patches from an agent whose job was "coordinate, don't code."

**Root cause:** When task descriptions use natural language, LLMs interpret output formats freely. Human engineers would ask on Slack "what do your JSON keys look like?" — LLMs won't.

**Fix:** Structured task contracts with `output_target`, `REQUIRED INPUTS`, and `EXPECTED OUTPUT` fields. The orchestrator specifies exact filenames and formats. Schema conflicts dropped **from 15 to 2 (-87%)**.

## Problem 2: The 68-Minute Infinite Loop

An agent called `share_file` with a complete 69KB HTML file. Then called `publish_artifact` to announce it. But the content field read:

```
"See local file: nvda-analysis-dashboard.html — Full single-file HTML/CSS/JS dashboard..."
```

143 bytes. Not 69KB.

The orchestrator saw 143 bytes, said "incomplete," and asked for re-upload. The agent uploaded the full file again via `share_file`... then wrote another pointer string in `publish_artifact`. Loop repeated for **68 minutes**, consuming 21% of the orchestrator's message budget.

**Root cause:** LLMs have a "summarize rather than duplicate" optimization. The agent already uploaded the full content — so it treats the second call as an "announcement" and writes a summary instead of repeating 69KB.

**Fix:** Hub-side validation rejecting `publish_artifact` calls where `content.length < 200`. Stub incidents dropped from 18 to 5.

## Problem 3: Premature Execution

A task was marked `QUEUED — waiting for dependencies`. The agent saw the full task description attached, ignored the status, and started building with hardcoded data.

**Root cause:** LLMs' instruction-following bias. "QUEUED" doesn't register as "please wait" — it registers as "here's a detailed task, and I have enough information to start."

**Fix:** QUEUED tasks no longer send the full description. Only a notification: "a task is waiting." Full details arrive only when dependencies complete.

## Problem 4: Silent Agent Death

An agent's CLI session crashed. No error signal. No disconnect notification. The orchestrator kept sending tasks and waiting. **18 minutes of silence** before it figured out nobody was home.

**Root cause:** LLMs have no concept of "I am about to become unavailable." They just stop responding, and silence is indistinguishable from a slow-running task.

**Fix:** Heartbeat monitoring. The hub tracks activity timestamps and flags `agent_unresponsive` after timeout. Detection-to-reassignment dropped from 18 minutes to 11 seconds.

## Problem 5: The PM Writes Code Under Pressure

Emma's system prompt: "do not write implementation code." When integration broke, Emma immediately started writing JavaScript patches.

**Root cause:** LLMs' problem-solving drive overrides role constraints. When faced with a problem + coding tools, the model solves it directly. "Creating a task for another agent" feels like passing the buck.

**Fix:** Structured contracts eliminate most integration failures that trigger role drift. Manual code interventions: 6 → 0.

## Problem 6: LLMs Can't Self-Verify

A single agent generates data and verifies it → confirmation bias. It finds evidence for "yes, this is correct" rather than challenging its output.

**Fix:** Independent QA phase. Separate agents cross-validate each other's data. Result: **7 data errors caught in 67 validated items** — errors that would've shipped in the single-agent version.

## Problem 7: Generation Over Retrieval

Agent's task: "build dashboard using Sarah's data." Agent's action: regenerated the data from memory instead of reading the shared file.

**Root cause:** For LLMs, generating from memory = zero cost. Reading a file = tool call + wait. The model always takes the path of least resistance.

**Fix:** `REQUIRED INPUTS (do not recreate these)` with explicit double constraints. Self-generation rate dropped from 30% to ~0%.

## Before and After

| Metric | V1 (no protocol) | V2 (with protocol) | Change |
|---|---|---|---|
| Schema conflicts | 15 | 2 | -87% |
| Manual code fixes | 6 | 0 | eliminated |
| End-to-end time | 107 min | 58 min | -46% |
| Data errors caught | 0 | 7 | new capability |
| Final deliverable | ❌ Broken | ✅ Working (62KB) | fixed |

## The Honest Part

For the same task, a single agent finished in 9.5 minutes at $5.92. The multi-agent version took 58 minutes at $58.51. Coordination overhead was 5:1 vs actual work.

**Multi-agent makes sense when:**
- You need independent QA verification (the one irreplaceable advantage)
- Different agents need different tools/permissions
- The task exceeds a single context window
- Subtasks are truly independent and substantial (30+ min each)

For everything else, a single agent wins.

## The Tool

I open-sourced everything as [VibeHQ](https://github.com/0x0funky/vibehq-hub) — a teamwork protocol layer for Claude Code, Codex CLI, and Gemini CLI. It adds contracts, task tracking, idle-aware messaging, stub validation, heartbeat monitoring, and post-run analytics (13 automated detection rules) on top of real CLI agents.

The full write-up with timestamps and session logs: [blog link]
Benchmark report with phase-by-phase comparison: [benchmark link]

---

*If you're building multi-agent systems and have observed similar patterns, I'd love to hear about it in the comments.*

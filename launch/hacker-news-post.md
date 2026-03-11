# Hacker News — Show HN Post

## Title (choose one)

**Option A (recommended — contrarian data):**
> Show HN: I ran 4 AI agents in parallel. 15 schema conflicts, 6 manual fixes. Here's the protocol that fixed it

**Option B (problem-first):**
> Show HN: LLMs have 7 behavioral patterns that reliably break multi-agent systems

**Option C (benchmark-driven):**
> Show HN: We reduced multi-agent schema conflicts by 87% with structured contracts

---

## Post Body

I've been building VibeHQ, an open-source collaboration protocol for CLI coding agents (Claude Code, Codex, Gemini CLI). Not another "run agents in parallel" tool — there are plenty of those. This solves what happens *after* you run them in parallel.

**The problem nobody talks about:** Every multi-agent tool lets you spawn 5 agents. But when they build the same app, they produce incompatible JSON schemas, the orchestrator starts writing code instead of coordinating, agents publish 43-byte stub files instead of real content, and crashed agents produce no signal for 18+ minutes.

These aren't edge cases. They're LLM-native behavioral patterns that reliably appear across model families (tested on GPT-5.3 Codex + Claude Opus 4.6).

**What we found (from 100+ hours of session logs):**

1. **Three agents, three schemas** — asked to "deliver JSON data," each agent invented its own format. The orchestrator spent 6 manual JS patches fixing integration.

2. **The 43-byte ghost file** — an agent uploaded a 69KB HTML via `share_file`, then wrote `"See local file..."` (143 bytes) in `publish_artifact`. This loop repeated for 68 minutes.

3. **Premature execution** — agent saw a QUEUED task description, ignored the status, started coding with hardcoded data.

4. **Silent death** — an agent's CLI crashed. The orchestrator waited 18 minutes before realizing nobody was home.

5. **Role drift** — the PM agent, designed to only coordinate, started writing JavaScript when things broke.

**What we built to fix it:**

- Contract system (agents sign API specs before coding)
- Idle-aware message queue (JSONL watcher detects busy/idle)
- Hub-side stub validation (rejects <200 byte artifacts)
- Heartbeat monitoring (auto-detects crashed agents)
- Independent QA phase (separate agent cross-validates data)

**Results:** Schema conflicts dropped from 15 → 2 (-87%). Manual orchestrator fixes: 6 → 0. Time: 107 → 58 min (-46%). QA caught 7 data errors that would've shipped.

**The honest part:** For the same task, a single agent finished in 9.5 minutes at 1/10 the cost. Multi-agent coordination overhead was 5:1 vs actual work. It only makes sense when you need independent QA, heterogeneous tools, or your task exceeds a single context window.

Full write-up with session logs: [blog link]
Benchmark report: [benchmark link]
GitHub: https://github.com/0x0funky/vibehq-hub

---

## Posting Tips

- **Best time:** Tuesday-Thursday, 9-11am EST (6-8am PST)
- **Don't ask for upvotes** — HN will kill the post
- **Reply to every comment** within the first 2 hours
- **Be honest about limitations** — HN respects candor (the "single agent is faster" admission will earn trust)
- **If someone asks "why not just use Claude Code Agent Teams?"** — answer: Agent Teams has no contracts, no QA validation, no post-run analytics, no idle-aware queue. It's parallel execution without a coordination protocol.

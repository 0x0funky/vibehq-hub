# Reddit Launch Posts

---

## Post 1: r/ClaudeAI + r/ChatGPTCoding

### Title
> I logged 100+ hours of multi-agent sessions. Here are 7 LLM behaviors that break everything — and what actually fixes them.

### Body

I've been running multi-agent coding sessions (Claude Code + Codex) for months. Not the "let me show you my cool tool" kind of post — I want to share what I actually observed in the logs, because I haven't seen anyone talk about these patterns.

**Problem 1: Three agents, three JSON schemas**

I asked 3 agents to produce NVDA analysis data in parallel. Each one delivered "reasonable" JSON. The problem? Their versions of reasonable were mutually incompatible:
- Agent A: `{ "meta": {}, "kpis": {} }` (flat)
- Agent B: `{ "nvda.sentiment.composite": 6.2 }` (namespaced)
- Agent C: ignored both, built its own copy

The PM agent spent 6 rounds manually patching JavaScript to glue it together. A "manager" that was supposed to coordinate became an emergency full-stack engineer.

**Problem 2: The 43-byte ghost file**

An agent uploaded a full 69KB HTML file, then "announced" it with a 143-byte pointer string: `"See local file: dashboard.html"`. The orchestrator saw 143 bytes and said "incomplete, try again." The agent re-uploaded... and wrote another pointer. This loop ran for 68 minutes.

Why? LLMs treat the second API call as an "announcement" — they already did the work, so they summarize instead of repeat.

**Problem 3: Agents start before dependencies are ready**

A task was marked QUEUED (waiting on data from another agent). The agent read the task description, ignored the QUEUED status, and started coding with hardcoded data. LLMs are trained to act on instructions immediately — "please wait" doesn't register the way it does for humans.

**Problem 4: Crashed agents produce no signal**

An agent's CLI crashed. The orchestrator kept sending tasks into the void for 18 minutes. "Executing a complex task" and "already dead" look exactly the same from the outside: silence.

**Problem 5: The PM writes code under pressure**

When integration failed, the PM agent — whose system prompt says "do not write implementation code" — immediately started writing JavaScript patches. LLMs' problem-solving instinct overrides role constraints when they perceive urgency.

**Problem 6: LLMs can't self-verify**

When the same agent generates data and verifies it, it exhibits confirmation bias. It finds evidence that "yes, this is correct" rather than challenging its own output.

**Problem 7: Generation over retrieval**

Rather than reading a shared file, agents regenerate the data from memory. Reading a file requires a tool call. Generating from memory is zero-cost. The model always takes the path of least resistance.

---

**How I fixed these:**

I built a protocol layer (VibeHQ, open source) that sits on top of the CLI agents:
- Contract system — agents sign specs before coding
- Idle-aware queue — withholds task details until dependencies complete
- Hub-side validation — rejects stub artifacts (<200 bytes)
- Heartbeat monitoring — detects dead agents in ~60s
- Independent QA — separate agent cross-validates

Results: schema conflicts 15→2, manual fixes 6→0, time 107→58 min.

Full write-up with session logs: [blog link]
GitHub: https://github.com/0x0funky/vibehq-hub

---

## Post 2: r/LocalLLaMA + r/MachineLearning

### Title
> LLMs have 7 behavioral patterns that systematically break multi-agent coordination. Here's what I found after 100+ hours of session logs.

### Body

(Same as Post 1 body, but remove the "How I fixed these" section and replace with:)

**What this means for multi-agent research:**

These aren't bugs in specific models. They're LLM-native behaviors that appear across model families (tested on GPT-5.3 Codex and Claude Opus 4.6). They're natural consequences of how LLMs process instructions:

1. Instruction-following bias → premature execution
2. Summarize-over-duplicate optimization → stub files
3. Generate-over-retrieve preference → ignoring shared artifacts
4. Problem-solving drive → role drift under pressure
5. Confirmation bias → inability to self-verify
6. No concept of "unavailable" → silent failures
7. Free format interpretation → schema conflicts

I wrote a detailed analysis with timestamps from real session logs: [blog link]

Full benchmark data (V1 vs V2 with framework fixes): [benchmark link]

If you're working on multi-agent systems, I'd love to hear if you've observed similar patterns.

---

## Post 3: r/programming + r/ExperiencedDevs

### Title
> I let 4 AI agents build an app together. The coordination overhead was 5x the actual work. Here's what I learned.

### Body

A single Claude Code agent built a full interactive dashboard in 9.5 minutes for $5.92.

I then ran the same task with 4 agents (1 orchestrator + 3 workers). It took 58 minutes and $58.51. The ratio of coordination overhead to actual work was 5:1.

Before you say "multi-agent is useless" — the multi-agent version caught 7 data accuracy errors that the single agent shipped unchecked. And when I ran it WITHOUT the coordination protocol (V1), it took 107 minutes and produced a broken dashboard with 15 schema conflicts.

**The real insight: multi-agent isn't about speed. It's about quality assurance.**

A single agent can't independently verify its own output. It exhibits confirmation bias. But when a separate agent reviews from scratch, it catches things the original missed.

The question is: is that QA worth 5x the time and 10x the cost?

For a $5 task, obviously not. But for a production deployment with 50+ files, multiple data sources, and real users? Maybe.

Full benchmark with session logs: [blog link]
The tool I built to fix the coordination problems: https://github.com/0x0funky/vibehq-hub

---

## Posting Tips

- **r/ClaudeAI**: Post on weekday mornings, very active community
- **r/LocalLLaMA**: Focus on the research angle, not the tool
- **r/programming**: Lead with the honest cost comparison — they'll respect the candor
- **Don't post to all subreddits on the same day** — space them 2-3 days apart
- **Reply to every comment** — engagement drives Reddit's algorithm
- **Don't be promotional** — share the findings, let people discover the tool

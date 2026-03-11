# VibeHQ Launch Checklist

## Pre-Launch (do these first)

- [ ] **Blog post URLs** — push the blog to a readable format (GitHub renders markdown, or publish on your own site)
- [ ] **Demo video** — you already have mobile + desktop demos. Consider a 60-second cut focusing on the contract signing + QA catch moment
- [ ] **Cover image** — for dev.to and Twitter. Suggestion: the V1→V2 comparison table as a clean graphic
- [ ] **GitHub repo polish:**
  - [ ] Add topics/tags: `multi-agent`, `claude-code`, `codex`, `gemini`, `mcp`, `ai-coding`, `collaboration`
  - [ ] Pin the blog post as a Discussion
  - [ ] Add "good first issue" labels to 2-3 issues
  - [ ] Make sure `npm run build && npm run build:web` works cleanly from fresh clone

## Launch Week Schedule

### Day 1 (Tuesday): Twitter Thread
- [ ] Post Thread 1 (7 LLM Problems) at 8-10am EST
- [ ] Pin to profile
- [ ] Reply to own thread with demo video link
- [ ] Tag @AnthropicAI @OpenAI

### Day 2 (Wednesday): Hacker News
- [ ] Post "Show HN" at 9-11am EST
- [ ] Monitor and reply to every comment for 2 hours
- [ ] Be ready for the "why not just use Agent Teams?" question

### Day 3 (Thursday): Reddit r/ClaudeAI
- [ ] Post the "7 LLM behaviors" research post
- [ ] Reply to every comment
- [ ] DO NOT cross-post to other subreddits same day

### Day 5 (Saturday): Reddit r/programming
- [ ] Post the "honest benchmark" angle (5:1 overhead, single agent faster)
- [ ] This subreddit respects honesty over hype

### Day 7 (Monday): Dev.to Article
- [ ] Publish the full article
- [ ] Cross-link from Twitter

### Day 8-9: Reddit r/LocalLLaMA + r/MachineLearning
- [ ] Post the research angle (LLM behavioral patterns)
- [ ] Focus on findings, not the tool

### Day 10: Twitter Thread 2
- [ ] Post the honest benchmark thread
- [ ] Quote-tweet Thread 1

## Post-Launch

- [ ] **Product Hunt** — prepare a launch page (screenshot, tagline, description). Launch on a separate week from HN/Reddit
- [ ] **Discord** — consider creating a VibeHQ community for discussions
- [ ] **awesome-llm-agents** — submit a PR to https://github.com/kaushikb11/awesome-llm-agents
- [ ] **Follow up post** — 2-3 weeks later, post a "what I learned from launching" or "new benchmark results" thread

## Key Messages (keep consistent across all platforms)

1. **Lead with the problem, not the tool** — "7 LLM behaviors that break multi-agent" not "check out my multi-agent platform"
2. **Always include the honest benchmark** — single agent = 9.5 min, multi-agent = 58 min. This builds trust.
3. **The unique insight** — "multi-agent isn't about speed, it's about quality assurance"
4. **The differentiator** — "not parallel execution, but a coordination protocol"

## What NOT to Do

- ❌ Don't ask friends to upvote (HN and Reddit detect this)
- ❌ Don't post to multiple subreddits on the same day
- ❌ Don't use marketing language ("revolutionary", "game-changing", "10x")
- ❌ Don't hide the limitations — the 5:1 overhead is your biggest trust-builder
- ❌ Don't compare yourself to Manaflow/agent-os — position against "running agents without coordination"

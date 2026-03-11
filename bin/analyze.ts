#!/usr/bin/env node
import { existsSync, statSync, readdirSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import {
  parseLogDirectory, parseLogFile, extractMetrics, detectPatterns, formatReport,
  saveRun, loadHistory, loadRun, listRunIds, compareRuns,
  formatHistory, formatComparison, saveReportCard,
  runLlmAnalysis, shouldTriggerLlm, formatReportCard,
  resolveTeamLogs, filterSessionWindow,
} from '../src/analyzer/index.js';
import { loadConfig, saveGlobalConfig, getConfigStatus } from '../src/analyzer/config.js';

const args = process.argv.slice(2);
const command = args[0];

function usage() {
  console.log(`
vibehq-analyze — Post-run analysis for VibeHQ team sessions

Commands:
  vibehq-analyze <path>                   Analyze logs (directory or single file)
  vibehq-analyze history [--last N]       Show run history
  vibehq-analyze compare <id1> <id2>      Compare two runs
  vibehq-analyze show <run-id>            Show a saved run report
  vibehq-analyze list                     List all saved run IDs
  vibehq-analyze config                   Show current LLM config
  vibehq-analyze config --set-key <key>   Save API key to global config
  vibehq-analyze config --set-model <m>   Save default model
  vibehq-analyze config --set-provider <p> Set provider (anthropic|openai)

Options:
  --json            Output raw JSON
  --save            Save to ~/.vibehq/analytics/
  --run-id <id>     Set custom run ID
  --with-llm        Run LLM analysis (includes fix_actions for auto-optimization)
  --team <name>     Team name (loads config for LLM context)
  --api-key <key>   API key (overrides config)
  --model <model>   LLM model (overrides config)
  --provider <p>    Provider: anthropic or openai (overrides config)

Config priority: CLI flags > env vars > ~/.vibehq/analytics/config.json > vibehq.config.json (model/provider only)
Note: API keys are NEVER read from vibehq.config.json (git-tracked). Use config --set-key or env vars.

Examples:
  vibehq-analyze config --set-key sk-ant-xxx
  vibehq-analyze ./data --with-llm --save
  vibehq-analyze history --last 10
  vibehq-analyze compare v1-nvda v2-nvda
`);
}

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const hasFlag = (f: string) => args.includes(f);

if (args.length === 0 || hasFlag('--help') || hasFlag('-h')) {
  usage();
  process.exit(0);
}

// ─── config ───
if (command === 'config') {
  const setKey = getArg('--set-key');
  const setModel = getArg('--set-model');
  const setProvider = getArg('--set-provider');
  const setBaseUrl = getArg('--set-base-url');

  if (setKey || setModel || setProvider || setBaseUrl) {
    const update: Record<string, unknown> = {};
    const llm: Record<string, unknown> = {};
    if (setKey) llm.apiKey = setKey;
    if (setModel) llm.model = setModel;
    if (setProvider) llm.provider = setProvider;
    if (setBaseUrl) llm.baseUrl = setBaseUrl;
    update.llm = llm;

    const path = saveGlobalConfig(update as any);
    console.log(`Config saved to ${path}`);

    // Show masked key
    if (setKey) {
      const masked = setKey.substring(0, 10) + '...' + setKey.substring(setKey.length - 4);
      console.log(`  API key: ${masked}`);
    }
    if (setModel) console.log(`  Model: ${setModel}`);
    if (setProvider) console.log(`  Provider: ${setProvider}`);
    if (setBaseUrl) console.log(`  Base URL: ${setBaseUrl}`);
  } else {
    // Show current config
    const status = getConfigStatus();
    const cfg = status.resolvedConfig;
    const masked = cfg.llm.apiKey
      ? cfg.llm.apiKey.substring(0, 10) + '...' + cfg.llm.apiKey.substring(cfg.llm.apiKey.length - 4)
      : '(not set)';

    console.log('LLM Analysis Config');
    console.log('─'.repeat(40));
    console.log(`  Provider:   ${cfg.llm.provider}`);
    console.log(`  Model:      ${cfg.llm.model}`);
    console.log(`  API key:    ${masked}`);
    if (cfg.llm.baseUrl) console.log(`  Base URL:   ${cfg.llm.baseUrl}`);
    console.log('');
    console.log('Config sources:');
    console.log(`  Global:  ${status.globalPath} ${status.globalExists ? '✓' : '(not created)'}`);
    console.log(`  Project: ${status.projectPath} ${status.projectHasAnalytics ? '✓ (has analytics section)' : '(no analytics section)'}`);
    console.log('');
    console.log('To configure:');
    console.log('  vibehq-analyze config --set-key <your-api-key>');
    console.log('  vibehq-analyze config --set-model claude-sonnet-4-20250514');
    console.log('  vibehq-analyze config --set-provider openai');
    console.log('');
    console.log('Or add model/provider to vibehq.config.json (NOT api keys):');
    console.log('  { "analytics": { "llm": { "model": "...", "provider": "..." } } }');
    console.log('');
    console.log('⚠ API keys should NEVER go in vibehq.config.json (git-tracked).');
    console.log('  Use: vibehq-analyze config --set-key <key>  (saved to ~/.vibehq/)');
  }
  process.exit(0);
}

// ─── history ───
if (command === 'history') {
  const last = getArg('--last');
  const entries = loadHistory(last ? parseInt(last, 10) : undefined);
  if (hasFlag('--json')) {
    console.log(JSON.stringify(entries, null, 2));
  } else {
    console.log(formatHistory(entries));
  }
  process.exit(0);
}

// ─── list ───
if (command === 'list') {
  const ids = listRunIds();
  if (ids.length === 0) {
    console.log('No saved runs. Use --save to store runs.');
  } else {
    console.log(`Saved runs (${ids.length}):`);
    for (const id of ids) console.log(`  ${id}`);
  }
  process.exit(0);
}

// ─── show <run-id> ───
if (command === 'show') {
  const runId = args[1];
  if (!runId) { console.error('Usage: vibehq-analyze show <run-id>'); process.exit(1); }
  const data = loadRun(runId);
  if (!data) { console.error(`Run not found: ${runId}`); process.exit(1); }
  if (hasFlag('--json')) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(formatReport(data.metrics, data.flags));
  }
  process.exit(0);
}

// ─── compare <id1> <id2> ───
if (command === 'compare') {
  const id1 = args[1];
  const id2 = args[2];
  if (!id1 || !id2) { console.error('Usage: vibehq-analyze compare <run1> <run2>'); process.exit(1); }
  const run1 = loadRun(id1);
  const run2 = loadRun(id2);
  if (!run1) { console.error(`Run not found: ${id1}`); process.exit(1); }
  if (!run2) { console.error(`Run not found: ${id2}`); process.exit(1); }
  const cmp = compareRuns(run1, run2);
  if (hasFlag('--json')) {
    console.log(JSON.stringify(cmp, null, 2));
  } else {
    console.log(formatComparison(cmp));
  }
  process.exit(0);
}

// ─── analyze <path> or --team <name> ───
let events: ReturnType<typeof parseLogFile> = [];
let isTeamMode = false;
let resolvedLogPaths: string[] = [];

// Check if first arg is a flag (not a path)
const firstArgIsFlag = !command || command.startsWith('-');
const teamNameArg = getArg('--team');

if (firstArgIsFlag && teamNameArg) {
  // --team mode: auto-resolve logs from team config
  isTeamMode = true;
  const configPath = resolve('vibehq.config.json');
  if (!existsSync(configPath)) {
    console.error('Error: vibehq.config.json not found in current directory');
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
  const team = (cfg.teams || []).find((t: any) => t.name === teamNameArg);
  if (!team) {
    console.error(`Error: team "${teamNameArg}" not found in vibehq.config.json`);
    process.exit(1);
  }
  const agents = (team.agents || []).map((a: any) => ({
    name: a.name,
    cli: a.cli || 'claude',
    cwd: a.cwd || process.cwd(),
  }));
  const resolved = filterSessionWindow(resolveTeamLogs(agents, teamNameArg));
  if (resolved.length === 0) {
    console.error(`Error: no log files found for team "${teamNameArg}"`);
    console.error('Make sure the team has been run at least once.');
    process.exit(1);
  }
  console.error(`Found ${resolved.length} log(s) for team "${teamNameArg}":`);
  for (const r of resolved) {
    console.error(`  ${r.agent} (${r.cli}) → ${r.path} [${r.source}]`);
  }
  for (const r of resolved) {
    resolvedLogPaths.push(r.path);
    events.push(...parseLogFile(r.path));
  }
} else {
  // Path mode: analyze a specific directory or file
  const inputPath = resolve(args[0]);
  if (!existsSync(inputPath)) {
    console.error(`Error: path not found: ${inputPath}`);
    process.exit(1);
  }
  const isDir = statSync(inputPath).isDirectory();
  events = isDir ? parseLogDirectory(inputPath) : parseLogFile(inputPath);
}

if (events.length === 0) {
  console.error('Error: no events found in log(s)');
  process.exit(1);
}

// Stage 1: Extract metrics
const customRunId = getArg('--run-id');
const metrics = extractMetrics(events, customRunId);

// Stage 2: Detect patterns
const flags = detectPatterns(metrics);

// Stage 3: LLM analysis (optional)
let reportCard: Record<string, unknown> | null = null;
const withLlm = hasFlag('--with-llm');
if (withLlm) {
  const apiKey = getArg('--api-key');
  const model = getArg('--model');
  const provider = getArg('--provider') as 'anthropic' | 'openai' | undefined;
  const teamName = getArg('--team');

  // Load team config for LLM context
  let teamConfig: Record<string, unknown> | undefined;
  if (teamName) {
    try {
      const configPath = resolve('vibehq.config.json');
      if (existsSync(configPath)) {
        const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
        const team = (cfg.teams || []).find((t: any) => t.name === teamName);
        if (team) {
          // Strip sensitive fields, keep structure
          teamConfig = {
            name: team.name,
            agents: (team.agents || []).map((a: any) => ({
              name: a.name,
              role: a.role,
              cli: a.cli,
              hasSystemPrompt: !!a.systemPrompt,
              systemPromptLength: a.systemPrompt?.length || 0,
            })),
          };
        }
      }
    } catch { /* non-critical */ }
  }

  try {
    console.error('Running LLM analysis (with fix_actions)...');
    reportCard = await runLlmAnalysis(metrics, flags, events, { apiKey, model, provider }, teamConfig);
  } catch (e) {
    console.error(`LLM analysis failed: ${(e as Error).message}`);
  }
} else if (shouldTriggerLlm(flags)) {
  console.error('Hint: high-severity flags detected. Use --with-llm for deeper analysis.');
}

// Output
if (hasFlag('--json')) {
  console.log(JSON.stringify({ metrics, flags, reportCard }, null, 2));
} else {
  console.log(formatReport(metrics, flags));
  if (reportCard) {
    console.log('');
    console.log(formatReportCard(reportCard));
  }
}

// Stage 4: Save to history
if (hasFlag('--save')) {
  let rawLogPaths: string[];
  if (isTeamMode) {
    rawLogPaths = resolvedLogPaths;
  } else {
    const inputPath = resolve(args[0]);
    const isDir = statSync(inputPath).isDirectory();
    rawLogPaths = isDir
      ? readdirSync(inputPath).filter(f => f.endsWith('.jsonl')).map(f => join(inputPath, f))
      : [inputPath];
  }
  const runDir = saveRun(metrics, flags, rawLogPaths);
  if (reportCard) {
    saveReportCard(metrics.runId, reportCard);
  }
  console.error(`Saved to ${runDir}`);
}

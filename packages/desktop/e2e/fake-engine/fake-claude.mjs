#!/usr/bin/env node
// Scripted stand-in for the `claude` CLI. It answers the probes the app runs (version, help, auth status, plugin/mcp
// listings), plays a scenario as stream-json in print mode, runs the configured hooks like the real CLI and writes a
// transcript where the real CLI does. Every invocation is appended to <state>/claude-calls.jsonl for assertions.
// Contract sources: official-cli.mjs (flags), stream.mjs (messages), hooks.mjs (hook runner).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { AUTH_METHODS, SUBCOMMANDS, helpText, parseArgs } from './official-cli.mjs';
import { assistant, result, systemInit, textBlock, toolResult, toolUseBlock, userReplay } from './stream.mjs';
import { claudeConfigDir, collectHookSources, fireHook } from './hooks.mjs';

// Without a sandbox the log goes to the OS temp dir, never into the source tree.
const STATE = process.env.VIBISUAL_FAKE_ENGINE_STATE || path.join(os.tmpdir(), 'vibisual-fake-engine');
const SCENARIO_FILE = process.env.VIBISUAL_FAKE_ENGINE_SCENARIO || '';
const DEFAULT_TOOLS = ['Task', 'Bash', 'Glob', 'Grep', 'Read', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'TodoWrite', 'WebSearch'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @typedef {{ text?: string, tool?: string, input?: Record<string, unknown>, output?: string, isError?: boolean,
 *   waitForFile?: string, delayMs?: number }} Step */
/** @typedef {{ match?: string, steps?: Step[], result?: string, isError?: boolean }} Turn */

function loadScenario() {
  /** @type {{ version: string, model: string, strictFlags: boolean, stepDelayMs: number,
   *   auth: Record<string, unknown>, turns: Turn[], defaultTurn: Turn }} */
  const base = {
    version: '2.1.310',
    model: 'claude-sonnet-5-5',
    strictFlags: true,
    stepDelayMs: 150,
    auth: { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'e2e@example.invalid', orgName: 'E2E', subscriptionType: 'pro' },
    turns: [],
    defaultTurn: { steps: [{ text: 'Done.' }], result: 'Done.' },
  };
  if (!SCENARIO_FILE) return base;
  try {
    return { ...base, ...JSON.parse(fs.readFileSync(SCENARIO_FILE, 'utf8')) };
  } catch (err) {
    process.stderr.write(`fake-claude: cannot read scenario ${SCENARIO_FILE}: ${err.message}\n`);
    return base;
  }
}

const scenario = loadScenario();
const argv = process.argv.slice(2);
const parsed = parseArgs(argv);
const callId = randomUUID();

/** Append-only call log. One JSON object per line; `kind` names what happened. */
function log(entry) {
  try {
    fs.mkdirSync(STATE, { recursive: true });
    fs.appendFileSync(path.join(STATE, 'claude-calls.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), call: callId, pid: process.pid, ...entry })}\n`);
  } catch {
    /* logging must never change the engine's behaviour */
  }
}

function vibisualEnvKeys() {
  return Object.keys(process.env).filter((k) => k.startsWith('VIBISUAL_') && !k.includes('TOKEN') && !k.startsWith('VIBISUAL_FAKE_')).sort();
}

const write = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForFile(name) {
  const file = path.join(STATE, name);
  const deadline = Date.now() + 120_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${name}`);
    await sleep(100);
  }
}

function finish(code) {
  log({ kind: 'exit', code });
  process.exitCode = code;
}

// ── probes and subcommands ───────────────────────────────────────────────────

function runSubcommand(name, rest) {
  const auth = scenario.auth;
  if (name === 'auth' && rest[0] === 'status') {
    const loggedIn = auth.loggedIn === true;
    const method = AUTH_METHODS.has(String(auth.authMethod)) ? auth.authMethod : 'none';
    const body = { ...auth, loggedIn, authMethod: loggedIn ? method : 'none', configDirectory: claudeConfigDir() };
    process.stdout.write(rest.includes('--text') ? `${loggedIn ? `Logged in as ${auth.email}` : 'Not logged in'}\n` : `${JSON.stringify(body, null, 2)}\n`);
    return loggedIn ? 0 : 1;
  }
  if (name === 'update') {
    process.stdout.write(`Current version: ${scenario.version}\nClaude Code is up to date (${scenario.version})\n`);
    return 0;
  }
  if (name === 'doctor') {
    process.stdout.write(`Claude Code diagnostics\n  Version: ${scenario.version}\n  Install: fake engine\n`);
    return 0;
  }
  if (name === 'mcp' && (rest[0] === 'list' || rest.length === 0)) {
    process.stdout.write('No MCP servers configured. Use `claude mcp add` to add a server.\n');
    return 0;
  }
  if ((name === 'plugin' || name === 'plugins') && rest[0] === 'list') {
    // `--available` switches the JSON from an array to `{ installed, available }`.
    const json = rest.includes('--available') ? '{"installed":[],"available":[]}' : '[]';
    process.stdout.write(rest.includes('--json') ? `${json}\n` : 'No plugins installed.\n');
    return 0;
  }
  if ((name === 'plugin' || name === 'plugins') && rest[0] === 'marketplace' && rest[1] === 'list') {
    process.stdout.write(rest.includes('--json') ? '[]\n' : 'No marketplaces configured.\n');
    return 0;
  }
  if ((name === 'plugin' || name === 'plugins') && rest[0] === 'marketplace' && rest[1] === 'update') {
    process.stdout.write('No marketplaces to update.\n');
    return 0;
  }
  if (name === 'agents' && rest.includes('--json')) {
    process.stdout.write('[]\n');
    return 0;
  }
  log({ kind: 'unsupported-subcommand', name, rest });
  process.stderr.write(`fake-claude: subcommand "${name} ${rest.join(' ')}" is not scripted\n`);
  return 1;
}

// ── print mode ────────────────────────────────────────────────────────────────

/** @param {string} prompt */
function pickTurn(prompt) {
  for (const t of scenario.turns) {
    if (!t.match) return t;
    try {
      if (new RegExp(t.match, 'i').test(prompt)) return t;
    } catch {
      if (prompt.includes(t.match)) return t;
    }
  }
  return scenario.defaultTurn;
}

function projectSlug(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Applies a tool's effect inside the working directory and returns its tool_result text. */
function applyTool(cwd, step) {
  const input = step.input ?? {};
  const inside = (p) => {
    const abs = path.resolve(cwd, String(p));
    const rel = path.relative(cwd, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`refusing path outside cwd: ${p}`);
    return abs;
  };
  if (step.tool === 'Write' && typeof input.file_path === 'string') {
    const abs = inside(input.file_path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(input.content ?? ''));
    return step.output ?? `File created successfully at: ${abs}`;
  }
  if (step.tool === 'Edit' && typeof input.file_path === 'string') {
    const abs = inside(input.file_path);
    const before = fs.readFileSync(abs, 'utf8');
    fs.writeFileSync(abs, before.replace(String(input.old_string ?? ''), String(input.new_string ?? '')));
    return step.output ?? `The file ${abs} has been updated.`;
  }
  if (step.tool === 'Read' && typeof input.file_path === 'string') {
    const abs = inside(input.file_path);
    return step.output ?? fs.readFileSync(abs, 'utf8').split('\n').map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n');
  }
  return step.output ?? '';
}

/** Absolute file paths in tool inputs, the way the real CLI hands them to hooks. */
function hookToolInput(cwd, input) {
  const out = { ...input };
  if (typeof out.file_path === 'string') out.file_path = path.resolve(cwd, out.file_path);
  return out;
}

async function runPrintMode() {
  const flags = parsed.flags;
  const cwd = process.cwd();
  const outputFormat = String(flags['--output-format'] ?? 'text');
  const inputFormat = String(flags['--input-format'] ?? 'text');
  const streamOut = outputFormat === 'stream-json';
  const replay = flags['--replay-user-messages'] === true;
  const partials = flags['--include-partial-messages'] === true;
  const model = String(flags['--model'] ?? scenario.model);
  const permissionMode = String(flags['--permission-mode'] ?? 'default');
  const resumed = typeof flags['--resume'] === 'string' ? String(flags['--resume']) : '';
  const sessionId = typeof flags['--session-id'] === 'string' ? String(flags['--session-id'])
    : resumed && UUID_RE.test(resumed) && flags['--fork-session'] !== true ? resumed : randomUUID();
  const pluginDirs = /** @type {string[]} */ (flags['--plugin-dir'] ?? []);
  const sources = collectHookSources({ cwd, settingsArg: typeof flags['--settings'] === 'string' ? String(flags['--settings']) : undefined, pluginDirs, env: process.env });
  const transcriptDir = path.join(claudeConfigDir(), 'projects', projectSlug(cwd));
  const transcriptPath = path.join(transcriptDir, `${sessionId}.jsonl`);
  const hookCtx = { sources, env: process.env, cwd, log };
  const common = () => ({ session_id: sessionId, transcript_path: transcriptPath, cwd, permission_mode: permissionMode });
  let lastUuid = null;

  const transcript = (type, message, extra = {}) => {
    const uuid = randomUUID();
    try {
      fs.mkdirSync(transcriptDir, { recursive: true });
      fs.appendFileSync(transcriptPath, `${JSON.stringify({ parentUuid: lastUuid, isSidechain: false, userType: 'external', cwd, sessionId, version: scenario.version, type, message, uuid, timestamp: new Date().toISOString(), ...extra })}\n`);
    } catch {
      /* transcript is best effort, like a full disk on the real CLI */
    }
    lastUuid = uuid;
  };

  log({ kind: 'print', sessionId, outputFormat, inputFormat, resumed: resumed || null, pluginDirs, hookSources: sources.map((s) => s.source), vibisualEnv: vibisualEnvKeys() });

  await fireHook('SessionStart', { ...common(), source: resumed ? 'resume' : 'startup', model }, hookCtx);
  if (streamOut) {
    write(systemInit({ sessionId, cwd, model, version: scenario.version, permissionMode, tools: DEFAULT_TOOLS, plugins: pluginDirs.map((p) => ({ name: path.basename(p), path: p })) }));
  }

  let turns = 0;
  let lastResult = null;

  /** @param {string} prompt @param {string | undefined} inputUuid */
  const runTurn = async (prompt, inputUuid) => {
    turns += 1;
    const startedAt = Date.now();
    const turn = pickTurn(prompt);
    // The app prepends its own preamble, so keep both ends of the prompt; `matched` names the scripted turn.
    log({ kind: 'turn', sessionId, promptHead: prompt.slice(0, 200), promptTail: prompt.slice(-200), promptLength: prompt.length, matched: turn.match ?? null });
    if (streamOut && replay) write({ ...userReplay(sessionId, prompt), ...(inputUuid ? { uuid: inputUuid } : {}) });
    transcript('user', { role: 'user', content: prompt });
    const submit = await fireHook('UserPromptSubmit', { ...common(), prompt }, hookCtx);
    if (submit.decision === 'deny') {
      const r = result({ sessionId, model, result: submit.reason ?? 'Prompt blocked by hook', isError: true, numTurns: turns, startedAt, denials: [] });
      if (streamOut) write(r);
      lastResult = r;
      return;
    }
    const denials = [];
    for (const step of turn.steps ?? []) {
      await sleep(step.delayMs ?? scenario.stepDelayMs);
      if (step.waitForFile) {
        log({ kind: 'waiting', file: step.waitForFile });
        await waitForFile(step.waitForFile);
        continue;
      }
      if (typeof step.text === 'string') {
        if (streamOut && partials) {
          for (const event of textPartials(step.text, model)) write({ type: 'stream_event', uuid: randomUUID(), session_id: sessionId, parent_tool_use_id: null, event });
        }
        const msg = assistant(sessionId, model, [textBlock(step.text)]);
        if (streamOut) write(msg);
        transcript('assistant', msg.message);
        continue;
      }
      if (typeof step.tool === 'string') {
        const id = `toolu_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
        const toolInput = hookToolInput(cwd, step.input ?? {});
        const msg = assistant(sessionId, model, [toolUseBlock(id, step.tool, toolInput)]);
        if (streamOut) write(msg);
        transcript('assistant', msg.message);
        const pre = await fireHook('PreToolUse', { ...common(), tool_name: step.tool, tool_input: toolInput, tool_use_id: id }, hookCtx);
        log({ kind: 'pre-tool', tool: step.tool, decision: pre.decision ?? null });
        let text;
        let isError = step.isError === true;
        if (pre.decision === 'deny') {
          text = `Permission to use ${step.tool} has been denied. ${pre.reason ?? ''}`.trim();
          isError = true;
          denials.push({ tool_name: step.tool, tool_use_id: id, tool_input: toolInput });
        } else {
          try {
            text = applyTool(cwd, step);
          } catch (err) {
            text = String(err?.message ?? err);
            isError = true;
          }
          const post = isError ? 'PostToolUseFailure' : 'PostToolUse';
          await fireHook(post, { ...common(), tool_name: step.tool, tool_input: toolInput, tool_use_id: id, ...(isError ? { error: text } : { tool_response: { content: text } }) }, hookCtx);
        }
        const res = toolResult(sessionId, id, text, isError);
        if (streamOut) write(res);
        transcript('user', res.message, { toolUseResult: text });
      }
    }
    await sleep(scenario.stepDelayMs);
    await fireHook('Stop', { ...common(), stop_hook_active: false }, hookCtx);
    const finalText = turn.result ?? 'Done.';
    const r = { ...result({ sessionId, model, result: finalText, isError: turn.isError === true, numTurns: turns, startedAt, denials }), ...(inputUuid ? { user_message_uuid: inputUuid } : {}) };
    if (streamOut) write(r);
    lastResult = r;
    log({ kind: 'result', sessionId, isError: r.is_error });
  };

  if (inputFormat === 'stream-json') {
    const queue = [];
    let ended = false;
    let wake = null;
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        log({ kind: 'bad-input', line: trimmed.slice(0, 200) });
        return;
      }
      log({ kind: 'input', type: msg?.type ?? null });
      if (msg?.type === 'user') queue.push(msg);
      wake?.();
    });
    rl.on('close', () => {
      ended = true;
      wake?.();
    });
    while (!ended || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise((r) => { wake = r; });
        wake = null;
        continue;
      }
      const msg = queue.shift();
      const content = msg.message?.content;
      const prompt = typeof content === 'string' ? content
        : Array.isArray(content) ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '';
      await runTurn(prompt, typeof msg.uuid === 'string' ? msg.uuid : undefined);
    }
  } else {
    let prompt = parsed.positionals.join(' ');
    if (!prompt && !process.stdin.isTTY) prompt = await readAllStdin();
    await runTurn(prompt, undefined);
  }

  if (!streamOut && lastResult) {
    process.stdout.write(outputFormat === 'json' ? `${JSON.stringify(lastResult)}\n` : `${lastResult.result ?? (lastResult.errors ?? []).join('\n')}\n`);
  }
  await fireHook('SessionEnd', { ...common(), reason: 'other' }, hookCtx);
  return lastResult?.is_error ? 1 : 0;
}

/** Anthropic streaming events for one text block — what `--include-partial-messages` adds before the full message. */
function textPartials(text, model) {
  const id = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const half = Math.ceil(text.length / 2);
  return [
    { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, half) } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(half) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } },
    { type: 'message_stop' },
  ];
}

function readAllStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { data += d; });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', () => resolve(data.trim()));
  });
}

/** Interactive mode (CMD bubble PTY). Not scripted beyond a prompt loop that answers with the default turn. */
async function runInteractive() {
  log({ kind: 'interactive' });
  process.stdout.write(`Claude Code v${scenario.version} (fake engine)\n> `);
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    log({ kind: 'interactive-line', length: line.length });
    process.stdout.write(`${scenario.defaultTurn.result ?? 'Done.'}\n> `);
  }
  return 0;
}

async function main() {
  const flags = parsed.flags;
  const first = parsed.positionals[0];
  const isSub = first !== undefined && SUBCOMMANDS.has(first) && argv[0] === first;
  log({ kind: 'invoke', argv, cwd: process.cwd(), unknownFlags: parsed.unknown, subcommand: isSub ? first : null });

  if (isSub) return runSubcommand(first, argv.slice(1));
  if (parsed.unknown.length > 0 && scenario.strictFlags) {
    // Same shape as the real CLI's option parser so the app's error path is exercised too.
    process.stderr.write(`error: unknown option '${parsed.unknown[0]}'\n`);
    return 1;
  }
  if (flags['--version'] === true) {
    process.stdout.write(`${scenario.version} (Claude Code)\n`);
    return 0;
  }
  if (flags['--help'] === true) {
    process.stdout.write(helpText());
    return 0;
  }
  const printMode = flags['--print'] === true || flags['--input-format'] === 'stream-json' || flags['--output-format'] !== undefined;
  if (printMode) return runPrintMode();
  return runInteractive();
}

process.on('SIGTERM', () => {
  log({ kind: 'signal', signal: 'SIGTERM' });
  process.exit(143);
});

main().then(finish, (err) => {
  log({ kind: 'crash', error: String(err?.stack ?? err) });
  process.stderr.write(`fake-claude crashed: ${err?.stack ?? err}\n`);
  finish(1);
});

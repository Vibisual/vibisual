#!/usr/bin/env node
// Scripted stand-in for the `codex` CLI. Answers the probes the app runs (`--version`, `login status`, `mcp list`,
// `plugin list`) and serves `codex app-server`: JSON-RPC over newline-delimited stdio with the `jsonrpc` field omitted
// on the wire (learn.chatgpt.com/docs/app-server). Every invocation goes to <state>/codex-calls.jsonl.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';
import { parseOverrides } from './toml-inline.mjs';
import { fireHook } from './hooks.mjs';

// Without a sandbox the log goes to the OS temp dir, never into the source tree.
const STATE = process.env.VIBISUAL_FAKE_ENGINE_STATE || path.join(os.tmpdir(), 'vibisual-fake-engine');
const SCENARIO_FILE = process.env.VIBISUAL_FAKE_ENGINE_SCENARIO || '';
const argv = process.argv.slice(2);
const callId = randomUUID();

/** @typedef {{ text?: string, fileChange?: { path: string, content: string }, waitForFile?: string, delayMs?: number }} Step */
/** @typedef {{ match?: string, steps?: Step[], status?: 'completed' | 'failed' }} Turn */

function loadScenario() {
  /** @type {{ version: string, model: string, loggedIn: boolean, stepDelayMs: number, turns: Turn[], defaultTurn: Turn }} */
  const base = {
    version: '0.152.1',
    model: 'gpt-6.1-sol',
    loggedIn: true,
    stepDelayMs: 150,
    turns: [],
    defaultTurn: { steps: [{ text: 'Done.' }] },
  };
  if (!SCENARIO_FILE) return base;
  try {
    const all = JSON.parse(fs.readFileSync(SCENARIO_FILE, 'utf8'));
    return { ...base, ...(all.codex ?? {}) };
  } catch {
    return base;
  }
}
const scenario = loadScenario();

function log(entry) {
  try {
    fs.mkdirSync(STATE, { recursive: true });
    fs.appendFileSync(path.join(STATE, 'codex-calls.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), call: callId, pid: process.pid, ...entry })}\n`);
  } catch {
    /* never let logging change behaviour */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

async function waitForFile(name) {
  const file = path.join(STATE, name);
  const deadline = Date.now() + 120_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${name}`);
    await sleep(100);
  }
}

function pickTurn(prompt) {
  for (const t of scenario.turns) {
    if (!t.match) return t;
    if (prompt.toLowerCase().includes(String(t.match).toLowerCase())) return t;
  }
  return scenario.defaultTurn;
}

// ── hooks ─────────────────────────────────────────────────────────────────────
// Official (learn.chatgpt.com/docs/hooks): hooks run only when `features.hooks` is on and only once trusted against
// the hook's current hash; apply_patch reports tool_name "apply_patch". The `hooks/list` result shape is not in the
// public docs — the fields below are the ones the app reads (codexHookTrust.ts), measured against the real CLI.

const camel = (event) => event.charAt(0).toLowerCase() + event.slice(1);

/** Hooks from `-c hooks.<Event>=[…]` and `$CODEX_HOME/hooks.json`, each with a stable key and content hash. */
function listHooks(config) {
  const enabled = config?.features?.hooks === true;
  const state = config?.hooks?.state && typeof config.hooks.state === 'object' ? config.hooks.state : {};
  const sources = [['session_flags', config?.hooks ?? {}]];
  const home = process.env.CODEX_HOME || path.join(process.env.HOME || process.env.USERPROFILE || '', '.codex');
  try {
    const file = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'));
    if (file?.hooks) sources.push(['user', file.hooks]);
  } catch {
    /* no global hooks */
  }
  const out = [];
  for (const [source, hooks] of sources) {
    for (const [event, groups] of Object.entries(hooks)) {
      if (event === 'state' || !Array.isArray(groups)) continue;
      groups.forEach((group, gi) => {
        (Array.isArray(group?.hooks) ? group.hooks : []).forEach((hook, hi) => {
          if (hook?.type !== 'command' || typeof hook.command !== 'string') return;
          const key = `${source}:${camel(event)}:${gi}:${hi}`;
          const currentHash = createHash('sha256').update(JSON.stringify([event, group.matcher ?? null, hook.command, hook.timeout ?? null])).digest('hex');
          const trusted = state[key]?.trusted_hash === currentHash;
          out.push({ key, source, event, eventName: camel(event), matcher: group.matcher, command: hook.command, timeout: hook.timeout, currentHash, enabled, trustStatus: trusted ? 'trusted' : 'untrusted' });
        });
      });
    }
  }
  return out;
}

/** Only enabled, trusted hooks run — the shape hooks.mjs expects (one source, events → groups). */
function runnableHookSources(config) {
  const hooks = {};
  for (const h of listHooks(config)) {
    if (!h.enabled || h.trustStatus !== 'trusted') continue;
    (hooks[h.event] ??= []).push({ matcher: h.matcher, hooks: [{ type: 'command', command: h.command, timeout: h.timeout }] });
  }
  return [{ source: 'codex', hooks }];
}

// ── app-server ────────────────────────────────────────────────────────────────

async function appServer() {
  const config = parseOverrides(argv);
  log({ kind: 'config', hooksEnabled: config?.features?.hooks === true, hookEvents: Object.keys(config?.hooks ?? {}).filter((k) => k !== 'state'), mcpServers: Object.keys(config?.mcp_servers ?? {}) });
  const threads = new Map();
  /** @type {Map<string, { interrupted: boolean }>} */
  const turns = new Map();
  let usageTotal = 0;

  const usage = (n) => ({ inputTokens: n, cachedInputTokens: 0, outputTokens: Math.ceil(n / 2), reasoningOutputTokens: 0, totalTokens: n + Math.ceil(n / 2) });

  /** @param {string} threadId @param {string} turnId @param {string} prompt @param {string} cwd */
  const playTurn = async (threadId, turnId, prompt, cwd) => {
    const turn = pickTurn(prompt);
    log({ kind: 'turn', threadId, promptTail: prompt.slice(-200), promptLength: prompt.length, matched: turn.match ?? null });
    send({ method: 'turn/started', params: { threadId, turn: { id: turnId, status: 'inProgress', items: [], error: null } } });
    const items = [];
    for (const step of turn.steps ?? []) {
      await sleep(step.delayMs ?? scenario.stepDelayMs);
      if (turns.get(turnId)?.interrupted) break;
      if (step.waitForFile) {
        log({ kind: 'waiting', file: step.waitForFile });
        await waitForFile(step.waitForFile);
        continue;
      }
      const id = `item_${randomUUID().slice(0, 8)}`;
      if (typeof step.text === 'string') {
        const item = { type: 'agentMessage', id, text: step.text, phase: 'final_answer' };
        send({ method: 'item/started', params: { threadId, turnId, item: { ...item, text: '' } } });
        send({ method: 'item/completed', params: { threadId, turnId, item } });
        items.push(item);
      } else if (step.fileChange) {
        const abs = path.resolve(cwd, step.fileChange.path);
        const rel = path.relative(cwd, abs);
        if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`refusing path outside cwd: ${step.fileChange.path}`);
        const changes = [{ path: abs, kind: { type: 'add' }, diff: step.fileChange.content }];
        const added = step.fileChange.content.replace(/\n$/, '').split('\n').map((l) => `+${l}`);
        const patch = ['*** Begin Patch', `*** Add File: ${rel}`, ...added, '*** End Patch', ''].join('\n');
        const common = { session_id: threadId, transcript_path: null, cwd, model: scenario.model, turn_id: turnId, tool_name: 'apply_patch', tool_use_id: id, tool_input: { input: patch } };
        const hookCtx = { sources: runnableHookSources(config), env: process.env, cwd, log };
        const pre = await fireHook('PreToolUse', common, hookCtx);
        log({ kind: 'pre-tool', tool: 'apply_patch', decision: pre.decision ?? null });
        if (pre.decision === 'deny') {
          const declined = { type: 'fileChange', id, status: 'declined', changes };
          send({ method: 'item/completed', params: { threadId, turnId, item: declined } });
          items.push(declined);
          continue;
        }
        send({ method: 'item/started', params: { threadId, turnId, item: { type: 'fileChange', id, status: 'inProgress', changes } } });
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, step.fileChange.content);
        const done = { type: 'fileChange', id, status: 'completed', changes };
        send({ method: 'item/completed', params: { threadId, turnId, item: done } });
        items.push(done);
        await fireHook('PostToolUse', { ...common, tool_response: { success: true } }, hookCtx);
      }
    }
    usageTotal += 20;
    send({ method: 'thread/tokenUsage/updated', params: { threadId, turnId, tokenUsage: { total: usage(usageTotal), last: usage(20), modelContextWindow: 272000 } } });
    const interrupted = turns.get(turnId)?.interrupted === true;
    const status = interrupted ? 'interrupted' : turn.status ?? 'completed';
    send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status, items, error: status === 'failed' ? { message: 'scripted failure' } : null } } });
    log({ kind: 'result', threadId, status });
  };

  const handlers = {
    initialize: () => ({ userAgent: `codex_cli_rs/${scenario.version} (fake engine)`, platformFamily: process.platform === 'win32' ? 'windows' : 'unix', platformOs: process.platform }),
    'config/read': () => ({ config: { model: scenario.model, approval_policy: 'on-request', sandbox_mode: 'workspace-write' } }),
    'model/list': () => ({
      data: [{
        id: scenario.model, model: scenario.model, displayName: 'GPT-6.1 Sol', description: 'Fake engine model',
        supportedReasoningEfforts: ['low', 'medium', 'high'].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
        defaultReasoningEffort: 'medium', inputModalities: ['text', 'image'], hidden: false, isDefault: true,
      }],
      nextCursor: null,
    }),
    'account/rateLimits/read': () => ({
      rateLimits: {
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 },
        secondary: { usedPercent: 3, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 86400 },
      },
    }),
    'thread/start': (p) => {
      const id = randomUUID();
      threads.set(id, { cwd: p?.cwd ?? process.cwd() });
      queueMicrotask(() => send({ method: 'thread/started', params: { thread: { id } } }));
      return { thread: { id, sessionId: id, preview: '', ephemeral: false, modelProvider: 'openai', createdAt: Math.floor(Date.now() / 1000) } };
    },
    'thread/resume': (p) => {
      const id = String(p?.threadId ?? randomUUID());
      if (!threads.has(id)) threads.set(id, { cwd: p?.cwd ?? process.cwd() });
      return { thread: { id, ephemeral: false } };
    },
    'turn/start': (p) => {
      const threadId = String(p?.threadId ?? '');
      const turnId = `turn_${randomUUID().slice(0, 8)}`;
      const input = Array.isArray(p?.input) ? p.input : [];
      const prompt = input.filter((x) => x?.type === 'text').map((x) => x.text).join('\n');
      turns.set(turnId, { interrupted: false });
      const cwd = threads.get(threadId)?.cwd ?? process.cwd();
      setTimeout(() => {
        playTurn(threadId, turnId, prompt, cwd).catch((err) => {
          log({ kind: 'crash', error: String(err?.stack ?? err) });
          send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'failed', items: [], error: { message: String(err?.message ?? err) } } } });
        });
      }, 0);
      return { turn: { id: turnId, status: 'inProgress', items: [], error: null } };
    },
    'turn/interrupt': (p) => {
      const t = turns.get(String(p?.turnId ?? ''));
      if (t) t.interrupted = true;
      return {};
    },
    'thread/compact/start': () => ({}),
    'hooks/list': (p) => {
      const cwds = Array.isArray(p?.cwds) && p.cwds.length ? p.cwds : [process.cwd()];
      const hooks = listHooks(config).map(({ key, source, eventName, command, currentHash, enabled, trustStatus }) => ({ key, source, eventName, command, currentHash, enabled, trustStatus }));
      return { data: cwds.map((cwd) => ({ cwd, hooks })) };
    },
  };

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      log({ kind: 'bad-input', line: trimmed.slice(0, 200) });
      continue;
    }
    if (msg.id === undefined) {
      log({ kind: 'notification', method: msg.method });
      continue;
    }
    if (msg.method === undefined) {
      // A response to a request we never sent — the fake does not ask for approvals.
      log({ kind: 'stray-response', id: msg.id });
      continue;
    }
    log({ kind: 'request', method: msg.method });
    const handler = handlers[msg.method];
    if (!handler) {
      send({ id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
      log({ kind: 'unsupported-method', method: msg.method });
      continue;
    }
    try {
      send({ id: msg.id, result: handler(msg.params) });
    } catch (err) {
      send({ id: msg.id, error: { code: -32603, message: String(err?.message ?? err) } });
    }
  }
  return 0;
}

// ── probes ────────────────────────────────────────────────────────────────────

async function main() {
  log({ kind: 'invoke', argv, cwd: process.cwd() });
  const first = argv.find((a) => !a.startsWith('-') && !/^[\w.]+=/.test(a));
  if (argv[0] === '--version' || argv[0] === '-V') {
    process.stdout.write(`codex-cli ${scenario.version}\n`);
    return 0;
  }
  if (argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write('Codex CLI\n\nUsage: codex [OPTIONS] [PROMPT]\n       codex <COMMAND>\n\nCommands:\n  exec\n  login\n  logout\n  mcp\n  plugin\n  app-server\n');
    return 0;
  }
  if (first === 'login' && argv.includes('status')) {
    if (scenario.loggedIn) {
      process.stdout.write('Logged in using ChatGPT\n');
      return 0;
    }
    process.stdout.write('Not logged in\n');
    return 1;
  }
  if ((first === 'mcp' || first === 'plugin') && argv.includes('list')) {
    process.stdout.write(argv.includes('--json') ? '[]\n' : `No ${first === 'mcp' ? 'MCP servers' : 'plugins'} configured.\n`);
    return 0;
  }
  if (first === 'app-server') return appServer();
  log({ kind: 'unsupported-subcommand', argv });
  process.stderr.write(`fake-codex: "${argv.join(' ')}" is not scripted\n`);
  return 1;
}

main().then((code) => {
  log({ kind: 'exit', code });
  process.exitCode = code;
}, (err) => {
  log({ kind: 'crash', error: String(err?.stack ?? err) });
  process.exitCode = 1;
});

// Runs configured hooks the way the real CLI does (code.claude.com/docs/en/hooks): every settings source contributes,
// `matcher` filters tool events, `type:"command"` gets the payload on stdin (exec form when `args` is present),
// `type:"http"` POSTs it with `$VAR` header interpolation limited to `allowedEnvVars`. The fake therefore exercises the
// app's real installer output instead of a shortcut straight to our endpoint.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied']);
const DEFAULT_TIMEOUT_SEC = 600;

/** @param {NodeJS.ProcessEnv} env */
export function claudeConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude');
}

/** @param {string} file */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Every hooks source for this run, in the CLI's precedence order. All of them run — hooks merge, they don't override.
 * @param {{ cwd: string, settingsArg?: string, pluginDirs?: string[], env?: NodeJS.ProcessEnv }} o
 * @returns {{ source: string, hooks: Record<string, any[]>, pluginRoot?: string }[]}
 */
export function collectHookSources(o) {
  const out = [];
  const push = (source, json, pluginRoot) => {
    if (json && typeof json === 'object' && json.hooks && typeof json.hooks === 'object') out.push({ source, hooks: json.hooks, pluginRoot });
  };
  push('user', readJson(path.join(claudeConfigDir(o.env), 'settings.json')));
  push('project', readJson(path.join(o.cwd, '.claude', 'settings.json')));
  push('local', readJson(path.join(o.cwd, '.claude', 'settings.local.json')));
  if (o.settingsArg) {
    const inline = o.settingsArg.trim().startsWith('{') ? safeParse(o.settingsArg) : readJson(path.resolve(o.cwd, o.settingsArg));
    push('flag', inline);
  }
  for (const dir of o.pluginDirs ?? []) {
    push(`plugin:${dir}`, readJson(path.join(dir, 'hooks', 'hooks.json')), dir);
  }
  return out;
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Official matcher semantics: empty / "*" / absent match everything; `A|B` lists names; anything else is a regex. */
export function matcherMatches(matcher, toolName) {
  if (matcher === undefined || matcher === null || matcher === '' || matcher === '*') return true;
  if (!toolName) return false;
  if (/^[A-Za-z0-9_|]+$/.test(matcher)) return matcher.split('|').includes(toolName);
  try {
    return new RegExp(`^(?:${matcher})$`).test(toolName);
  } catch {
    return false;
  }
}

/** `if` uses permission-rule syntax; the fake honours the tool-name part, which is all the app's installer writes. */
export function ifMatches(rule, toolName) {
  if (!rule) return true;
  return rule.split('|').some((part) => {
    const name = part.trim().replace(/\(.*\)$/, '');
    return name === toolName;
  });
}

/** @param {string} value @param {string[]} allowed @param {NodeJS.ProcessEnv} env */
export function interpolateHeader(value, allowed, env) {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, a, b) => {
    const name = a ?? b;
    return allowed.includes(name) ? env[name] ?? '' : '';
  });
}

/**
 * Fires one event. Resolves after every synchronous hook finished; async hooks are started and left running.
 * @param {string} event
 * @param {Record<string, unknown>} payload
 * @param {{ sources: ReturnType<typeof collectHookSources>, env: NodeJS.ProcessEnv, cwd: string,
 *   log: (entry: object) => void }} ctx
 * @returns {Promise<{ decision?: string, reason?: string, additionalContext: string[] }>}
 */
export async function fireHook(event, payload, ctx) {
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : undefined;
  const body = JSON.stringify({ ...payload, hook_event_name: event });
  /** @type {Promise<{ stdout: string, ok: boolean }>[]} */
  const waits = [];
  for (const src of ctx.sources) {
    const groups = Array.isArray(src.hooks[event]) ? src.hooks[event] : [];
    for (const group of groups) {
      if (TOOL_EVENTS.has(event) && !matcherMatches(group?.matcher, toolName)) continue;
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        if (TOOL_EVENTS.has(event) && !ifMatches(hook.if, toolName)) continue;
        const run = hook.type === 'http' ? runHttp(hook, body, ctx) : hook.type === 'command' ? runCommand(hook, body, src, ctx) : null;
        if (!run) continue;
        ctx.log({ kind: 'hook', event, source: src.source, type: hook.type, async: hook.async === true });
        if (hook.async === true) run.catch(() => {});
        else waits.push(run);
      }
    }
  }
  const outcome = { decision: undefined, reason: undefined, additionalContext: [] };
  for (const r of await Promise.all(waits)) {
    const json = safeParse(r.stdout.trim());
    const specific = json?.hookSpecificOutput;
    if (specific?.permissionDecision && !outcome.decision) {
      outcome.decision = specific.permissionDecision;
      outcome.reason = specific.permissionDecisionReason;
    }
    if (typeof specific?.additionalContext === 'string') outcome.additionalContext.push(specific.additionalContext);
    if (json?.decision === 'block' && !outcome.decision) {
      outcome.decision = 'deny';
      outcome.reason = json.reason;
    }
  }
  return outcome;
}

function runHttp(hook, body, ctx) {
  const allowed = Array.isArray(hook.allowedEnvVars) ? hook.allowedEnvVars : [];
  /** @type {Record<string, string>} */
  const headers = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(hook.headers ?? {})) headers[k] = interpolateHeader(String(v), allowed, ctx.env);
  const timeoutMs = (Number(hook.timeout) || DEFAULT_TIMEOUT_SEC) * 1000;
  return fetch(hook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) })
    .then(async (res) => {
      const text = await res.text();
      ctx.log({ kind: 'hook-http', url: hook.url, status: res.status });
      return { stdout: res.ok ? text : '', ok: res.ok };
    })
    .catch((err) => {
      ctx.log({ kind: 'hook-http', url: hook.url, error: String(err?.message ?? err) });
      return { stdout: '', ok: false };
    });
}

function runCommand(hook, body, src, ctx) {
  const timeoutMs = (Number(hook.timeout) || DEFAULT_TIMEOUT_SEC) * 1000;
  const env = { ...ctx.env, CLAUDE_PROJECT_DIR: ctx.cwd, ...(src.pluginRoot ? { CLAUDE_PLUGIN_ROOT: src.pluginRoot } : {}) };
  const expand = (s) => String(s)
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, ctx.cwd)
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, src.pluginRoot ?? '');
  // Exec form (`args`) never touches a shell on any OS; shell form is `sh -c` on POSIX, PowerShell on Windows.
  const [file, argv, opts] = Array.isArray(hook.args)
    ? [expand(hook.command), hook.args.map(expand), { shell: false }]
    : process.platform === 'win32'
      ? ['powershell.exe', ['-NoProfile', '-Command', expand(hook.command)], { shell: false }]
      : ['/bin/sh', ['-c', expand(hook.command)], { shell: false }];
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(file, argv, { ...opts, cwd: ctx.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      ctx.log({ kind: 'hook-command', command: file, error: String(err?.message ?? err) });
      resolve({ stdout: '', ok: false });
      return;
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      ctx.log({ kind: 'hook-command', command: file, error: String(err?.message ?? err) });
      resolve({ stdout: '', ok: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      ctx.log({ kind: 'hook-command', command: path.basename(file), exit: code, stderr: stderr.slice(0, 500) });
      // Exit 2 is the documented blocking error; stderr is the reason.
      if (code === 2) resolve({ stdout: JSON.stringify({ decision: 'block', reason: stderr.trim() }), ok: false });
      else resolve({ stdout: code === 0 ? stdout : '', ok: code === 0 });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(body);
  });
}

/** Opt-in: uses the signed-in Codex CLI for three short turns (§5.25 (H) permission bridge).
 * The loopback /api/permission-check endpoint is a fixture; the runner, hook trust, helper and Codex are real.
 *
 * The working folder must NOT live under the OS temp folder: the workspace-write sandbox may allow the temp
 * roots, and then the outside write never asks for approval. Set VIBISUAL_CODEX_PERMISSION_LIVE_DIR to a
 * scratch folder outside it (default: the home folder; everything created is removed afterwards). */
import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runCodexTurn, stopCodexTurn } from './codexRunner.js';

type HookEvent = 'PreToolUse' | 'PermissionRequest';
interface CheckBody { engine?: string; hookEvent?: HookEvent; sessionId?: string; parentAgentId?: string; subAgentId?: string; toolName?: string; toolInput?: Record<string, unknown>; toolUseId?: string; cwd?: string }

const LIVE = process.env.VIBISUAL_CODEX_PERMISSION_LIVE_TEST === '1';
const TOKEN = 'live-permission-token';
const helperPath = fileURLToPath(new URL('../../../../hooks/codex-edges.mjs', import.meta.url));

async function liveTurn(permissionMode: string, prompt: string, decide: (check: CheckBody) => 'allow' | 'deny') {
  const root = mkdtempSync(join(process.env.VIBISUAL_CODEX_PERMISSION_LIVE_DIR ?? homedir(), 'vibisual-codex-perm-'));
  const ws = join(root, 'ws');
  mkdirSync(ws);
  const nonce = randomUUID().slice(0, 8);
  const outsideFile = join(root, `outside-${nonce}.txt`);
  const insideFile = join(ws, `inside-${nonce}.txt`);
  const subAgentId = `live-perm-${nonce}`;
  const events: string[] = [];
  const received: CheckBody[] = [];
  const server: Server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/permission-check' || req.headers['x-vibisual-hook-token'] !== TOKEN) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const check = JSON.parse(raw) as CheckBody;
    received.push(check);
    const decision = decide(check);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, decision, ...(decision === 'deny' ? { reason: 'live test' } : {}) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const timer = setTimeout(() => stopCodexTurn(subAgentId), 150000);
  try {
    const text = await new Promise<string>((resolve, reject) => {
      runCodexTurn({
        subAgentId, cwd: ws, model: 'gpt-6-astra', reasoningEffort: 'low', permissionMode,
        prompt: prompt.replaceAll('{OUTSIDE}', outsideFile.replaceAll('\\', '/')).replaceAll('{INSIDE}', `inside-${nonce}.txt`),
        ownerAgentId: 'live-owner',
        permissionHook: { helperPath, nodeBin: process.execPath, required: true },
        env: { VIBISUAL_BASE: `http://127.0.0.1:${(server.address() as { port: number }).port}`, VIBISUAL_TOKEN: TOKEN },
        onThread: () => {}, onUsage: () => {}, onFileWrites: () => {},
        onEvent: (event) => { events.push(`${event.eventType} ${event.toolName ?? ''} ${String(event.content).slice(0, 300)}`); },
        onDone: (error, finalText) => error ? reject(new Error(error)) : resolve(finalText),
      });
    });
    const outsideExists = existsSync(outsideFile);
    const insideExists = existsSync(insideFile);
    const log = `${events.join('\n')}\n--- final ---\n${text}\n--- checks ---\n${received.map((check) => `${check.hookEvent} ${check.toolName} ${JSON.stringify(check.toolInput).slice(0, 200)}`).join('\n')}`;
    return { subAgentId, received, outsideExists, insideExists, log };
  } finally {
    clearTimeout(timer);
    stopCodexTurn(subAgentId);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

const OUTSIDE_PROMPT = 'Integration test of an approval flow. Run one shell command that writes the text "outside" to {OUTSIDE} (outside the workspace). If the sandbox blocks it, request escalation with sandbox_permissions. If the escalation is denied, do not try any other way. Then report the result in one line.';
const INSIDE_PROMPT = 'Integration test of a tool policy. Run one shell command that writes the text "inside" to {INSIDE} in the working directory. If the tool is blocked, do not try any other way. Then report the result in one line.';
const summary = (received: CheckBody[]) => received.map((check) => `${check.hookEvent}:${check.toolName}`);

describe.runIf(LIVE)('real Codex permission bridge (§5.25 (H))', () => {
  it('default mode: a denied approval request keeps the outside write from running', async () => {
    const turn = await liveTurn('default', OUTSIDE_PROMPT, (check) => check.hookEvent === 'PermissionRequest' ? 'deny' : 'allow');
    const requests = turn.received.filter((check) => check.hookEvent === 'PermissionRequest');
    expect(requests.length, turn.log).toBeGreaterThan(0);
    expect(requests[0], turn.log).toMatchObject({ engine: 'codex', parentAgentId: 'live-owner', subAgentId: turn.subAgentId });
    expect(requests[0]?.toolUseId, turn.log).toBeUndefined();
    const pre = turn.received.filter((check) => check.hookEvent === 'PreToolUse');
    expect(pre.length, turn.log).toBeGreaterThan(0);
    expect(pre.every((check) => check.engine === 'codex' && typeof check.toolUseId === 'string' && check.subAgentId === turn.subAgentId), turn.log).toBe(true);
    expect(turn.outsideExists, turn.log).toBe(false);
    console.info('LIVE_PERMISSION_DENY', JSON.stringify({ checks: summary(turn.received), outsideExists: turn.outsideExists }));
  }, 170000);

  it('default mode: an allowed approval request lets the outside write run', async () => {
    const turn = await liveTurn('default', OUTSIDE_PROMPT, () => 'allow');
    expect(turn.received.some((check) => check.hookEvent === 'PermissionRequest'), turn.log).toBe(true);
    expect(turn.outsideExists, turn.log).toBe(true);
    console.info('LIVE_PERMISSION_ALLOW', JSON.stringify({ checks: summary(turn.received), outsideExists: turn.outsideExists }));
  }, 170000);

  it('auto mode: the audit boundary denies at PreToolUse and nothing asks for approval', async () => {
    const turn = await liveTurn('auto', INSIDE_PROMPT, (check) => check.hookEvent === 'PreToolUse' ? 'deny' : 'allow');
    expect(turn.received.some((check) => check.hookEvent === 'PreToolUse'), turn.log).toBe(true);
    expect(turn.received.some((check) => check.hookEvent === 'PermissionRequest'), turn.log).toBe(false);
    expect(turn.insideExists, turn.log).toBe(false);
    console.info('LIVE_BOUNDARY_DENY', JSON.stringify({ checks: summary(turn.received), insideExists: turn.insideExists }));
  }, 170000);
});

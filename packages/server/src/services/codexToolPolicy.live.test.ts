/** Opt-in real CLI verification. Only disposable fixture paths reach the model.
 * Approval answers are supplied by the fixture, never by a real user popup. */
import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { decideCodexTool, type CodexToolPolicy } from '@vibisual/shared';
import { runCodexTurn, stopCodexTurn } from './codexRunner.js';

it.runIf(process.env.VIBISUAL_CODEX_TOOL_LIVE_TEST === '1')('real CLI honors allow and deny responses before applying a patch, including resume', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'vibisual-codex-tool-permission-'));
  const id = `tool-policy-${randomUUID()}`;
  const policy: CodexToolPolicy = { shell: 'deny', edit: 'ask', mcp: 'deny', web: 'deny', image: 'deny', computer: 'deny' };
  let answer: 'allow' | 'deny' = 'allow';
  let thread: string | undefined;
  const asks: string[] = [];
  const events: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.url !== '/api/codex-tool-check' || req.headers['x-vibisual-hook-token'] !== 'fixture') {
      res.writeHead(403); res.end('{}'); return;
    }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const choice = decideCodexTool(policy, body.toolName);
    if (choice === 'ask') asks.push(answer);
    // Keep the hook waiting briefly so the response is demonstrably asynchronous.
    await new Promise((resolve) => setTimeout(resolve, 100));
    res.end(JSON.stringify({ decision: choice === 'ask' ? answer : choice, reason: choice === 'ask' ? 'user' : 'tool-policy' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const run = (file: string) => new Promise<void>((resolve, reject) => runCodexTurn({
    subAgentId: id, ownerAgentId: 'fixture-owner', cwd, model: 'gpt-6-astra', reasoningEffort: 'low', permissionMode: 'bypassPermissions',
    resumeThreadId: thread,
    toolHook: { helperPath: fileURLToPath(new URL('../../../../hooks/codex-edges.mjs', import.meta.url)), nodeBin: process.execPath, policy },
    env: { VIBISUAL_BASE: `http://127.0.0.1:${(server.address() as { port: number }).port}`, VIBISUAL_TOKEN: 'fixture' },
    prompt: `Tool approval integration fixture. Use apply_patch once to create ${file} in this temporary working directory with the exact text TOOL_PERMISSION_OK. The test hook will answer. If denied, stop immediately, do not retry or use alternative tools. No network, no other files, no delegation.`,
    onThread: (value) => { thread = value; }, onUsage: () => {}, onFileWrites: () => {},
    onEvent: (event) => events.push(`${event.eventType} ${event.toolName ?? ''} ${event.content ?? ''}`),
    onDone: (error) => error ? reject(new Error(error)) : resolve(),
  }));
  const timer = setTimeout(() => stopCodexTurn(id), 150000);
  try {
    await run('allowed.txt');
    expect(asks, events.join('\n')).toContain('allow');
    expect(readFileSync(join(cwd, 'allowed.txt'), 'utf8')).toContain('TOOL_PERMISSION_OK');
    expect(thread).toBeTruthy();
    answer = 'deny';
    await run('denied.txt');
    expect(asks, events.join('\n')).toContain('deny');
    expect(existsSync(join(cwd, 'denied.txt')), events.join('\n')).toBe(false);
    console.info('LIVE_TOOL_PERMISSION_PROOF', JSON.stringify({ allowedPatchWritten: true, deniedPatchAbsent: true, resumed: !!thread, asks }));
  } finally {
    clearTimeout(timer); stopCodexTurn(id); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}, 170000);

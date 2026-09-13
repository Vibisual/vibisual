/** Opt-in: uses the signed-in Codex CLI for two short turns in a temporary folder.
 * The loopback dispatch endpoint is a fixture; both source and target runners are real. */
import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runCodexTurn, stopCodexTurn, type CodexTurnArgs } from './codexRunner.js';

it.runIf(process.env.VIBISUAL_CODEX_EDGE_LIVE_TEST === '1')('real Codex source delegates to a real Codex target and receives the file result', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'vibisual-codex-edge-'));
  const nonce = `EDGE_RESULT_${randomUUID()}`;
  writeFileSync(join(cwd, 'fixture.txt'), nonce);
  const events: string[] = [];
  const sourceId = `live-source-${randomUUID()}`;
  const targetId = `live-target-${randomUUID()}`;
  let dispatched = 0;
  const run = (id: string, options: Partial<CodexTurnArgs>): Promise<string> => new Promise((resolve, reject) => {
    runCodexTurn({ subAgentId: id, cwd, model: 'gpt-6-astra', reasoningEffort: 'low', permissionMode: 'auto',
      prompt: '', onThread: () => {}, onUsage: () => {}, onFileWrites: () => {},
      onEvent: (event) => { events.push(`${id}: ${event.eventType} ${event.toolName ?? ''} ${event.content}`); },
      onDone: (error, text) => error ? reject(new Error(error)) : resolve(text), ...options,
    });
  });
  const server = createServer(async (req, res) => {
    if (req.url !== '/api/task-edges/dispatch?edgeId=edge-live' || req.headers['x-vibisual-hook-token'] !== 'live-test-token'
      || req.headers['x-vibisual-source-agent'] !== 'live-source') {
      res.writeHead(403); res.end('forbidden'); return;
    }
    let instruction = '';
    for await (const chunk of req) instruction += chunk;
    dispatched++;
    try {
      const result = await run(targetId, { prompt: `Integration test: ${instruction}\nRead only fixture.txt in this working directory. Return its exact contents. Do not modify files or use any network service.` });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, waited: true, result }));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const timer = setTimeout(() => { stopCodexTurn(sourceId); stopCodexTurn(targetId); }, 150000);
  try {
    const result = await run(sourceId, {
      ownerAgentId: 'live-source',
      edgeConfig: { helperPath: fileURLToPath(new URL('../../../../hooks/codex-edges.mjs', import.meta.url)), nodeBin: process.execPath, edgeIds: ['edge-live'], restrictedTools: ['Read', 'Write'] },
      env: { VIBISUAL_BASE: `http://127.0.0.1:${(server.address() as { port: number }).port}`, VIBISUAL_TOKEN: 'live-test-token' },
      prompt: 'This is an integration test of a tool gate. First attempt apply_patch to add forbidden.txt containing "should be blocked"; the policy should deny it. Whether unavailable or denied, then use the vibisual_edges dispatch MCP tool with edgeId "edge-live", instruction "Read fixture.txt and return its exact content". Do not try alternative direct tools. Return the exact file content received from the target.',
    });
    expect(dispatched, events.join('\n')).toBe(1);
    expect(result, events.join('\n')).toContain(nonce);
    expect(existsSync(join(cwd, 'forbidden.txt')), events.join('\n')).toBe(false);
    expect(events.some((event) => event.includes(targetId) && event.includes('tool_use'))).toBe(true);
    console.info('LIVE_EDGE_PROOF', JSON.stringify({ dispatched, receivedTargetNonce: result.includes(nonce), forbiddenFileAbsent: !existsSync(join(cwd, 'forbidden.txt')), sourceGateObserved: events.some((event) => event.includes('Vibisual tool delegation')) }));
  } finally {
    clearTimeout(timer);
    stopCodexTurn(sourceId); stopCodexTurn(targetId);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}, 170000);

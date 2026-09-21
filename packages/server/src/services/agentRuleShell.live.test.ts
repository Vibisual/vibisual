/** Opt-in: one real Codex turn against an isolated HTTP fixture; never writes a real IDE card. */
import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { agentRuleShell, buildAgentCardCommonRules, buildOrchestraConductorRules } from '@vibisual/shared';
import { runCodexTurn, stopCodexTurn } from './codexRunner.js';

it.runIf(process.env.VIBISUAL_CODEX_RULE_LIVE_TEST === '1').each(['card', 'orchestra'] as const)('real Codex executes generated %s protocol with TOKEN filtered out', async (protocol) => {
  const cwd = mkdtempSync(join(tmpdir(), 'vibisual-codex-rules-'));
  const subAgentId = `rule-live-${randomUUID()}`;
  const token = randomUUID();
  const endpoint = protocol === 'card' ? '/api/agent-review' : '/api/orchestra/runs/live-orchestra/plan';
  const received: unknown[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== endpoint || req.headers['x-vibisual-hook-token'] !== token) {
      res.writeHead(401).end(); return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try { received.push(JSON.parse(raw)); } catch { res.writeHead(400).end(); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  const serverBase = `http://127.0.0.1:${address.port}`;
  const rules = protocol === 'card'
    ? buildAgentCardCommonRules({ serverBase, serverToken: token, agentId: 'live-agent', subAgentId, shell: agentRuleShell('codex', process.platform) })
    : buildOrchestraConductorRules({ serverBase, runId: 'live-orchestra', conductorAgentId: 'live-agent', conductorSubAgentId: subAgentId, projectName: null, centerX: 0, centerY: 0, settings: {}, existingMembers: [], existingEdges: [], conductorEngine: 'codex', platform: process.platform });
  const task = protocol === 'card'
    ? 'Execute exactly one POST to /api/agent-review using the generated protocol above. Add changes:["한글 왕복 확인"] and checkpoints:["테스트 서버 수신"] to the JSON IDs.'
    : 'User question: 2+2는 무엇입니까? This is a question needing no members. Apply the conductor rules: choose intent question, topology none, report the plan once with note "한글 왕복 확인", then answer. No create/config/edge/kickoff requests are needed.';
  const timer = setTimeout(() => stopCodexTurn(subAgentId), 90_000);
  try {
    const finalText = await new Promise<string>((resolve, reject) => {
      runCodexTurn({ subAgentId, cwd, model: 'gpt-6-astra', reasoningEffort: 'low', permissionMode: 'auto', networkAccess: true,
        env: { VIBISUAL_BASE: serverBase, VIBISUAL_TOKEN: token },
        prompt: `${rules}\n\nIntegration test, authorized against an isolated local HTTP fixture only. ${task} In that same shell command, remove VIBISUAL_TOKEN from the command environment before executing the protocol, to simulate Codex default exclusion; the protocol's VIBISUAL_HOOK_AUTH fallback must authenticate. Do not print any credential values. Do not inspect or change any files. Do not create agents. This one fixture request is the entire task.`,
        onThread: () => {}, onUsage: () => {}, onFileWrites: () => {}, onEvent: () => {},
        onDone: (error, text) => error ? reject(new Error(error)) : resolve(text),
      });
    });
    expect(finalText).not.toContain(token);
    expect(received).toHaveLength(1);
    if (protocol === 'card') expect(received).toEqual([{ agentId: 'live-agent', subAgentId, changes: ['한글 왕복 확인'], checkpoints: ['테스트 서버 수신'] }]);
    else expect(received[0]).toMatchObject({ intent: 'question', topology: 'none', note: '한글 왕복 확인' });
  } finally {
    clearTimeout(timer);
    stopCodexTurn(subAgentId);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (dirname(resolve(cwd)) !== resolve(tmpdir()) || !basename(cwd).startsWith('vibisual-codex-rules-')) throw new Error('unexpected scratch path');
    await rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 100_000);

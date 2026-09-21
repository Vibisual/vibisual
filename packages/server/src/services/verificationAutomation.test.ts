import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VERIFICATION_AUTOMATION as L, parseVerificationAction, parseVerificationCheck, parseVerificationTarget, type VerificationRun } from '@vibisual/shared';
import { ProjectGraph, normalizeVerificationDemo, normalizeVerificationRun } from './projectGraph.js';
import { VerificationAutomationService, verificationEvidenceVerdict, verificationToolHandler, buildVerificationAutomationPrompt } from './verificationAutomation.js';
import type { VerificationAutomationAdapter } from './verificationAutomationAdapter.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM9sAAAAASUVORK5CYII=', 'base64');
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function harness(procedure?: VerificationRun['procedure']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-verify-automation-'));
  const graph = new ProjectGraph();
  let activeCommand = true;
  let checked = true;
  const adapter: VerificationAutomationAdapter = {
    probe: vi.fn(async () => ({ available: true, actions: ['click'], checks: ['text'] })),
    open: vi.fn(async () => {}), close: vi.fn(async () => {}),
    observe: vi.fn(async () => ({ png, width: 1, height: 1, elements: [], url: 'http://localhost:9000/' })),
    act: vi.fn(async () => 'Clicked the selected button.'), check: vi.fn(async () => ({ passed: checked, detail: checked ? 'Expected result visible.' : 'Expected result is missing.' })),
  };
  const run: VerificationRun = { id: 'ver-test', agentId: 'a', subAgentId: 's', projectName: 'fixture',
    target: { kind: 'browser', url: 'http://localhost:9000/' }, expected: 'Expected result',
    ...(procedure ? { procedure, requiredSteps: procedure.length } : {}),
    recipeSource: 'none', status: 'running', verdict: 'unknown', startedAt: Date.now(), pendingCommandId: 'cmd-test', attempts: [], toolEvents: [], evidence: [] };
  graph.addVerificationRun(run);
  const service = new VerificationAutomationService({ findRun: (id) => graph.findVerificationRun(id), updateRun: (id, patch) => graph.updateVerificationRun(id, patch), projectRoot: () => root,
    adapter: () => adapter, isCommandActive: () => activeCommand, changed: vi.fn() });
  await service.open(run);
  cleanups.push(() => {
    for (const r of graph.getVerificationRuns('s')) service.close(r.id);
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('vib-verify-automation-')) throw new Error('Unsafe test directory');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const invoke = (operation: string, input: Record<string, unknown> = {}) => service.invoke(operation, { runId: run.id, ...input }, { agentId: 'a', subAgentId: 's' });
  const current = () => graph.findVerificationRun(run.id)!;
  return { root, graph, service, adapter, run, invoke, current, setCheck: (value: boolean) => { checked = value; }, stopCommand: () => { activeCommand = false; } };
}

describe('actual verification evidence ledger', () => {
  it('holds an unsupported success claim and closes tools after finalization', async () => {
    const h = await harness();
    await h.invoke('finalize', { verdict: 'pass', reason: 'I say it works', attempts: [{ kind: 'run', exitCode: 0 }] });
    expect(h.current().verdict).toBe('held');
    expect((await h.invoke('act', { action: { kind: 'click', selector: '#ok' } })).isError).toBe(true);
    expect(h.adapter.act).not.toHaveBeenCalled();
  });
  it('records actual images and hashes, passes only after the final action was checked, and preserves them in snapshots', async () => {
    const h = await harness();
    await h.invoke('act', { action: { kind: 'click', selector: '#ok' } });
    expect(verificationEvidenceVerdict(h.current()).verdict).toBe('held');
    await h.invoke('check', { check: { kind: 'text', selector: '#result', expected: 'Expected result' } });
    await h.invoke('finalize', { verdict: 'pass' });
    expect(h.current().verdict).toBe('pass');
    expect(h.current().evidence).toHaveLength(2);
    const image = h.current().evidence![1]!;
    expect(image.sha256).toBe(createHash('sha256').update(png).digest('hex'));
    expect(fs.readFileSync(h.service.evidencePath(h.current(), image.id)!)).toEqual(png);
    expect(normalizeVerificationRun(h.graph.getVerificationRunsRecord()!['s']![0]!).toolEvents).toHaveLength(2);
    h.service.remove(h.current());
    expect(fs.existsSync(path.join(h.root, '.vibisual', L.evidenceDirectory, h.run.id))).toBe(false);
  });
  it('does not accept a check made before a later interaction', async () => {
    const h = await harness();
    await h.invoke('check', { check: { kind: 'text', expected: 'before' } });
    await h.invoke('act', { action: { kind: 'click', selector: '#ok' } });
    expect(verificationEvidenceVerdict(h.current()).verdict).toBe('held');
  });
  it('fails a real assertion and permits a successful retry of that same assertion', async () => {
    const h = await harness();
    await h.invoke('act', { action: { kind: 'click', selector: '#ok' } });
    h.setCheck(false);
    const check = { kind: 'text', expected: 'Expected result' };
    expect((await h.invoke('check', { check })).isError).toBe(true);
    expect(verificationEvidenceVerdict(h.current()).verdict).toBe('fail');
    h.setCheck(true);
    await h.invoke('check', { check });
    expect(verificationEvidenceVerdict(h.current()).verdict).toBe('pass');
  });
  it('rejects another owner, ended command and malformed action without touching the OS', async () => {
    const h = await harness();
    expect((await h.service.invoke('observe', { runId: h.run.id }, { agentId: 'other', subAgentId: 's' })).isError).toBe(true);
    expect((await h.invoke('act', { action: { kind: 'click', x: -0.1, y: 1 } })).isError).toBe(true);
    h.stopCommand();
    expect((await h.invoke('act', { action: { kind: 'click', selector: '#ok' } })).isError).toBe(true);
    expect(h.adapter.act).not.toHaveBeenCalled();
  });
  it('enforces every step and exact registered action/check mappings', async () => {
    const h = await harness([{ atMs: 0, text: 'click', action: { kind: 'click', selector: '#ok' } }, { atMs: 1, text: 'check', check: { kind: 'text', expected: 'Expected result' } }]);
    await h.invoke('act', { stepIndex: 0, action: { kind: 'click', selector: '#wrong' } });
    await h.invoke('check', { stepIndex: 1, check: { kind: 'text', expected: 'Expected result' } });
    expect(verificationEvidenceVerdict(h.current()).verdict).toBe('held');
    await h.invoke('replay');
    expect(verificationEvidenceVerdict(h.current()).verdict).toBe('pass');
  });
  it('executes mapped stepIndex calls and rejects explicit invalid overrides', async () => {
    const h = await harness([{ atMs: 0, text: 'click and check', action: { kind: 'click', selector: '#ok' }, check: { kind: 'text', expected: 'Expected result' } }]);
    expect((await h.invoke('act', { stepIndex: 0, action: null })).isError).toBe(true);
    expect(h.adapter.act).not.toHaveBeenCalled();
    expect((await h.invoke('act', { stepIndex: 0 })).isError).toBeUndefined();
    expect((await h.invoke('check', { stepIndex: 0 })).isError).toBeUndefined();
    expect(verificationEvidenceVerdict(h.current()).verdict).toBe('pass');
  });
  it('does not pass an out-of-order procedure until its ordered replay succeeds', async () => {
    const h = await harness([{ atMs: 0, text: 'open', action: { kind: 'click', selector: '#open' } }, { atMs: 1, text: 'save', action: { kind: 'click', selector: '#save' }, check: { kind: 'text', expected: 'Saved' } }]);
    await h.invoke('act', { stepIndex: 1 });
    await h.invoke('act', { stepIndex: 0 });
    await h.invoke('check', { stepIndex: 1 });
    expect(verificationEvidenceVerdict(h.current()).verdict).toBe('held');
    await h.invoke('replay');
    expect(verificationEvidenceVerdict(h.current()).verdict).toBe('pass');
  });
  it('saves a successful run as durable procedure and replays it in another run', async () => {
    const h = await harness();
    await h.invoke('act', { action: { kind: 'click', selector: '#ok' } });
    await h.invoke('check', { check: { kind: 'text', selector: '#result', expected: 'Expected result' } });
    await h.invoke('finalize', { verdict: 'pass' });
    const demo = normalizeVerificationDemo(h.service.saveProcedure(h.current(), 'Test procedure'));
    expect(demo.target).toEqual(h.run.target);
    expect(demo.steps.map((s) => s.action ?? s.check)).toEqual([{ kind: 'click', selector: '#ok' }, { kind: 'text', selector: '#result', expected: 'Expected result' }]);
    const next = { ...h.run, id: 'ver-next', procedure: demo.steps, requiredSteps: demo.steps.length };
    h.graph.addVerificationRun(next);
    await h.service.open(next);
    expect((await h.service.invoke('replay', { runId: next.id }, { agentId: 'a', subAgentId: 's' })).isError).toBeUndefined();
    expect(verificationEvidenceVerdict(h.graph.findVerificationRun(next.id)!).verdict).toBe('pass');
  });
  it('rejects unsupported replay before any partial actions', async () => {
    const h = await harness([{ atMs: 0, text: 'click', action: { kind: 'click', selector: '#ok' } }, { atMs: 1, text: 'unmapped step' }]);
    expect((await h.invoke('replay')).isError).toBe(true);
    expect(h.adapter.act).not.toHaveBeenCalled();
  });
  it('requires registered screenshot references', async () => {
    const h = await harness();
    expect((await h.invoke('check', { check: { kind: 'screenshot', referenceFrame: 0 }, referencePng: png.toString('base64') })).isError).toBe(true);
    expect(h.adapter.check).not.toHaveBeenCalled();
  });
  it('serializes overlapping interactions and ignores late evidence after stop', async () => {
    const h = await harness();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(h.adapter.act).mockImplementationOnce(async () => { await blocked; return 'late'; });
    const first = h.invoke('act', { action: { kind: 'click', selector: '#first' } });
    await vi.waitFor(() => expect(h.adapter.act).toHaveBeenCalledTimes(1));
    const second = h.invoke('act', { action: { kind: 'click', selector: '#second' } });
    h.graph.updateVerificationRun(h.run.id, { status: 'stopped', pendingCommandId: undefined });
    h.service.close(h.run.id);
    release();
    expect((await first).isError).toBe(true);
    expect((await second).isError).toBe(true);
    expect(h.adapter.act).toHaveBeenCalledTimes(1);
    expect(h.current().evidence).toHaveLength(0);
  });
  it('caps execution time and prevents calls after the deadline', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await vi.advanceTimersByTimeAsync(L.maxDurationMs);
    expect(h.current().verdict).toBe('held');
    expect(h.adapter.close).toHaveBeenCalled();
    expect((await h.invoke('observe')).isError).toBe(true);
  });
  it('cancels an in-flight owned request while preserving another owner\'s run', async () => {
    const h = await harness();
    h.service.cancelOwned(h.run.id, { agentId: 'other', subAgentId: 's' });
    expect(h.current().status).toBe('running');
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(h.adapter.act).mockImplementationOnce(async () => { await blocked; return 'late'; });
    const request = h.invoke('act', { action: { kind: 'click', selector: '#ok' } });
    await vi.waitFor(() => expect(h.adapter.act).toHaveBeenCalled());
    h.service.cancelOwned(h.run.id, { agentId: 'a', subAgentId: 's' });
    release();
    expect((await request).isError).toBe(true);
    expect(h.current().verdict).toBe('held');
    expect(h.current().evidence).toHaveLength(0);
    expect(h.adapter.close).toHaveBeenCalled();
  });
  it('uses an ordinary prompt for both engines with real tools and immutable procedure references', async () => {
    const h = await harness();
    const prompt = buildVerificationAutomationPrompt(h.run);
    expect(prompt).toContain('vibisual_verify');
    expect(prompt).toContain(h.run.id);
    expect(prompt.startsWith('/verify')).toBe(false);
    expect(prompt).toContain('finalize');
  });
});

describe('verification input boundaries', () => {
  it('rejects executable/credential URLs and unbounded coordinates, waits and strings', () => {
    expect(parseVerificationTarget({ kind: 'browser', url: 'javascript:alert(1)' })).toBeUndefined();
    expect(parseVerificationTarget({ kind: 'browser', url: 'https://user:secret@example.com/' })).toBeUndefined();
    expect(parseVerificationAction({ kind: 'click', x: Infinity, y: 0.5 })).toBeUndefined();
    expect(parseVerificationAction({ kind: 'wait', ms: L.maxWaitMs + 1 })).toBeUndefined();
    expect(parseVerificationAction({ kind: 'fill', text: 'x'.repeat(L.maxText + 1) })).toBeUndefined();
    expect(parseVerificationCheck({ kind: 'screenshot', referenceFrame: 0, region: { x: 0.9, y: 0, width: 0.2, height: 1 } })).toBeUndefined();
  });
  it('supports checking a cleared field without permitting a vacuous text match', () => {
    expect(parseVerificationCheck({ kind: 'value', selector: '#name', expected: '' })).toEqual({ kind: 'value', selector: '#name', expected: '' });
    expect(parseVerificationCheck({ kind: 'text', expected: '' })).toBeUndefined();
  });
});

describe('verification tool HTTP authorization', () => {
  it('requires the hook token and correct session, then returns real screenshot MCP content', async () => {
    const h = await harness();
    const app = express(); app.use(express.json());
    app.post('/api/verification-tools/:operation', verificationToolHandler(h.service, () => 'fixture-token', (a, s) => a === 'a' && s === 's'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    cleanups.unshift(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
    const post = (token: string, subAgentId: string) => fetch(`http://127.0.0.1:${address.port}/api/verification-tools/observe`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-vibisual-hook-token': token, 'x-vibisual-source-agent': 'a', 'x-vibisual-source-subagent': subAgentId }, body: JSON.stringify({ runId: h.run.id }) });
    expect((await post('wrong', 's')).status).toBe(403);
    expect((await post('fixture-token', 'wrong')).status).toBe(403);
    const response = await post('fixture-token', 's');
    expect(response.status).toBe(200);
    expect((await response.json() as { content: { type: string }[] }).content.map((c) => c.type)).toEqual(['text', 'image']);
    expect(h.adapter.observe).toHaveBeenCalledTimes(1);
  });
});

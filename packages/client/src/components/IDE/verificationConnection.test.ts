import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerificationToolEvent } from '@vibisual/shared';
import { verificationStepCompletion } from '@vibisual/shared';
import { canRecordVerificationRun, probeVerificationTarget, validVerificationTarget, verificationEvidenceUrl, verificationStepCoverage } from './verificationConnection.js';

afterEach(() => vi.unstubAllGlobals());
describe('verification connections', () => {
  it('records run video only from the same desktop target, never from a hidden browser or another window', () => {
    const desktop = { kind: 'desktop' as const, sourceId: 'window:one', sourceName: 'App', sourceKind: 'window' as const };
    const source = { sourceId: 'window:one' };
    expect(canRecordVerificationRun(desktop, source)).toBe(true);
    expect(canRecordVerificationRun({ ...desktop, sourceId: 'window:other' }, source)).toBe(false);
    expect(canRecordVerificationRun({ kind: 'browser', url: 'http://localhost' }, source)).toBe(false);
    expect(canRecordVerificationRun(desktop, undefined)).toBe(false);
    expect(canRecordVerificationRun(undefined, source)).toBe(false);
  });
  it('accepts HTTP targets and rejects credentials, file and script URLs', () => {
    for (const url of ['http://localhost:3000', 'https://example.org/app']) expect(validVerificationTarget({ kind: 'browser', url })).toBe(true);
    for (const url of ['', 'broken', 'file:///c:/private', 'javascript:alert(1)', 'https://user:secret@example.org']) expect(validVerificationTarget({ kind: 'browser', url })).toBe(false);
    expect(validVerificationTarget(undefined)).toBe(false);
  });
  it('asks the server for actual availability and capabilities', async () => {
    const availability = { available: false, reason: 'desktop-offline', actions: [], checks: [] };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(availability)));
    vi.stubGlobal('fetch', fetcher);
    const target = { kind: 'desktop' as const, sourceId: 'window:4', sourceName: 'Editor', sourceKind: 'window' as const };
    expect(await probeVerificationTarget(target)).toEqual(availability);
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('/api/verification-target/probe');
    expect(JSON.parse(call[1].body as string)).toEqual({ target });
  });
  it('never treats a malformed or failing probe as available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ available: true }), { status: 500 })));
    await expect(probeVerificationTarget({ kind: 'browser', url: 'http://localhost' })).rejects.toThrow();
  });
  it('encodes evidence identifiers independently of server paths', () => {
    expect(verificationEvidenceUrl('run/a', '../frame')).toBe('/api/verification-runs/run%2Fa/evidence/..%2Fframe.png');
  });
  it('counts unique covered steps, excluding failures, observation-only events and invalid indices', () => {
    const event = (stepIndex: number, ok: boolean, operation: VerificationToolEvent['operation'] = 'act'): VerificationToolEvent => ({ id: String(stepIndex), at: 1, durationMs: 1, detail: '', stepIndex, ok, operation, evidenceId: 'shot' });
    const evidence = [{ id: 'shot', rel: 'shot.png', capturedAt: 1, sha256: 'abc', width: 10, height: 10 }];
    expect(verificationStepCoverage({ requiredSteps: 3, evidence, toolEvents: [event(0, true), event(0, true), event(1, false), event(2, true, 'observe'), event(99, true), event(-1, true)] })).toBe(1);
    expect(verificationStepCoverage({})).toBe(0);
  });
  it('requires both mapped action and check with evidence for one procedure step', () => {
    const action = { kind: 'click' as const, selector: '#save' };
    const check = { kind: 'text' as const, expected: 'Saved' };
    const base = { requiredSteps: 1, procedure: [{ atMs: 0, text: 'Save', action, check }], evidence: [{ id: 'shot', rel: 'shot.png', capturedAt: 1, sha256: 'abc', width: 10, height: 10 }] };
    const first: VerificationToolEvent = { id: 'one', at: 1, durationMs: 1, detail: '', stepIndex: 0, ok: true, operation: 'act', action, evidenceId: 'shot' };
    expect(verificationStepCoverage({ ...base, toolEvents: [first] })).toBe(0);
    expect(verificationStepCoverage({ ...base, toolEvents: [first, { ...first, id: 'two', operation: 'check', action: undefined, check }] })).toBe(1);
    expect(verificationStepCoverage({ ...base, evidence: [], toolEvents: [first] })).toBe(0);
    const checkFirst: VerificationToolEvent = { ...first, id: 'check-first', operation: 'check', action: undefined, check };
    expect(verificationStepCompletion({ ...base, toolEvents: [checkFirst, first] })).toEqual([false]);
    expect(verificationStepCompletion({ ...base, procedure: [{ atMs: 0, text: 'Saved', check }], toolEvents: [checkFirst] })).toEqual([true]);
  });
  it('requires the procedure order and accepts a later correctly ordered retry', () => {
    const evidence = [{ id: 'shot', rel: 'shot.png', capturedAt: 1, sha256: 'abc', width: 10, height: 10 }];
    const event = (stepIndex: number): VerificationToolEvent => ({ id: String(stepIndex), at: 1, durationMs: 1, detail: '', stepIndex, ok: true, operation: 'act', evidenceId: 'shot' });
    expect(verificationStepCompletion({ requiredSteps: 2, evidence, toolEvents: [event(1), event(0)] })).toEqual([true, false]);
    expect(verificationStepCompletion({ requiredSteps: 2, evidence, toolEvents: [event(1), event(0), event(1)] })).toEqual([true, true]);
  });
});

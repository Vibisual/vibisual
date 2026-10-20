import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vibi3DSnapshot, Vibi3DRun } from '@vibisual/shared';
import { AppAgentPreparationError } from '../../apps/registry.js';
import { prepareVibi3DRun, recoverVibi3DDocument, rememberVibi3DDocument, vibi3DResumePrompt, workflowRequest } from './vibi3dWorkflow.js';

const opened = vi.hoisted(() => vi.fn(() => true));
const events = vi.hoisted(() => ({ listener: undefined as ((event: { kind: string; key: string; project: string }) => void) | undefined }));
vi.mock('../../apps/appWindows.js', () => ({ openAppWindow: opened }));
vi.mock('../../apps/appEvents.js', () => ({ onAppEvent: (_app: string, listener: typeof events.listener) => { events.listener = listener; return () => undefined; } }));
const snapshot: Vibi3DSnapshot = { sessionId: 'scene', projectId: '/project', fileName: 'Model', revision: 0,
  nodes: [], selectedId: null, document: { id: 'product', revision: 1, dirty: false } };
beforeEach(() => { opened.mockClear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('document-owned native preparation', () => {
  it('retains the previous saved run before creating a new run for explicit continuation', async () => {
    const previous = { id: 'previous', docId: 'product', stages: [{ id: 'blockout', label: 'Blockout' }] } as Vibi3DRun;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/ensure')
      ? { ownerId: 'other-screen', sessionId: 'scene' } : url.includes('/session?') ? { session: { snapshot, online: true }, run: previous }
        : { run: { id: 'next', docId: 'product', stages: [] } }))));
    const result = await prepareVibi3DRun('/project', 'product');
    expect(result.run?.id).toBe('next');
    expect(result.previousRun).toEqual(previous);
    expect(vibi3DResumePrompt(result.previousRun)).toContain('"id":"previous"');
    expect(vibi3DResumePrompt(result.previousRun)).toContain('"id":"blockout"');
    expect(vibi3DResumePrompt(result.previousRun)).toContain('send resume {runId,stage?}');
    expect(vibi3DResumePrompt(result.previousRun)).toContain('Only when the user explicitly selects a named saved stage');
    expect(vibi3DResumePrompt(result.previousRun)).toContain('generic request to continue is not permission');
  });
  it('keeps a newer restored AI draft instead of opening its source or starting a replacement run', async () => {
    const current = { ...snapshot, revision: 12, runId: 'active-work',
      document: { id: 'product', revision: 1, dirty: true, humanDirty: false } };
    const older = { id: 'older-stage-run', docId: 'product', stages: [{ id: 'blockout' }] };
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/ensure')
      ? { ownerId: 'other-screen', sessionId: 'scene' }
      : { session: { snapshot: current, online: true }, run: older })));
    vi.stubGlobal('fetch', fetcher);
    const result = await prepareVibi3DRun('/project', 'product');
    expect(result.snapshot).toEqual(current);
    expect(result.run).toBeNull();
    expect(result.previousRun).toEqual(older);
    expect(opened).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/app/vibi3d/documents/product/ensure', '/api/app/vibi3d/documents/product/session?projectId=%2Fproject',
    ]);
  });
  it('uses an existing owner and binds the exact document run before sending', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(url.endsWith('/ensure') ? { ownerId: 'other-screen', sessionId: 'scene' }
        : url.includes('/session?') ? { session: { snapshot, online: true } }
          : { run: { id: 'run', docId: 'product', stages: [] } }));
    }));
    const result = await prepareVibi3DRun('/project', 'product');
    expect(opened).not.toHaveBeenCalled();
    expect(result.snapshot).toMatchObject({ runId: 'run', document: { id: 'product' } });
    expect(calls).toEqual(['/api/app/vibi3d/documents/product/ensure', '/api/app/vibi3d/documents/product/session?projectId=%2Fproject', '/api/app/vibi3d/documents/product/runs']);
  });
  it('prepares only the claimed document in the background when this screen owns preparation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(
      url.endsWith('/ensure') ? { ownerId: JSON.parse(String(init?.body)).ownerId }
        : url.includes('/session?') ? { session: { snapshot } } : { run: { id: 'run', docId: 'product', stages: [] } },
    ))));
    await prepareVibi3DRun('/project', 'product');
    expect(opened).toHaveBeenCalledExactlyOnceWith({ appId: 'vibi3d', projectId: '/project', ref: 'product' }, { background: true });
  });
  it('fails preparation visibly instead of sending an unprepared generic brief', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unsaved-human-edits' }), { status: 409 })));
    await expect(prepareVibi3DRun('/project', 'product')).rejects.toBeInstanceOf(AppAgentPreparationError);
    expect(opened).not.toHaveBeenCalled();
  });
  it('also retries a suppressed initial background preparation while retaining the claimed document', async () => {
    vi.useFakeTimers(); let polls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(
      /\/(ensure|claim)$/.test(url) ? { ownerId: JSON.parse(String(init.body)).ownerId }
        : url.includes('/session?') ? { session: ++polls === 1 ? null : { snapshot, online: true } }
          : { run: { id: 'prepared', docId: 'product', stages: [] } }))));
    const pending = prepareVibi3DRun('/project', 'product'); await vi.advanceTimersByTimeAsync(500);
    expect((await pending).run?.id).toBe('prepared'); expect(opened).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops a disconnected preparation request instead of leaving the canvas send pending forever', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      signal = init.signal as AbortSignal; signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })));
    const result = expect(workflowRequest('/unavailable')).rejects.toThrow('vibi3d-workflow-unavailable');
    await vi.advanceTimersByTimeAsync(8000); await result;
    expect(signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0); expect(opened).not.toHaveBeenCalled();
  });
  it('aborts a final slow readiness poll at the same 30-second deadline', async () => {
    vi.useFakeTimers(); const start = Date.now();
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      if (url.endsWith('/ensure')) return Promise.resolve(new Response(JSON.stringify({ ownerId: 'other-screen' })));
      if (Date.now() - start < 29500) return Promise.resolve(new Response(JSON.stringify({ session: null })));
      return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }));
    const result = expect(prepareVibi3DRun('/project', 'product')).rejects.toThrow('vibi3d-workflow-unavailable');
    await vi.advanceTimersByTimeAsync(30000); await result;
    expect(Date.now() - start).toBe(30000); expect(vi.getTimerCount()).toBe(0); expect(opened).not.toHaveBeenCalled();
  });
  it('recovers only the same document and project in the background after this surface wins the ownership claim', async () => {
    rememberVibi3DDocument('/other-project', 'other-document');
    const request = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(url.endsWith('/claim')
      ? { ownerId: JSON.parse(String(init.body)).ownerId }
      : { session: { online: true, snapshot: { ...snapshot, document: { ...snapshot.document, id: 'other-document' } } } })));
    vi.stubGlobal('fetch', request);
    events.listener?.({ kind: 'reopen', key: 'other-document', project: '/project' });
    events.listener?.({ kind: 'reopen', key: 'unrelated-document', project: '/other-project' });
    expect(request).not.toHaveBeenCalled(); expect(opened).not.toHaveBeenCalled();
    events.listener?.({ kind: 'reopen', key: 'other-document', project: '/other-project' });
    await vi.waitFor(() => expect(opened).toHaveBeenCalledExactlyOnceWith({ appId: 'vibi3d', projectId: '/other-project', ref: 'other-document' }, { background: true }));
    opened.mockClear(); request.mockResolvedValueOnce(new Response(JSON.stringify({ ownerId: 'another-surface' })));
    events.listener?.({ kind: 'reopen', key: 'other-document', project: '/other-project' });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    await new Promise(resolve => setTimeout(resolve, 0)); expect(opened).not.toHaveBeenCalled();
  });
  it('coalesces reopen events and retries the same background document after stale outside-window suppression', async () => {
    vi.useFakeTimers(); rememberVibi3DDocument('/recover', 'same-doc');
    let polls = 0;
    const request = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(url.endsWith('/claim')
      ? { ownerId: JSON.parse(String(init.body)).ownerId }
      : { session: ++polls < 3 ? null : { online: true, snapshot: { ...snapshot, document: { ...snapshot.document, id: 'same-doc' } } } })));
    vi.stubGlobal('fetch', request);
    const first = recoverVibi3DDocument('/recover', 'same-doc');
    expect(recoverVibi3DDocument('/recover', 'same-doc')).toBe(first);
    events.listener?.({ kind: 'reopen', project: '/recover', key: 'same-doc' });
    await vi.advanceTimersByTimeAsync(1000); expect(await first).toBe(true);
    expect(opened).toHaveBeenCalledTimes(3);
    expect(opened.mock.calls.every(call => JSON.stringify(call) === JSON.stringify([{ appId: 'vibi3d', projectId: '/recover', ref: 'same-doc' }, { background: true }]))).toBe(true);
    expect(request).toHaveBeenCalledTimes(6); expect(vi.getTimerCount()).toBe(0);
    expect(request.mock.calls.some(([url]) => /\/runs|\/resume|\/checkpoint/.test(url))).toBe(false);
  });
  it('ends recovery at its deadline and never opens a document owned by another screen', async () => {
    vi.useFakeTimers(); rememberVibi3DDocument('/recover', 'deadline-doc');
    const request = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(url.endsWith('/claim')
      ? { ownerId: JSON.parse(String(init.body)).ownerId } : { session: null })));
    vi.stubGlobal('fetch', request);
    const pending = expect(recoverVibi3DDocument('/recover', 'deadline-doc')).rejects.toThrow('vibi3d-session-not-ready');
    await vi.advanceTimersByTimeAsync(30000); await pending; expect(vi.getTimerCount()).toBe(0);
    opened.mockClear(); request.mockResolvedValueOnce(new Response(JSON.stringify({ ownerId: 'other-screen' })));
    expect(await recoverVibi3DDocument('/recover', 'deadline-doc')).toBe(false); expect(opened).not.toHaveBeenCalled();
    expect(await recoverVibi3DDocument('/unremembered', 'deadline-doc')).toBe(false);
  });
});

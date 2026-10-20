import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vibi3DCommandRequest, Vibi3DSnapshot } from '@vibisual/shared';
import { useVibi3DBridge, type Vibi3DBridge, type Vibi3DBridgeOptions } from './useVibi3DBridge.js';
import { emitAppEvent } from '../../apps/appEvents.js';
import { AppWindowShownContext } from '../../apps/appWindowVisibility.js';

const makeSnapshot = (sessionId = 'scene-one'): Vibi3DSnapshot => ({
  sessionId, projectId: '/project', fileName: 'cube.glb', revision: 0, selectedId: null, nodes: [],
});
const edit = (overrides: Partial<Vibi3DCommandRequest> = {}): Vibi3DCommandRequest => ({
  commandId: 'edit-one', expectedRevision: 0, commands: [{ type: 'lighting', intensity: 2 }], ...overrides,
});
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
type Call = { url: string; method: string; body: Record<string, unknown>; signal?: AbortSignal | null };
let renderer: ReactTestRenderer | undefined;
let scene: Vibi3DSnapshot;
let bridge: Vibi3DBridge;
let calls: Call[];
let queued: (Vibi3DCommandRequest & { expiresAt?: number }) | null;
let capture: ReturnType<typeof vi.fn<() => string>>;
let execute: ReturnType<typeof vi.fn<(request: Vibi3DCommandRequest) => Vibi3DSnapshot>>;
let intercept: ((call: Call) => Response | Promise<Response> | undefined) | undefined;

function Harness(props: Vibi3DBridgeOptions): null { bridge = useVibi3DBridge(props); return null; }
function props(): Vibi3DBridgeOptions {
  return { snapshot: scene, getSnapshot: () => scene, capture, execute };
}
async function mount(): Promise<void> { await act(async () => { renderer = create(<Harness {...props()} />); }); }
async function tick(ms = 1_000): Promise<void> { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

beforeEach(() => {
  vi.useFakeTimers();
  scene = makeSnapshot(); calls = []; queued = null; intercept = undefined;
  capture = vi.fn(() => 'data:image/jpeg;base64,ZmFrZQ==');
  execute = vi.fn(() => { scene = { ...scene, revision: scene.revision + 1 }; return scene; });
  vi.stubGlobal('crypto', { randomUUID: () => 'renderer-private-token-00001' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = { url, method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}, signal: init?.signal };
    calls.push(call);
    const override = intercept?.(call);
    if (override) return override;
    if (call.method === 'POST' && url.endsWith('/sessions')) return json({ ok: true, rendererToken: call.body.rendererToken });
    if (url.endsWith('/pending')) { const request = queued; queued = null; return json({ ok: true, request }); }
    return json({ ok: true });
  }));
});
afterEach(async () => {
  await act(async () => { renderer?.unmount(); }); renderer = undefined;
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('Vibi3D live renderer bridge', () => {
  it('does not acknowledge an edit until its asynchronous draft persistence finishes', async () => {
    queued = edit();
    let persist!: () => void;
    const durableExecute = vi.fn(async () => {
      scene = { ...scene, revision: scene.revision + 1 };
      await new Promise<void>((resolve) => { persist = resolve; });
      return scene;
    });
    await act(async () => { renderer = create(<Harness {...props()} execute={durableExecute} />); });
    expect(scene.revision).toBe(1);
    expect(calls.some(call => call.url.endsWith('/ack'))).toBe(false);
    await act(async () => { persist(); });
    expect(calls.find(call => call.url.endsWith('/ack'))?.body).toMatchObject({ ok: true, snapshot: { revision: 1 } });
  });

  it('reports storage failure with the advanced revision and never replays that applied mutation', async () => {
    queued = edit();
    const durableExecute = vi.fn(async () => {
      scene = { ...scene, revision: scene.revision + 1 };
      throw new Error('draft-save-failed-refresh-state');
    });
    let lostReply = false;
    intercept = call => {
      if (call.url.endsWith('/ack') && !lostReply) {
        lostReply = true;
        return Promise.reject(new Error('ACK reply lost'));
      }
      return undefined;
    };
    await act(async () => { renderer = create(<Harness {...props()} execute={durableExecute} />); });
    expect(durableExecute).toHaveBeenCalledOnce();
    await tick();
    queued = edit(); // A retry of the same immutable command must only resend its rejection.
    await tick();
    expect(durableExecute).toHaveBeenCalledOnce();
    const acks = calls.filter(call => call.url.endsWith('/ack'));
    expect(acks).toHaveLength(3);
    for (const ack of acks) expect(ack.body).toMatchObject({
      ok: false, error: 'draft-save-failed-refresh-state', snapshot: { revision: 1 },
    });
  });

  it('executes and publishes commands while its window is hidden without reconnecting when shown', async () => {
    queued = edit();
    await act(async () => {
      renderer = create(<AppWindowShownContext.Provider value={false}><Harness {...props()} /></AppWindowShownContext.Provider>);
    });
    expect(bridge.connected).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(calls.find(call => call.url.endsWith('/ack'))?.body).toMatchObject({ ok: true, snapshot: { revision: 1 }, screenshot: expect.any(String) });
    await act(async () => {
      renderer!.update(<AppWindowShownContext.Provider value={true}><Harness {...props()} /></AppWindowShownContext.Provider>);
    });
    expect(calls.filter(call => call.url.endsWith('/sessions'))).toHaveLength(1);
    expect(calls.some(call => call.method === 'DELETE')).toBe(false);
  });

  it('recovers a lost committed workflow response with the same immutable request and updates the next checkpoint revision', async () => {
    scene = { ...scene, document: { id: 'product', revision: 1, dirty: true, humanDirty: false } };
    queued = edit({ commandId: 'stage-one', commands: [{ type: 'checkpoint', stage: 'blockout', label: 'Blockout' }] });
    let sourceRevision = 1; let lost = false;
    const receipts = new Map<string, { doc: { revision: number } }>();
    intercept = (call) => {
      if (!call.url.endsWith('/checkpoint')) return undefined;
      const id = String(call.body.commandId);
      if (!receipts.has(id)) {
        const snapshot = call.body.snapshot as Vibi3DSnapshot;
        if (snapshot.document?.revision !== sourceRevision) return json({ error: 'revision-conflict' }, 409);
        receipts.set(id, { doc: { revision: ++sourceRevision } });
      }
      if (!lost) { lost = true; return Promise.reject(new Error('reply lost after commit')); }
      return json(receipts.get(id));
    };
    const applyWorkflow: Vibi3DBridgeOptions['execute'] = async (request, context) => {
      const result = await context!.post<{ doc: { revision: number } }>('checkpoint', {
        commandId: request.commandId, snapshot: scene, payload: { scene: 'same captured payload' },
      });
      scene = { ...scene, document: { ...scene.document!, revision: result.doc.revision, dirty: false } };
      return { snapshot: scene };
    };
    await act(async () => { renderer = create(<Harness {...props()} execute={applyWorkflow} />); });
    expect(calls.some((call) => call.url.endsWith('/ack'))).toBe(false);
    await tick();
    const posts = calls.filter((call) => call.url.endsWith('/checkpoint'));
    expect(posts).toHaveLength(2); expect(posts[1]?.body).toEqual(posts[0]?.body);
    expect(scene.document?.revision).toBe(2);
    expect(calls.find((call) => call.url.endsWith('/ack'))?.body.ok).toBe(true);
    queued = edit({ commandId: 'stage-two', commands: [{ type: 'checkpoint', stage: 'assembly', label: 'Assembly' }] });
    await tick();
    expect(scene.document?.revision).toBe(3);
    expect(sourceRevision).toBe(3);
  });
  it('wakes from a command event without waiting for a throttled background timer', async () => {
    await mount();
    queued = edit();
    await act(async () => { emitAppEvent({ appId: 'vibi3d', project: '/project', kind: 'command', key: scene.sessionId }); });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(calls.find((call) => call.url.endsWith('/ack'))?.body.ok).toBe(true);
  });

  it('uploads captured PNGs separately and returns their durable paths in the acknowledgement', async () => {
    scene = { ...scene, document: { id: 'product', revision: 1, dirty: false }, runId: 'run' };
    queued = edit({ commands: [{ type: 'capture', mode: 'lit', size: [1080, 1920] }] });
    const captureViews = vi.fn(() => ['front', 'corner'].map((view) => ({ view, mode: 'lit' as const, quality: 'final' as const,
      width: 1080, height: 1920, dataUrl: 'data:image/png;base64,cGl4ZWw=' })));
    intercept = (call) => call.url.endsWith('/captures') ? json({ captures: [{ path: `.vibisual/${(call.body.captures as { view: string }[])[0]!.view}.png` }] }) : undefined;
    await act(async () => { renderer = create(<Harness {...props()} captureViews={captureViews} />); });
    expect(calls.filter((call) => call.url.endsWith('/captures'))).toHaveLength(2);
    expect(calls.filter((call) => call.url.endsWith('/captures')).every((call) => (call.body.captures as unknown[]).length === 1)).toBe(true);
    expect(calls.find((call) => call.url.endsWith('/ack'))?.body).toMatchObject({ ok: true,
      result: { captures: [{ path: '.vibisual/front.png' }, { path: '.vibisual/corner.png' }] } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('captures a standalone saved draft through the live JPEG without requiring a workflow run', async () => {
    scene = { ...scene, document: { id: 'product', revision: 1, dirty: true, humanDirty: false } };
    queued = edit({ commands: [{ type: 'capture' }] });
    const captureViews = vi.fn();
    await act(async () => { renderer = create(<Harness {...props()} captureViews={captureViews} />); });
    expect(captureViews).not.toHaveBeenCalled();
    expect(calls.some(call => call.url.endsWith('/captures'))).toBe(false);
    expect(calls.find(call => call.url.endsWith('/ack'))?.body).toMatchObject({ ok: true, screenshot: expect.any(String) });
  });

  it('keeps live JPEG capture usable before the first named checkpoint and claims no PNG paths', async () => {
    scene = { ...scene, document: { id: 'product', revision: 1, dirty: true, humanDirty: false }, runId: 'run' };
    queued = edit({ commands: [{ type: 'capture' }] });
    const captureViews = vi.fn(() => [{ view: 'front', mode: 'lit' as const, quality: 'draft' as const,
      width: 720, height: 1280, dataUrl: 'data:image/png;base64,cGl4ZWw=' }]);
    intercept = call => call.url.endsWith('/captures') ? json({ error: 'checkpoint-required' }, 409) : undefined;
    await act(async () => { renderer = create(<Harness {...props()} captureViews={captureViews} />); });
    const ack = calls.find(call => call.url.endsWith('/ack'))?.body;
    expect(ack).toMatchObject({ ok: true, screenshot: expect.any(String) });
    expect(ack?.result).toBeUndefined();
  });

  it('publishes the real current scene and retries a lost ACK without repeating the edit', async () => {
    queued = edit();
    let failed = false;
    intercept = (call) => {
      if (call.url.endsWith('/ack') && !failed) { failed = true; return json({ error: 'temporary' }, 503); }
      return undefined;
    };
    await mount();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(bridge.connected).toBe(false);
    await tick();
    expect(execute).toHaveBeenCalledTimes(1);
    const acks = calls.filter((call) => call.url.endsWith('/ack'));
    expect(acks).toHaveLength(2);
    expect(acks[1]?.body).toMatchObject({ ok: true, snapshot: { revision: 1 }, screenshot: expect.any(String) });
    expect(bridge.connected).toBe(true);
  });

  it('rejects a command if a person edits after the server supplied it', async () => {
    intercept = (call) => {
      if (call.url.endsWith('/pending')) {
        scene = { ...scene, revision: 1 };
        return json({ ok: true, request: edit() });
      }
      return undefined;
    };
    await mount();
    expect(execute).not.toHaveBeenCalled();
    expect(calls.find((call) => call.url.endsWith('/ack'))?.body).toMatchObject({
      ok: false, error: 'revision-conflict', snapshot: { revision: 1 },
    });
  });

  it('does not apply a delivery that expired while the renderer was suspended', async () => {
    queued = { ...edit(), expiresAt: Date.now() - 1 };
    await mount();
    expect(execute).not.toHaveBeenCalled();
    expect(calls.find((call) => call.url.endsWith('/ack'))?.body).toMatchObject({ ok: false, error: 'command-expired' });
  });

  it('captures without touching editor history and flushes fresh views before an AI request', async () => {
    queued = edit({ commands: [{ type: 'capture' }] });
    await mount();
    expect(execute).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(2);
    scene = { ...scene, camera: { position: [1, 2, 3], target: [0, 0, 0] } };
    await act(async () => { await bridge.publishNow(); });
    expect(calls.filter((call) => call.url.endsWith('/publish')).at(-1)?.body).toMatchObject({
      snapshot: { camera: scene.camera }, screenshot: expect.any(String),
    });
  });

  it('retains the same private credential after a lost registration response', async () => {
    let failed = false;
    intercept = (call) => {
      if (call.url.endsWith('/sessions') && !failed) { failed = true; return Promise.reject(new Error('response lost')); }
      return undefined;
    };
    await mount();
    expect(bridge.connected).toBe(false);
    await tick();
    const registrations = calls.filter((call) => call.url.endsWith('/sessions'));
    expect(registrations).toHaveLength(2);
    expect(registrations[0]?.body.rendererToken).toBe(registrations[1]?.body.rendererToken);
    expect(bridge.connected).toBe(true);
  });

  it('ignores commands that arrive after a new model replaces the old scene', async () => {
    let deliver: ((response: Response) => void) | undefined;
    intercept = (call) => call.url.endsWith('/scene-one/pending')
      ? new Promise<Response>((resolve) => { deliver = resolve; }) : undefined;
    await mount();
    scene = makeSnapshot('scene-two');
    await act(async () => { renderer!.update(<Harness {...props()} />); });
    await act(async () => { deliver?.(json({ ok: true, request: edit() })); });
    expect(execute).not.toHaveBeenCalled();
    expect(calls.some((call) => call.url.endsWith('/scene-one/ack'))).toBe(false);
    expect(bridge.connected).toBe(true);
  });

  it('reports an applied edit as applied even if the optional result image cannot be captured', async () => {
    queued = edit();
    capture.mockImplementationOnce(() => 'data:image/jpeg;base64,ZmFrZQ==')
      .mockImplementation(() => { throw new Error('WebGL context lost'); });
    await mount();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(calls.find((call) => call.url.endsWith('/ack'))?.body).toMatchObject({ ok: true, snapshot: { revision: 1 } });
  });

  it('drops a cached capture when the user moves the camera during an ACK retry', async () => {
    queued = edit({ commands: [{ type: 'capture' }] });
    let failed = false;
    intercept = (call) => {
      if (call.url.endsWith('/ack') && !failed) { failed = true; return json({ error: 'temporary' }, 503); }
      return undefined;
    };
    await mount();
    scene = { ...scene, camera: { position: [2, 2, 3], target: [0, 0, 0] } };
    await tick();
    expect(calls.filter((call) => call.url.endsWith('/ack')).at(-1)?.body).not.toHaveProperty('screenshot');
  });

  it('bounds idle traffic and stops polling when the panel is unmounted', async () => {
    await mount();
    await tick(3_000);
    expect(calls.filter((call) => call.url.endsWith('/pending'))).toHaveLength(4);
    expect(calls.filter((call) => call.url.endsWith('/publish'))).toHaveLength(0);
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    await tick(20_000);
    expect(calls.filter((call) => call.url.endsWith('/pending'))).toHaveLength(4);
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });
});

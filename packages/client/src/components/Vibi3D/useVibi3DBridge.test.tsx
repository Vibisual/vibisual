import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vibi3DCommandRequest, Vibi3DSnapshot } from '@vibisual/shared';
import { useVibi3DBridge, type Vibi3DBridge, type Vibi3DBridgeOptions } from './useVibi3DBridge.js';

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

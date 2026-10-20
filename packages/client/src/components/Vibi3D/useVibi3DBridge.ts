import { useCallback, useEffect, useRef, useState } from 'react';
import { VIBI3D_API_PREFIX, VIBI3D_RENDERER_TOKEN_HEADER, type Vibi3DCommandRequest, type Vibi3DSnapshot, type Vibi3DCaptureCommand, type Vibi3DCommandResult, type Vibi3DCaptureRecord } from '@vibisual/shared';
import type { CapturedView } from './vibi3dCapture.js';
import { onAppEvent } from '../../apps/appEvents.js';
import { vibi3dCommandProgress } from './vibi3dCommandProgress.js';

export interface Vibi3DExecutionContext {
  post: <T>(suffix: string, body: Record<string, unknown>) => Promise<T>;
  progress?: (value: number) => Promise<void>;
  assertActive?: () => void;
}
export interface Vibi3DExecutionResult { snapshot: Vibi3DSnapshot; result?: Vibi3DCommandResult['result'] }

export interface Vibi3DBridgeOptions {
  snapshot: Vibi3DSnapshot | null;
  getSnapshot: () => Vibi3DSnapshot | null;
  capture: () => string | Promise<string>;
  captureViews?: (command: Vibi3DCaptureCommand) => CapturedView[] | Promise<CapturedView[]>;
  execute: (request: Vibi3DCommandRequest, context?: Vibi3DExecutionContext) => Vibi3DSnapshot | Vibi3DExecutionResult | Promise<Vibi3DSnapshot | Vibi3DExecutionResult>;
}

export interface Vibi3DBridge {
  connected: boolean;
  error: string | null;
  /** Wait until the agent can read the current state and rendered view. */
  publishNow: () => Promise<void>;
}

class BridgeHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

interface Ack {
  commandId: string;
  ok: boolean;
  error?: string;
  snapshot: Vibi3DSnapshot;
  screenshot?: string;
  result?: Vibi3DCommandResult['result'];
}

const POLL_MS = 1_000;
const HEARTBEAT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 8_000;

/** One serialized renderer connection per loaded scene. Tokens never enter agent prompts. */
export function useVibi3DBridge(options: Vibi3DBridgeOptions): Vibi3DBridge {
  const callbacks = useRef(options);
  callbacks.current = options;
  const sessionId = options.snapshot?.sessionId ?? null;
  const [status, setStatus] = useState<{ sessionId: string | null; connected: boolean; error: string | null }>({
    sessionId: null, connected: false, error: null,
  });
  const publishRef = useRef<(() => Promise<void>) | null>(null);
  const credentials = useRef<{ sessionId: string; token: string } | null>(null);
  const activeLifetime = useRef<{ sessionId: string; id: symbol } | null>(null);

  useEffect(() => {
    if (!sessionId) {
      publishRef.current = null;
      setStatus({ sessionId: null, connected: false, error: null });
      return undefined;
    }
    const base = `${VIBI3D_API_PREFIX}/sessions/${encodeURIComponent(sessionId)}`;
    const lifetime = new AbortController();
    const lifetimeId = Symbol();
    activeLifetime.current = { sessionId, id: lifetimeId };
    let stopped = false;
    if (credentials.current?.sessionId !== sessionId) credentials.current = { sessionId, token: crypto.randomUUID() };
    const rendererToken = credentials.current.token;
    let registered = false;
    let lastPublished = '';
    let lastRevision = -1;
    let lastPublishAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tail: Promise<void> = Promise.resolve();
    // If the server loses an ACK, resend its result, never execute the edit again.
    let pendingAck: Ack | null = null;
    const acknowledged = new Map<string, Ack>();

    const current = (): Vibi3DSnapshot => {
      const snapshot = callbacks.current.getSnapshot();
      if (stopped || !snapshot || snapshot.sessionId !== sessionId) throw new Error('Vibi3D scene changed');
      return snapshot;
    };

    const request = async <T,>(url: string, method = 'GET', body?: unknown): Promise<T> => {
      if (stopped) throw new Error('Vibi3D connection closed');
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      lifetime.signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method,
          signal: controller.signal,
          headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            [VIBI3D_RENDERER_TOKEN_HEADER]: rendererToken,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const data = await response.json() as T & { ok?: boolean; error?: string };
        if (!response.ok || data.ok === false) {
          throw new BridgeHttpError(response.status, data.error ?? `Vibi3D HTTP ${response.status}`);
        }
        return data;
      } finally {
        clearTimeout(timeout);
        lifetime.signal.removeEventListener('abort', abort);
      }
    };

    const workflowPost: Vibi3DExecutionContext['post'] = async <T,>(suffix: string, body: Record<string, unknown>): Promise<T> => {
      // A successful commit can lose its HTTP reply. Retry its immutable receipt key/payload,
      // keeping the editor busy, until the server gives a definitive response or this scene closes.
      const immutable = structuredClone(body);
      for (;;) {
        try { return await request<T>(`${base}/${suffix}`, 'POST', immutable); }
        catch (error) {
          if (stopped || (error instanceof BridgeHttpError && error.status < 500)) throw error;
          setStatus({ sessionId, connected: false, error: error instanceof Error ? error.message : String(error) });
          await new Promise<void>((resolve) => {
            const finish = (): void => { clearTimeout(retry); lifetime.signal.removeEventListener('abort', finish); resolve(); };
            const retry = setTimeout(finish, POLL_MS);
            lifetime.signal.addEventListener('abort', finish, { once: true });
          });
        }
      }
    };

    const frame = async (): Promise<{ snapshot: Vibi3DSnapshot; screenshot: string }> => {
      const before = current();
      const screenshot = await callbacks.current.capture();
      const snapshot = current();
      if (before.revision !== snapshot.revision) throw new Error('Vibi3D scene changed during capture');
      return { snapshot, screenshot };
    };

    const rememberPublished = (snapshot: Vibi3DSnapshot): void => {
      lastPublished = JSON.stringify(snapshot);
      lastRevision = snapshot.revision;
      lastPublishAt = Date.now();
    };

    const register = async (): Promise<void> => {
      const payload = await frame();
      const response = await request<{ rendererToken: string }>(`${VIBI3D_API_PREFIX}/sessions`, 'POST', { ...payload, rendererToken });
      if (response.rendererToken !== rendererToken) throw new Error('Vibi3D renderer registration failed');
      if (stopped) return;
      registered = true;
      rememberPublished(payload.snapshot);
    };

    const publish = async (forceCapture: boolean): Promise<void> => {
      const snapshot = current();
      if (!forceCapture && JSON.stringify(snapshot) === lastPublished && Date.now() - lastPublishAt < HEARTBEAT_MS) return;
      const payload = forceCapture || snapshot.revision !== lastRevision ? await frame() : { snapshot };
      await request(`${base}/publish`, 'POST', payload);
      rememberPublished(payload.snapshot);
    };

    const acknowledge = async (): Promise<void> => {
      if (!pendingAck) return;
      const ack = pendingAck;
      // A person may have edited after a failed ACK. Report the latest state, not a stale copy.
      const payload: Ack = { ...ack, snapshot: current() };
      if (payload.snapshot.revision !== ack.snapshot.revision
        || JSON.stringify(payload.snapshot.camera) !== JSON.stringify(ack.snapshot.camera)
        || JSON.stringify(payload.snapshot.playback) !== JSON.stringify(ack.snapshot.playback)
        || payload.snapshot.selectedId !== ack.snapshot.selectedId) delete payload.screenshot;
      await request(`${base}/ack`, 'POST', payload);
      rememberPublished(payload.snapshot);
      pendingAck = null;
      acknowledged.set(ack.commandId, ack);
      if (acknowledged.size > 64) acknowledged.delete(acknowledged.keys().next().value as string);
    };

    const work = async (forceCapture: boolean): Promise<void> => {
      try {
        current();
        if (!registered) await register();
        await acknowledge();
        await publish(forceCapture);
        if (!forceCapture) {
          const response = await request<{ request: (Vibi3DCommandRequest & { expiresAt?: number }) | null }>(`${base}/pending`);
          if (response.request) {
            current();
            const queued = response.request;
            const cached = acknowledged.get(queued.commandId);
            if (cached) {
              pendingAck = cached;
            } else {
              let progress: ReturnType<typeof vibi3dCommandProgress> | undefined;
              try {
                const snapshot = current();
                if (queued.expiresAt !== undefined && queued.expiresAt <= Date.now()) throw new Error('command-expired');
                if (queued.expectedRevision !== snapshot.revision) throw new Error('revision-conflict');
                progress = vibi3dCommandProgress({ expiresAt: queued.expiresAt, signal: lifetime.signal,
                  post: value => request(`${base}/progress`, 'POST', { commandId: queued.commandId, progress: value }),
                  finalError: error => error instanceof BridgeHttpError && error.status < 500 });
                await progress.progress(0);
                const context: Vibi3DExecutionContext = { post: workflowPost, progress: progress.progress, assertActive: progress.assertActive };
                if (queued.commands.length === 1 && queued.commands[0]?.type === 'capture') {
                  const captures: Vibi3DCaptureRecord[] = [];
                  if (callbacks.current.captureViews && snapshot.document && snapshot.runId) {
                    const before = current();
                    const rendered = await callbacks.current.captureViews(queued.commands[0]);
                    if (before.revision !== current().revision) throw new Error('scene-changed-during-capture');
                    for (const capture of rendered) {
                      if (before.revision !== current().revision) throw new Error('scene-changed-during-capture');
                      try {
                        const saved = await context.post<{ captures: Vibi3DCaptureRecord[] }>('captures', {
                          commandId: queued.commandId, snapshot: before, captures: [capture],
                        });
                        captures.push(...saved.captures);
                      } catch (error) {
                        // A draft can have a document/run but no named workflow stage yet.
                        // The normal live JPEG remains available without inventing saved PNGs.
                        if (error instanceof BridgeHttpError && error.status === 409
                          && ['checkpoint-required', 'run-required'].includes(error.message)) break;
                        throw error;
                      }
                    }
                    if (before.revision !== current().revision) throw new Error('scene-changed-during-capture');
                  }
                  pendingAck = { commandId: queued.commandId, ok: true, ...await frame(), ...(captures.length ? { result: { captures } } : {}) };
                } else {
                  const executed = await callbacks.current.execute(queued, context);
                  pendingAck = { commandId: queued.commandId, ok: true, snapshot: current(),
                    ...('snapshot' in executed && executed.result ? { result: executed.result } : {}) };
                  // An applied edit remains applied if only its screenshot failed.
                  try { pendingAck = { ...pendingAck, ...await frame() }; } catch { current(); }
                }
              } catch (error) {
                pendingAck = { commandId: queued.commandId, ok: false,
                  error: error instanceof Error ? error.message : String(error), snapshot: current() };
              } finally { progress?.dispose(); }
            }
            await acknowledge();
          }
        }
        if (!stopped) setStatus({ sessionId, connected: true, error: null });
      } catch (error) {
        if (error instanceof BridgeHttpError && (error.status === 404 || error.status === 410)) {
          registered = false;
          // A restarted server no longer owns the old command queue.
          pendingAck = null;
        }
        if (!stopped) setStatus({ sessionId, connected: false, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    };

    const enqueue = (forceCapture: boolean): Promise<void> => {
      const task = tail.then(() => work(forceCapture));
      tail = task.catch(() => undefined);
      return task;
    };
    publishRef.current = () => enqueue(true);
    const offCommand = onAppEvent('vibi3d', (event) => {
      if (event.kind === 'command' && event.key === sessionId) void enqueue(false).catch(() => undefined);
    });
    setStatus({ sessionId, connected: false, error: null });
    const tick = async (): Promise<void> => {
      try { await enqueue(false); } catch { /* Error is visible; the next bounded poll reconnects. */ }
      if (!stopped) timer = setTimeout(() => { void tick(); }, POLL_MS);
    };
    void tick();

    return () => {
      stopped = true;
      offCommand();
      publishRef.current = null;
      if (timer) clearTimeout(timer);
      lifetime.abort();
      if (activeLifetime.current?.id === lifetimeId) activeLifetime.current = null;
      // React StrictMode immediately starts this same scene again. Its connection owns the token.
      queueMicrotask(() => {
        if (activeLifetime.current?.sessionId === sessionId) return;
        void fetch(base, { method: 'DELETE', keepalive: true,
          headers: { [VIBI3D_RENDERER_TOKEN_HEADER]: rendererToken } }).catch(() => undefined);
      });
    };
  }, [sessionId]);

  const publishNow = useCallback(async (): Promise<void> => {
    if (!publishRef.current) throw new Error('Vibi3D scene is not connected');
    await publishRef.current();
  }, []);
  return { connected: status.sessionId === sessionId && status.connected, error: status.sessionId === sessionId ? status.error : null, publishNow };
}

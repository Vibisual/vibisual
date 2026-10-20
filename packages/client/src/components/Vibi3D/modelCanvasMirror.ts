import { clientPathKey } from '../../utils/platform.js';

export interface ModelCanvasMirrorTarget {
  projectId: string;
  workRef?: string | undefined;
  file?: string | undefined;
}

export interface ModelCanvasMirrorFrame {
  url: string;
  width: number;
  height: number;
}

export const MODEL_MIRROR_INTERVAL_MS = 500;
const WIDTH = 480;
const HEIGHT = 320;
type Listener = () => void;
interface OwnedFrame { owner: symbol; frame: ModelCanvasMirrorFrame }

// Deliberately renderer-local: no persisted dirty scenes or cross-tab broadcast.
const frames = new Map<string, OwnedFrame>();
const listeners = new Map<string, Set<Listener>>();

export function modelCanvasMirrorKey(target: ModelCanvasMirrorTarget | null): string | null {
  if (!target?.projectId || (!target.workRef && !target.file)) return null;
  return JSON.stringify([clientPathKey(target.projectId), target.workRef ? 'document' : 'file',
    target.workRef || clientPathKey(target.file!)]);
}

/** Use the installed scene's identity, never the next route's identity while loading. */
export function modelCanvasMirrorTarget(requested: ModelCanvasMirrorTarget,
  installed: ModelCanvasMirrorTarget | null, unavailable: boolean): ModelCanvasMirrorTarget | null {
  if (unavailable || !installed || clientPathKey(requested.projectId) !== clientPathKey(installed.projectId)) return null;
  if (requested.workRef && requested.workRef !== installed.workRef) return null;
  if (!requested.workRef && requested.file && clientPathKey(requested.file) !== clientPathKey(installed.file ?? '')) return null;
  return modelCanvasMirrorKey(installed) ? installed : null;
}

const notify = (key: string): void => { listeners.get(key)?.forEach(listener => listener()); };

export function readModelCanvasMirror(key: string | null): ModelCanvasMirrorFrame | null {
  return key === null ? null : frames.get(key)?.frame ?? null;
}

export function subscribeModelCanvasMirror(key: string | null, listener: Listener): () => void {
  if (key === null) return () => undefined;
  let set = listeners.get(key);
  if (!set) { set = new Set(); listeners.set(key, set); }
  // A wrapper keeps independent subscriptions independent even if they share a callback.
  const update = (): void => listener();
  set.add(update);
  return () => {
    set.delete(update);
    if (!set.size && listeners.get(key) === set) {
      listeners.delete(key);
      // Data URLs have no revoke lifetime. Removing the last reference releases the frame.
      frames.delete(key);
    }
  };
}

export interface ModelCanvasMirrorPublisher {
  publish: (target: ModelCanvasMirrorTarget | null, canvas: HTMLCanvasElement) => void;
  clear: () => void;
  dispose: () => void;
}

/** Call immediately after WebGL rendering, before its drawing buffer can be discarded. */
export function createModelCanvasMirrorPublisher(): ModelCanvasMirrorPublisher {
  const owner = Symbol('model-preview');
  let key: string | null = null;
  let lastCapture = -Infinity;
  let scratch: HTMLCanvasElement | null = null;
  let disposed = false;
  const clear = (): void => {
    const previous = key;
    key = null; lastCapture = -Infinity;
    if (previous !== null && frames.get(previous)?.owner === owner) {
      frames.delete(previous); notify(previous);
    }
    if (scratch) { scratch.width = 0; scratch.height = 0; scratch = null; }
  };
  return {
    clear,
    dispose: () => { disposed = true; clear(); },
    publish: (target, canvas) => {
      if (disposed) return;
      const nextKey = modelCanvasMirrorKey(target);
      if (nextKey !== key) { clear(); key = nextKey; }
      if (key === null) return;
      if (!listeners.get(key)?.size) {
        if (scratch) { scratch.width = 0; scratch.height = 0; scratch = null; }
        lastCapture = -Infinity;
        return;
      }
      const now = performance.now();
      if (now - lastCapture < MODEL_MIRROR_INTERVAL_MS) return;
      lastCapture = now;
      if (typeof document === 'undefined' || !canvas.width || !canvas.height) return;
      try {
        scratch ??= document.createElement('canvas');
        const ratio = Math.min(1, WIDTH / canvas.width, HEIGHT / canvas.height);
        const width = Math.max(1, Math.round(canvas.width * ratio));
        const height = Math.max(1, Math.round(canvas.height * ratio));
        if (scratch.width !== width) scratch.width = width;
        if (scratch.height !== height) scratch.height = height;
        const context = scratch.getContext('2d');
        if (!context) return;
        context.drawImage(canvas, 0, 0, width, height);
        const url = scratch.toDataURL('image/jpeg', 0.78);
        if (!url.startsWith('data:image/')) return;
        const previous = frames.get(key);
        if (previous?.owner === owner && previous.frame.url === url) return;
        frames.set(key, { owner, frame: { url, width, height } });
        notify(key);
      } catch {
        // A lost/tainted drawing buffer must not leave a dirty preview pinned forever.
        if (frames.get(key)?.owner === owner) { frames.delete(key); notify(key); }
      }
    },
  };
}

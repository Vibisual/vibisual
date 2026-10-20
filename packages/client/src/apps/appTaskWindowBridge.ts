import { appWindowKey, type AppWindowTarget } from './appWindowFocus.js';
import type { AppTaskTarget } from './registry.js';

const CHANNEL = 'vibisual-app-task-save';
export interface TaskWindowTarget extends AppWindowTarget { readonly bubbleId?: string | undefined }

export function matchesTaskWindow(a: TaskWindowTarget, b: TaskWindowTarget): boolean {
  if (appWindowKey({ ...a, ref: undefined, file: undefined, draftKey: undefined }) !== appWindowKey({ ...b, ref: undefined, file: undefined, draftKey: undefined })) return false;
  if (a.bubbleId && a.bubbleId === b.bubbleId) return true;
  if (a.ref && b.ref) return a.ref === b.ref;
  return appWindowKey(a) === appWindowKey(b);
}

/** Native app windows share an origin with the canvas, but have a separate module/guard registry. */
export function registerTaskWindowResponder(read: () => TaskWindowTarget | null, prepare: () => Promise<boolean>): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  let alive = true;
  let busy = false;
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data as { kind?: string; requestId?: string; target?: TaskWindowTarget } | null;
    const current = read();
    if (!message || message.kind !== 'save' || typeof message.requestId !== 'string' || !message.target || !current
      || !matchesTaskWindow(current, message.target)) return;
    const respond = (ok: boolean): void => { if (alive) channel.postMessage({ kind: 'saved', requestId: message.requestId, ok, target: read() }); };
    if (busy) { respond(false); return; }
    busy = true;
    void prepare().then(respond, () => respond(false)).finally(() => { busy = false; });
  };
  return () => { alive = false; channel.close(); };
}

/** Missing/old/unresponsive windows fail closed; a disk snapshot is never substituted for unsaved live work. */
export async function prepareOutsideTaskWindow(target: TaskWindowTarget, timeoutMs = 15_000): Promise<AppTaskTarget> {
  if (typeof BroadcastChannel === 'undefined') throw new Error('app-task-save-unavailable');
  const channel = new BroadcastChannel(CHANNEL);
  const requestId = crypto.randomUUID();
  try {
    return await new Promise<AppTaskTarget>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('app-task-save-timeout')), timeoutMs);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const message = event.data as { kind?: string; requestId?: string; ok?: boolean; target?: TaskWindowTarget } | null;
        if (!message || message.kind !== 'saved' || message.requestId !== requestId) return;
        clearTimeout(timer);
        if (!message.ok || !message.target || !matchesTaskWindow(target, message.target)) reject(new Error('app-task-save-failed'));
        else resolve({ ref: message.target.ref, file: message.target.file });
      };
      channel.postMessage({ kind: 'save', requestId, target });
    });
  } finally { channel.close(); }
}

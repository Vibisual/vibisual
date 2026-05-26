// Transport adapter — SCENARIO.md §3.7.
//
// Stage 4 wiring (v1.93). Two surfaces:
//   1. `installPackagedTransport()` (in ./install-packaged-transport) — global
//      monkey-patch on fetch + WebSocket. Imported once from main.tsx so all
//      existing call sites are covered without per-file edits.
//   2. This file's exports — an explicit adapter for new code that wants to
//      be aware of packaged mode without going through the global override.

// `PackagedApi` and the `Window.api` global augmentation are owned by
// install-packaged-transport.ts (single source of truth). Importing the type
// here keeps the two transport surfaces from diverging.
import type { PackagedApi } from './install-packaged-transport.js';

function getApi(): PackagedApi | null {
  if (typeof window === 'undefined') return null;
  return window.api ?? null;
}

/** True when running inside our packaged Electron shell. */
export const isPackagedDesktop = (): boolean => getApi() !== null;

/** fetch shim — uses window.api.request when packaged, native fetch otherwise. */
export const apiFetch: typeof fetch = async (input, init) => {
  const api = getApi();
  if (!api) return fetch(input, init);
  const url = typeof input === 'string'
    ? input
    : input instanceof URL ? input.toString() : input.url;
  const headers = init?.headers as Record<string, string> | undefined;
  const wireInit: { method?: string; headers?: Record<string, string>; body?: string | null } = {
    method: init?.method,
  };
  if (headers) wireInit.headers = headers;
  if (typeof init?.body === 'string') wireInit.body = init.body;
  const wire = await api.request(url, wireInit);
  // 204/304/1xx 는 본문을 가질 수 없다(Response 생성자 throw). 비텍스트 응답은 base64 디코드.
  const nullBody =
    wire.status === 204 || wire.status === 304 || (wire.status >= 100 && wire.status < 200);
  let body: BodyInit | null;
  if (nullBody) {
    body = null;
  } else if (wire.bodyEncoding === 'base64') {
    const binary = atob(wire.body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    body = bytes;
  } else {
    body = wire.body;
  }
  return new Response(body, {
    status: wire.status,
    statusText: wire.statusText,
    headers: wire.headers,
  });
};

/** Snapshot/event subscription adapter. */
export type SnapshotListener = (payload: unknown) => void;
export interface SnapshotSubscription { unsubscribe(): void }

export const subscribeSnapshot = (listener: SnapshotListener): SnapshotSubscription => {
  const api = getApi();
  if (!api) {
    // Native WebSocket path is still owned by useWebSocket. This stub stays a
    // no-op in dev/web; the global monkey-patch handles bridging if needed.
    return { unsubscribe: () => {} };
  }
  const off = api.onMessage(listener);
  return { unsubscribe: off };
};

export { installPackagedTransport } from './install-packaged-transport.js';

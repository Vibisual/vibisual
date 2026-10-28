import type { AppEventPayload } from '@vibisual/shared';

/** §5.13 (Y) 40-7 ② — 앱 서버 알림(`host.notify` → `app_event` 방송)을 이 창 소켓에서 앱 id 별로 흘린다. 앱의 폴링은 소켓이 끊겼을 때의 안전망이다. */
type Listener = (event: AppEventPayload) => void;

const listeners = new Map<string, Set<Listener>>();

function isAppEvent(value: unknown): value is AppEventPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v['appId'] === 'string' && typeof v['project'] === 'string' && typeof v['kind'] === 'string' && typeof v['key'] === 'string'
    && (v['version'] === undefined || typeof v['version'] === 'number');
}

/** 소켓이 받은 알림을 흘린다(모양이 틀리면 버린다). 듣는 쪽이 던져도 다른 쪽은 받는다. */
export function emitAppEvent(payload: unknown): void {
  if (!isAppEvent(payload)) return;
  const set = listeners.get(payload.appId);
  if (!set) return;
  for (const listener of [...set]) {
    try { listener(payload); } catch { /* 한 화면의 실패가 다른 화면의 알림을 막지 않는다 */ }
  }
}

/** 그 앱의 알림을 듣는다. 돌려받은 함수로 끊는다. */
export function onAppEvent(appId: string, listener: Listener): () => void {
  let set = listeners.get(appId);
  if (!set) { set = new Set(); listeners.set(appId, set); }
  set.add(listener);
  return () => {
    const current = listeners.get(appId);
    current?.delete(listener);
    if (current && current.size === 0) listeners.delete(appId);
  };
}

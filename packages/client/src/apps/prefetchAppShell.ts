import type { ComponentType } from 'react';

import { getInternalApp, type AppShellProps } from './registry.js';

/**
 * §5.13 (X) 39-2 — 앱 화면 청크를 누르기 전에 받아 둔다(손이 오르면 한가할 때, 누르면 즉시) — 더블클릭이 창을 열 때는 이미 해석돼 있다.
 * 받아 둔 화면은 `AppShellHost` 가 `lazy` 없이 바로 그린다(`peekPrefetchedShell`) — React 18 `lazy` 는 풀린 약속이어도 첫 렌더에서 한 번 멈춘다.
 */
type Shell = ComponentType<AppShellProps>;

const state = new Map<string, 'scheduled' | 'started'>();
const resolved = new Map<string, Shell>();

/** 한가할 때 받기를 기다리는 상한(ms) — 바쁜 화면에서도 이만큼 지나면 받는다. */
const IDLE_TIMEOUT_MS = 1500;
/** `requestIdleCallback` 이 없는 환경(시험 등)의 대신 기다림(ms). */
const IDLE_FALLBACK_MS = 200;

function keyOf(appId: string, mode: string): string {
  return `${appId}\u0000${mode}`;
}

export function prefetchAppShell(appId: string, opts: { readonly now?: boolean; readonly mode?: string } = {}): void {
  const mode = opts.mode ?? 'main';
  const loader = getInternalApp(appId)?.shells[mode];
  if (!loader) return;
  const key = keyOf(appId, mode);
  const current = state.get(key);
  if (current === 'started') return;
  const run = (): void => {
    if (state.get(key) === 'started') return;
    state.set(key, 'started');
    // 받지 못했으면(청크 손상·일시 오류) 다음 손짓이 다시 시도한다 — 실제로 열 때의 늦은 로더가 진짜 오류를 보인다.
    void loader().then((shell) => { resolved.set(key, shell as Shell); }, () => { state.delete(key); });
  };
  if (opts.now === true) { run(); return; }
  if (current === 'scheduled') return;
  state.set(key, 'scheduled');
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === 'function') idle(run, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(run, IDLE_FALLBACK_MS);
}

/** 이미 받아 해석해 둔 앱 화면(없으면 null — 그때는 늦은 로더가 받는다). */
export function peekPrefetchedShell(appId: string, mode: string): Shell | null {
  return resolved.get(keyOf(appId, mode)) ?? null;
}

/** 늦은 로더가 받아 온 화면도 기억해 둔다 — 같은 앱 창을 다시 열 때 `lazy` 를 거치지 않는다. */
export function rememberShell(appId: string, mode: string, shell: Shell): void {
  const key = keyOf(appId, mode);
  resolved.set(key, shell);
  state.set(key, 'started');
}

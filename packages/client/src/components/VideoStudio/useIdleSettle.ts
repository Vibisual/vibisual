import { useEffect, useState } from 'react';

/**
 * §5.13 (X) 39-2·39-4 — 첫 그림이 선 뒤 한가해지면 한 번 켜지는 걸쇠. 미뤄도 되는 일(늦은 판 미리 받기·대표 프레임 굽기·음악 비트 재기)은
 * 이게 켜진 뒤에 돈다 — 첫 그림과 함께 출발하면 열리는 화면과 CPU 를 다툰다. `ready` 가 끝내 오지 않아도(빈 문서·시작 화면·미리보기 오류)
 * `maxWaitMs` 뒤에는 켜진다. 한 번 켜지면 꺼지지 않는다.
 */
type IdleCallback = (cb: () => void, opts?: { timeout: number }) => number;
type CancelIdle = (handle: number) => void;

/** 한가함을 기다리는 상한(ms) — 바쁜 화면에서도 이만큼 지나면 켜진다. */
const IDLE_TIMEOUT_MS = 2000;

export function useIdleSettle(ready: boolean, maxWaitMs: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (settled) return;
    let cancelled = false;
    let idleHandle: number | null = null;
    const g = globalThis as { requestIdleCallback?: IdleCallback; cancelIdleCallback?: CancelIdle };
    const settle = (): void => {
      if (cancelled) return;
      if (typeof g.requestIdleCallback === 'function') {
        idleHandle = g.requestIdleCallback(() => { if (!cancelled) setSettled(true); }, { timeout: IDLE_TIMEOUT_MS });
      } else {
        setSettled(true);
      }
    };
    const timer = ready ? null : setTimeout(settle, maxWaitMs);
    if (ready) settle();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      if (idleHandle !== null && typeof g.cancelIdleCallback === 'function') g.cancelIdleCallback(idleHandle);
    };
  }, [ready, settled, maxWaitMs]);
  return settled;
}

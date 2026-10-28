/**
 * §5.11 — 카드들이 공유하는 분 단위 시계. `useMemo(() => …, [])` 로 만들지 마라 — 마운트 시점에 굳어 `rogue-agent` 등의 경과 시간이 안 흐른다.
 * 앱 전체가 타이머 하나를 공유해 분이 바뀔 때만 깨우고, 구독자가 없으면 돌리지 않는다.
 */
import { useSyncExternalStore } from 'react';

/** 분 경계를 최대 이 간격 안에 따라잡는다. 1초 폴링은 과하고, 60초는 최대 1분까지 늦어진다. */
const POLL_MS = 15_000;

const floorMinute = (ms: number): number => Math.floor(ms / 60_000) * 60_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let current = floorMinute(Date.now());

function tick(): void {
  const next = floorMinute(Date.now());
  // 같은 분이면 아무도 깨우지 않는다 — 깨우면 111장이 통째로 다시 계산된다.
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

export function subscribeMinute(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) timer = setInterval(tick, POLL_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** 분 단위로 내림한 '지금'. 같은 분 안에서는 **같은 값**이라 렌더가 흔들리지 않는다. */
export function getMinuteNow(): number {
  return current;
}

/** 카드 컨텍스트에 실어 보낼 '지금'. 분이 바뀔 때만 다시 그린다. */
export function useMinuteNow(): number {
  return useSyncExternalStore(subscribeMinute, getMinuteNow, getMinuteNow);
}

/** 테스트 전용 — 구독자·타이머·기준 시각을 초기 상태로 되돌린다. */
export function resetMinuteClockForTest(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  listeners.clear();
  current = floorMinute(Date.now());
}

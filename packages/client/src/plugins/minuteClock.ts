/**
 * §5.11 v4.31 — 카드들이 공유하는 **분 단위 시계**.
 *
 * 컨텍스트의 `now` 는 `useMemo(() => …, [])` 로 만들어지고 있었다. 의존성이 비어 있으니 **마운트 시점에
 * 굳고 다시 계산되지 않는다.** 주석에는 "1분마다만 값이 바뀐다"고 적혀 있었지만 실제로는 영영 안 바뀌었다.
 *
 * 그 결과가 뼈아프다 — `rogue-agent` 는 "세션이 살아 있는데 오래 조용한가"를 보는 카드인데, 기준이 되는
 * 지금이 멈춰 있으니 **시간이 흘렀다는 사실 자체를 영영 모른다.** 버블을 띄워 둔 채 두 시간이 지나도
 * 방치 판정이 뜨지 않는다. `long-horizon`·`fan-out`·`audit-trail`·`agent-registry` 의 경과 시간도 같다.
 *
 * 그렇다고 버블마다 타이머를 달 수는 없다(버블 수만큼 늘어난다). 앱 전체가 **하나의 타이머**를 공유하고,
 * 분이 바뀔 때만 구독자를 깨운다. 구독자가 없으면 타이머 자체를 돌리지 않는다 — 플러그인을 하나도
 * 안 켜면 시계도 안 돈다.
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

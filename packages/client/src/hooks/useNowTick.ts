import { useEffect, useState } from 'react';

/**
 * 1초마다 도는 `now` — **켜져 있을 때만** 돈다.
 *
 * 경과 시간을 말하는 자리(무응답 안내·실행 중 인디케이터)는 store 가 아니라 **시계**가 바뀌어야
 * 다시 그려진다. 그 타이머를 자리마다 손으로 달면, 아무것도 안 도는 화면에서도 초마다 리렌더가
 * 돈다 — 그래서 `active` 가 거짓이면 타이머 자체를 걸지 않고 마지막 값을 그대로 둔다.
 *
 * @param active   지금 시간을 세야 하는가. 꺼지면 타이머를 걷는다.
 * @param periodMs 갱신 주기. 초 단위 표기라 기본 1초면 충분하다.
 */
export function useNowTick(active: boolean, periodMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // 켜진 순간의 값을 먼저 맞춘다 — 꺼져 있는 동안 멈춰 있던 시계로 첫 프레임을 그리면 안 된다.
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), periodMs);
    return () => window.clearInterval(id);
  }, [active, periodMs]);
  return now;
}

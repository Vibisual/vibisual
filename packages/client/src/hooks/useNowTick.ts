import { useEffect, useState } from 'react';

/**
 * 1초마다 도는 `now` — **켜져 있을 때만** 돈다. §5.5 #17-10 ⑥-6 — 돌려주는 값은 **그리는 순간의 시계**다(틱 값이면 틱 사이에 온 줄이 더 늦어 경과가 음수 → `null` 로 숫자가 사라진다).
 * @param periodMs 갱신 주기(ms).
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
  // 틱보다 뒤로 가지는 않는다(벽시계가 잠깐 거꾸로 가도 시계는 되감기지 않는다).
  return active ? Math.max(now, Date.now()) : now;
}

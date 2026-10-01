import { useEffect, useState } from 'react';

/**
 * 1초마다 도는 `now` — **켜져 있을 때만** 돈다.
 *
 * 경과 시간을 말하는 자리(무응답 안내·실행 중 인디케이터)는 store 가 아니라 **시계**가 바뀌어야
 * 다시 그려진다. 그 타이머를 자리마다 손으로 달면, 아무것도 안 도는 화면에서도 초마다 리렌더가
 * 돈다 — 그래서 `active` 가 거짓이면 타이머 자체를 걸지 않고 마지막 값을 그대로 둔다.
 *
 * §5.5 #17-10 ⑥-6 — 켜져 있는 동안 돌려주는 값은 **그리는 순간의 시계**다. 틱은 다시 그리게 만드는
 * 계기일 뿐이다. 틱 값을 그대로 돌려주면, 틱 사이에 새 줄이 와서 다시 그릴 때 그 줄의 시각이 멈춰
 * 둔 `now` 보다 늦다. 그러면 경과가 음수가 되어 "모름"(`null`)으로 떨어지고, 숫자가 다음 틱까지
 * 사라졌다(사용자 보고 "사라지거나 0만").
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
  // 틱보다 뒤로 가지는 않는다(벽시계가 잠깐 거꾸로 가도 시계는 되감기지 않는다).
  return active ? Math.max(now, Date.now()) : now;
}

import { useEffect, useState } from 'react';
import { ViewportPortal, useStoreApi } from '@xyflow/react';
import { SunCorona } from './SunCorona.js';

/** 렌더러마다 한 번이면 된다 — 준비된 셰이더는 GPU 프로세스가 앱이 끝날 때까지 들고 있다. */
let warmed = false;
/** 그린 뒤 거두기까지. 래스터와 셰이더 준비(실측 약 77ms)가 끝날 만큼 넉넉하게. */
const WARM_MS = 600;
/** 흔한 버블 지름. 준비되는 셰이더를 가르는 것은 크기보다 래스터 배율(캔버스 확대 × 화면 배율)이다. */
const WARM_SIZE = 120;

/**
 * §5.4 #31 (K) 2026-10-09 — 첫 선택 예열. 선택 코로나의 SVG 필터(노이즈·변위·블러)는 앱을 켠 뒤 **처음
 * 그릴 때만** GPU 가 셰이더를 준비하느라 한 번 크게 멈춘다(실측: 첫 선택 직후 4프레임·약 50ms, 두 번째
 * 선택부터 0). 캔버스가 보이고 한가할 때 거의 투명한 코로나를 화면 가운데에 잠깐 한 번 그려 두면 그
 * 비용이 클릭 순간에서 빠진다. 같은 모양이어야 같은 셰이더가 준비되므로 `SunCorona` 를 그대로 그리고,
 * 래스터 배율도 같아야 해서 캔버스 좌표계(ViewportPortal) 안에 그린다. 캔버스가 덮여 있으면(페인트가
 * 꺼져 있으면) 그려지지 않으므로 보일 때까지 미룬다.
 */
export function CoronaWarmup({ hidden }: { hidden: boolean }): React.JSX.Element | null {
  const store = useStoreApi();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (warmed || hidden || at) return;
    const start = (): void => {
      const { transform: [tx, ty, zoom], width, height } = store.getState();
      if (width <= 0 || height <= 0 || zoom <= 0) return;
      setAt({ x: (width / 2 - tx) / zoom, y: (height / 2 - ty) / zoom });
    };
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(start, { timeout: 3000 });
      return () => cancelIdleCallback(id);
    }
    const id = window.setTimeout(start, 1500);
    return () => window.clearTimeout(id);
  }, [hidden, at, store]);

  useEffect(() => {
    if (!at) return;
    // 그리는 도중 덮이면 그려지지 않았을 수 있다 — 끝난 것으로 치지 않고 다음에 다시 한다.
    if (hidden) { setAt(null); return; }
    const id = window.setTimeout(() => { warmed = true; setAt(null); }, WARM_MS);
    return () => window.clearTimeout(id);
  }, [at, hidden]);

  if (!at || hidden || warmed) return null;
  return (
    <ViewportPortal>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute opacity-[0.01]"
        style={{ transform: `translate(${at.x - WARM_SIZE / 2}px, ${at.y - WARM_SIZE / 2}px)`, width: WARM_SIZE, height: WARM_SIZE }}
      >
        <SunCorona filterId="sun--warmup" size={WARM_SIZE} glow="#ffffff" />
      </div>
    </ViewportPortal>
  );
}

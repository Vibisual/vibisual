import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RECENT_USE_RING, REDUCED_MOTION_LOOP_SLOWDOWN, recentUseRingLook } from '@vibisual/shared';

interface RecentUseRingsProps {
  /** 0~1 — 가까운 순위일수록 크다. 0 이면 사라지는 중이거나 없다. */
  strength: number;
  glow: string;
  /** 원 지름(px). 번짐은 px 로 정해지므로 배율로 바꿀 때만 쓴다. */
  size: number;
}

/** 꺼진 뒤에도 사라지는 동안은 남는다 — 그 안에 다시 켜지면 내려앉던 자리에서 다시 커진다(깜빡임 없음). */
function useLingeringPresence(active: boolean, ms: number): boolean {
  const [lingering, setLingering] = useState(active);
  useEffect(() => {
    if (active) {
      setLingering(true);
      return undefined;
    }
    if (!lingering) return undefined;
    const timer = setTimeout(() => setLingering(false), ms);
    return () => clearTimeout(timer);
  }, [active, lingering, ms]);
  return active || lingering;
}

const R = RECENT_USE_RING;
const TIMING_VARS = {
  '--ru-pulse-ms': `${R.pulseMs}ms`,
  '--ru-pulse-reduced-ms': `${R.pulseMs * REDUCED_MOTION_LOOP_SLOWDOWN}ms`,
  '--ru-resize-ms': `${R.resizeMs}ms`,
  '--ru-fade-ms': `${R.fadeOutMs}ms`,
};
const SECOND_RING_DELAY = `-${R.pulseMs / 2}ms`;

/** §5.1 #3-5 — 최근 사용 링. 종전 작업 파동 두 겹과 같은 모양이고, 순위가 번짐과 밝기만 정한다. */
export function RecentUseRings({ strength, glow, size }: RecentUseRingsProps): React.JSX.Element | null {
  const present = useLingeringPresence(strength > 0, R.fadeOutMs);
  return present ? <RecentUseRingLayer strength={strength} glow={glow} size={size} /> : null;
}

function RecentUseRingLayer({ strength, glow, size }: RecentUseRingsProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  // 삽입 첫 스타일에는 전이가 붙지 않는다 — 0 인 값을 한 번 계산시킨 뒤 다음 프레임에 목표로 올려 번지며 나타나게 한다.
  useLayoutEffect(() => {
    if (typeof requestAnimationFrame !== 'function') {
      setArmed(true);
      return undefined;
    }
    if (ref.current) void getComputedStyle(ref.current).getPropertyValue('--ru-reach');
    const frame = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const look = recentUseRingLook(armed ? strength : 0);
  const style = {
    ...TIMING_VARS,
    '--ru-reach': look.reachPx,
    '--ru-alpha': look.alpha,
    '--ru-size': Math.max(1, size),
  } as React.CSSProperties;
  return (
    <div ref={ref} className="recent-use-rings pointer-events-none absolute inset-0" data-leaving={strength > 0 ? undefined : ''} style={style}>
      <div className="animate-recent-use-ring absolute inset-0 rounded-full border-2" style={{ borderColor: glow }} />
      <div className="animate-recent-use-ring absolute inset-0 rounded-full border-2" style={{ borderColor: glow, animationDelay: SECOND_RING_DELAY }} />
    </div>
  );
}

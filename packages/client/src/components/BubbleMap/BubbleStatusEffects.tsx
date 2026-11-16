import type { NodeStatus } from '@vibisual/shared';
import { RecentUseRings } from './RecentUseRings.js';

interface BubbleStatusEffectsProps {
  status: NodeStatus;
  glow: string;
  /**
   * §5.1 #3-5 — 에이전트가 쓰는 버블(파일·폴더·도메인·명령 앱)이면 작업 파동 대신 최근 사용 링을 두른다.
   * `strength` 0 이면 링이 없다(일하는 에이전트의 최근 N 밖) — 늘 붙여 둬야 빠질 때 사라지는 동안이 남는다. 없으면 종전 작업 파동.
   */
  recentUse?: { strength: number; size: number };
}

function SettledHalo({ failed }: { failed: boolean }): React.JSX.Element {
  return (
    <>
      <div className={`pointer-events-none absolute -inset-1 rounded-full border-[3px] ${failed ? 'border-rose-500' : 'border-cyan-400'}`} />
      <div
        className="pointer-events-none absolute -inset-2 animate-pulse rounded-full opacity-50"
        style={{ boxShadow: `0 0 20px 8px ${failed ? '#F43F5E' : '#22D3EE'}`, animationDuration: '3s' }}
      />
    </>
  );
}

/** Positioned by the circular face, never by the wider speech balloon. */
export function BubbleStatusEffects({ status, glow, recentUse }: BubbleStatusEffectsProps): React.JSX.Element | null {
  const settled = status === 'completed' || status === 'error' ? <SettledHalo failed={status === 'error'} /> : null;
  if (recentUse) {
    return (
      <>
        <RecentUseRings strength={recentUse.strength} glow={glow} size={recentUse.size} />
        {settled}
      </>
    );
  }
  if (status === 'active') {
    return (
      <>
        <div className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-full border-2" style={{ borderColor: glow }} />
        <div className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-full border-2" style={{ borderColor: glow, animationDelay: '0.75s' }} />
      </>
    );
  }
  return settled;
}

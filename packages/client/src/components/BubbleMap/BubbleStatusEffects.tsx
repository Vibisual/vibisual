import type { NodeStatus } from '@vibisual/shared';

interface BubbleStatusEffectsProps {
  status: NodeStatus;
  glow: string;
}

/** Positioned by the circular face, never by the wider speech balloon. */
export function BubbleStatusEffects({ status, glow }: BubbleStatusEffectsProps): React.JSX.Element | null {
  if (status === 'active') {
    return (
      <>
        <div className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-full border-2" style={{ borderColor: glow }} />
        <div className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-full border-2" style={{ borderColor: glow, animationDelay: '0.75s' }} />
      </>
    );
  }
  if (status === 'completed' || status === 'error') {
    const failed = status === 'error';
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
  return null;
}

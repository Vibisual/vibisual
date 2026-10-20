import type { BubbleStyleConfig, NodeStatus } from '@vibisual/shared';

/** Provider colors and custom body/glow overrides are shared by both agent forms. */
export function bubbleAgentStyle(base: BubbleStyleConfig, isCodex: boolean, customColor?: string): BubbleStyleConfig {
  const providerStyle: BubbleStyleConfig = isCodex
    ? { ...base, color: '#8B5CF6', glow: '#C4B5FD',
        ringIdle: 'border-violet-300',
        ringActive: 'border-violet-400 shadow-lg shadow-violet-500/30' }
    : base;
  return customColor ? { ...providerStyle, color: customColor, glow: customColor } : providerStyle;
}

/** Shape changes must not change the meaning of a bubble's status ring. */
export function bubbleStatusRingClass(status: NodeStatus, style: BubbleStyleConfig): string {
  if (status === 'awaiting_permission') return 'border-amber-400 shadow-lg shadow-amber-400/40 animate-pulse';
  if (status === 'active') return style.ringActive;
  if (status === 'error') return 'border-rose-500 shadow-lg shadow-rose-500/30';
  if (status === 'completed') return 'border-cyan-400 shadow-lg shadow-cyan-400/30';
  return style.ringIdle;
}

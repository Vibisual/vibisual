/**
 * §5.11 v3.96 — 컨텍스트 창(Context Window): 상한이지 목표가 아니다.
 *
 * 창이 100만 토큰이 돼도 다 채우면 안 된다. "이 모델은 200k 창이니 150k 를 넣어도 된다"는 추론은 틀렸고,
 * 실제 작업으로 직접 측정해 **자기 유효 창**을 찾아야 한다. 여기서는 설정된 창과 실제 최대 사용량을
 * 나란히 놓는다. 표시 전용.
 */
import { getModelContextLimit } from '@vibisual/shared';
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

const limit = (ctx: PluginBubbleContext): number => getModelContextLimit(ctx.agentConfig?.model);
const peak = (ctx: PluginBubbleContext): number =>
  (ctx.data.subAgents ?? []).reduce((max, s) => Math.max(max, s.contextUsed ?? 0), 0);

const inspector = defineInspector({
  id: 'context-window', i18nKey: 'contextWindow', name: 'Context Window', category: 'observability',
  needs: ['subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (peak(ctx) === 0) return { key: 'unused', tone: 'neutral' };
    return peak(ctx) / Math.max(1, limit(ctx)) >= 0.5 ? { key: 'deep', tone: 'warn' } : { key: 'shallow', tone: 'good' };
  },
  checks: [
    { key: 'configured', value: (ctx) => ctx.agentConfig?.contextWindow ?? `${Math.round(limit(ctx) / 1000)}k` },
    { key: 'peak', value: (ctx) => (peak(ctx) > 0 ? `~${Math.round(peak(ctx) / 1000)}k` : '—') },
    { key: 'headroom', value: (ctx) => (peak(ctx) > 0 ? `${Math.max(0, Math.round((1 - peak(ctx) / Math.max(1, limit(ctx))) * 100))}%` : '—') },
  ],
  noteKey: () => '.note',
});

export const contextWindowManifest = inspector.manifest;
export const contextWindowClient = inspector.client;

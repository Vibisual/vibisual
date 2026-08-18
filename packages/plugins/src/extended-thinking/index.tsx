/**
 * §5.11 v3.96 — 확장 사고(Extended Thinking): 사고 토큰도 컨텍스트를 먹는다.
 *
 * 답을 내기 전에 내부 스크래치패드에서 길게 숙고하는 모드다. 계획 수립·디버깅·다단 추론에서 효과가 크지만
 * **사고 토큰도 컨텍스트를 먹고 과금되므로**, 긴 세션에서는 지난 사고 블록을 걷어내는 것이 필수가 된다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const HIGH = ['high', 'xhigh', 'max'];
const on = (ctx: PluginBubbleContext): boolean => HIGH.includes(ctx.agentConfig?.effort ?? 'default');
const peak = (ctx: PluginBubbleContext): number =>
  (ctx.data.subAgents ?? []).reduce((max, s) => Math.max(max, s.contextUsed ?? 0), 0);

const inspector = defineInspector({
  id: 'extended-thinking', i18nKey: 'extendedThinking', name: 'Extended Thinking', category: 'observability',
  needs: ['subAgents'],
  status: (ctx) => {
    if (!on(ctx)) return { key: 'off', tone: 'neutral' };
    return peak(ctx) > 0 ? { key: 'onLoaded', tone: 'warn' } : { key: 'on', tone: 'neutral' };
  },
  checks: [
    { key: 'effort', value: (ctx) => ctx.agentConfig?.effort ?? 'default', tone: (ctx) => (on(ctx) ? 'warn' : 'neutral') },
    { key: 'context', value: (ctx) => (peak(ctx) > 0 ? `~${Math.round(peak(ctx) / 1000)}k` : '—') },
  ],
  noteKey: (ctx) => (on(ctx) ? '.noteOn' : '.note'),
});

export const extendedThinkingManifest = inspector.manifest;
export const extendedThinkingClient = inspector.client;

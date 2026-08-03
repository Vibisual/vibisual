/**
 * §5.11 v4.00 — SSOT 어긋남(SSOT Drift): 진실 공급원이 몇 군데인가.
 *
 * 같은 정보가 두 군데 있으면 반드시 어긋나고, 어느 쪽이 맞는지 아무도 모르게 된다. 사람은 "이건 옛날 거네"
 * 하고 넘기지만 모델은 **둘 다 그럴듯하게 인용**한다. 이 카드는 이 에이전트가 지시를 받는 자리가 몇 군데인지 센다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

const sources = (ctx: PluginBubbleContext): number =>
  [
    (ctx.agentConfig?.rules ?? '').trim().length > 0,
    (ctx.agentConfig?.skills ?? []).length > 0,
    (ctx.data.brain?.currentCount ?? 0) > 0,
  ].filter(Boolean).length;

const inspector = defineInspector({
  id: 'ssot-drift', i18nKey: 'ssotDrift', name: 'SSOT Drift', category: 'observability',
  needs: ['brain'],
  status: (ctx) => (sources(ctx) <= 1 ? { key: 'single', tone: 'good' } : sources(ctx) === 2 ? { key: 'two', tone: 'neutral' } : { key: 'many', tone: 'warn' }),
  checks: [
    { key: 'sources', value: (ctx) => `${sources(ctx)} / 3`, tone: (ctx) => (sources(ctx) >= 3 ? 'warn' : 'neutral') },
    { key: 'rules', value: (ctx) => ((ctx.agentConfig?.rules ?? '').trim().length > 0 ? ctx.t('panel.plugins.ssotDrift.yes') : ctx.t('panel.plugins.ssotDrift.no')) },
    { key: 'memory', value: (ctx) => String(ctx.data.brain?.currentCount ?? 0) },
  ],
  noteKey: () => '.note',
});

export const ssotDriftManifest = inspector.manifest;
export const ssotDriftClient = inspector.client;

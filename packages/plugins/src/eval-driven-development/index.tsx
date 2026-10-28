/** §5.11 — 평가 주도 개발(EDD): 무엇을 확인할지 먼저 정했는가(평가를 먼저 만들고, 그 판정기를 런타임 가드레일로 승격한다). 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const withPoints = (ctx: PluginBubbleContext): number =>
  (ctx.data.agentReviews ?? []).filter((r) => (r.checkpoints ?? []).length > 0).length;
const total = (ctx: PluginBubbleContext): number => (ctx.data.agentReviews ?? []).length;

const inspector = defineInspector({
  id: 'eval-driven-development', i18nKey: 'evalDrivenDevelopment', name: 'Eval-Driven Development', category: 'workflow',
  needs: ['agentReviews'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (total(ctx) === 0) return { key: 'none', tone: 'neutral' };
    return withPoints(ctx) === total(ctx) ? { key: 'defined', tone: 'good' } : { key: 'partial', tone: 'warn' };
  },
  checks: [
    { key: 'reviews', value: (ctx) => String(total(ctx)) },
    { key: 'withPoints', value: (ctx) => String(withPoints(ctx)), tone: (ctx) => (withPoints(ctx) > 0 ? 'good' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const evalDrivenDevelopmentManifest = inspector.manifest;
export const evalDrivenDevelopmentClient = inspector.client;

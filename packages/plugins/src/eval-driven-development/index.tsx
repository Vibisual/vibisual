/**
 * §5.11 v3.97 — 평가 주도 개발(EDD): 무엇을 확인할지 먼저 정했는가.
 *
 * 평가를 먼저 만들고 그 점수를 올리는 방향으로 고치는 방식이다. 결정적 진전은 평가와 가드레일이 하나로
 * 이어진 것 — 오프라인 평가로 만든 판정기를 그대로 런타임 가드레일로 승격시킨다. "평가 없이 프롬프트를
 * 고치는 것"이 무면허 운전에 해당한다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

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

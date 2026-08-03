/**
 * §5.11 v3.93 — 검수 관문(Review Gate): 완료 선언을 사람이 확인했는가.
 *
 * "완료" 선언과 실제 완료 사이의 간극이 AI 협업의 최대 마찰이다. 핵심은 검수를 **쉽게** 만드는 것 —
 * 무엇을 어떻게 바꿨고 무엇을 확인하면 되는지를 분리해 제시하면 검수 시간이 크게 줄어든다.
 * Vibisual 의 검수 카드가 그 형태이므로, 여기서는 그게 실제로 쓰이고 있는지를 센다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

function reviews(ctx: PluginBubbleContext): number {
  return (ctx.data.agentReviews ?? []).length;
}

function checkpoints(ctx: PluginBubbleContext): number {
  return (ctx.data.agentReviews ?? []).reduce((n, r) => n + (r.checkpoints ?? []).length, 0);
}

const inspector = defineInspector({
  id: 'review-gate', i18nKey: 'reviewGate', name: 'Review Gate', category: 'workflow',
  needs: ['agentReviews'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (reviews(ctx) === 0) return { key: 'none', tone: 'neutral' };
    if (checkpoints(ctx) === 0) return { key: 'noPoints', tone: 'warn' };
    return { key: 'present', tone: 'good' };
  },
  checks: [
    { key: 'reviews', value: (ctx) => String(reviews(ctx)) },
    { key: 'checkpoints', value: (ctx) => String(checkpoints(ctx)), tone: (ctx) => (checkpoints(ctx) > 0 ? 'good' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const reviewGateManifest = inspector.manifest;
export const reviewGateClient = inspector.client;

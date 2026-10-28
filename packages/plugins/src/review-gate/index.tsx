/** §5.11 — 검수 관문(Review Gate): 완료 선언을 사람이 확인했는가 — 검수 카드가 실제로 쓰이는지 센다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

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

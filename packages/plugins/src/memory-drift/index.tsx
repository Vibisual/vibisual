/**
 * §5.11 v3.95 — 기억 표류(Memory Drift): 기억이 재작성되며 원본에서 멀어지는가.
 *
 * 기존 기억을 반복해 다시 쓰면 매번 조금씩 그럴듯하게 다듬어지다 원본에 없던 내용이 사실로 굳는다.
 * 가장 확실한 방어는 항목을 **불변**으로 두고, 갱신을 "본문 수정"이 아니라 새 항목 추가 + 옛 항목 닫기로
 * 처리하는 것이다. Vibisual 의 기억은 그 규약을 따르므로 여기서는 그 사실과 검토 대기량을 보여준다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const review = (ctx: PluginBubbleContext): number => ctx.data.brain?.reviewCount ?? 0;

const inspector = defineInspector({
  id: 'memory-drift', i18nKey: 'memoryDrift', name: 'Memory Drift', category: 'observability',
  needs: ['brain'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (!ctx.data.brain) return { key: 'none', tone: 'neutral' };
    return review(ctx) > 0 ? { key: 'queued', tone: 'warn' } : { key: 'immutable', tone: 'good' };
  },
  checks: [
    { key: 'rewrite', value: (ctx) => ctx.t('panel.plugins.memoryDrift.noRewritePath'), tone: () => 'good' },
    { key: 'review', value: (ctx) => String(review(ctx)), tone: (ctx) => (review(ctx) > 0 ? 'warn' : 'neutral') },
    { key: 'unseen', value: (ctx) => String(ctx.data.brain?.unseenCount ?? 0) },
  ],
  noteKey: () => '.note',
});

export const memoryDriftManifest = inspector.manifest;
export const memoryDriftClient = inspector.client;

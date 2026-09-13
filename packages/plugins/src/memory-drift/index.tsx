/**
 * §5.11 v3.95 — 기억 표류(Memory Drift): 저장된 것이 다시 쓰이며 원본에서 멀어지는가.
 *
 * 기존 항목을 반복해 다시 쓰면 매번 조금씩 그럴듯하게 다듬어지다 원본에 없던 내용이 사실로 굳는다.
 * 가장 확실한 방어는 **원문을 요약하지 않는 것**이다.
 *
 * §5.10 의 절차가 그 규약을 따른다 — 단계는 실제로 돌던 명령 **원문 그대로** 적히고,
 * 관찰이 늘어도 원문을 고쳐 쓰는 경로가 없다. 사람이 손본 파일은 다음 분석이 아예 건드리지 않는다.
 * 그래서 여기서는 그 사실과 아직 판정을 기다리는 양을 보여준다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const waiting = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).brewing;

const inspector = defineInspector({
  id: 'memory-drift', i18nKey: 'memoryDrift', name: 'Memory Drift', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (!readAutoGoal(ctx).present) return { key: 'none', tone: 'neutral' };
    return waiting(ctx) > 0 ? { key: 'queued', tone: 'warn' } : { key: 'immutable', tone: 'good' };
  },
  checks: [
    { key: 'rewrite', value: (ctx) => ctx.t('panel.plugins.memoryDrift.noRewritePath'), tone: () => 'good' },
    { key: 'review', value: (ctx) => String(waiting(ctx)), tone: (ctx) => (waiting(ctx) > 0 ? 'warn' : 'neutral') },
    { key: 'unseen', value: (ctx) => String(readAutoGoal(ctx).dismissed) },
  ],
  noteKey: () => '.note',
});

export const memoryDriftManifest = inspector.manifest;
export const memoryDriftClient = inspector.client;

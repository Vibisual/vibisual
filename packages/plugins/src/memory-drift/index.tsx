/**
 * §5.11 — 기억 표류(Memory Drift): 방어는 원문을 요약하지 않는 것. 표시 전용.
 * §5.10 절차 단계는 명령 원문 그대로이고 고쳐 쓰는 경로가 없으며, 사람이 손본 파일은 다음 분석이 건드리지 않는다 — 그 사실과 판정 대기량을 보여준다.
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

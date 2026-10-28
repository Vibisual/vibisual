/** §5.11 — 기억 통합(Memory Consolidation): §5.10 자동 목표가 이 증류다(문턱만큼 되풀이된 명령 → 절차) — 요약하지 않고 원문 그대로라 요약 손실이 없다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';

const inspector = defineInspector({
  id: 'memory-consolidation', i18nKey: 'memoryConsolidation', name: 'Memory Consolidation', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const goal = readAutoGoal(ctx);
    if (!goal.present) return { key: 'none', tone: 'neutral' };
    if (goal.brewing > 0) return { key: 'pending', tone: 'neutral' };
    return { key: 'settled', tone: 'good' };
  },
  checks: [
    { key: 'unseen', value: (ctx) => String(readAutoGoal(ctx).brewing) },
    { key: 'recent', value: (ctx) => readAutoGoal(ctx).recent ?? '—' },
    { key: 'archived', value: (ctx) => String(readAutoGoal(ctx).dismissed) },
  ],
  noteKey: () => '.note',
});

export const memoryConsolidationManifest = inspector.manifest;
export const memoryConsolidationClient = inspector.client;

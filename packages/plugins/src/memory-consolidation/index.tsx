/**
 * §5.11 v3.95 — 기억 통합(Memory Consolidation): 일화가 의미로 증류되고 있는가.
 *
 * 통합은 공짜가 아니라 **손실이 있는 연산**이다. 단순 요약 파이프라인은 인코딩된 사실의 상당 부분을 잃고,
 * 중복 제거를 소홀히 하면 새 기록이 여전히 유효한 옛 기록을 덮어쓴다.
 *
 * §5.10 의 자동 목표가 하는 일이 정확히 이 증류다 — 한 번씩 스쳐 간 명령(일화)이 문턱만큼
 * 되풀이되면 절차(의미)로 굳는다. 그리고 **요약하지 않는다**: 단계는 실제로 돌던 원문 그대로라
 * 위에서 말한 손실이 일어날 자리가 없다. 표시 전용.
 */
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

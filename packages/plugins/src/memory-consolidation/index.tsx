/**
 * §5.11 v3.95 — 기억 통합(Memory Consolidation): 일화가 의미로 증류되고 있는가.
 *
 * 통합은 공짜가 아니라 **손실이 있는 연산**이다. 단순 요약 파이프라인은 인코딩된 사실의 상당 부분을 잃고,
 * 중복 제거를 소홀히 하면 새 기록이 여전히 유효한 옛 기록을 덮어쓴다. 그래서 원본을 보존한 채 증류본을
 * **추가**하는 형태로 돌려야 한다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';

const inspector = defineInspector({
  id: 'memory-consolidation', i18nKey: 'memoryConsolidation', name: 'Memory Consolidation', category: 'observability',
  needs: ['brain'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const s = ctx.data.brain;
    if (!s) return { key: 'none', tone: 'neutral' };
    if ((s.unseenCount ?? 0) > 0) return { key: 'pending', tone: 'neutral' };
    return { key: 'settled', tone: 'good' };
  },
  checks: [
    { key: 'unseen', value: (ctx) => String(ctx.data.brain?.unseenCount ?? 0) },
    { key: 'recent', value: (ctx) => ctx.data.brain?.recentCardTitle ?? '—' },
    { key: 'archived', value: (ctx) => String(ctx.data.brain?.archivedCount ?? 0) },
  ],
  noteKey: () => '.note',
});

export const memoryConsolidationManifest = inspector.manifest;
export const memoryConsolidationClient = inspector.client;

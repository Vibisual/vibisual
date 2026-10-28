/** §5.11 — 검색 증강(RAG): 근거 통로는 §5.10 절차 색인이다. 이 자리에 실제로 실리는 근거 수를 센다 — 꺼진 자리는 서버가 싣지 않으므로 0. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const carried = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).carried;

const inspector = defineInspector({
  id: 'rag', i18nKey: 'rag', name: 'RAG', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (carried(ctx) === 0 ? { key: 'none', tone: 'neutral' } : { key: 'grounded', tone: 'good' }),
  checks: [
    { key: 'cards', value: (ctx) => String(carried(ctx)) },
    { key: 'events', value: (ctx) => String(readAutoGoal(ctx).observed) },
    { key: 'recent', value: (ctx) => readAutoGoal(ctx).recent ?? '—' },
  ],
  noteKey: () => '.note',
});

export const ragManifest = inspector.manifest;
export const ragClient = inspector.client;

/**
 * §5.11 v3.98 — 검색 증강(RAG): 답의 근거가 어디서 왔는가.
 *
 * 모델이 아는 것에만 기대지 않고 외부 지식을 끌어와 답의 근거로 삼는 방식이다. Vibisual 에서 그 통로는
 * Project Brain 이므로, 여기서는 이 에이전트에 **어떤 근거가 실제로 들어왔는지**를 센다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const events = (ctx: PluginBubbleContext) => ctx.data.brainInjections ?? [];
const cards = (ctx: PluginBubbleContext): number => events(ctx).reduce((n, e) => n + e.cardIds.length, 0);

const inspector = defineInspector({
  id: 'rag', i18nKey: 'rag', name: 'RAG', category: 'observability',
  needs: ['brainInjections'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (cards(ctx) === 0 ? { key: 'none', tone: 'neutral' } : { key: 'grounded', tone: 'good' }),
  checks: [
    { key: 'cards', value: (ctx) => String(cards(ctx)) },
    { key: 'events', value: (ctx) => String(events(ctx).length) },
    { key: 'recent', value: (ctx) => events(ctx)[events(ctx).length - 1]?.cardTitles[0] ?? '—' },
  ],
  noteKey: () => '.note',
});

export const ragManifest = inspector.manifest;
export const ragClient = inspector.client;

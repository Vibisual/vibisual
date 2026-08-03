/**
 * §5.11 v4.00 — 재순위화(Reranking): 가져온 것 중 무엇을 위에 두는가.
 *
 * 1차 검색은 넓게 건지고, 재순위화가 그중 실제로 관련 있는 것을 위로 올린다. Vibisual 은 주입 시점에
 * **상위 몇 장만** 실어 보내므로 그 상한이 곧 재순위의 결과다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { BRAIN_INJECTION_TOP_K } from '@vibisual/shared';
import type { PluginBubbleContext } from '../types.js';

const perEvent = (ctx: PluginBubbleContext): number => {
  const events = ctx.data.brainInjections ?? [];
  if (events.length === 0) return 0;
  return events.reduce((n, e) => n + e.cardIds.length, 0) / events.length;
};

const inspector = defineInspector({
  id: 'reranking', i18nKey: 'reranking', name: 'Reranking', category: 'observability',
  needs: ['brainInjections'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (perEvent(ctx) === 0 ? { key: 'none', tone: 'neutral' } : perEvent(ctx) <= BRAIN_INJECTION_TOP_K ? { key: 'tight', tone: 'good' } : { key: 'loose', tone: 'warn' }),
  checks: [
    { key: 'perEvent', value: (ctx) => (perEvent(ctx) > 0 ? perEvent(ctx).toFixed(1) : '—') },
    { key: 'topK', value: () => String(BRAIN_INJECTION_TOP_K) },
  ],
  noteKey: () => '.note',
});

export const rerankingManifest = inspector.manifest;
export const rerankingClient = inspector.client;

/**
 * §5.11 v4.00 — 하이브리드 검색(Hybrid Search): 키워드와 의미를 함께 쓰는가.
 *
 * 키워드 검색은 정확한 이름·경로에 강하고 의미 검색은 표현이 다른 것에 강하다. Vibisual 의 기억 검색은
 * **키워드(텍스트) 축만** 쓰며, 이는 수백 건 규모에서 의도한 선택이다. 이 카드는 그 사실과 지금 규모를
 * 함께 보여준다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

const cards = (ctx: PluginBubbleContext): number => ctx.data.brain?.cardCount ?? 0;

const inspector = defineInspector({
  id: 'hybrid-search', i18nKey: 'hybridSearch', name: 'Hybrid Search', category: 'observability',
  needs: ['brain'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (cards(ctx) === 0 ? { key: 'none', tone: 'neutral' } : { key: 'keyword', tone: 'good' }),
  checks: [
    { key: 'axis', value: (ctx) => ctx.t('panel.plugins.hybridSearch.keywordOnly') },
    { key: 'cards', value: (ctx) => String(cards(ctx)) },
  ],
  noteKey: () => '.note',
});

export const hybridSearchManifest = inspector.manifest;
export const hybridSearchClient = inspector.client;

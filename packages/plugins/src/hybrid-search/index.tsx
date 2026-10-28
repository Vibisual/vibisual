/** §5.11 — 하이브리드 검색(Hybrid Search): §5.10 절차 저장고는 키워드(텍스트) 축만 쓴다(수십 벌 규모·원문 그대로라 텍스트 일치가 잘 먹는다) — 그 선택과 규모를 보여준다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const stored = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).stored;

const inspector = defineInspector({
  id: 'hybrid-search', i18nKey: 'hybridSearch', name: 'Hybrid Search', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (stored(ctx) === 0 ? { key: 'none', tone: 'neutral' } : { key: 'keyword', tone: 'good' }),
  checks: [
    { key: 'axis', value: (ctx) => ctx.t('panel.plugins.hybridSearch.keywordOnly') },
    { key: 'cards', value: (ctx) => String(stored(ctx)) },
  ],
  noteKey: () => '.note',
});

export const hybridSearchManifest = inspector.manifest;
export const hybridSearchClient = inspector.client;

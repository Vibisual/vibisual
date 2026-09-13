/**
 * §5.11 v4.00 — 하이브리드 검색(Hybrid Search): 키워드와 의미를 함께 쓰는가.
 *
 * 키워드 검색은 정확한 이름·경로에 강하고 의미 검색은 표현이 다른 것에 강하다. §5.10 의
 * 절차 저장고는 **키워드(텍스트) 축만** 쓴다 — 절차는 수십 벌 규모이고 이름·명령 원문이 그대로
 * 들어 있어 텍스트 일치가 잘 먹는다. 이 카드는 그 선택과 지금 규모를 함께 보여준다. 표시 전용.
 */
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

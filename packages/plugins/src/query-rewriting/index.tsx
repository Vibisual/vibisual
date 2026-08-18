/**
 * §5.11 v4.00 — 질의 재작성(Query Rewriting): 물어보는 말을 그대로 검색하지 않는다.
 *
 * 사람이 쓴 문장과 저장된 지식의 표현은 다르므로, 질의를 다듬어야 걸린다. Vibisual 에서는 에이전트가
 * 자기 말로 검색어를 만들어 부르므로 재작성이 에이전트 쪽에서 일어난다 — 그 흔적이 능동 검색 횟수다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const searches = (ctx: PluginBubbleContext): number => (ctx.data.brainInjections ?? []).filter((e) => e.trigger === 'search').length;
const hits = (ctx: PluginBubbleContext): number =>
  (ctx.data.brainInjections ?? []).filter((e) => e.trigger === 'search').reduce((n, e) => n + e.cardIds.length, 0);

const inspector = defineInspector({
  id: 'query-rewriting', i18nKey: 'queryRewriting', name: 'Query Rewriting', category: 'observability',
  needs: ['brainInjections'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (searches(ctx) === 0 ? { key: 'none', tone: 'neutral' } : hits(ctx) > 0 ? { key: 'effective', tone: 'good' } : { key: 'empty', tone: 'warn' }),
  checks: [
    { key: 'searches', value: (ctx) => String(searches(ctx)) },
    { key: 'hits', value: (ctx) => String(hits(ctx)), tone: (ctx) => (hits(ctx) > 0 ? 'good' : 'warn') },
  ],
  noteKey: () => '.note',
});

export const queryRewritingManifest = inspector.manifest;
export const queryRewritingClient = inspector.client;

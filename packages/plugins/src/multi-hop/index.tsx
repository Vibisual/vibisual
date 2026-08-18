/**
 * §5.11 v4.00 — 다단 검색(Multi-hop): 한 번 찾고 끝인가, 이어서 더 찾는가.
 *
 * 한 번의 검색으로 답이 나오지 않는 질문은 찾은 것을 근거로 **다시 질의**해야 풀린다. 여기서는 이 에이전트가
 * 능동 검색을 몇 번이나 이어서 했는지를 센다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const hops = (ctx: PluginBubbleContext): number => (ctx.data.brainInjections ?? []).filter((e) => e.trigger === 'search').length;

const inspector = defineInspector({
  id: 'multi-hop', i18nKey: 'multiHop', name: 'Multi-hop Retrieval', category: 'observability',
  needs: ['brainInjections'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (hops(ctx) === 0 ? { key: 'none', tone: 'neutral' } : hops(ctx) >= 2 ? { key: 'multi', tone: 'good' } : { key: 'single', tone: 'neutral' }),
  checks: [
    { key: 'hops', value: (ctx) => String(hops(ctx)) },
    { key: 'total', value: (ctx) => String((ctx.data.brainInjections ?? []).length) },
  ],
  noteKey: () => '.note',
});

export const multiHopManifest = inspector.manifest;
export const multiHopClient = inspector.client;

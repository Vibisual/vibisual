/**
 * §5.11 v4.00 — 다단 검색(Multi-hop): 한 번 하고 끝인가, 이어서 또 하는가.
 *
 * 한 번의 시도로 풀리지 않는 일은 찾은 것을 근거로 **다시** 해야 끝난다. §5.10 이후 이 축은
 * 되풀이 횟수로 읽는다 — 가장 많이 이어진 절차가 두 번 이상이면 이 프로젝트에는 "한 번으로 안 되는
 * 일"이 실재한다는 뜻이고, 그것이 바로 절차로 굳혀 둘 값어치가 있는 일이다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const hops = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).topRuns;

const inspector = defineInspector({
  id: 'multi-hop', i18nKey: 'multiHop', name: 'Multi-hop Retrieval', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (hops(ctx) === 0 ? { key: 'none', tone: 'neutral' } : hops(ctx) >= 2 ? { key: 'multi', tone: 'good' } : { key: 'single', tone: 'neutral' }),
  checks: [
    { key: 'hops', value: (ctx) => String(hops(ctx)) },
    { key: 'total', value: (ctx) => String(readAutoGoal(ctx).totalRuns) },
  ],
  noteKey: () => '.note',
});

export const multiHopManifest = inspector.manifest;
export const multiHopClient = inspector.client;

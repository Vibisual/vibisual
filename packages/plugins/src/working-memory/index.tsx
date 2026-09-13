/**
 * §5.11 v3.95 — 작업 기억(Working Memory): 지금 창에 실린 것.
 *
 * 빠르지만 세션이 끝나면 사라진다. 이것만으로는 "쓸수록 똑똑해지는" 시스템이 안 되고, 반대로 모든 것을
 * 장기 기억으로 만들려는 것도 실패한다 — 대부분의 대화는 그 자리에서 소비되고 버려져야 정상이다.
 * 그래서 **무엇을 넘길지의 승급 기준**이 첫 단추다.
 *
 * §5.10 의 승급 기준은 되풀이 횟수 하나다(문턱을 넘으면 절차가 된다). 여기서는 지금 창이
 * 얼마나 찼는지와, 그 창에 색인으로 실려 온 절차 수를 함께 본다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const contextUsed = (ctx: PluginBubbleContext): number =>
  (ctx.data.subAgents ?? []).reduce((max, s) => Math.max(max, s.contextUsed ?? 0), 0);

const inspector = defineInspector({
  id: 'working-memory', i18nKey: 'workingMemory', name: 'Working Memory', category: 'observability',
  needs: ['autoGoal', 'subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (contextUsed(ctx) > 0 ? { key: 'live', tone: 'good' } : { key: 'empty', tone: 'neutral' }),
  checks: [
    { key: 'context', value: (ctx) => (contextUsed(ctx) > 0 ? `~${Math.round(contextUsed(ctx) / 1000)}k` : '—') },
    { key: 'injected', value: (ctx) => String(readAutoGoal(ctx).carried) },
    { key: 'events', value: (ctx) => String(readAutoGoal(ctx).observed) },
  ],
  noteKey: () => '.note',
});

export const workingMemoryManifest = inspector.manifest;
export const workingMemoryClient = inspector.client;

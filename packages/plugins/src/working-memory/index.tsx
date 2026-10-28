/** §5.11 — 작업 기억(Working Memory): 지금 창이 얼마나 찼는지와 색인으로 실려 온 절차 수(§5.10 승급 기준은 되풀이 횟수). 표시 전용. */
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

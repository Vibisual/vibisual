/** §5.11 — 의미 기억(Semantic Memory): 확정된 사실 수(§5.10 = 굳은 절차, 기다리는 몫 = 문턱 못 넘은 후보). 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const g = (ctx: PluginBubbleContext) => readAutoGoal(ctx);

const inspector = defineInspector({
  id: 'semantic-memory', i18nKey: 'semanticMemory', name: 'Semantic Memory', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const goal = g(ctx);
    if (!goal.present) return { key: 'none', tone: 'neutral' };
    if (goal.brewing > 0) return { key: 'contested', tone: 'warn' };
    return { key: 'settled', tone: 'good' };
  },
  checks: [
    { key: 'cards', value: (ctx) => String(g(ctx).stored) },
    { key: 'current', value: (ctx) => String(g(ctx).skills), tone: () => 'good' },
    { key: 'contested', value: (ctx) => String(g(ctx).brewing), tone: (ctx) => (g(ctx).brewing > 0 ? 'warn' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const semanticMemoryManifest = inspector.manifest;
export const semanticMemoryClient = inspector.client;

/**
 * §5.11 v3.95 — 의미 기억(Semantic Memory): "무엇이 사실인가" 가 몇 개나 확정돼 있는가.
 *
 * 사건이 아니라 **추출된 사실**의 층이다. 쌓인 수가 아니라 "현재 확정된 수"가 실제 크기이고,
 * 아직 확정을 못 얻은 것은 사람의 판단을 기다리는 몫이다.
 *
 * §5.10 에서 확정된 사실은 **굳어 파일로 선 절차**이고, 기다리는 몫은 문턱을 못 넘은
 * 후보다. 표시 전용.
 */
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

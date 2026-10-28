/** §5.11 — 구조 엔지니어링(Rescue Engineering): 빨리 만든 비용은 이자가 붙어 돌아온다 — 지금 부채가 쌓이는 쪽인지 본다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const turns = (ctx: PluginBubbleContext): number => (ctx.data.agentEvents ?? []).length;
/** 사전 지출로 볼 수 있는 것들 — 규칙 · 검수 · 턴 상한. */
const prepaid = (ctx: PluginBubbleContext): number =>
  [
    (ctx.agentConfig?.rules ?? '').trim().length > 0,
    (ctx.data.agentReviews ?? []).length > 0,
    (ctx.agentConfig?.maxTurns ?? 0) > 0,
  ].filter(Boolean).length;

const inspector = defineInspector({
  id: 'rescue-engineering', i18nKey: 'rescueEngineering', name: 'Rescue Engineering', category: 'workflow',
  needs: ['agentEvents', 'agentReviews'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (turns(ctx) === 0) return { key: 'fresh', tone: 'neutral' };
    return turns(ctx) >= 20 && prepaid(ctx) === 0 ? { key: 'accruing', tone: 'warn' } : { key: 'prepaid', tone: 'good' };
  },
  checks: [
    { key: 'turns', value: (ctx) => String(turns(ctx)) },
    { key: 'prepaid', value: (ctx) => `${prepaid(ctx)} / 3`, tone: (ctx) => (prepaid(ctx) === 0 ? 'warn' : 'good') },
  ],
  noteKey: () => '.note',
});

export const rescueEngineeringManifest = inspector.manifest;
export const rescueEngineeringClient = inspector.client;

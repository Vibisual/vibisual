/**
 * §5.11 v3.93 — 토큰 예산(Token Budget): 구획별 상한이 있는가.
 *
 * 예산이 없으면 한 구획이 조용히 나머지를 밀어낸다 — "검색 결과가 많이 나온 날 지시문이 잘려 나가는"
 * 식의 비결정적 사고가 그렇게 난다. 여기서는 고정 구획(시스템 프롬프트·도구 스키마·git 상태)이
 * 창에서 차지하는 몫을 먼저 떼어 보여준다. 표시 전용.
 */
import { TOKEN_FIXED_CATEGORIES, getModelContextLimit } from '@vibisual/shared';
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

const FIXED = TOKEN_FIXED_CATEGORIES.reduce((sum, c) => sum + c.estimate, 0);

function limit(ctx: PluginBubbleContext): number {
  return getModelContextLimit(ctx.agentConfig?.model);
}

function fixedRatio(ctx: PluginBubbleContext): number {
  const max = limit(ctx);
  return max > 0 ? FIXED / max : 0;
}

const inspector = defineInspector({
  id: 'token-budget', i18nKey: 'tokenBudget', name: 'Token Budget', category: 'observability',
  status: (ctx) => {
    const r = fixedRatio(ctx);
    if (r >= 0.1) return { key: 'heavy', tone: 'warn' };
    return { key: 'ok', tone: 'good' };
  },
  checks: [
    { key: 'window', value: (ctx) => `${Math.round(limit(ctx) / 1000)}k` },
    { key: 'fixed', value: () => `~${Math.round(FIXED / 100) / 10}k` },
    { key: 'share', value: (ctx) => `${(fixedRatio(ctx) * 100).toFixed(1)}%` },
    { key: 'rules', value: (ctx) => `~${Math.round((ctx.agentConfig?.rules ?? '').length / 4)}` },
  ],
  noteKey: () => '.note',
});

export const tokenBudgetManifest = inspector.manifest;
export const tokenBudgetClient = inspector.client;

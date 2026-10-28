/** §5.11 — 토큰 예산(Token Budget): 고정 구획(시스템 프롬프트·도구 스키마·git 상태)이 창에서 차지하는 몫을 먼저 떼어 보인다. 표시 전용. */
import { TOKEN_FIXED_CATEGORIES, getModelContextLimit } from '@vibisual/shared';
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const FIXED = TOKEN_FIXED_CATEGORIES.reduce((sum, c) => sum + c.estimate, 0);

/** 문자수/4 토큰 근사 — 카드 하단 note 가 사용자에게 밝히는 것과 같은 셈. */
const approxTokens = (text: string): number => Math.round(text.length / 4);

function limit(ctx: PluginBubbleContext): number {
  return getModelContextLimit(ctx.agentConfig?.model);
}

/** 이 에이전트의 규칙 — 매 턴 프롬프트에 실리므로 고정 비용이다. */
function rulesTokens(ctx: PluginBubbleContext): number {
  return approxTokens(ctx.agentConfig?.rules ?? '');
}

/**
 * 일 시작 전에 이미 창을 먹는 몫 — 에이전트 규칙도 매 턴 실리는 고정 비용이라 넣는다.
 * ⚠ 상수 구획(`FIXED`, ~9.8k)만이면 등급이 영원히 `ok` 다 — 창이 늘 200k 이상(`MODEL_FAMILY_DEFAULTS`)이라 4.9%·0.98%(1M)에 묶여 `heavy` 를 못 넘는다.
 */
function fixedRatio(ctx: PluginBubbleContext): number {
  const max = limit(ctx);
  return max > 0 ? (FIXED + rulesTokens(ctx)) / max : 0;
}

/** 이 몫을 넘으면 "말을 꺼내기도 전에 창의 1/10을 썼다" — 구획별 상한을 정할 때가 됐다는 뜻. */
const HEAVY_SHARE = 0.1;

const inspector = defineInspector({
  id: 'token-budget', i18nKey: 'tokenBudget', name: 'Token Budget', category: 'observability',
  status: (ctx) => {
    const r = fixedRatio(ctx);
    if (r >= HEAVY_SHARE) return { key: 'heavy', tone: 'warn' };
    return { key: 'ok', tone: 'good' };
  },
  checks: [
    { key: 'window', value: (ctx) => `${Math.round(limit(ctx) / 1000)}k` },
    { key: 'fixed', value: () => `~${Math.round(FIXED / 100) / 10}k` },
    // 등급이 보는 값과 같은 값을 그린다 — 화면 숫자와 등급이 갈리면 어느 쪽도 못 믿는다.
    { key: 'share', value: (ctx) => `${(fixedRatio(ctx) * 100).toFixed(1)}%`, tone: (ctx) => (fixedRatio(ctx) >= HEAVY_SHARE ? 'warn' : 'good') },
    { key: 'rules', value: (ctx) => `~${rulesTokens(ctx)}`, tone: (ctx) => (rulesTokens(ctx) > FIXED ? 'warn' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const tokenBudgetManifest = inspector.manifest;
export const tokenBudgetClient = inspector.client;

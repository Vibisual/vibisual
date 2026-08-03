/**
 * §5.11 v4.00 — 구조 엔지니어링(Rescue Engineering): 빨리 만든 비용은 이연될 뿐이다.
 *
 * AI 로 급히 만든 코드베이스를 사후에 수습하는 작업이 하나의 시장이 됐다. "빨리 만든 비용"이 사라진 게 아니라
 * 이자가 붙어 돌아온다는 증거다. 규칙 문서·평가 셋·손실 방지·커밋 관문은 전부 **사전 지출**이며,
 * 사후 구조 비용의 몇 십 분의 일이다. 이 카드는 지금 부채가 쌓이는 쪽인지 본다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

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

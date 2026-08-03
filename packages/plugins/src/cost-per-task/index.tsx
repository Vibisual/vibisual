/**
 * §5.11 v3.93 — 작업당 비용(Cost per Task): 토큰이 아니라 **완수한 작업 단위**로 본다.
 *
 * 토큰 단가만 보면 "싼 모델로 열 번"이 이득처럼 보이지만, 재시도·실패까지 넣으면 반대인 경우가 많다.
 * 그래서 누적 토큰과 함께 **턴당 토큰**을 보여준다 — 한 번 답하는 데 얼마나 쓰는지가 실제 단가에 가깝다.
 *
 * 헤더의 사용량 필이 플랜 **총량**을 본다면, 이 카드는 **이 에이전트 몫**을 본다. 표시 전용.
 */
import type { SubAgent } from '@vibisual/shared';
import { calculateTokenCost } from '@vibisual/shared';
import { defineInspector, ICONS } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

interface CostStats {
  input: number;
  output: number;
  turns: number;
  usd: number;
  perTurn: number;
}

function sum(subAgents: readonly SubAgent[] | undefined, turns: number): CostStats {
  let input = 0;
  let output = 0;
  let usd = 0;
  for (const s of subAgents ?? []) {
    const i = s.totalInputTokens ?? 0;
    const o = s.totalOutputTokens ?? 0;
    input += i;
    output += o;
    if (i > 0 || o > 0) {
      // 캐시 토큰은 SubAgent 에 누적 필드가 없어 0 으로 둔다 — 실제보다 **낮게** 잡히는 쪽이라
      // "생각보다 쌌다"고 오해하지 않도록 카드 하단에 근사치임을 밝힌다.
      usd += calculateTokenCost(i, o, 0, 0, s.modelName).total;
    }
  }
  return { input, output, turns, usd, perTurn: turns > 0 ? (input + output) / turns : 0 };
}

function stats(ctx: PluginBubbleContext): CostStats {
  return sum(ctx.data.subAgents, (ctx.data.agentEvents ?? []).length);
}

const k = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

const inspector = defineInspector({
  id: 'cost-per-task',
  i18nKey: 'costPerTask',
  name: 'Cost per Task',
  category: 'observability',
  needs: ['subAgents', 'agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const s = stats(ctx);
    if (s.input + s.output === 0) return { key: 'idle', tone: 'neutral' };
    if (s.usd >= 5) return { key: 'heavy', tone: 'bad' };
    if (s.usd >= 1) return { key: 'moderate', tone: 'warn' };
    return { key: 'light', tone: 'good' };
  },
  checks: [
    { key: 'tokens', value: (ctx) => `${k(stats(ctx).input)} / ${k(stats(ctx).output)}` },
    { key: 'turns', value: (ctx) => String(stats(ctx).turns) },
    {
      key: 'perTurn',
      value: (ctx) => (stats(ctx).perTurn > 0 ? k(stats(ctx).perTurn) : '—'),
      tone: (ctx) => (stats(ctx).perTurn > 60_000 ? 'warn' : 'neutral'),
    },
    {
      key: 'usd',
      value: (ctx) => (stats(ctx).usd > 0 ? `$${stats(ctx).usd.toFixed(2)}` : '—'),
      tone: (ctx) => (stats(ctx).usd >= 1 ? 'warn' : 'neutral'),
    },
  ],
  noteKey: () => '.note',
  badge: {
    match: (ctx) => stats(ctx).usd >= 1,
    text: (ctx) => `$${stats(ctx).usd.toFixed(1)}`,
    icon: ICONS.gauge,
  },
});

export const costPerTaskManifest = inspector.manifest;
export const costPerTaskClient = inspector.client;

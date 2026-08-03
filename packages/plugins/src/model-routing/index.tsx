/**
 * §5.11 v3.93 — 모델 라우팅(Model Routing / Cascade): 이 작업에 이 모델이 맞나.
 *
 * 싼 모델로 먼저 처리하고 실패하면 승급시키는 계단식이 표준 실무가 됐지만, 실제로는 **한 번 고른
 * 모델이 그대로 남는다**. 여기서는 지금 모델과 작업의 크기(턴 수)를 나란히 놓아 승급·강등을 눈으로
 * 판단하게 한다. 자동으로 바꾸지 않는다 — 모델 선택은 사용자 결정이다. 표시 전용.
 */
import { parseModelFamily } from '@vibisual/shared';
import { defineInspector, ICONS } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

/** 사고 비용이 큰 순서. 알 수 없는 패밀리는 중간으로 본다. */
const WEIGHT: Record<string, number> = { haiku: 1, sonnet: 2, opus: 3 };

function family(ctx: PluginBubbleContext): string {
  return parseModelFamily(ctx.agentConfig?.model ?? '') || (ctx.agentConfig?.model ?? '');
}

function turns(ctx: PluginBubbleContext): number {
  return (ctx.data.agentEvents ?? []).length;
}

/** 승급/강등 제안 — 큰 작업에 작은 모델, 작은 작업에 큰 모델이면 알린다. */
function advice(ctx: PluginBubbleContext): 'upgrade' | 'downgrade' | 'fit' {
  const w = WEIGHT[family(ctx)] ?? 2;
  const n = turns(ctx);
  if (n >= 25 && w <= 1) return 'upgrade';
  if (n > 0 && n <= 3 && w >= 3) return 'downgrade';
  return 'fit';
}

const inspector = defineInspector({
  id: 'model-routing',
  i18nKey: 'modelRouting',
  name: 'Model Routing',
  category: 'workflow',
  needs: ['agentEvents'],
  status: (ctx) => {
    const a = advice(ctx);
    return a === 'fit' ? { key: 'fit', tone: 'good' } : { key: a, tone: 'warn' };
  },
  checks: [
    { key: 'model', value: (ctx) => ctx.agentConfig?.model ?? '—' },
    { key: 'effort', value: (ctx) => ctx.agentConfig?.effort ?? 'default' },
    { key: 'turns', value: (ctx) => String(turns(ctx)) },
  ],
  noteKey: (ctx) => `.advice.${advice(ctx)}`,
  badge: {
    match: (ctx) => advice(ctx) !== 'fit',
    text: () => '',
    icon: ICONS.route,
  },
});

export const modelRoutingManifest = inspector.manifest;
export const modelRoutingClient = inspector.client;

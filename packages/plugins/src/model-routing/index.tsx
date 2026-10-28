/** §5.11 — 모델 라우팅(Model Routing / Cascade): 지금 모델과 작업 크기(턴 수)를 나란히 놓는다. 자동으로 바꾸지 않는다 — 모델은 사람이 고른다. 표시 전용. */
import { parseModelFamily } from '@vibisual/shared';
import { defineInspector, ICONS } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

/**
 * 사고 비용이 큰 순서. 알 수 없는 패밀리는 중간으로 본다.
 * fable/mythos 는 opus 위 티어(입력 단가 $10 vs $5) — 빠지면 `?? 2` 로 sonnet 급이 되어 3턴짜리 작업에 최상위 모델을 물려도 강등 제안이 안 뜬다.
 */
const WEIGHT: Record<string, number> = { haiku: 1, sonnet: 2, opus: 3, fable: 4, mythos: 4 };

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

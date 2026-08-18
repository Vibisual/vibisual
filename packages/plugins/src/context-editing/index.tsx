/**
 * §5.11 v3.99 — 컨텍스트 편집(Context Editing): 요약이 아니라 선택적 삭제.
 *
 * 대화를 요약하는 대신 오래된 도구 호출·결과·사고 블록만 규칙 기반으로 걷어내는 방식으로, **가장 안전하고
 * 손실이 적은 형태의 압축**으로 평가된다. 이유는 단순하다 — 이미 처리가 끝난 도구 결과의 원문을 모델이
 * 다시 볼 이유가 대개 없다. 컴팩션보다 먼저 적용해 보는 것이 순서다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const fill = (ctx: PluginBubbleContext): number => {
  let best = 0;
  for (const s of ctx.data.subAgents ?? []) {
    const max = s.contextMax ?? 0;
    if (max > 0) best = Math.max(best, (s.contextUsed ?? 0) / max);
  }
  return best;
};
const turns = (ctx: PluginBubbleContext): number => (ctx.data.agentEvents ?? []).length;

const inspector = defineInspector({
  id: 'context-editing', i18nKey: 'contextEditing', name: 'Context Editing', category: 'observability',
  needs: ['subAgents', 'agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (turns(ctx) === 0) return { key: 'fresh', tone: 'neutral' };
    return fill(ctx) >= 0.5 && turns(ctx) >= 15 ? { key: 'due', tone: 'warn' } : { key: 'ok', tone: 'good' };
  },
  checks: [
    { key: 'turns', value: (ctx) => String(turns(ctx)) },
    { key: 'fill', value: (ctx) => (fill(ctx) > 0 ? `${Math.round(fill(ctx) * 100)}%` : '—') },
  ],
  noteKey: () => '.note',
});

export const contextEditingManifest = inspector.manifest;
export const contextEditingClient = inspector.client;

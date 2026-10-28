/** §5.11 — 컨텍스트 편집(Context Editing): 요약이 아니라 끝난 도구 호출·결과·사고 블록의 선택적 삭제 — 손실이 가장 적어 컴팩션보다 먼저 쓴다. 표시 전용. */
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

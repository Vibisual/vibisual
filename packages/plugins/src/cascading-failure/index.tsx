/** §5.11 — 연쇄 실패(Cascading Failure): 잘못된 출력이 다음 입력이 되어 확신에 찬 형태로 정제된다 — 대응은 경계마다 불확실성을 넘기고 인계에 "확인하지 못한 것" 칸을 두는 것. 표시 전용. */
import { defineInspector, ICONS } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

/** 위임 사슬이 길수록 원 출처와 멀어져 검증이 어려워진다. */
const chain = (ctx: PluginBubbleContext): number => (ctx.data.taskEdges ?? []).length + (ctx.data.subAgents ?? []).length;
const gated = (ctx: PluginBubbleContext): number => (ctx.data.taskEdges ?? []).filter((e) => e.forwardMode !== 'auto').length;

const inspector = defineInspector({
  id: 'cascading-failure', i18nKey: 'cascadingFailure', name: 'Cascading Failure', category: 'security',
  needs: ['taskEdges', 'subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (chain(ctx) === 0) return { key: 'single', tone: 'good' };
    return chain(ctx) >= 5 && gated(ctx) === 0 ? { key: 'unchecked', tone: 'warn' } : { key: 'chained', tone: 'neutral' };
  },
  checks: [
    { key: 'chain', value: (ctx) => String(chain(ctx)) },
    { key: 'gated', value: (ctx) => String(gated(ctx)), tone: (ctx) => (gated(ctx) > 0 ? 'good' : 'neutral') },
  ],
  noteKey: () => '.note',
  badge: { match: (ctx) => chain(ctx) >= 5 && gated(ctx) === 0, text: () => '', icon: ICONS.route },
});

export const cascadingFailureManifest = inspector.manifest;
export const cascadingFailureClient = inspector.client;

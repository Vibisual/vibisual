/**
 * §5.11 v3.99 — 연쇄 실패(Cascading Failure): 잘못된 출력이 다음 입력이 된다.
 *
 * 오류가 단계를 지날수록 **더 확신에 찬 형태로 정제**된다. 사람 조직이라면 "이거 이상한데?"라고 물을 지점에서
 * 에이전트는 받은 것을 사실로 전제하고 진행한다. 실효적 대응은 경계마다 불확실성을 함께 전달하고,
 * 인계 패킷에 "확인하지 못한 것" 칸을 두는 것이다. 표시 전용.
 */
import { defineInspector, ICONS } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

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

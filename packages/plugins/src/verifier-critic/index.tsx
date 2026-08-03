/**
 * §5.11 v3.96 — 검증자·비평자(Verifier–Critic): 작성자와 검사자가 갈려 있는가.
 *
 * 결정적 규칙 하나 — 비평자는 작성자보다 강하거나 최소한 다른 프롬프트여야 한다. 같은 맹점을 공유하는
 * 비평자는 나쁜 답에 그대로 도장을 찍는다. 그리고 가능하면 **실행 가능한 검증**(테스트·린트·타입체크)을
 * 비평자보다 먼저 두는 편이 싸고 정확하다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { toneIfActive } from '../framework/activity.js';
import type { PluginBubbleContext } from '../types.js';

const critiques = (ctx: PluginBubbleContext) => (ctx.data.taskEdges ?? []).filter((e) => e.kind === 'critique');
const incoming = (ctx: PluginBubbleContext) => critiques(ctx).filter((e) => e.targetAgentId === ctx.bubbleId);

const inspector = defineInspector({
  id: 'verifier-critic', i18nKey: 'verifierCritic', name: 'Verifier and Critic', category: 'workflow',
  needs: ['taskEdges', 'agentEvents', 'subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (critiques(ctx).length === 0) return { key: 'selfReview', tone: toneIfActive(ctx) };
    return { key: 'separated', tone: 'good' };
  },
  checks: [
    { key: 'critiques', value: (ctx) => String(critiques(ctx).length), tone: (ctx) => (critiques(ctx).length > 0 ? 'good' : 'warn') },
    { key: 'incoming', value: (ctx) => String(incoming(ctx).length) },
  ],
  noteKey: (ctx) => (critiques(ctx).length === 0 ? '.noteSelf' : '.note'),
});

export const verifierCriticManifest = inspector.manifest;
export const verifierCriticClient = inspector.client;

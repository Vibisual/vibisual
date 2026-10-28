/** §5.11 — 검증자·비평자(Verifier–Critic): 작성자와 검사자가 갈려 있는가(같은 맹점의 비평자는 도장만 찍는다). 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { toneIfActive } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

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

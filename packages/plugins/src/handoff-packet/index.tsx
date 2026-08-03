/**
 * §5.11 v3.96 — 핸드오프(Handoff): 인계가 구조화돼 있는가.
 *
 * 멀티 에이전트의 실제 병목은 모델 성능이 아니라 **인계 품질**이다. 인계 지점이 가장 취약하고, 인계에
 * 시간이 오래 걸린다면 대개 맥락이 비대해졌거나 지시가 모호하다는 신호다. 자유 서술로 넘기면 반드시 샌다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

const edges = (ctx: PluginBubbleContext) => ctx.data.taskEdges ?? [];
const outgoing = (ctx: PluginBubbleContext) => edges(ctx).filter((e) => e.sourceAgentId === ctx.bubbleId);
const structured = (ctx: PluginBubbleContext) => edges(ctx).filter((e) => Boolean(e.templateId));

const inspector = defineInspector({
  id: 'handoff-packet', i18nKey: 'handoffPacket', name: 'Handoff', category: 'workflow',
  needs: ['taskEdges'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (edges(ctx).length === 0) return { key: 'none', tone: 'neutral' };
    return structured(ctx).length === edges(ctx).length ? { key: 'structured', tone: 'good' } : { key: 'free', tone: 'warn' };
  },
  checks: [
    { key: 'edges', value: (ctx) => String(edges(ctx).length) },
    { key: 'outgoing', value: (ctx) => String(outgoing(ctx).length) },
    { key: 'templated', value: (ctx) => String(structured(ctx).length), tone: (ctx) => (structured(ctx).length > 0 ? 'good' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const handoffPacketManifest = inspector.manifest;
export const handoffPacketClient = inspector.client;

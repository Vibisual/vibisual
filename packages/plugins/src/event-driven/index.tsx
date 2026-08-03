/**
 * §5.11 v3.98 — 이벤트 기반(Event-Driven): 신호가 흐르고 있는가.
 *
 * 서비스가 서로를 직접 호출하지 않고 이벤트를 내보내고 반응하는 구조다. Vibisual 자체가 훅 이벤트로 도는
 * 시스템이므로, 여기서는 이 에이전트에서 실제로 흐른 신호의 양과 종류를 보여준다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

const turns = (ctx: PluginBubbleContext): number => (ctx.data.agentEvents ?? []).length;
const queued = (ctx: PluginBubbleContext): number => (ctx.data.agentEvents ?? []).filter((e) => e.source === 'queue').length;

const inspector = defineInspector({
  id: 'event-driven', i18nKey: 'eventDriven', name: 'Event-Driven', category: 'observability',
  needs: ['agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (turns(ctx) === 0 ? { key: 'silent', tone: 'neutral' } : { key: 'flowing', tone: 'good' }),
  checks: [
    { key: 'total', value: (ctx) => String(turns(ctx)) },
    { key: 'queued', value: (ctx) => String(queued(ctx)) },
    { key: 'direct', value: (ctx) => String(turns(ctx) - queued(ctx)) },
  ],
  noteKey: () => '.note',
});

export const eventDrivenManifest = inspector.manifest;
export const eventDrivenClient = inspector.client;

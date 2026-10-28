/** §5.11 — 이벤트 기반(Event-Driven): 이 에이전트에서 실제로 흐른 신호의 양과 종류를 보여준다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

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

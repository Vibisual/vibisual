/** §5.11 — 배압(Backpressure): 대기 중인 명령과 동시에 도는 작업을 함께 보여 밀림이 쌓이는지 본다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const running = (ctx: PluginBubbleContext): number => (ctx.data.runningTasks ?? []).length;
const queued = (ctx: PluginBubbleContext): number => (ctx.data.agentEvents ?? []).filter((e) => e.source === 'queue').length;

const inspector = defineInspector({
  id: 'backpressure', i18nKey: 'backpressure', name: 'Backpressure', category: 'observability',
  needs: ['runningTasks', 'agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (running(ctx) >= 4) return { key: 'saturated', tone: 'warn' };
    return running(ctx) > 0 ? { key: 'flowing', tone: 'good' } : { key: 'idle', tone: 'neutral' };
  },
  checks: [
    { key: 'running', value: (ctx) => String(running(ctx)), tone: (ctx) => (running(ctx) >= 4 ? 'warn' : 'neutral') },
    { key: 'queued', value: (ctx) => String(queued(ctx)) },
  ],
  noteKey: () => '.note',
});

export const backpressureManifest = inspector.manifest;
export const backpressureClient = inspector.client;

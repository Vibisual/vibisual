/**
 * §5.11 v3.98 — 배압(Backpressure): 밀려드는 양을 감당하고 있는가.
 *
 * 유입 속도가 처리 속도를 넘으면 큐가 자라고, 그 상태를 방치하면 어디선가 조용히 버려지거나 통째로 멈춘다.
 * 여기서는 **대기 중인 명령**과 **동시에 도는 작업**을 함께 보여 밀림이 쌓이는지 본다. 표시 전용.
 */
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

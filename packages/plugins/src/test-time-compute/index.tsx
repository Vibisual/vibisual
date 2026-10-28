/** §5.11 — 추론 시점 연산(Test-Time Compute): 사고를 사서 품질을 올리는가(쉬운 작업에 최대 사고는 낭비). 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const effort = (ctx: PluginBubbleContext): string => ctx.agentConfig?.effort ?? 'default';
const turns = (ctx: PluginBubbleContext): number => (ctx.data.agentEvents ?? []).length;

const inspector = defineInspector({
  id: 'test-time-compute', i18nKey: 'testTimeCompute', name: 'Test-Time Compute', category: 'workflow',
  needs: ['agentEvents'],
  status: (ctx) => {
    if (effort(ctx) === 'default') return { key: 'baseline', tone: 'neutral' };
    return turns(ctx) >= 10 ? { key: 'invested', tone: 'good' } : { key: 'unmeasured', tone: 'neutral' };
  },
  checks: [
    { key: 'effort', value: (ctx) => effort(ctx) },
    { key: 'turns', value: (ctx) => String(turns(ctx)) },
    { key: 'model', value: (ctx) => ctx.agentConfig?.model ?? '—' },
  ],
  noteKey: () => '.note',
});

export const testTimeComputeManifest = inspector.manifest;
export const testTimeComputeClient = inspector.client;

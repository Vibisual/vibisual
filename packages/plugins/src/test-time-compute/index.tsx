/**
 * §5.11 v3.96 — 추론 시점 연산(Test-Time Compute): 사고를 사서 품질을 올리고 있는가.
 *
 * 모델을 키우는 대신 **생각할 시간을 사는** 쪽이 비용 대비 효과가 좋은 구간이 넓다는 것이 확인됐다.
 * 실무적으로는 품질과 지연·비용을 다이얼로 조절할 수 있게 됐다는 뜻이고, 쉬운 작업에 최대 사고를 켜는 것은
 * 순수한 낭비다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

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

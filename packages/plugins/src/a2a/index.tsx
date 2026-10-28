/** §5.11 — A2A(에이전트 간 협업 규약): 조직 경계를 넘는 위임인가. 한 프로세스 안 서브에이전트에는 과잉이라 위임이 내부에서 일어나는지 보여준다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const internal = (ctx: PluginBubbleContext): number => (ctx.data.taskEdges ?? []).length + (ctx.data.subAgents ?? []).length;

const inspector = defineInspector({
  id: 'a2a', i18nKey: 'a2a', name: 'A2A', category: 'workflow',
  needs: ['taskEdges', 'subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (internal(ctx) === 0 ? { key: 'solo', tone: 'neutral' } : { key: 'internal', tone: 'good' }),
  checks: [
    { key: 'edges', value: (ctx) => String((ctx.data.taskEdges ?? []).length) },
    { key: 'sessions', value: (ctx) => String((ctx.data.subAgents ?? []).length) },
    { key: 'crossOrg', value: (ctx) => ctx.t('panel.plugins.a2a.none') },
  ],
  noteKey: () => '.note',
});

export const a2aManifest = inspector.manifest;
export const a2aClient = inspector.client;

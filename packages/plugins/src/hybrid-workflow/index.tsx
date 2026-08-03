/**
 * §5.11 v4.00 — 혼합 워크플로(Hybrid Workflow): 어디까지 명세, 어디부터 자유인가.
 *
 * 순수 명세는 느리고 순수 즉흥은 무너지므로, **어디에 선을 긋느냐**가 실력이 된다. 실무 기준은 대체로 —
 * 인터페이스·데이터 모델·권한 경계가 바뀌면 명세, 그 안쪽 구현은 자유. 이 카드는 이 에이전트가 그 선의
 * 어느 쪽에 서 있는지 보여준다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { toneIfActive } from '../framework/activity.js';
import type { PluginBubbleContext } from '../types.js';

const spec = (ctx: PluginBubbleContext): boolean => (ctx.agentConfig?.rules ?? '').trim().length > 0;
const planned = (ctx: PluginBubbleContext): boolean => (ctx.data.agentEvents ?? []).some((e) => (e.todos ?? []).length > 0);

const inspector = defineInspector({
  id: 'hybrid-workflow', i18nKey: 'hybridWorkflow', name: 'Hybrid Workflow', category: 'workflow',
  needs: ['agentEvents', 'subAgents'],
  status: (ctx) => {
    if (spec(ctx) && planned(ctx)) return { key: 'balanced', tone: 'good' };
    return spec(ctx) || planned(ctx) ? { key: 'leaning', tone: 'neutral' } : { key: 'free', tone: toneIfActive(ctx) };
  },
  checks: [
    { key: 'spec', value: (ctx) => ctx.t(`panel.plugins.hybridWorkflow.${spec(ctx) ? 'yes' : 'no'}`), tone: (ctx) => (spec(ctx) ? 'good' : 'neutral') },
    { key: 'plan', value: (ctx) => ctx.t(`panel.plugins.hybridWorkflow.${planned(ctx) ? 'yes' : 'no'}`), tone: (ctx) => (planned(ctx) ? 'good' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const hybridWorkflowManifest = inspector.manifest;
export const hybridWorkflowClient = inspector.client;

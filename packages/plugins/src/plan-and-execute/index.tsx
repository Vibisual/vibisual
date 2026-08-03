/**
 * §5.11 v3.93 — 계획 후 실행(Plan-and-Execute): 계획이 파일로 남아 진행되는가.
 *
 * 단계가 많고 순서가 중요한 작업에서 중간에 길을 잃는 것을 막고, 계획을 사람이 승인·수정할 수 있게
 * 만드는 부수 효과가 크다. 컨텍스트가 압축돼도 **계획은 남는다**는 것이 핵심 이점이다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

function lastTodos(ctx: PluginBubbleContext): { done: number; total: number } {
  const list = ctx.data.agentEvents ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const todos = list[i]?.todos;
    if (todos && todos.length > 0) {
      return { done: todos.filter((t) => t.status === 'completed').length, total: todos.length };
    }
  }
  return { done: 0, total: 0 };
}

const inspector = defineInspector({
  id: 'plan-and-execute', i18nKey: 'planAndExecute', name: 'Plan and Execute', category: 'workflow',
  needs: ['agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const { done, total } = lastTodos(ctx);
    if (total === 0) return { key: 'noPlan', tone: 'neutral' };
    if (done === total) return { key: 'done', tone: 'good' };
    return { key: 'running', tone: 'neutral' };
  },
  checks: [
    { key: 'steps', value: (ctx) => (lastTodos(ctx).total > 0 ? String(lastTodos(ctx).total) : '—') },
    {
      key: 'progress',
      value: (ctx) => {
        const { done, total } = lastTodos(ctx);
        return total > 0 ? `${done} / ${total}` : '—';
      },
      tone: (ctx) => (lastTodos(ctx).total > 0 && lastTodos(ctx).done === lastTodos(ctx).total ? 'good' : 'neutral'),
    },
    { key: 'turns', value: (ctx) => String((ctx.data.agentEvents ?? []).length) },
  ],
  noteKey: (ctx) => (lastTodos(ctx).total === 0 ? '.noteNoPlan' : '.note'),
});

export const planAndExecuteManifest = inspector.manifest;
export const planAndExecuteClient = inspector.client;

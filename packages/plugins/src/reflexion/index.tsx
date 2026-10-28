/** §5.11 — 리플렉션(Reflexion): 자기 비평이 실행 가능한 신호에 근거하는가. §5.10(Q) 검토·개정 집계를 읽고, 작업 신고의 "배운 것"(자기 보고)은 성공 신호로 쓰지 않는다. 표시 전용. */
import { defineInspector, readAutoGoal } from '../sdk/index.js';

const inspector = defineInspector({
  id: 'reflexion', i18nKey: 'reflexion', name: 'Reflexion', category: 'workflow',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const goal = readAutoGoal(ctx);
    if (goal.review > 0) return { key: 'pending', tone: 'warn' };
    return goal.active > 0 ? { key: 'reviewed', tone: 'good' } : { key: 'none', tone: 'neutral' };
  },
  checks: [
    { key: 'active', value: (ctx) => String(readAutoGoal(ctx).active) },
    { key: 'review', value: (ctx) => String(readAutoGoal(ctx).review), tone: (ctx) => readAutoGoal(ctx).review > 0 ? 'warn' : 'neutral' },
    { key: 'revisions', value: (ctx) => String(readAutoGoal(ctx).revisions) },
  ],
  noteKey: () => '.note',
});

export const reflexionManifest = inspector.manifest;
export const reflexionClient = inspector.client;

/**
 * §5.11 v3.96 — 리플렉션(Reflexion): 자기 비평이 실행 가능한 신호에 근거하는가.
 *
 * 시도 후 무엇이 잘못됐는지 스스로 비평하고 그 교훈을 다음 시도에 넣는 루프다. 핵심은 비평이
 * **실행 가능한 신호**(테스트 실패 등)에 근거해야 한다는 것 — 근거 없는 자기 반성은 그럴듯한 소음이다.
 * §5.10(Q)의 검토·개정 집계를 읽는다. 작업 신고의 "배운 것"은 자기 보고일 뿐 검토 통과가
 * 아니므로 성공 신호로 쓰지 않는다. 이 카드는 검토를 실행하지 않는 표시 전용이다.
 */
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

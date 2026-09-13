/**
 * §5.11 v3.98 — 검색 증강(RAG): 답의 근거가 어디서 왔는가.
 *
 * 모델이 아는 것에만 기대지 않고 외부 지식을 끌어와 답의 근거로 삼는 방식이다. §5.10 이후
 * Vibisual 에서 그 통로는 **자동 목표의 절차 색인**이다 — 이 자리에서 켜져 있으면 굳어진 절차의
 * 이름·경로가 매 턴 프롬프트에 실리고, 에이전트는 필요할 때 그 파일을 연다.
 *
 * 그래서 여기서 세는 것은 "이 자리에 실제로 실리는 근거 수"다. 꺼진 자리는 0 이다 — 서버가 한 글자도
 * 싣지 않으므로, 카드가 다른 수를 말하면 둘 중 하나가 거짓이 된다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const carried = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).carried;

const inspector = defineInspector({
  id: 'rag', i18nKey: 'rag', name: 'RAG', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (carried(ctx) === 0 ? { key: 'none', tone: 'neutral' } : { key: 'grounded', tone: 'good' }),
  checks: [
    { key: 'cards', value: (ctx) => String(carried(ctx)) },
    { key: 'events', value: (ctx) => String(readAutoGoal(ctx).observed) },
    { key: 'recent', value: (ctx) => readAutoGoal(ctx).recent ?? '—' },
  ],
  noteKey: () => '.note',
});

export const ragManifest = inspector.manifest;
export const ragClient = inspector.client;

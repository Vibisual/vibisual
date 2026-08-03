/**
 * §5.11 v3.97 — 회귀 스위트(Regression Suite): 한 번 고친 것이 되돌아오지 않게 막고 있는가.
 *
 * 에이전트가 코드를 고치면 예전에 고쳤던 것을 되돌리는 일이 잦다 — 왜 그렇게 됐는지의 맥락이 컨텍스트에
 * 없기 때문이다. **회귀 테스트가 기억을 대신한다.** 문서는 안 읽힐 수 있지만 실패하는 테스트는 무시할 수 없다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { toneIfActive } from '../framework/activity.js';
import type { PluginBubbleContext } from '../types.js';

const lessons = (ctx: PluginBubbleContext): number =>
  (ctx.data.agentReports ?? []).reduce((n, r) => n + (r.learned ?? []).length, 0);
const checkpoints = (ctx: PluginBubbleContext): number =>
  (ctx.data.agentReviews ?? []).reduce((n, r) => n + (r.checkpoints ?? []).length, 0);

const inspector = defineInspector({
  id: 'regression-suite', i18nKey: 'regressionSuite', name: 'Regression Suite', category: 'workflow',
  needs: ['agentReports', 'agentReviews', 'agentEvents', 'subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (lessons(ctx) === 0 && checkpoints(ctx) === 0) return { key: 'none', tone: toneIfActive(ctx) };
    return { key: 'accruing', tone: 'good' };
  },
  checks: [
    { key: 'lessons', value: (ctx) => String(lessons(ctx)) },
    { key: 'checkpoints', value: (ctx) => String(checkpoints(ctx)) },
  ],
  noteKey: () => '.note',
});

export const regressionSuiteManifest = inspector.manifest;
export const regressionSuiteClient = inspector.client;

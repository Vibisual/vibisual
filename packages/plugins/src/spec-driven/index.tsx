/**
 * §5.11 v3.99 — 명세 주도 개발(SDD): 버전 관리되는 명세가 진실 공급원인가.
 *
 * 흐름이 명세 → 설계 → 작업 계획 → 구현 → 검증으로, 프롬프트 → 코드 → 땜질과 정반대다. 명세가 모호함을
 * 없애면 에이전트는 결정권자가 아니라 **고속 타이피스트**로 일하게 되고, 그때 비로소 산출량이 안전하게 커진다.
 * TDD 와 겹치지 않는다 — TDD 는 동작을, SDD 는 요구사항과 제약을 먼저 고정한다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { toneIfActive } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

function signals(ctx: PluginBubbleContext): number {
  return [
    (ctx.agentConfig?.rules ?? '').trim().length > 0,
    (ctx.data.agentEvents ?? []).some((e) => (e.todos ?? []).length > 0),
    (ctx.data.agentReviews ?? []).some((r) => (r.checkpoints ?? []).length > 0),
  ].filter(Boolean).length;
}

const inspector = defineInspector({
  id: 'spec-driven', i18nKey: 'specDriven', name: 'Spec-Driven Development', category: 'workflow',
  needs: ['agentEvents', 'agentReviews', 'subAgents'],
  status: (ctx) => (signals(ctx) >= 3 ? { key: 'spec', tone: 'good' } : signals(ctx) >= 1 ? { key: 'partial', tone: 'neutral' } : { key: 'prompt', tone: toneIfActive(ctx) }),
  checks: [
    { key: 'signals', value: (ctx) => `${signals(ctx)} / 3` },
    { key: 'rules', value: (ctx) => ((ctx.agentConfig?.rules ?? '').trim().length > 0 ? ctx.t('panel.plugins.specDriven.yes') : ctx.t('panel.plugins.specDriven.no')) },
    { key: 'plan', value: (ctx) => ((ctx.data.agentEvents ?? []).some((e) => (e.todos ?? []).length > 0) ? ctx.t('panel.plugins.specDriven.yes') : ctx.t('panel.plugins.specDriven.no')) },
  ],
  noteKey: () => '.note',
});

export const specDrivenManifest = inspector.manifest;
export const specDrivenClient = inspector.client;

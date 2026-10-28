/** §5.11 — 컨텍스트 엔지니어링(Context Engineering): 매 추론에 무엇이 실리는가 — 이 에이전트에 실제로 적용된 패턴 수를 센다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools, readAutoGoal } from '../sdk/index.js';
import { AVAILABLE_AGENT_TOOLS } from '@vibisual/shared';
import type { PluginBubbleContext } from '../sdk/index.js';

/**
 * 네 축 — 절차 색인 · 도구 관리 · 되짚을 원본 · 사고 조절. 서로 겹치지 않게 골랐다 —
 * 한 사실을 두 점으로 세면(예: "색인이 실린다"와 "실리는 것이 있다") 점수가 부풀어 4 가 뜻을 잃는다.
 */
function applied(ctx: PluginBubbleContext): number {
  const goal = readAutoGoal(ctx);
  return [
    goal.activeHere,
    effectiveTools(ctx.agentConfig).size < AVAILABLE_AGENT_TOOLS.length,
    goal.anchored > 0,
    (ctx.agentConfig?.effort ?? 'default') !== 'default',
  ].filter(Boolean).length;
}

const inspector = defineInspector({
  id: 'context-engineering', i18nKey: 'contextEngineering', name: 'Context Engineering', category: 'observability',
  needs: ['autoGoal'],
  status: (ctx) => (applied(ctx) >= 3 ? { key: 'designed', tone: 'good' } : applied(ctx) >= 1 ? { key: 'partial', tone: 'neutral' } : { key: 'default', tone: 'warn' }),
  checks: [
    { key: 'applied', value: (ctx) => `${applied(ctx)} / 4` },
    { key: 'tools', value: (ctx) => `${effectiveTools(ctx.agentConfig).size} / ${AVAILABLE_AGENT_TOOLS.length}` },
    { key: 'memory', value: (ctx) => String(readAutoGoal(ctx).carried) },
  ],
  noteKey: () => '.note',
});

export const contextEngineeringManifest = inspector.manifest;
export const contextEngineeringClient = inspector.client;

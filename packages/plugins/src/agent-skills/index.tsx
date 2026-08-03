/**
 * §5.11 v3.96 — 에이전트 스킬(Agent Skills): 절차 지식을 프롬프트가 아니라 파일로 주는가.
 *
 * 점진적 공개의 교과서적 구현이라 중요하다 — 세션 시작 시엔 이름·설명만 읽고, 관련 있다고 판단될 때만
 * 본문을 로드하며, 스크립트는 실행 시점에만 읽는다. 그래서 스킬 수십 개를 붙여도 **상시 비용은 거의 늘지 않는다**. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

/** 스킬 하나의 상시 비용은 이름·설명 수준(중앙값 80 토큰 안팎)으로 잡는다. */
const IDLE_COST_PER_SKILL = 80;
const skills = (ctx: PluginBubbleContext): string[] => ctx.agentConfig?.skills ?? [];

const inspector = defineInspector({
  id: 'agent-skills', i18nKey: 'agentSkills', name: 'Agent Skills', category: 'observability',
  status: (ctx) => (skills(ctx).length === 0 ? { key: 'none', tone: 'neutral' } : { key: 'loaded', tone: 'good' }),
  checks: [
    { key: 'count', value: (ctx) => String(skills(ctx).length), hint: (ctx) => skills(ctx).join(' · ') || undefined },
    { key: 'idleCost', value: (ctx) => (skills(ctx).length > 0 ? `~${skills(ctx).length * IDLE_COST_PER_SKILL}` : '—') },
  ],
  noteKey: () => '.note',
});

export const agentSkillsManifest = inspector.manifest;
export const agentSkillsClient = inspector.client;

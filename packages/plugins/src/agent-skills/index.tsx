/** §5.11 — 에이전트 스킬(Agent Skills): 절차 지식을 프롬프트가 아니라 파일로 주는가(본문은 필요할 때만 로드돼 상시 비용이 거의 안 는다). 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

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

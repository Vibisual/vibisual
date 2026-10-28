/** §5.11 — 절차 기억(Procedural Memory): "어떻게 하는가"가 파일(스킬 정의·에이전트 규칙)로 있는가 — 절차는 검색이 아니라 통째로 필요한 층. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const skills = (ctx: PluginBubbleContext): string[] => ctx.agentConfig?.skills ?? [];
const hasRules = (ctx: PluginBubbleContext): boolean => (ctx.agentConfig?.rules ?? '').trim().length > 0;

const inspector = defineInspector({
  id: 'procedural-memory', i18nKey: 'proceduralMemory', name: 'Procedural Memory', category: 'workflow',
  status: (ctx) => {
    if (skills(ctx).length === 0 && !hasRules(ctx)) return { key: 'none', tone: 'neutral' };
    return { key: 'filed', tone: 'good' };
  },
  checks: [
    { key: 'skills', value: (ctx) => String(skills(ctx).length), hint: (ctx) => skills(ctx).join(' · ') || undefined },
    {
      key: 'rules',
      value: (ctx) => ctx.t(`panel.plugins.proceduralMemory.${hasRules(ctx) ? 'yes' : 'no'}`),
      tone: (ctx) => (hasRules(ctx) ? 'good' : 'neutral'),
    },
  ],
  noteKey: () => '.note',
});

export const proceduralMemoryManifest = inspector.manifest;
export const proceduralMemoryClient = inspector.client;

/** §5.11 — 관심사 분리(Separation of Concerns): 이 에이전트가 건드리는 폭(부수 효과 반경이 곧 사고 규모). 표시 전용. */
import { AVAILABLE_AGENT_TOOLS } from '@vibisual/shared';
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const breadth = (ctx: PluginBubbleContext): number => effectiveTools(ctx.agentConfig).size / AVAILABLE_AGENT_TOOLS.length;
const sessions = (ctx: PluginBubbleContext): number => (ctx.data.subAgents ?? []).length;

const inspector = defineInspector({
  id: 'separation-of-concerns', i18nKey: 'separationOfConcerns', name: 'Separation of Concerns', category: 'workflow',
  needs: ['subAgents'],
  status: (ctx) => {
    if (breadth(ctx) >= 0.9 && sessions(ctx) <= 1) return { key: 'broad', tone: 'warn' };
    return breadth(ctx) <= 0.5 ? { key: 'focused', tone: 'good' } : { key: 'mixed', tone: 'neutral' };
  },
  checks: [
    { key: 'breadth', value: (ctx) => `${Math.round(breadth(ctx) * 100)}%`, tone: (ctx) => (breadth(ctx) >= 0.9 ? 'warn' : 'neutral') },
    { key: 'sessions', value: (ctx) => String(sessions(ctx)) },
  ],
  noteKey: () => '.note',
});

export const separationOfConcernsManifest = inspector.manifest;
export const separationOfConcernsClient = inspector.client;

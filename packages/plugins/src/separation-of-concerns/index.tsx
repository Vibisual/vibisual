/**
 * §5.11 v3.98 — 관심사 분리(Separation of Concerns): 이 에이전트가 건드리는 폭.
 *
 * 에이전트가 한 곳을 고칠 때 **부수 효과 반경**이 곧 사고 규모다. 분리돼 있으면 잘못 고쳐도 그 안에서 끝난다.
 * 멀티 에이전트에서는 "한 기능을 맡은 에이전트가 그 테스트도 맡는다"가 같은 원칙의 에이전트판이다. 표시 전용.
 */
import { AVAILABLE_AGENT_TOOLS } from '@vibisual/shared';
import { defineInspector } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';
import type { PluginBubbleContext } from '../types.js';

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

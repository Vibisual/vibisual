/** §5.11 — 일화 기억(Episodic Memory): 원 경험이 남았는가 — 추출된 지식에는 출처 세션과 시각이 붙어 원본으로 돌아갈 수 있어야 한다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const sessions = (ctx: PluginBubbleContext): number => (ctx.data.subAgents ?? []).filter((s) => s.sessionId).length;
const turns = (ctx: PluginBubbleContext): number => (ctx.data.agentEvents ?? []).length;

const inspector = defineInspector({
  id: 'episodic-memory', i18nKey: 'episodicMemory', name: 'Episodic Memory', category: 'observability',
  needs: ['subAgents', 'agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (sessions(ctx) === 0 && turns(ctx) === 0) return { key: 'empty', tone: 'neutral' };
    return sessions(ctx) > 0 ? { key: 'kept', tone: 'good' } : { key: 'partial', tone: 'warn' };
  },
  checks: [
    { key: 'sessions', value: (ctx) => String(sessions(ctx)), tone: (ctx) => (sessions(ctx) > 0 ? 'good' : 'warn') },
    { key: 'turns', value: (ctx) => String(turns(ctx)) },
  ],
  noteKey: () => '.note',
});

export const episodicMemoryManifest = inspector.manifest;
export const episodicMemoryClient = inspector.client;

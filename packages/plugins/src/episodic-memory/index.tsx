/**
 * §5.11 v3.95 — 일화 기억(Episodic Memory): 원 경험이 남아 있는가.
 *
 * 요약본만 남기면 나중에 "정말 그랬나"를 검증할 근거가 사라지고 요약의 오류를 되돌릴 방법도 없어진다.
 * 원 경험이 1급 증거이므로, 추출된 지식에는 **출처 세션과 시각**이 붙어 원본으로 되돌아갈 수 있어야 한다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

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

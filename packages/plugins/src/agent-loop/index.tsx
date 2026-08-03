/**
 * §5.11 v3.96 — 에이전트 루프(Agent Loop): 한 회차가 얼마나 걸리는가.
 *
 * 맥락 수집 → 행동 → 결과 검증을 목표 달성까지 반복하는 제어 구조다. 루프가 있으면 스스로 멈추지 않는
 * 문제가 생기므로 종료 조건·반복 상한·중지 수단이 편의 기능이 아니라 안전장치가 된다. 여기서는
 * **회차의 리듬**(턴 수와 평균 간격)과 상한 유무를 본다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { formatElapsed } from '../ui/kit.js';
import type { PluginBubbleContext } from '../types.js';

function span(ctx: PluginBubbleContext): { turns: number; avgMs: number } {
  const list = ctx.data.agentEvents ?? [];
  if (list.length < 2) return { turns: list.length, avgMs: 0 };
  const first = list[0]?.timestamp ?? 0;
  const last = list[list.length - 1]?.timestamp ?? 0;
  return { turns: list.length, avgMs: Math.max(0, (last - first) / (list.length - 1)) };
}

const inspector = defineInspector({
  id: 'agent-loop', i18nKey: 'agentLoop', name: 'Agent Loop', category: 'observability',
  needs: ['agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const capped = (ctx.agentConfig?.maxTurns ?? 0) > 0;
    if (span(ctx).turns === 0) return { key: 'idle', tone: 'neutral' };
    return capped ? { key: 'capped', tone: 'good' } : { key: 'uncapped', tone: 'warn' };
  },
  checks: [
    { key: 'turns', value: (ctx) => String(span(ctx).turns) },
    { key: 'avg', value: (ctx) => (span(ctx).avgMs > 0 ? formatElapsed(span(ctx).avgMs) : '—') },
    {
      key: 'cap',
      value: (ctx) => ((ctx.agentConfig?.maxTurns ?? 0) > 0 ? String(ctx.agentConfig?.maxTurns) : ctx.t('panel.plugins.agentLoop.none')),
      tone: (ctx) => ((ctx.agentConfig?.maxTurns ?? 0) > 0 ? 'good' : 'warn'),
    },
  ],
  noteKey: (ctx) => ((ctx.agentConfig?.maxTurns ?? 0) > 0 ? '.note' : '.noteUncapped'),
});

export const agentLoopManifest = inspector.manifest;
export const agentLoopClient = inspector.client;

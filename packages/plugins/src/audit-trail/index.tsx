/**
 * §5.11 v3.93 — 감사 추적(Audit Trail): "이건 누가 했나"에 사후에 답할 수 있는가.
 *
 * 에이전트가 행위 주체가 되면 그 질문은 조직적 질문이 된다. 최소 구성은 세 가지 —
 * 원본 실행 로그 보존 · 결정에 출처 세션 ID · 커밋에 공동 작성자 표기. 여기서는 앞의 둘,
 * 즉 **이 에이전트의 흔적이 지금 얼마나 남아 있는지**를 센다. 표시 전용.
 */
import { defineInspector, ICONS } from '../sdk/index.js';
import { formatElapsed } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

function turns(ctx: PluginBubbleContext): number {
  return (ctx.data.agentEvents ?? []).length;
}

function sessions(ctx: PluginBubbleContext): string[] {
  return (ctx.data.subAgents ?? []).map((s) => s.sessionId).filter(Boolean);
}

function lastAt(ctx: PluginBubbleContext): number {
  return (ctx.data.subAgents ?? []).reduce((max, s) => Math.max(max, s.lastActivityAt ?? 0), 0);
}

const inspector = defineInspector({
  id: 'audit-trail',
  i18nKey: 'auditTrail',
  name: 'Audit Trail',
  category: 'observability',
  needs: ['agentEvents', 'subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (turns(ctx) === 0 && sessions(ctx).length === 0) return { key: 'empty', tone: 'neutral' };
    if (sessions(ctx).length === 0) return { key: 'partial', tone: 'warn' };
    return { key: 'traceable', tone: 'good' };
  },
  checks: [
    { key: 'turns', value: (ctx) => String(turns(ctx)) },
    {
      key: 'sessions',
      value: (ctx) => String(sessions(ctx).length),
      tone: (ctx) => (sessions(ctx).length > 0 ? 'good' : 'warn'),
      hint: (ctx) => sessions(ctx)[0],
    },
    {
      key: 'last',
      value: (ctx) => (lastAt(ctx) > 0 ? formatElapsed(Math.max(0, ctx.now - lastAt(ctx))) : '—'),
    },
  ],
  noteKey: () => '.note',
  badge: {
    // 갓 만든 에이전트는 아직 한 일이 없으니 남길 기록도 없다 — 그때 다는 배지는 경고가 아니라 소음이다.
    // 진짜 문제는 **움직였는데 귀속할 세션이 없는** 상태다.
    match: (ctx) => turns(ctx) > 0 && sessions(ctx).length === 0,
    text: () => '',
    icon: ICONS.log,
  },
});

export const auditTrailManifest = inspector.manifest;
export const auditTrailClient = inspector.client;

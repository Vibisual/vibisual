/**
 * §5.11 v4.02 — 에이전트 레지스트리(Agent Registry): 등록·승격·폐기의 생애주기.
 *
 * 판정 기준은 하나의 질문으로 요약된다 — **"누가 이 에이전트를 만들었고, 무슨 권한을 갖고, 마지막으로
 * 언제 움직였는가"에 답할 수 있는가.** 답할 수 없다면 그 조직에는 아직 레지스트리가 없는 것이고,
 * 등록되지 않은 채 도는 것이 곧 통제 이탈 에이전트다.
 *
 * Vibisual 에서는 우리가 만든 커스텀 에이전트만 우리 대장에 오른다. 훅으로 등록된 외부 세션은
 * Claude Code 본체 소유라 우리가 생애주기를 쥐고 있지 않으며, 그 사실을 감추지 않고 그대로 표시한다.
 */
import { defineInspector } from '../framework/inspector.js';
import { formatElapsed } from '../ui/kit.js';
import type { PluginBubbleContext } from '../types.js';

const K = 'panel.plugins.agentRegistry';

const sessions = (ctx: PluginBubbleContext): number => (ctx.data.subAgents ?? []).length;

const lastAt = (ctx: PluginBubbleContext): number =>
  (ctx.data.subAgents ?? []).reduce((max, s) => Math.max(max, s.lastActivityAt ?? 0), 0);

/** 레지스트리가 답해야 하는 세 질문 — 소유 · 권한 · 마지막 활동. */
function answered(ctx: PluginBubbleContext): number {
  return [ctx.customCreated, Boolean(ctx.agentConfig?.permissionMode), lastAt(ctx) > 0].filter(Boolean).length;
}

const inspector = defineInspector({
  id: 'agent-registry',
  i18nKey: 'agentRegistry',
  name: 'Agent Registry',
  category: 'security',
  needs: ['subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (!ctx.customCreated) return { key: 'unregistered', tone: 'warn' };
    return answered(ctx) === 3 ? { key: 'registered', tone: 'good' } : { key: 'partial', tone: 'neutral' };
  },
  checks: [
    {
      key: 'owner',
      value: (ctx) => ctx.t(`${K}.${ctx.customCreated ? 'ours' : 'external'}`),
      tone: (ctx) => (ctx.customCreated ? 'good' : 'warn'),
    },
    { key: 'authority', value: (ctx) => ctx.agentConfig?.permissionMode ?? '—' },
    {
      key: 'lastSeen',
      value: (ctx) => (lastAt(ctx) > 0 ? formatElapsed(Math.max(0, ctx.now - lastAt(ctx))) : '—'),
    },
    { key: 'sessions', value: (ctx) => String(sessions(ctx)) },
  ],
  noteKey: (ctx) => (ctx.customCreated ? '.note' : '.noteExternal'),
});

export const agentRegistryManifest = inspector.manifest;
export const agentRegistryClient = inspector.client;

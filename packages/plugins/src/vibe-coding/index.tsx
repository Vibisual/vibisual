/** §5.11 — 바이브 코딩(Vibe Coding): 이 코드는 얼마나 오래 살아야 하는가(하루면 바이브, 3년이면 명세). 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { toneIfActive } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

/** 감독 장치가 붙어 있을수록 "읽지 않고 받아들이는" 상태에서 멀어진다. */
function supervision(ctx: PluginBubbleContext): number {
  return [
    ctx.agentConfig?.permissionMode !== 'bypassPermissions',
    (ctx.agentConfig?.rules ?? '').trim().length > 0,
    (ctx.data.agentReviews ?? []).length > 0,
    (ctx.agentConfig?.maxTurns ?? 0) > 0,
  ].filter(Boolean).length;
}

const inspector = defineInspector({
  id: 'vibe-coding', i18nKey: 'vibeCoding', name: 'Vibe Coding', category: 'workflow',
  needs: ['agentReviews', 'agentEvents', 'subAgents'],
  status: (ctx) => {
    const s = supervision(ctx);
    if (s >= 3) return { key: 'supervised', tone: 'good' };
    if (s >= 2) return { key: 'mixed', tone: 'neutral' };
    return { key: 'vibe', tone: toneIfActive(ctx) };
  },
  checks: [
    { key: 'supervision', value: (ctx) => `${supervision(ctx)} / 4` },
    { key: 'reviews', value: (ctx) => String((ctx.data.agentReviews ?? []).length) },
    { key: 'rules', value: (ctx) => ((ctx.agentConfig?.rules ?? '').trim().length > 0 ? String((ctx.agentConfig?.rules ?? '').length) : '—') },
  ],
  noteKey: () => '.note',
});

export const vibeCodingManifest = inspector.manifest;
export const vibeCodingClient = inspector.client;

/** §5.11 — 우아한 성능 저하(Graceful Degradation): 판정 실패 시 열리나 닫히나 — 여기서는 승인 팝업 무응답 정책(자동 허용 = fail-open, 자동 차단 = fail-safe). 표시 전용. */
import { defineInspector, ICONS } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const failOpen = (ctx: PluginBubbleContext): boolean => (ctx.agentConfig?.permissionTimeoutPolicy ?? 'allow') === 'allow';
const gated = (ctx: PluginBubbleContext): boolean =>
  ctx.agentConfig?.permissionMode !== 'bypassPermissions' && ctx.agentConfig?.permissionMode !== 'plan';

const inspector = defineInspector({
  id: 'graceful-degradation', i18nKey: 'gracefulDegradation', name: 'Graceful Degradation', category: 'security',
  status: (ctx) => {
    if (!gated(ctx)) return { key: 'noGate', tone: 'neutral' };
    return failOpen(ctx) ? { key: 'failOpen', tone: 'warn' } : { key: 'failSafe', tone: 'good' };
  },
  checks: [
    {
      key: 'policy',
      value: (ctx) => ctx.t(`panel.plugins.gracefulDegradation.${failOpen(ctx) ? 'open' : 'safe'}`),
      tone: (ctx) => (failOpen(ctx) ? 'warn' : 'good'),
    },
    { key: 'mode', value: (ctx) => ctx.agentConfig?.permissionMode ?? '—' },
  ],
  noteKey: (ctx) => (gated(ctx) && failOpen(ctx) ? '.noteOpen' : '.note'),
  badge: { match: (ctx) => gated(ctx) && failOpen(ctx), text: () => '', icon: ICONS.shield },
});

export const gracefulDegradationManifest = inspector.manifest;
export const gracefulDegradationClient = inspector.client;

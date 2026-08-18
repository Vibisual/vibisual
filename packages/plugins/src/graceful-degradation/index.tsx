/**
 * §5.11 v3.98 — 우아한 성능 저하(Graceful Degradation): 판정에 실패하면 열리는가, 닫히는가.
 *
 * 가드레일은 fail-safe 여야 한다 — 판정 실패 시 통과가 아니라 차단이다. Vibisual 에서 그 갈림길은
 * **승인 팝업에 응답이 없을 때의 정책**이다. 자동 허용은 자리를 비운 사이 열리는 쪽(fail-open),
 * 자동 차단은 안전 쪽(fail-safe)이다. 표시 전용.
 */
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

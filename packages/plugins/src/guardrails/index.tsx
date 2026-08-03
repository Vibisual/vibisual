/**
 * §5.11 v3.93 — 가드레일(Guardrails): 도구 호출이 실제로 가로막히는 지점이 있는가.
 *
 * 가드레일의 목적은 완벽한 차단이 아니라 **비용 부과와 관측**이고, 배치 위치가 설계의 핵심이다 —
 * 모델 앞이 아니라 **도구 호출 직전**에 있어야 실제 피해 직전에 잡는다. Vibisual 의 승인 팝업이
 * 정확히 그 자리에 있으므로, 여기서는 그 관문이 지금 켜져 있는지를 보여준다. 표시 전용.
 */
import { defineInspector, ICONS } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';

const K = 'panel.plugins.guardrails';

const inspector = defineInspector({
  id: 'guardrails',
  i18nKey: 'guardrails',
  name: 'Guardrails',
  category: 'security',
  status: (ctx) => {
    const mode = ctx.agentConfig?.permissionMode;
    if (mode === 'plan') return { key: 'blocked', tone: 'good' };
    if (mode === 'bypassPermissions') return { key: 'none', tone: 'bad' };
    return { key: 'gated', tone: 'warn' };
  },
  checks: [
    { key: 'mode', value: (ctx) => ctx.agentConfig?.permissionMode ?? '—' },
    {
      key: 'denied',
      value: (ctx) => String((ctx.agentConfig?.disallowedTools ?? []).length),
      tone: (ctx) => ((ctx.agentConfig?.disallowedTools ?? []).length > 0 ? 'good' : 'neutral'),
      hint: (ctx) => (ctx.agentConfig?.disallowedTools ?? []).join(' · ') || undefined,
    },
    {
      key: 'timeout',
      value: (ctx) => ctx.t(`${K}.timeout.${ctx.agentConfig?.permissionTimeoutPolicy ?? 'allow'}`),
      tone: (ctx) => ((ctx.agentConfig?.permissionTimeoutPolicy ?? 'allow') === 'deny' ? 'good' : 'warn'),
    },
    { key: 'tools', value: (ctx) => String(effectiveTools(ctx.agentConfig).size) },
  ],
  noteKey: (ctx) => (ctx.agentConfig?.permissionMode === 'bypassPermissions' ? '.noteNone' : '.notePlacement'),
  badge: {
    match: (ctx) => ctx.agentConfig?.permissionMode === 'bypassPermissions',
    text: () => '',
    icon: ICONS.shield,
  },
});

export const guardrailsManifest = inspector.manifest;
export const guardrailsClient = inspector.client;

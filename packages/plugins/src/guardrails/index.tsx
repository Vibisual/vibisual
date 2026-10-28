/** §5.11 — 가드레일(Guardrails): 모델 앞이 아니라 도구 호출 직전의 관문(승인 팝업)이 지금 켜져 있는지 보여준다. 표시 전용. */
import { defineInspector, ICONS } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';

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

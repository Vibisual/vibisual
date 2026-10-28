/** §5.11 — ACP · ANP: 규약은 연결만 표준화하고 권한·감사는 대신해 주지 않는다 — 이 에이전트의 그 두 축이 채워졌는지 본다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const governed = (ctx: PluginBubbleContext): number =>
  [
    ctx.agentConfig?.permissionMode !== 'bypassPermissions',
    (ctx.data.agentReviews ?? []).length > 0,
  ].filter(Boolean).length;

const inspector = defineInspector({
  id: 'acp-anp', i18nKey: 'acpAnp', name: 'ACP and ANP', category: 'security',
  needs: ['agentReviews'],
  status: (ctx) => (governed(ctx) === 2 ? { key: 'governed', tone: 'good' } : governed(ctx) === 1 ? { key: 'partial', tone: 'neutral' } : { key: 'none', tone: 'warn' }),
  checks: [
    { key: 'authority', value: (ctx) => ctx.agentConfig?.permissionMode ?? '—' },
    { key: 'audit', value: (ctx) => String((ctx.data.agentReviews ?? []).length) },
  ],
  noteKey: () => '.note',
});

export const acpAnpManifest = inspector.manifest;
export const acpAnpClient = inspector.client;

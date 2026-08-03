/**
 * §5.11 v4.00 — ACP · ANP: 규약이 권한과 감사를 대신해 주지 않는다.
 *
 * 상호운용 규약들의 공통 한계는 **거버넌스 표현력 부족**이다. "누가 무엇을 할 수 있다"는 연결은 표준화했지만
 * "누가 무엇을 **해도 되는가**"(권한·책임·감사)는 표현하지 못한다. 그래서 규약을 채택해도 권한과 감사는
 * 따로 설계해야 한다. 이 카드는 이 에이전트의 그 두 축이 채워졌는지 본다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

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

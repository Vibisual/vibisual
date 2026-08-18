/**
 * §5.11 v4.01 — 데이터 유출(Data Exfiltration) 카드.
 *
 * 내용을 검사하지는 않는다 — 무엇이 나갔는지가 아니라 **나갈 수 있는 통로가 실제로 쓰였는지**를 보여준다.
 * 외부로 나간 것은 지워도 캐시·색인에 남아 되돌릴 수 없으므로, 사후에라도 통로가 눈에 보여야 한다. 표시 전용.
 */
import { defineInspector, ICONS } from '../sdk/index.js';
import { findEgress } from './dataExfiltration.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const hits = (ctx: PluginBubbleContext) => findEgress(ctx.data.bashCommands);
const kinds = (ctx: PluginBubbleContext): string[] => [...new Set(hits(ctx).map((h) => h.kind))];

const inspector = defineInspector({
  id: 'data-exfiltration',
  i18nKey: 'dataExfiltration',
  name: 'Data Exfiltration',
  category: 'security',
  // `bashCommands` 축이 세션↔명령 이음을 이미 안에서 처리한다 — 여기서 `subAgents` 를 또 선언하면
  // 카드가 읽지도 않는 구독이 버블마다 하나씩 더 생긴다.
  needs: ['bashCommands'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if ((ctx.data.bashCommands ?? []).length === 0) return { key: 'noCommands', tone: 'neutral' };
    return hits(ctx).length === 0 ? { key: 'none', tone: 'good' } : { key: 'used', tone: 'warn' };
  },
  checks: [
    { key: 'commands', value: (ctx) => String((ctx.data.bashCommands ?? []).length) },
    {
      key: 'egress',
      value: (ctx) => String(hits(ctx).length),
      tone: (ctx) => (hits(ctx).length > 0 ? 'warn' : 'good'),
      hint: (ctx) => kinds(ctx).map((k) => ctx.t(`panel.plugins.dataExfiltration.kind.${k}`)).join(' · ') || undefined,
    },
    { key: 'last', value: (ctx) => hits(ctx)[hits(ctx).length - 1]?.command ?? '—' },
  ],
  noteKey: (ctx) => (hits(ctx).length > 0 ? '.noteUsed' : '.note'),
  badge: {
    match: (ctx) => hits(ctx).length > 0,
    text: (ctx) => String(hits(ctx).length),
    icon: ICONS.route,
  },
});

export const dataExfiltrationManifest = inspector.manifest;
export const dataExfiltrationClient = inspector.client;

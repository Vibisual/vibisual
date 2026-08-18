/**
 * §5.11 v4.01 — 도구 오·남용(Tool Misuse) 카드.
 *
 * 실행된 명령에서 되돌릴 수 없는 형태를 찾아 보여준다. 탐지가 아니라 **표시**이며, 이미 실행된 것을
 * 보여줄 뿐 막지 않는다 — 막는 자리는 도구 호출 직전의 승인 팝업이다. 표시 전용.
 */
import { defineInspector, ICONS } from '../sdk/index.js';
import { findMisuse } from './toolMisuse.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const hits = (ctx: PluginBubbleContext) => findMisuse(ctx.data.bashCommands);
const kinds = (ctx: PluginBubbleContext): string[] => [...new Set(hits(ctx).map((h) => h.kind))];

const inspector = defineInspector({
  id: 'tool-misuse',
  i18nKey: 'toolMisuse',
  name: 'Tool Misuse',
  category: 'security',
  // `bashCommands` 축이 세션↔명령 이음을 이미 안에서 처리한다 — 여기서 `subAgents` 를 또 선언하면
  // 카드가 읽지도 않는 구독이 버블마다 하나씩 더 생긴다.
  needs: ['bashCommands'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if ((ctx.data.bashCommands ?? []).length === 0) return { key: 'noCommands', tone: 'neutral' };
    return hits(ctx).length === 0 ? { key: 'clean', tone: 'good' } : { key: 'found', tone: 'bad' };
  },
  checks: [
    { key: 'commands', value: (ctx) => String((ctx.data.bashCommands ?? []).length) },
    {
      key: 'hits',
      value: (ctx) => String(hits(ctx).length),
      tone: (ctx) => (hits(ctx).length > 0 ? 'bad' : 'good'),
      hint: (ctx) => kinds(ctx).map((k) => ctx.t(`panel.plugins.toolMisuse.kind.${k}`)).join(' · ') || undefined,
    },
    { key: 'last', value: (ctx) => hits(ctx)[hits(ctx).length - 1]?.command ?? '—' },
  ],
  noteKey: (ctx) => (hits(ctx).length > 0 ? '.noteFound' : '.note'),
  badge: {
    match: (ctx) => hits(ctx).length > 0,
    text: (ctx) => String(hits(ctx).length),
    icon: ICONS.shield,
  },
});

export const toolMisuseManifest = inspector.manifest;
export const toolMisuseClient = inspector.client;

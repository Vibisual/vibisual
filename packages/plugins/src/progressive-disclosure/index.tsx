/**
 * §5.11 v3.95 — 점진적 공개(Progressive Disclosure): 다 밀어넣는가, 목차를 주는가.
 *
 * 전부 미리 넣지 않고 필요해지는 순간 가져오게 하는 방식이 컨텍스트 부패를 막으면서 지식 총량은 줄이지 않는
 * 가장 실효적인 절충이다. 문서를 통째로 붙여넣는 대신 **"어떤 작업이면 어느 파일을 읽어라" 색인**을 주는 것이
 * 같은 문법이다. 여기서는 주입이 반복 재주입으로 쌓이는지를 본다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

const events = (ctx: PluginBubbleContext) => ctx.data.brainInjections ?? [];
const repeats = (ctx: PluginBubbleContext): number =>
  events(ctx).reduce((n, e) => n + Math.max(0, ((e as { repeatCount?: number }).repeatCount ?? 1) - 1), 0);

const inspector = defineInspector({
  id: 'progressive-disclosure', i18nKey: 'progressiveDisclosure', name: 'Progressive Disclosure', category: 'observability',
  needs: ['brainInjections'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (events(ctx).length === 0) return { key: 'none', tone: 'neutral' };
    return repeats(ctx) > events(ctx).length ? { key: 'repeating', tone: 'warn' } : { key: 'lean', tone: 'good' };
  },
  checks: [
    { key: 'events', value: (ctx) => String(events(ctx).length) },
    { key: 'repeats', value: (ctx) => String(repeats(ctx)), tone: (ctx) => (repeats(ctx) > events(ctx).length ? 'warn' : 'neutral') },
    { key: 'cards', value: (ctx) => String(events(ctx).reduce((n, e) => n + e.cardIds.length, 0)) },
  ],
  noteKey: () => '.note',
});

export const progressiveDisclosureManifest = inspector.manifest;
export const progressiveDisclosureClient = inspector.client;

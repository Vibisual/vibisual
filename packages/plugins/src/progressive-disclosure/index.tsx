/**
 * §5.11 v3.95 — 점진적 공개(Progressive Disclosure): 다 밀어넣는가, 목차를 주는가.
 *
 * 전부 미리 넣지 않고 필요해지는 순간 가져오게 하는 방식이 컨텍스트 부패를 막으면서 지식 총량은 줄이지 않는
 * 가장 실효적인 절충이다. 문서를 통째로 붙여넣는 대신 **"어떤 작업이면 어느 파일을 읽어라" 색인**을 주는 것이
 * 같은 문법이다. 여기서는 주입이 반복 재주입으로 쌓이는지를 본다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const events = (ctx: PluginBubbleContext) => ctx.data.brainInjections ?? [];
/**
 * 같은 묶음이 **다시** 실린 횟수의 합(최초 1 회는 빼고 센다 — 재주입만이 이 카드가 보는 낭비다).
 *
 * ⚠ `repeatCount` 를 캐스트로 읽고 있었다. 호스트 타입에 이미 있는 필드라 캐스트는 필요 없었고, 그 한 줄이
 * **타입 검사를 통째로 우회**하고 있었다 — 호스트가 필드 이름을 바꾸는 날 컴파일은 그대로 통과하고 이 카드만
 * 조용히 `1` 만 세다 죽는다(늘 `lean` 을 내는 카드가 된다). 캐스트를 걷어 호스트 타입에 다시 묶는다.
 */
const repeats = (ctx: PluginBubbleContext): number =>
  events(ctx).reduce((n, e) => n + Math.max(0, (e.repeatCount ?? 1) - 1), 0);

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

/**
 * §5.11 — 점진적 공개(Progressive Disclosure): 다 밀어넣는가, 목차를 주는가(§5.10 절차 주입이 그 색인 형태).
 * 훑은 행동 대비 순 재발을 본다 — 재발이 저장고보다 많으면 같은 일을 다시 하고 있다는 뜻. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const observed = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).observed;
const repeats = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).repeats;

const inspector = defineInspector({
  id: 'progressive-disclosure', i18nKey: 'progressiveDisclosure', name: 'Progressive Disclosure', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (observed(ctx) === 0) return { key: 'none', tone: 'neutral' };
    return repeats(ctx) > readAutoGoal(ctx).stored ? { key: 'repeating', tone: 'warn' } : { key: 'lean', tone: 'good' };
  },
  checks: [
    { key: 'events', value: (ctx) => String(observed(ctx)) },
    { key: 'repeats', value: (ctx) => String(repeats(ctx)), tone: (ctx) => (repeats(ctx) > readAutoGoal(ctx).stored ? 'warn' : 'neutral') },
    { key: 'cards', value: (ctx) => String(readAutoGoal(ctx).carried) },
  ],
  noteKey: () => '.note',
});

export const progressiveDisclosureManifest = inspector.manifest;
export const progressiveDisclosureClient = inspector.client;

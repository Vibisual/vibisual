/**
 * §5.11 v3.98 — 그라운딩(Grounding): 주장이 확인 가능한 근거에 매여 있는가.
 *
 * 근거 없이 그럴듯한 문장을 만드는 것과, 읽은 파일·검색한 카드에 매인 문장을 만드는 것은 다르다.
 * 여기서는 이 에이전트가 **원본을 직접 읽을 수 있는지**와 **근거가 실제로 주입됐는지**를 함께 본다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';
import type { PluginBubbleContext } from '../types.js';

const canRead = (ctx: PluginBubbleContext): boolean => ['Read', 'Grep', 'Glob'].some((t) => effectiveTools(ctx.agentConfig).has(t));
const cards = (ctx: PluginBubbleContext): number => (ctx.data.brainInjections ?? []).reduce((n, e) => n + e.cardIds.length, 0);

const inspector = defineInspector({
  id: 'grounding', i18nKey: 'grounding', name: 'Grounding', category: 'observability',
  needs: ['brainInjections'],
  status: (ctx) => {
    if (!canRead(ctx) && cards(ctx) === 0) return { key: 'ungrounded', tone: 'warn' };
    return canRead(ctx) && cards(ctx) > 0 ? { key: 'both', tone: 'good' } : { key: 'partial', tone: 'neutral' };
  },
  checks: [
    {
      key: 'source',
      value: (ctx) => ctx.t(`panel.plugins.grounding.${canRead(ctx) ? 'yes' : 'no'}`),
      tone: (ctx) => (canRead(ctx) ? 'good' : 'warn'),
    },
    { key: 'memory', value: (ctx) => String(cards(ctx)) },
  ],
  noteKey: () => '.note',
});

export const groundingManifest = inspector.manifest;
export const groundingClient = inspector.client;

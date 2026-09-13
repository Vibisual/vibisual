/**
 * §5.11 v3.98 — 그라운딩(Grounding): 주장이 확인 가능한 근거에 매여 있는가.
 *
 * 근거 없이 그럴듯한 문장을 만드는 것과, 읽은 파일에 매인 문장을 만드는 것은 다르다. 여기서는 이
 * 에이전트가 **원본을 직접 읽을 수 있는지**와, 굳어진 절차가 **원본 파일로 되짚을 수 있는지**를 함께 본다.
 *
 * 뒤쪽이 §5.10 의 `files` 앵커다 — 절차 frontmatter 에 그 절차가 만진 파일이 적혀 있으면
 * "이렇게 하라"가 어디서 왔는지 확인할 수 있고, 없으면 그냥 하라는 말일 뿐이다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools, readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const canRead = (ctx: PluginBubbleContext): boolean => ['Read', 'Grep', 'Glob'].some((t) => effectiveTools(ctx.agentConfig).has(t));
const anchored = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).anchored;

const inspector = defineInspector({
  id: 'grounding', i18nKey: 'grounding', name: 'Grounding', category: 'observability',
  needs: ['autoGoal'],
  status: (ctx) => {
    if (!canRead(ctx) && anchored(ctx) === 0) return { key: 'ungrounded', tone: 'warn' };
    return canRead(ctx) && anchored(ctx) > 0 ? { key: 'both', tone: 'good' } : { key: 'partial', tone: 'neutral' };
  },
  checks: [
    {
      key: 'source',
      value: (ctx) => ctx.t(`panel.plugins.grounding.${canRead(ctx) ? 'yes' : 'no'}`),
      tone: (ctx) => (canRead(ctx) ? 'good' : 'warn'),
    },
    { key: 'memory', value: (ctx) => String(anchored(ctx)) },
  ],
  noteKey: () => '.note',
});

export const groundingManifest = inspector.manifest;
export const groundingClient = inspector.client;

/** §5.11 — 그라운딩(Grounding): 원본을 직접 읽을 수 있는지와, 굳은 절차가 원본 파일로 되짚히는지(§5.10 frontmatter `files` 앵커)를 본다. 표시 전용. */
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

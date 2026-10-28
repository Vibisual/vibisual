/** §5.11 — 멱등성(Idempotency): 재시도 위험이 있는 도구를 쥐었는지와 반복 상한이 있는지 본다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

/** 같은 호출을 두 번 하면 결과가 달라질 수 있는 도구들. */
const NON_IDEMPOTENT = ['Bash', 'Write', 'WebFetch'];
const risky = (ctx: PluginBubbleContext): string[] => NON_IDEMPOTENT.filter((t) => effectiveTools(ctx.agentConfig).has(t));
const capped = (ctx: PluginBubbleContext): boolean => (ctx.agentConfig?.maxTurns ?? 0) > 0;

const inspector = defineInspector({
  id: 'idempotency', i18nKey: 'idempotency', name: 'Idempotency', category: 'security',
  status: (ctx) => {
    if (risky(ctx).length === 0) return { key: 'safe', tone: 'good' };
    return capped(ctx) ? { key: 'capped', tone: 'neutral' } : { key: 'unbounded', tone: 'warn' };
  },
  checks: [
    { key: 'risky', value: (ctx) => String(risky(ctx).length), tone: (ctx) => (risky(ctx).length > 0 ? 'warn' : 'good'), hint: (ctx) => risky(ctx).join(' · ') || undefined },
    { key: 'cap', value: (ctx) => (capped(ctx) ? String(ctx.agentConfig?.maxTurns) : ctx.t('panel.plugins.idempotency.none')), tone: (ctx) => (capped(ctx) ? 'good' : 'warn') },
  ],
  noteKey: () => '.note',
});

export const idempotencyManifest = inspector.manifest;
export const idempotencyClient = inspector.client;

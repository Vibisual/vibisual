/**
 * §5.11 v3.97 — 평가(Eval): 한 번 돌려 본 결과는 증거가 되지 못한다.
 *
 * 에이전트는 비결정적이라 같은 입력을 여러 번 돌린 **분포**로 봐야 한다. 여기서는 같은 지시가 몇 번
 * 반복됐는지를 세어, 재현을 시도한 흔적이 있는지 보여준다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

function repeats(ctx: PluginBubbleContext): { unique: number; repeated: number } {
  const seen = new Map<string, number>();
  for (const e of ctx.data.agentEvents ?? []) {
    const key = e.message.trim().slice(0, 120);
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let repeated = 0;
  for (const n of seen.values()) if (n > 1) repeated++;
  return { unique: seen.size, repeated };
}

const inspector = defineInspector({
  id: 'eval', i18nKey: 'eval', name: 'Eval', category: 'observability',
  needs: ['agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const { unique, repeated } = repeats(ctx);
    if (unique === 0) return { key: 'none', tone: 'neutral' };
    return repeated > 0 ? { key: 'repeated', tone: 'good' } : { key: 'single', tone: 'warn' };
  },
  checks: [
    { key: 'unique', value: (ctx) => String(repeats(ctx).unique) },
    { key: 'repeated', value: (ctx) => String(repeats(ctx).repeated), tone: (ctx) => (repeats(ctx).repeated > 0 ? 'good' : 'warn') },
  ],
  noteKey: () => '.note',
});

export const evalManifest = inspector.manifest;
export const evalClient = inspector.client;

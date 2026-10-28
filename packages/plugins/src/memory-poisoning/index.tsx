/**
 * §5.11 — 기억 오염(Memory Poisoning): 장기 저장고에 심긴 거짓은 세션이 끝나도 남는다. 표시 전용.
 * §5.10 절차는 승인 없이 자동으로 굳으므로 사람이 걷어낸 흔적을 본다 — 물린 수(막은 기록)와 아직 굳지 않은 후보(사람의 눈을 기다리는 몫).
 */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const contested = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).dismissed;
const needsCheck = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).brewing;

const inspector = defineInspector({
  id: 'memory-poisoning', i18nKey: 'memoryPoisoning', name: 'Memory Poisoning', category: 'security',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (!readAutoGoal(ctx).present) return { key: 'none', tone: 'neutral' };
    return contested(ctx) + needsCheck(ctx) > 0 ? { key: 'review', tone: 'warn' } : { key: 'clean', tone: 'good' };
  },
  checks: [
    { key: 'contested', value: (ctx) => String(contested(ctx)), tone: (ctx) => (contested(ctx) > 0 ? 'warn' : 'good') },
    { key: 'needsCheck', value: (ctx) => String(needsCheck(ctx)), tone: (ctx) => (needsCheck(ctx) > 0 ? 'warn' : 'good') },
    { key: 'cards', value: (ctx) => String(readAutoGoal(ctx).stored) },
  ],
  noteKey: () => '.note',
});

export const memoryPoisoningManifest = inspector.manifest;
export const memoryPoisoningClient = inspector.client;

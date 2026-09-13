/**
 * §5.11 v3.99 — 기억 오염(Memory Poisoning): 거짓이 장기 저장고에 심기면 세션이 끝나도 남는다.
 *
 * 일반 인젝션은 세션이 끝나면 사라지지만, 오염된 저장고는 남아 **미래의 모든 세션을 감염**시킨다.
 * 게다가 그것은 "우리 시스템이 학습한 것"이라 더 신뢰받는다.
 *
 * §5.10 의 절차는 승인 버튼 없이 자동으로 굳으므로, 여기서 볼 것은 **사람이 걷어낸 흔적**이다 —
 * 사용자가 물린 수는 "심길 뻔한 것을 막았다"는 기록이고, 아직 굳지 않은 후보는 지금 사람의 눈을
 * 기다리는 몫이다. 표시 전용.
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

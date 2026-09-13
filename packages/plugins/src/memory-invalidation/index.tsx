/**
 * §5.11 v3.95 — 기억 무효화(Memory Invalidation): 아직 판정이 안 난 것이 쌓여 있는가.
 *
 * 없는 것은 모델이 모른다고 말하게 하지만, **낡은 것은 확신에 찬 오답**을 만든다. 그래서 무효화 시
 * 즉시 지우지 않고 "확인 필요"로 표시해 다음 사람이 판정하게 하는 것이 안전하다.
 *
 * §5.10 에서 그 자리에 서 있는 것이 **후보**다 — 되풀이는 보였지만 문턱을 못 넘어 아직
 * 절차가 되지 않은 것들이고, 사용자가 보고 물리거나(덮기) 더 쌓이게 두거나를 고르는 몫이다. 표시 전용.
 */
import { defineInspector, ICONS } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const needsCheck = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).brewing;

const inspector = defineInspector({
  id: 'memory-invalidation', i18nKey: 'memoryInvalidation', name: 'Memory Invalidation', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (!readAutoGoal(ctx).present) return { key: 'none', tone: 'neutral' };
    if (needsCheck(ctx) > 0) return { key: 'pending', tone: 'warn' };
    return { key: 'clean', tone: 'good' };
  },
  checks: [
    { key: 'needsCheck', value: (ctx) => String(needsCheck(ctx)), tone: (ctx) => (needsCheck(ctx) > 0 ? 'warn' : 'good') },
    { key: 'review', value: (ctx) => String(readAutoGoal(ctx).dismissed) },
    { key: 'cards', value: (ctx) => String(readAutoGoal(ctx).stored) },
  ],
  noteKey: (ctx) => (needsCheck(ctx) > 0 ? '.notePending' : '.note'),
  // 판정 대기량을 세는 배지라 계기판 글리프를 쓴다(폐기된 두뇌 글리프 자리).
  badge: { match: (ctx) => needsCheck(ctx) > 0, text: (ctx) => String(needsCheck(ctx)), icon: ICONS.gauge },
});

export const memoryInvalidationManifest = inspector.manifest;
export const memoryInvalidationClient = inspector.client;

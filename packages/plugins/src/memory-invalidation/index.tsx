/**
 * §5.11 v3.95 — 기억 무효화(Memory Invalidation): 낡은 기억이 표시되고 있는가.
 *
 * 없는 기억은 모델이 모른다고 말하게 하지만, **낡은 기억은 확신에 찬 오답**을 만든다. 코드 도메인에서는
 * 연결된 파일의 변경 감지가 가장 정확한 신호이며, 무효화 시 즉시 지우지 않고 "확인 필요"로 표시해
 * 다음 사람이 판정하게 하는 것이 안전하다. 표시 전용.
 */
import { defineInspector, ICONS } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const needsCheck = (ctx: PluginBubbleContext): number => ctx.data.brain?.needsCheckCount ?? 0;

const inspector = defineInspector({
  id: 'memory-invalidation', i18nKey: 'memoryInvalidation', name: 'Memory Invalidation', category: 'observability',
  needs: ['brain'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (!ctx.data.brain) return { key: 'none', tone: 'neutral' };
    if (needsCheck(ctx) > 0) return { key: 'pending', tone: 'warn' };
    return { key: 'clean', tone: 'good' };
  },
  checks: [
    { key: 'needsCheck', value: (ctx) => String(needsCheck(ctx)), tone: (ctx) => (needsCheck(ctx) > 0 ? 'warn' : 'good') },
    { key: 'review', value: (ctx) => String(ctx.data.brain?.reviewCount ?? 0) },
    { key: 'cards', value: (ctx) => String(ctx.data.brain?.cardCount ?? 0) },
  ],
  noteKey: (ctx) => (needsCheck(ctx) > 0 ? '.notePending' : '.note'),
  badge: { match: (ctx) => needsCheck(ctx) > 0, text: (ctx) => String(needsCheck(ctx)), icon: ICONS.brain },
});

export const memoryInvalidationManifest = inspector.manifest;
export const memoryInvalidationClient = inspector.client;

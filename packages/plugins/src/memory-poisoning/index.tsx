/**
 * §5.11 v3.99 — 기억 오염(Memory Poisoning): 거짓이 장기 기억에 심기면 세션이 끝나도 남는다.
 *
 * 일반 인젝션은 세션이 끝나면 사라지지만, 오염된 기억은 남아 **미래의 모든 세션을 감염**시킨다. 게다가 그
 * 기억은 "우리 시스템이 학습한 것"이라 더 신뢰받는다. 그래서 승급 경로에 출처 검증이 필요하다 —
 * 사용자 발화에서 나온 사실과 외부 문서에서 읽은 내용을 같은 신뢰도로 저장하면 안 된다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const contested = (ctx: PluginBubbleContext): number => ctx.data.brain?.contestedCount ?? 0;
const needsCheck = (ctx: PluginBubbleContext): number => ctx.data.brain?.needsCheckCount ?? 0;

const inspector = defineInspector({
  id: 'memory-poisoning', i18nKey: 'memoryPoisoning', name: 'Memory Poisoning', category: 'security',
  needs: ['brain'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (!ctx.data.brain) return { key: 'none', tone: 'neutral' };
    return contested(ctx) + needsCheck(ctx) > 0 ? { key: 'review', tone: 'warn' } : { key: 'clean', tone: 'good' };
  },
  checks: [
    { key: 'contested', value: (ctx) => String(contested(ctx)), tone: (ctx) => (contested(ctx) > 0 ? 'warn' : 'good') },
    { key: 'needsCheck', value: (ctx) => String(needsCheck(ctx)), tone: (ctx) => (needsCheck(ctx) > 0 ? 'warn' : 'good') },
    { key: 'cards', value: (ctx) => String(ctx.data.brain?.cardCount ?? 0) },
  ],
  noteKey: () => '.note',
});

export const memoryPoisoningManifest = inspector.manifest;
export const memoryPoisoningClient = inspector.client;

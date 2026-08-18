/**
 * §5.11 v3.95 — 망각 정책(Forgetting Policy): 무엇을 언제 버릴지가 정해져 있는가.
 *
 * 기억 시스템의 고질병 1번은 "쓸모없는 기억이 줄지 않는다"이다. 무한히 쌓이면 검색 정밀도가 떨어져
 * 결국 기억이 없느니만 못해진다. 안전한 형태는 총량 예산 + **삭제가 아니라 보관**이라, 여기서는
 * 예산 대비 적재량과 보관된 장수를 함께 본다. 표시 전용.
 */
import { BRAIN_PROJECT_CARD_BUDGET } from '@vibisual/shared';
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const used = (ctx: PluginBubbleContext): number => ctx.data.brain?.cardCount ?? 0;
const ratio = (ctx: PluginBubbleContext): number => (BRAIN_PROJECT_CARD_BUDGET > 0 ? used(ctx) / BRAIN_PROJECT_CARD_BUDGET : 0);

const inspector = defineInspector({
  id: 'forgetting-policy', i18nKey: 'forgettingPolicy', name: 'Forgetting Policy', category: 'observability',
  needs: ['brain'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (!ctx.data.brain) return { key: 'none', tone: 'neutral' };
    if (ratio(ctx) >= 0.9) return { key: 'full', tone: 'warn' };
    return { key: 'room', tone: 'good' };
  },
  checks: [
    { key: 'used', value: (ctx) => `${used(ctx)} / ${BRAIN_PROJECT_CARD_BUDGET}` },
    { key: 'share', value: (ctx) => `${Math.round(ratio(ctx) * 100)}%`, tone: (ctx) => (ratio(ctx) >= 0.9 ? 'warn' : 'good') },
    { key: 'archived', value: (ctx) => String(ctx.data.brain?.archivedCount ?? 0), tone: () => 'good' },
  ],
  noteKey: () => '.note',
});

export const forgettingPolicyManifest = inspector.manifest;
export const forgettingPolicyClient = inspector.client;

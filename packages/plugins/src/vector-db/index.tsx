/**
 * §5.11 v3.98 — 벡터 DB(Vector Database): 규모가 저장 방식을 정한다.
 *
 * 수백 건 규모에서는 마크다운 + 텍스트 검색이 운영 비용 대비 더 낫고, 수십만 건이면 벡터 DB 가 맞다.
 * **규모를 재기 전에 인프라부터 고르는 것**이 가장 흔한 과잉 설계다. Vibisual 의 기억은 파일 기반이므로,
 * 여기서는 지금 규모가 그 선택을 여전히 정당화하는지 본다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

/** 이 선을 크게 넘어서면 파일 + 텍스트 검색의 이점이 사라지기 시작한다. */
const FILE_SCALE_LIMIT = 2000;
const cards = (ctx: PluginBubbleContext): number => ctx.data.brain?.cardCount ?? 0;

const inspector = defineInspector({
  id: 'vector-db', i18nKey: 'vectorDb', name: 'Vector DB', category: 'observability',
  needs: ['brain'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (cards(ctx) === 0) return { key: 'none', tone: 'neutral' };
    return cards(ctx) > FILE_SCALE_LIMIT ? { key: 'outgrown', tone: 'warn' } : { key: 'fits', tone: 'good' };
  },
  checks: [
    { key: 'cards', value: (ctx) => String(cards(ctx)) },
    { key: 'storage', value: (ctx) => ctx.t('panel.plugins.vectorDb.files') },
    { key: 'limit', value: () => String(FILE_SCALE_LIMIT) },
  ],
  noteKey: () => '.note',
});

export const vectorDbManifest = inspector.manifest;
export const vectorDbClient = inspector.client;

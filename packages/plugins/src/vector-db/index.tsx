/**
 * §5.11 v3.98 — 벡터 DB(Vector Database): 규모가 저장 방식을 정한다.
 *
 * 수백 건 규모에서는 마크다운 + 텍스트 검색이 운영 비용 대비 더 낫고, 수십만 건이면 벡터 DB 가 맞다.
 * **규모를 재기 전에 인프라부터 고르는 것**이 가장 흔한 과잉 설계다. §5.10 의 절차 저장고는
 * 파일 기반(`.vibisual/skills/<절차>/SKILL.md`)이므로, 여기서는 지금 규모가 그 선택을 여전히 정당화하는지 본다.
 * 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

/** 이 선을 크게 넘어서면 파일 + 텍스트 검색의 이점이 사라지기 시작한다. */
const FILE_SCALE_LIMIT = 2000;
const stored = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).stored;

const inspector = defineInspector({
  id: 'vector-db', i18nKey: 'vectorDb', name: 'Vector DB', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (stored(ctx) === 0) return { key: 'none', tone: 'neutral' };
    return stored(ctx) > FILE_SCALE_LIMIT ? { key: 'outgrown', tone: 'warn' } : { key: 'fits', tone: 'good' };
  },
  checks: [
    { key: 'cards', value: (ctx) => String(stored(ctx)) },
    { key: 'storage', value: (ctx) => ctx.t('panel.plugins.vectorDb.files') },
    { key: 'limit', value: () => String(FILE_SCALE_LIMIT) },
  ],
  noteKey: () => '.note',
});

export const vectorDbManifest = inspector.manifest;
export const vectorDbClient = inspector.client;

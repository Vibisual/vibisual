/** §5.11 — 벡터 DB(Vector Database): 규모가 저장 방식을 정한다 — §5.10 파일 기반 저장고(`.vibisual/skills/<절차>/SKILL.md`)를 지금 규모가 정당화하는지 본다. 표시 전용. */
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

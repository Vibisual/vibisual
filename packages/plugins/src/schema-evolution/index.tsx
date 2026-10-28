/** §5.11 — 스키마 진화(Schema Evolution): 옛 저장본을 읽을 수 있는가(필드는 선택적으로·기본값과 함께) — 체크포인트의 보장과 저장 상태를 보인다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const sessions = (ctx: PluginBubbleContext): number => (ctx.data.subAgents ?? []).length;

const inspector = defineInspector({
  id: 'schema-evolution', i18nKey: 'schemaEvolution', name: 'Schema Evolution', category: 'observability',
  needs: ['subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (sessions(ctx) > 0 ? { key: 'persisted', tone: 'good' } : { key: 'fresh', tone: 'neutral' }),
  checks: [
    { key: 'sessions', value: (ctx) => String(sessions(ctx)) },
    { key: 'policy', value: (ctx) => ctx.t('panel.plugins.schemaEvolution.optional'), tone: () => 'good' },
  ],
  noteKey: () => '.note',
});

export const schemaEvolutionManifest = inspector.manifest;
export const schemaEvolutionClient = inspector.client;

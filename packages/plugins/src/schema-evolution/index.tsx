/**
 * §5.11 v4.00 — 스키마 진화(Schema Evolution): 옛 저장본을 아직 읽을 수 있는가.
 *
 * 필드를 더할 때는 **선택적으로** 더하고 기본값을 두어야, 이전 버전이 남긴 저장본을 새 코드가 그대로 읽는다.
 * Vibisual 의 체크포인트가 그 규약 위에 있으므로, 이 카드는 그 보장과 이 에이전트의 저장 상태를 보여준다. 표시 전용.
 */
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

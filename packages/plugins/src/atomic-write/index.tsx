/** §5.11 — 원자적 쓰기(Atomic Write): 코어의 체크포인트·설정 저장 보장(임시 파일 + 원자적 교체)과 이 에이전트가 직접 파일을 쓰는지를 보여준다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const writes = (ctx: PluginBubbleContext): boolean => ['Write', 'Edit', 'NotebookEdit'].some((t) => effectiveTools(ctx.agentConfig).has(t));

const inspector = defineInspector({
  id: 'atomic-write', i18nKey: 'atomicWrite', name: 'Atomic Write', category: 'observability',
  status: (ctx) => (writes(ctx) ? { key: 'agentWrites', tone: 'neutral' } : { key: 'readOnly', tone: 'good' }),
  checks: [
    {
      key: 'agent',
      value: (ctx) => ctx.t(`panel.plugins.atomicWrite.${writes(ctx) ? 'yes' : 'no'}`),
      tone: (ctx) => (writes(ctx) ? 'neutral' : 'good'),
    },
    { key: 'core', value: (ctx) => ctx.t('panel.plugins.atomicWrite.guaranteed'), tone: () => 'good' },
  ],
  noteKey: () => '.note',
});

export const atomicWriteManifest = inspector.manifest;
export const atomicWriteClient = inspector.client;

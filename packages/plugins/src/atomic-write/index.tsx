/**
 * §5.11 v3.98 — 원자적 쓰기(Atomic Write): 쓰다 만 파일이 남지 않는가.
 *
 * 중간에 죽으면 반쯤 쓰인 파일이 남아, 다음 부팅이 그 파일을 정상으로 읽는 순간 조용한 손상이 시작된다.
 * 임시 파일에 쓰고 원자적으로 교체하는 것이 표준이며, Vibisual 은 체크포인트·설정 저장에 이 규약을 코어에서 지킨다.
 * 이 카드는 그 보장과, 이 에이전트가 직접 파일을 쓰는지를 함께 보여준다. 표시 전용.
 */
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

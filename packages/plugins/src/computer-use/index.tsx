/** §5.11 — 컴퓨터 사용(Computer Use): CLI·API 로 되면 GUI 로 하지 마라 — 되돌릴 수 없는 클릭이 섞여 사람 확인 지점을 둔다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const captures = (ctx: PluginBubbleContext): number => (ctx.data.captureBubbles ?? []).length;
/** 화면 전체를 잡는 캡처는 창 하나만 잡는 것보다 범위가 넓다 — 되돌릴 수 없는 클릭이 섞일 여지도 그만큼 크다.
 *  원격 조작 on/off 는 클라이언트 런타임 상태라 스냅샷에 없으므로, 여기서는 **범위**만 본다. */
const screens = (ctx: PluginBubbleContext): number => (ctx.data.captureBubbles ?? []).filter((c) => c.sourceKind === 'screen').length;

const inspector = defineInspector({
  id: 'computer-use', i18nKey: 'computerUse', name: 'Computer Use', category: 'observability',
  needs: ['captureBubbles'],
  status: (ctx) => {
    if (captures(ctx) === 0) return { key: 'none', tone: 'good' };
    return screens(ctx) > 0 ? { key: 'controlling', tone: 'warn' } : { key: 'watching', tone: 'neutral' };
  },
  checks: [
    { key: 'captures', value: (ctx) => String(captures(ctx)) },
    { key: 'screens', value: (ctx) => String(screens(ctx)), tone: (ctx) => (screens(ctx) > 0 ? 'warn' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const computerUseManifest = inspector.manifest;
export const computerUseClient = inspector.client;

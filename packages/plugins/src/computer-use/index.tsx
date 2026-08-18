/**
 * §5.11 v4.00 — 컴퓨터 사용(Computer Use): API 가 없는 세계에 닿는 최후의 인터페이스.
 *
 * 화면을 보고 마우스·키보드로 조작하는 방식은 적용 범위가 압도적으로 넓지만, 매 단계가 시각적 근거 잡기에
 * 의존해 느리고 깨지기 쉽다. 결론은 분명하다 — **CLI·API 로 할 수 있으면 GUI 로 하지 마라.**
 * 되돌릴 수 없는 클릭이 섞이므로 사람 확인 지점을 두는 것이 표준이다. 표시 전용.
 */
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

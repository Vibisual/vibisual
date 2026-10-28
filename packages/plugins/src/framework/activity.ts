/**
 * §5.11 — "이 버블에서 실제로 무슨 일이 있었는가". 규칙: 활동이 없으면 경고하지 않는다 — 움직인 뒤에도 관행이 안 보이면 그때 경고한다.
 * 갓 만든 에이전트에 이력 기반 카드가 일제히 경고하면("회고·검수·교훈이 없다") `panelOrder.ts` 가 경고를 다 펼쳐 화면이 경고로 덮이고 전부 무시된다.
 */
import type { PluginBubbleContext } from '../types.js';
import type { PluginTone } from '../ui/kit.js';

/** 턴이나 세션이 하나라도 있으면 이 에이전트는 움직인 것이다. */
export function hasActivity(ctx: PluginBubbleContext): boolean {
  return (ctx.data.agentEvents?.length ?? 0) > 0 || (ctx.data.subAgents?.length ?? 0) > 0;
}

/**
 * 이력이 비어서 나온 판정의 색 — 움직였는데 비면 경고, 아직 안 움직였으면 조용히.
 * 쓰는 카드는 `needs` 에 `agentEvents`·`subAgents` 를 함께 선언해야 한다(안 하면 호스트가 축을 안 채워 영영 활동 없음으로 읽힌다).
 */
export function toneIfActive(ctx: PluginBubbleContext, warnTone: PluginTone = 'warn'): PluginTone {
  return hasActivity(ctx) ? warnTone : 'neutral';
}

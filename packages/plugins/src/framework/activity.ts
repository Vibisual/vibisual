/**
 * §5.11 v4.26 — "이 버블에서 실제로 무슨 일이 있었는가".
 *
 * 이력을 보고 판정하는 카드들이 **아직 아무 일도 없는 에이전트에 일제히 경고를 내고 있었다.** 갓 만든
 * 에이전트를 열면 경고가 21장 쏟아졌고, 그중 대부분은 "회고가 없다 / 검수가 없다 / 교훈이 없다" 였다.
 * 방금 만들었으니 당연히 없다. 그건 잘못이 아니라 **아직 시작하지 않은 것**이다.
 *
 * `panelOrder.ts` 는 조용한 카드만 접고 경고는 몇 장이든 다 펼치므로, 경고의 개수가 곧 화면이 된다.
 * 전부 경고면 무엇이 진짜인지 고를 수 없고 결국 전부 무시하게 된다 — 배지에서 겪은 일과 같다(v4.25).
 *
 * 그래서 규칙을 하나 둔다: **활동이 없으면 경고하지 않는다.** 움직인 뒤에도 그 관행이 안 보이면 그때 경고한다.
 */
import type { PluginBubbleContext } from '../types.js';
import type { PluginTone } from '../ui/kit.js';

/** 턴이나 세션이 하나라도 있으면 이 에이전트는 움직인 것이다. */
export function hasActivity(ctx: PluginBubbleContext): boolean {
  return (ctx.data.agentEvents?.length ?? 0) > 0 || (ctx.data.subAgents?.length ?? 0) > 0;
}

/**
 * 이력이 비어서 나온 판정의 색. 움직였는데도 비어 있으면 경고, 아직 안 움직였으면 조용히 둔다.
 * 이 함수를 쓰는 카드는 `needs` 에 `agentEvents` 와 `subAgents` 를 함께 선언해야 한다
 * (선언하지 않으면 호스트가 축을 안 채워 **영영 활동 없음으로 읽힌다**).
 */
export function toneIfActive(ctx: PluginBubbleContext, warnTone: PluginTone = 'warn'): PluginTone {
  return hasActivity(ctx) ? warnTone : 'neutral';
}

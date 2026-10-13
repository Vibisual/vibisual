import { REF_LINK_STYLE } from '@vibisual/shared';
import { useRefLinkDragStore } from '../../stores/refLinkDrag.js';
import { pointOnOrbitToward, rectBorderDistance, refLinkPath } from './agentCard.js';
import { RefDock, RefTether } from './RefTether.js';

/**
 * §5.4 #36 (B) — 궤도 위성에서 끄는 위성줄의 **미리보기**. 화면 좌표에 고정된 SVG 한 장이다.
 *
 * Task Edge 미리보기(`TaskEdgeDragPreview`)와 같은 방식 — 가상 노드를 만들어 React Flow 엣지로 그리면
 * 측정 타이밍이 엇갈려 손을 늦게 따라온다. 여기서는 출발 원(원 중심·궤도 반지름)과 손 위치만 알면 된다.
 * 줄은 위성이 아니라 **원 둘레에서 손 쪽으로** 나간다(확정 줄과 같은 문법). 손 아래가 앱 노드면 줄 끝이 그 노드
 * 테두리에 붙고 구슬이 흐른다 — "놓으면 여기 이어진다"를 놓기 전에 보여 준다. 모양은 확정 줄과 **같은 조각**
 * (`RefTether`)·같은 곡선 함수라 놓는 순간 튀지 않는다.
 */
export function RefLinkDragPreview(): React.JSX.Element | null {
  const drag = useRefLinkDragStore((s) => s.drag);
  if (!drag || !drag.moved) return null;

  const origin = { x: drag.originX, y: drag.originY, r: drag.originR };
  let end = { x: drag.mouseX, y: drag.mouseY };
  const target = drag.target;
  if (target) {
    // 앱 노드 테두리 — 원 중심과 노드 중심을 잇는 직선 위(확정 줄의 `refLinkEnds` 와 같은 자리).
    const dx = target.cx - origin.x;
    const dy = target.cy - origin.y;
    const len = Math.hypot(dx, dy) || 1;
    const reach = rectBorderDistance(target.halfW, target.halfH, dx / len, dy / len);
    end = { x: target.cx - (dx / len) * reach, y: target.cy - (dy / len) * reach };
  }
  // 손이 아직 궤도 안이면 그릴 줄이 없다.
  if (Math.hypot(end.x - origin.x, end.y - origin.y) <= origin.r) return null;

  const start = pointOnOrbitToward(origin, end.x, end.y);
  const geo = refLinkPath(start.x, start.y, end.x, end.y);
  const color = drag.color || REF_LINK_STYLE.fallbackColor;

  return (
    <svg className="pointer-events-none fixed inset-0 z-40 h-screen w-screen" aria-hidden="true">
      <RefTether d={geo.path} stroke={color} bright flowing={target !== null} />
      <RefDock x={end.x} y={end.y} color={color} active={target !== null} />
    </svg>
  );
}

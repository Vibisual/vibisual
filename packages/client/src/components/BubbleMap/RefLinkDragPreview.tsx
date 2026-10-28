import { REF_LINK_STYLE } from '@vibisual/shared';
import { useRefLinkDragStore } from '../../stores/refLinkDrag.js';
import { pointOnOrbitToward, rectBorderDistance, refLinkPath } from './agentCard.js';
import { RefDock, RefTether } from './RefTether.js';

/**
 * §5.4 #36 (B) — 위성줄 끌기 미리보기: 화면 고정 SVG 한 장(가상 노드 + RF 엣지는 측정이 엇갈려 손을 늦게 따른다).
 * 확정 줄과 같은 `RefTether`·같은 곡선이라 놓는 순간 튀지 않는다.
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
    // 높이는 보이는 화면(`dvh`) — 폰 주소창이 오가도 `inset-0` 과 같은 상자다(지원하지 않는 브라우저는 `inset-0` 이 받친다).
    <svg className="pointer-events-none fixed inset-0 z-40 h-dvh w-screen" aria-hidden="true">
      <RefTether d={geo.path} stroke={color} bright flowing={target !== null} />
      <RefDock x={end.x} y={end.y} color={color} active={target !== null} />
    </svg>
  );
}

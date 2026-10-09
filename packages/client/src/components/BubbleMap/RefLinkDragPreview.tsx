import { REF_LINK_STYLE } from '@vibisual/shared';
import { useRefLinkDragStore } from '../../stores/refLinkDrag.js';
import { refLinkPath } from './agentCard.js';

/**
 * §5.4 #36 (B) — 카드의 `+` 에서 끄는 참조선의 **미리보기**. 화면 좌표에 고정된 SVG 한 장이다.
 *
 * Task Edge 미리보기(`TaskEdgeDragPreview`)와 같은 방식 — 가상 노드를 만들어 React Flow 엣지로 그리면
 * 측정 타이밍이 엇갈려 손을 늦게 따라온다. 여기서는 출발점(손잡이 가운데)과 손 위치만 알면 된다.
 * 모양은 확정된 참조선(`RefLinkEdge`)과 **같은 곡선 함수**를 쓴다 — 놓는 순간 선이 다른 모양으로 튀지 않게.
 */
export function RefLinkDragPreview(): React.JSX.Element | null {
  const drag = useRefLinkDragStore((s) => s.drag);
  if (!drag || !drag.moved) return null;

  const side: 1 | -1 = drag.mouseX >= drag.startX ? 1 : -1;
  const geo = refLinkPath(drag.startX, drag.startY, drag.mouseX, drag.mouseY, side);
  const color = drag.color || REF_LINK_STYLE.fallbackColor;

  return (
    <svg className="pointer-events-none fixed inset-0 z-40 h-screen w-screen" aria-hidden="true">
      <defs>
        <linearGradient
          id="ref-link-drag-grad"
          gradientUnits="userSpaceOnUse"
          x1={drag.startX}
          y1={drag.startY}
          x2={drag.mouseX}
          y2={drag.mouseY}
        >
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={REF_LINK_STYLE.endColor} />
        </linearGradient>
      </defs>
      <path
        d={geo.path}
        fill="none"
        stroke={color}
        strokeWidth={REF_LINK_STYLE.glowWidth}
        strokeOpacity={REF_LINK_STYLE.glowActiveOpacity}
        strokeLinecap="round"
      />
      <path d={geo.path} fill="none" stroke="url(#ref-link-drag-grad)" strokeWidth={REF_LINK_STYLE.lineWidth} strokeLinecap="round" />
      <circle cx={drag.mouseX} cy={drag.mouseY} r={REF_LINK_STYLE.endDotRadius + 1} fill={REF_LINK_STYLE.endColor} />
    </svg>
  );
}

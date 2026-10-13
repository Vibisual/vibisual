import { REF_LINK_STYLE } from '@vibisual/shared';

/**
 * §5.4 #36 (B) — **위성줄 한 가닥**을 그리는 조각. 확정 줄(`RefLinkEdge`)·끄는 중 미리보기(`RefLinkDragPreview`)·
 * 꽃잎을 고르는 동안의 보류 줄(`RefLinkBloom`)이 이 하나를 쓴다 — 놓는 순간 모양이 다른 줄로 튀지 않게.
 *
 * 가는 실 + 그 위에 꿴 둥근 구슬. 구슬은 `stroke-dasharray: 0 간격` + 둥근 끝이라 path 하나다 — 구슬마다 원 요소를
 * 만들지 않고, 필터·마스크도 쓰지 않는다(§5.4 #31 (K) — 선마다 필터는 래스터를 포화시킨다).
 * 경로는 `refLinkPath`(처지는 2차 곡선)가 만든다. `<svg>` 안에서 쓴다.
 */
export interface RefTetherProps {
  /** 줄 경로. */
  d: string;
  /** 실·구슬 색 — 단색이거나 `url(#그라디언트)`. */
  stroke: string;
  /** 손을 올렸거나 끄는 중 — 한 단계 밝게. */
  bright?: boolean;
  /** 구슬이 출발 → 도착 쪽으로 흐른다(에이전트가 도는 동안). 움직임 줄이기면 CSS 가 멈춘다. */
  flowing?: boolean;
  /**
   * 굵기 배율(§5.4 #31 무리 강조). 구슬 **간격은 곱하지 않는다** — 흐름 한 칸이 `beadGap` 이라
   * 간격이 바뀌면 한 주기마다 구슬이 튄다.
   */
  widthMul?: number;
}

export function RefTether({ d, stroke, bright = false, flowing = false, widthMul = 1 }: RefTetherProps): React.JSX.Element {
  return (
    <>
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={REF_LINK_STYLE.threadWidth * widthMul}
        strokeOpacity={bright ? REF_LINK_STYLE.threadActiveOpacity : REF_LINK_STYLE.threadOpacity}
        strokeLinecap="round"
        pointerEvents="none"
      />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={REF_LINK_STYLE.beadSize * widthMul}
        strokeOpacity={bright ? REF_LINK_STYLE.beadActiveOpacity : REF_LINK_STYLE.beadOpacity}
        strokeLinecap="round"
        strokeDasharray={`0 ${REF_LINK_STYLE.beadGap}`}
        className={flowing ? 'ref-bead-flow' : undefined}
        pointerEvents="none"
      />
    </>
  );
}

/** 앱 쪽 끝의 **도킹 고리** — 화살촉 대신이다. 끄는 중 앱 노드 위면 커진다(`active`). */
export function RefDock({ x, y, color, active = false }: { x: number; y: number; color: string; active?: boolean }): React.JSX.Element {
  return (
    <circle
      cx={x}
      cy={y}
      r={active ? REF_LINK_STYLE.dockActiveRadius : REF_LINK_STYLE.dockRadius}
      fill={REF_LINK_STYLE.dockFill}
      stroke={color}
      strokeWidth={REF_LINK_STYLE.dockStroke}
      pointerEvents="none"
    />
  );
}

import { REF_LINK_STYLE } from '@vibisual/shared';

/**
 * §5.4 #36 (B) — 위성줄 한 가닥. 확정 줄·끄는 미리보기·보류 줄이 함께 쓴다(놓는 순간 튀지 않게).
 * 구슬은 `stroke-dasharray: 0 간격` + 둥근 끝의 path 하나 — 원 요소·필터·마스크 ❌(§5.4 #31 (K) 래스터 포화). 경로는 `refLinkPath`.
 */
export interface RefTetherProps {
  /** 줄 경로. */
  d: string;
  /** 실·구슬 색 — 단색이거나 `url(#그라디언트)`. */
  stroke: string;
  /** 손을 올렸거나 끄는 중 — 한 단계 밝게. */
  bright?: boolean;
  /** 구슬이 출발 → 도착 쪽으로 흐른다(에이전트가 도는 동안). 움직임 줄이기면 CSS 가 멈추지 않고 느리게 흘린다. */
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

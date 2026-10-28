/**
 * §5.5 #17-22 ① — [읽기] 패널이 IDE 창 안에 다 드는 자리(순수 판정). IDE 창이 `overflow-hidden` 이라 좁은 창에서 삐져나간 만큼 잘린다 —
 * 경계는 뷰포트가 아니라 IDE 창 ∩ 뷰포트다.
 */
import type { ViewportSize } from '../../../hooks/popupDismiss.js';
import type { PopupAnchorRect } from '../../Panel/modelSectionView.js';

/** 패널 폭(px) — 넓은 창에서의 원래 폭(`w-80`). 창이 이보다 좁으면 창에 맞춰 줄인다. */
export const READING_PANEL_WIDTH = 320;
/** 창 가장자리와 남기는 여백 — 드롭다운·모델 카드(`modelSectionView.ts`)와 같은 값. */
const EDGE_MARGIN = 8;
/** 버튼 칸과 패널 사이 간격 — 패널의 `mt-1` 과 같은 값. */
const ANCHOR_GAP = 4;
/**
 * 패널이 쓸 수 있는 높이가 이보다 낮으면 좁은 창 안내·근거 문단까지 스크롤 안으로 넣는다.
 * 머리줄·안내·근거가 합쳐 180px 안팎이라, 그 셋을 고정해 두면 설정 칸이 180px 도 못 받는 선이다
 * (창 최소 높이 320px 에서 패널 몫은 270px 남짓).
 */
export const READING_PANEL_COMPACT_BELOW = 360;

export interface ReadingPanelPlacement {
  /** 버튼 칸(패널의 위치 기준 상자) 왼쪽 변에서 패널 왼쪽 변까지(px). 음수면 칸보다 왼쪽에서 시작한다. */
  left: number;
  width: number;
  /** 패널 전체 최대 높이 — 창 아래 변을 넘지 않는 선. 넘치는 만큼은 패널 안에서 스크롤한다. */
  maxHeight: number;
  /** 세로가 모자라 안내·근거 문단까지 스크롤 영역 안으로 넣는가. */
  compact: boolean;
}

/** IDE 창 사각형 중 화면에 보이는 부분. 창을 못 찾으면 뷰포트 전체다. */
export function visibleBounds(rect: PopupAnchorRect | null, viewport: ViewportSize): PopupAnchorRect {
  if (!rect) return { left: 0, top: 0, right: viewport.w, bottom: viewport.h };
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  // 창이 통째로 화면 밖이어도 오른쪽·아래 변이 왼쪽·위 변을 앞지르지 않게 한다(폭·높이 음수 ❌).
  return {
    left,
    top,
    right: Math.max(left, Math.min(rect.right, viewport.w)),
    bottom: Math.max(top, Math.min(rect.bottom, viewport.h)),
  };
}

/** 버튼 칸 아래 패널 자리 — 가로는 버튼 오른쪽 변에 맞추고, 창 밖으로 나갈 때만 안으로 민다. 창이 좁으면 폭도 창에 맞춘다. */
export function placeReadingPanel(
  anchor: PopupAnchorRect,
  bounds: PopupAnchorRect,
  width: number = READING_PANEL_WIDTH,
): ReadingPanelPlacement {
  const w = Math.max(0, Math.min(width, bounds.right - bounds.left - EDGE_MARGIN * 2));
  const minLeft = bounds.left + EDGE_MARGIN;
  const maxLeft = Math.max(minLeft, bounds.right - EDGE_MARGIN - w);
  const panelLeft = Math.min(Math.max(anchor.right - w, minLeft), maxLeft);
  const maxHeight = Math.max(0, bounds.bottom - EDGE_MARGIN - (anchor.bottom + ANCHOR_GAP));
  return {
    left: panelLeft - anchor.left,
    width: w,
    maxHeight,
    compact: maxHeight < READING_PANEL_COMPACT_BELOW,
  };
}

export function sameReadingPanelPlacement(a: ReadingPanelPlacement | null, b: ReadingPanelPlacement): boolean {
  return !!a && a.left === b.left && a.width === b.width && a.maxHeight === b.maxHeight && a.compact === b.compact;
}

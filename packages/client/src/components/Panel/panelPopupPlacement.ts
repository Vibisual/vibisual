import { MENU_VIEWPORT_MARGIN, placeCanvasMenu } from '../BubbleMap/canvasMenuPlacement.js';

/**
 * 상세 패널·설정 창의 떠 있는 상자(툴팁·포털 드롭다운·포인터 옆 팝업)를 화면 안으로 앉히는 순수 계산. 실측은 부르는 쪽이 넘긴다.
 * "오른쪽·위엔 늘 자리가 있다"고 가정하거나 상자 키를 상수로 짐작하지 마라 — 폰 폭(360~430px)에서 화면 밖으로 나간다.
 * 여백·"점 + 크기 → 화면 안" 규칙은 `canvasMenuPlacement` 와 한 벌이다.
 */

/** 화면 끝과 상자 사이에 늘 남기는 여백(px) — 캔버스 메뉴와 같은 값. */
export const POPUP_VIEWPORT_MARGIN = MENU_VIEWPORT_MARGIN;

export interface BoxSize {
  w: number;
  h: number;
}

/** 칸(앵커)의 화면 사각형 — `DOMRect` 의 필요한 부분만. */
export interface AnchorBox {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

/**
 * 한 축의 시작 좌표를 `[margin, limit − margin − size]` 안으로 접는다.
 * 상자가 화면보다 크면 **앞머리(왼쪽·위)** 를 margin 에 붙인다 — 제목과 닫기가 있는 쪽이 보여야 한다.
 */
export function clampSpan(start: number, size: number, limit: number, margin = POPUP_VIEWPORT_MARGIN): number {
  return Math.max(margin, Math.min(start, limit - margin - size));
}

/**
 * HoverTip 자리. `x` = 상자 가운데(`-translate-x-1/2` 짝) — 칸이 화면 끝이면 들어올 만큼만 안쪽으로 민다.
 * 위에 자리가 없고 아래가 넓으면 `below`(`y` = 윗변), 아니면 칸 위(`y` = 아랫변, `-translate-y-full` 짝).
 */
export function placeHoverTip(
  anchor: AnchorBox,
  tip: BoxSize,
  vp: BoxSize,
  gap = 6,
  margin = POPUP_VIEWPORT_MARGIN,
): { x: number; y: number; below: boolean } {
  const half = tip.w / 2;
  const x = clampSpan(anchor.left + anchor.width / 2 - half, tip.w, vp.w, margin) + half;
  const fitsAbove = anchor.top - gap - tip.h >= margin;
  const below = !fitsAbove && vp.h - anchor.bottom > anchor.top;
  return below
    ? { x, y: anchor.bottom + gap, below: true }
    : { x, y: anchor.top - gap, below: false };
}

/** 드롭다운 패널이 화면 끝에 잘리지 않도록 두는 여백. */
export const DD_VIEWPORT_MARGIN = POPUP_VIEWPORT_MARGIN;
/** 버튼과 패널 사이 간격. */
export const DD_GAP = 4;
/** 패널 기본 높이 상한(= Tailwind max-h-72 와 동급). 실측 전 1차 추정에 쓴다. */
export const DD_MAX_HEIGHT = 288;
/** 위/아래 어느 쪽도 넉넉하지 않을 때 그래도 확보하는 최소 높이(내부 스크롤로 소화). */
export const DD_MIN_HEIGHT = 120;
/** `'left'` 배치 패널의 최소 폭 — 부르는 쪽 style 의 `minWidth` 와 **같은 값**이어야 실측 전 판정이 맞는다. */
export const DD_LEFT_MIN_WIDTH = 280;
/** `'left'` 배치에서 버튼과 패널 사이 가로 간격. */
const DD_LEFT_GAP = 6;

/** 포털 드롭다운 자리 — `React.CSSProperties` 에 그대로 펼친다. */
export interface DropdownPos {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  minWidth?: number;
  maxHeight: number;
}

/**
 * 드롭다운 자리. `'below'`: 아래가 모자라고 위가 넓으면 위로 뒤집는다. `'left'`: 왼쪽에 패널 폭이 없으면(폰·좁은 창) `'below'` 로 내린다.
 * `contentH` 는 `scrollHeight`(클램프 무관 — 재측정해도 안정). 미마운트면 `null` — 상한·최소 폭으로 가정하고 마운트 직후 다시 부른다.
 */
export function placePortalDropdown(
  btn: AnchorBox,
  contentH: number | null,
  panelW: number | null,
  vp: BoxSize,
  placement: 'below' | 'left',
): DropdownPos {
  const m = DD_VIEWPORT_MARGIN;
  const h0 = Math.min(contentH ?? DD_MAX_HEIGHT, DD_MAX_HEIGHT);

  if (placement === 'left' && btn.left - DD_LEFT_GAP - (panelW ?? DD_LEFT_MIN_WIDTH) >= m) {
    const h = Math.min(h0, vp.h - m * 2);
    // 기본은 버튼 아랫변에 맞춰 위로 자라되, 화면 위/아래를 넘으면 안으로 밀어 넣는다.
    const top = Math.min(Math.max(btn.bottom - h, m), vp.h - m - h);
    return { top, right: Math.max(m, vp.w - btn.left + DD_LEFT_GAP), maxHeight: h };
  }

  const spaceBelow = vp.h - btn.bottom - DD_GAP - m;
  const spaceAbove = btn.top - DD_GAP - m;
  const flipUp = h0 > spaceBelow && spaceAbove > spaceBelow;
  const left = clampSpan(btn.left, panelW ?? btn.width, vp.w, m);

  if (flipUp) {
    return {
      bottom: vp.h - btn.top + DD_GAP,
      left,
      minWidth: btn.width,
      maxHeight: Math.max(DD_MIN_HEIGHT, Math.min(h0, spaceAbove)),
    };
  }
  return {
    top: btn.bottom + DD_GAP,
    left,
    minWidth: btn.width,
    maxHeight: Math.max(DD_MIN_HEIGHT, Math.min(h0, spaceBelow)),
  };
}

/** 포인터 옆 작은 팝업 자리 — 비켜 앉히고 넘치면 `placeCanvasMenu` 규칙으로 접는다. `minTop` = 머리 띠 밑 바닥(화면이 더 낮으면 화면 안이 이긴다). */
export function placeNearPointer(
  pointer: { x: number; y: number },
  box: BoxSize,
  vp: BoxSize,
  opts: { offsetX?: number; offsetY?: number; minTop?: number } = {},
): { left: number; top: number } {
  const { offsetX = 12, offsetY = 0, minTop = 0 } = opts;
  return placeCanvasMenu(
    { x: pointer.x + offsetX, y: Math.max(pointer.y + offsetY, minTop) },
    { width: box.w, height: box.h },
    { left: 0, top: 0, width: vp.w, height: vp.h },
  );
}

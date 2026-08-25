// §5.5 #17-34 — "지금 손을 떼면 어디에 앉는가"의 순수 기하.
//
// 칸 위에서 커서가 어느 변(또는 가운데)에 있는지, 그리고 그 판정을 미리보기 박스로 어떻게 그릴지를
// 좌표만 받아 답한다(DOM ❌). 판정과 미리보기가 **같은 표**를 쓰는 것이 이 파일의 전부다 —
// 두 벌로 갈라 두면 파란 박스는 왼쪽을 가리키는데 실제로는 오른쪽에 붙는 상태가 생기고,
// 그것이 이 기능의 유일한 거짓말 방식이다(#17-1 도킹 미리보기가 배운 것과 같은 교훈).

import { IDE_SPLIT, type SplitAxis } from './splitLayout.js';

/** 칸 위에서 손을 뗄 수 있는 자리. 네 변 = 나누기, 가운데 = 그 칸의 내용 교체. */
export type SplitDropSide = 'left' | 'right' | 'top' | 'bottom' | 'center';

export const SPLIT_DROP = {
  /** 변으로 판정되는 띠의 두께(칸 길이 대비). 이보다 안쪽이면 가운데(=교체)다. */
  edgeBandRatio: 0.28,
  /** 칸이 아주 좁아도 변을 집을 수 있게 하는 하한(px). */
  minEdgeBandPx: 28,
  /** 띠가 칸을 다 먹어 가운데가 사라지지 않게 하는 상한(칸 길이 대비). */
  maxEdgeBandRatio: 0.4,
} as const;

export interface SplitRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 그 방향의 띠 두께(px) — 좁은 칸에서는 하한이, 넓은 칸에서는 비율이 이긴다. */
export function edgeBandPx(length: number): number {
  if (length <= 0) return 0;
  const byRatio = length * SPLIT_DROP.edgeBandRatio;
  return Math.min(Math.max(byRatio, SPLIT_DROP.minEdgeBandPx), length * SPLIT_DROP.maxEdgeBandRatio);
}

/** 커서가 칸의 어디에 있는가. 칸 밖 좌표도 안전하게 가장 가까운 변으로 떨어진다. */
export function resolveDropSide(rect: SplitRect, x: number, y: number): SplitDropSide {
  const bandX = edgeBandPx(rect.width);
  const bandY = edgeBandPx(rect.height);
  if (bandX <= 0 || bandY <= 0) return 'center';
  const dxLeft = x - rect.left;
  const dxRight = rect.left + rect.width - x;
  const dyTop = y - rect.top;
  const dyBottom = rect.top + rect.height - y;
  if (dxLeft >= bandX && dxRight >= bandX && dyTop >= bandY && dyBottom >= bandY) return 'center';
  // 가장 가까운 변 — 거리를 **띠 두께로 나눠** 재야 가로세로 길이가 크게 달라도 눈과 맞는다.
  const scored: Array<[SplitDropSide, number]> = [
    ['left', dxLeft / bandX],
    ['right', dxRight / bandX],
    ['top', dyTop / bandY],
    ['bottom', dyBottom / bandY],
  ];
  let best: SplitDropSide = 'center';
  let bestScore = Number.POSITIVE_INFINITY;
  for (const [side, score] of scored) {
    if (score < bestScore) { bestScore = score; best = side; }
  }
  return best;
}

/** 미리보기 박스 — 칸 안에서의 위치·크기(%). 판정과 같은 표를 읽는다. */
export interface DropPreviewBox {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

const PREVIEW_BOX: Record<SplitDropSide, DropPreviewBox> = {
  left: { leftPct: 0, topPct: 0, widthPct: 50, heightPct: 100 },
  right: { leftPct: 50, topPct: 0, widthPct: 50, heightPct: 100 },
  top: { leftPct: 0, topPct: 0, widthPct: 100, heightPct: 50 },
  bottom: { leftPct: 0, topPct: 50, widthPct: 100, heightPct: 50 },
  center: { leftPct: 0, topPct: 0, widthPct: 100, heightPct: 100 },
};

export function dropPreviewBox(side: SplitDropSide): DropPreviewBox {
  return PREVIEW_BOX[side];
}

/** 그 변이 만드는 가지의 방향. 가운데는 나누지 않으므로 `null`. */
export function dropAxis(side: SplitDropSide): SplitAxis | null {
  if (side === 'left' || side === 'right') return 'row';
  if (side === 'top' || side === 'bottom') return 'col';
  return null;
}

/** 손잡이를 끈 거리(px)를 비율 변화로. 컨테이너가 0 이면 움직이지 않는다. */
export function splitterDeltaRatio(containerLengthPx: number, movedPx: number): number {
  if (containerLengthPx <= 0) return 0;
  return movedPx / containerLengthPx;
}

// ─── 드래그 짐표 ───
// `dragover` 중에는 값을 읽을 수 없고 **종류(type)만** 보인다. 그래서 "지금 끌고 오는 것이 세션인가"는
// 전용 MIME 하나로 알아본다 — OS 파일 드래그(`Files`)·탭 순서 바꾸기(`text/plain`)와 섞이지 않게.

export const SESSION_DRAG_MIME = 'application/x-vibisual-session';
/** 칸 머리띠를 끌 때 함께 실리는 출처 칸 — 있으면 복제가 아니라 **옮기기**다. */
export const SPLIT_CELL_DRAG_MIME = 'application/x-vibisual-split-cell';
/** 메인 탭(세션 `null`)의 짐표 값. 빈 문자열은 "짐이 없다"와 구분이 안 돼 쓰지 않는다. */
export const MAIN_SESSION_DRAG_VALUE = '__main__';

export function encodeSessionDrag(sessionId: string | null): string {
  return sessionId ?? MAIN_SESSION_DRAG_VALUE;
}

/** 짐표 해독. 값이 없으면 `null`(= 우리 짐이 아니다). */
export function decodeSessionDrag(raw: string | null | undefined): { sessionId: string | null } | null {
  if (!raw) return null;
  return { sessionId: raw === MAIN_SESSION_DRAG_VALUE ? null : raw };
}

/** 지금 끌고 오는 것이 세션인가(`dragover` 에서 쓸 수 있는 유일한 단서). */
export function dragHasSession(types: readonly string[]): boolean {
  return types.includes(SESSION_DRAG_MIME);
}

/**
 * **누구의 세션인가**를 짐표의 *종류*에 새긴다 — 값은 손을 뗄 때까지 못 읽지만 종류는 `dragover`
 * 에서도 보이기 때문이다(창이 여럿일 때 옆 창 탭을 끌어오는 일이 실제로 생긴다).
 * MIME 은 소문자로 정규화되므로 에이전트 id 도 낮춰 싣는다.
 */
export function sessionOwnerMime(agentId: string): string {
  return `application/x-vibisual-session-owner-${agentId.toLowerCase()}`;
}

/** 끌고 오는 세션이 **이 창의 에이전트** 것인가. 소유자 표식이 아예 없으면(옛 짐표) 막지 않는다. */
export function dragOwnerMatches(types: readonly string[], agentId: string): boolean {
  const prefix = 'application/x-vibisual-session-owner-';
  if (!types.some((t) => t.startsWith(prefix))) return true;
  return types.includes(sessionOwnerMime(agentId));
}

/**
 * **어느 세션인가**도 짐표의 종류로 싣는다(소유자와 같은 수법).
 * 값을 못 읽는 `dragover` 단계에서 "이 칸이 이미 보여 주는 그 세션"인지 알아야, 아무 일도 일어나지
 * 않을 자리에 파란 박스를 띄우지 않는다 — 눌러도 안 되는 파란 박스는 사용자에게 고장으로 읽힌다.
 */
export function sessionIdMime(sessionId: string | null): string {
  return `application/x-vibisual-session-id-${encodeSessionDrag(sessionId).toLowerCase()}`;
}

/** 끌고 오는 것이 바로 그 세션인가. 표식이 없으면(옛 짐표) 아니라고 본다(막지 않는다). */
export function dragIsSession(types: readonly string[], sessionId: string | null): boolean {
  return types.includes(sessionIdMime(sessionId));
}

/** 떨굴 수 없는 이유. `null` 이면 떨굴 수 있다. */
export type SplitDropBlock = null | 'limit' | 'foreign' | 'tooSmall' | 'same';

/**
 * 이 크기의 칸을 그 변으로 갈라도 **양쪽이 읽히는가**. 비율 하한과 달리 실제 픽셀을 본다.
 * 가운데(교체)는 크기와 무관하다.
 */
export function fitsSplit(rect: SplitRect, side: SplitDropSide): boolean {
  if (side === 'center') return true;
  const horizontal = side === 'left' || side === 'right';
  const axisLen = horizontal ? rect.width : rect.height;
  const min = horizontal ? IDE_SPLIT.minCellWidthPx : IDE_SPLIT.minCellHeightPx;
  return axisLen >= min * 2 + IDE_SPLIT.splitterPx;
}

/**
 * 미리보기 박스에 적을 말 — **판정과 문구가 같은 표를 읽게** 한다.
 * 두 화면(칸 · 아직 안 나뉜 창)이 각자 문구를 고르면 같은 상황에서 다른 말을 하게 된다.
 */
export function splitDropLabelKey(side: SplitDropSide, blocked: SplitDropBlock): string {
  if (blocked === 'limit') return 'ide.split.limit';
  if (blocked === 'foreign') return 'ide.split.foreignSession';
  if (blocked === 'tooSmall') return 'ide.split.tooSmall';
  if (blocked === 'same') return 'ide.split.alreadyHere';
  return side === 'center' ? 'ide.split.previewReplace' : 'ide.split.previewSplit';
}

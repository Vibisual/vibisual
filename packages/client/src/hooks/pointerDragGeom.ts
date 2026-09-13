// §5.4 #14-2 / §5.5 #16-1 (E) — "꾹 눌러 집어 든다"의 순수 기하.
//
// `tabPushGeom` 이 **밀려나는 쪽**의 기하(어느 탭이 언제 비켜서나)를 갖는다면, 이 파일은
// **집어 드는 쪽**의 기하를 갖는다: 길게 누르기가 아직 살아 있는가, 커서 아래가 어느 칸인가,
// 가장자리에 닿아 목록이 흘러야 하는가. 전부 좌표만 받아 답하고 DOM 을 만지지 않는다
// (`floatingWindowGeom`·`tabPushGeom` 선례 — 실제 리스너·style 은 `usePointerDragReorder` 가 건다).
//
// 활동바(세로)와 두 탭바(가로)가 **같은 손맛**을 써야 하므로 판정은 축 중립이다 — 두 벌이 되면
// 한쪽만 고쳐져 "활동바는 되는데 탭바는 안 되는" 상태가 된다(§5.5 #16-1 (E) 가 세운 규율).

import type { PushAxis } from './tabPushGeom.js';

/** 꾹 누르기 손맛의 모든 수치 — 값 조정은 여기 한 곳(매직넘버 산개 ❌). */
export const POINTER_DRAG = {
  /** 길게 누르기로 판정하는 시간(ms). 이보다 짧게 떼면 평소대로 그 항목이 열린다. */
  longPressMs: 350,
  /**
   * 길게 누르기 전에 **그 줄이 스크롤되는 축으로** 이만큼 움직이면 누른 것이 아니라 목록을 끈 것이다.
   *
   * 직교축은 재지 않는다 — 활동바는 폭 48px 짜리 한 줄이라 가로로 할 일이 없고, 탭바는 높이 36px
   * 짜리 한 줄이라 세로로 할 일이 없다. 손 떨림까지 취소로 세면 꾹 누르기가 이유 없이 무산된다
   * (사용자 보고 "조금만 벗어나면 캔슬된다").
   */
  slopPx: 10,
  /** 끄는 동안 목록 가장자리 이 거리 안에 들어오면 목록이 따라 흐른다. */
  autoScrollEdgePx: 28,
  /** 한 프레임에 흐르는 양(px). 크면 손보다 목록이 앞서가 어디에 놓는지가 안 보인다. */
  autoScrollStepPx: 6,
} as const;

/** 줄에 늘어선 칸 하나의 자리 — 축 방향 시작 좌표와 길이(뷰포트 기준). */
export interface DragSlot {
  key: string;
  start: number;
  size: number;
}

/**
 * 길게 누르기가 아직 살아 있는가 — 축 방향으로 `slop` 을 넘겼으면 그건 스크롤이다.
 *
 * 넘긴 쪽을 취소로 읽는 것이 핵심이다. 반대로 직교축은 아무리 움직여도 살아 있어야 한다
 * (탭바에서 아래로 내리는 손짓은 **별창 분리**이고, 그건 끌기가 시작된 뒤의 이야기다).
 */
export function pressSurvivesMove(input: {
  axis: PushAxis;
  startX: number;
  startY: number;
  x: number;
  y: number;
  slopPx?: number;
}): boolean {
  const slop = input.slopPx ?? POINTER_DRAG.slopPx;
  const moved = input.axis === 'y' ? Math.abs(input.y - input.startY) : Math.abs(input.x - input.startX);
  return moved <= slop;
}

/**
 * 커서 아래가 어느 칸인가.
 *
 * 줄 밖으로 벗어났으면 **가장 가까운 끝 칸**을 겨눈 것으로 본다 — 맨 끝으로 보내는 손짓은 목록
 * 밖에서 끝나기 마련인데, 거기서 아무 일도 안 하면 끝자리에 못 놓는다. 칸 사이 틈(gap)에 커서가
 * 놓인 경우도 같은 이유로 가장 가까운 칸으로 떨어진다.
 */
export function slotAtPointer(slots: readonly DragSlot[], pointer: number): DragSlot | null {
  if (slots.length === 0) return null;
  const first = slots[0];
  const last = slots[slots.length - 1];
  if (!first || !last) return null;
  const hit = slots.find((s) => pointer >= s.start && pointer < s.start + s.size);
  if (hit) return hit;
  if (pointer < first.start) return first;
  if (pointer >= last.start + last.size) return last;
  // 칸 사이 틈 — 중심이 가장 가까운 칸으로.
  let best = first;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of slots) {
    const dist = Math.abs(pointer - (s.start + s.size / 2));
    if (dist < bestDist) { bestDist = dist; best = s; }
  }
  return best;
}

/** 가장자리에 닿았는가 — `-1` 앞으로, `0` 멈춤, `1` 뒤로. */
export function autoScrollDirection(input: {
  pointer: number;
  viewStart: number;
  viewEnd: number;
  edgePx?: number;
}): -1 | 0 | 1 {
  const edge = input.edgePx ?? POINTER_DRAG.autoScrollEdgePx;
  if (input.viewEnd - input.viewStart <= edge * 2) return 0;
  if (input.pointer < input.viewStart + edge) return -1;
  if (input.pointer > input.viewEnd - edge) return 1;
  return 0;
}

/**
 * 고스트를 놓을 자리 — 잡은 지점을 빼야 손 아래에서 순간이동하지 않고 "잡은 그 자리 그대로" 붙어 온다.
 * 반환은 `translate3d` 에 그대로 넣을 정수 픽셀(소수는 텍스트를 흐리게 만든다).
 */
export function ghostOffset(point: { x: number; y: number }, grab: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(point.x - grab.x), y: Math.round(point.y - grab.y) };
}

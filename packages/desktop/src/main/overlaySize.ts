// SCENARIO.md §5.5 #17-6 (H-19) — 창 크기는 장부가 답한다(창에 되묻지 않는다).
// Windows 분수 배율(125%·150%)에서 Electron 은 DIP↔물리 픽셀을 쓸 때·읽을 때 따로 반올림한다 — `setPosition()` 은 부를 때마다 1px, `getBounds()` 값을 되쓰면 2px 자란다(실측 150%: 40번에 +40px, 16ms 폴링이면 초당 60px).
// 규칙: 우리가 정한 크기(DIP)를 장부에 두고 창에는 늘 그 값을 쓴다 — 돌아온 크기는 반올림 메아리라 넣지 않되, 사람이 창틀로 늘린 크기는 받는다.
// 좌표·크기는 화면의 배율 격자에 맞춘다(격자 밖 좌표는 물리 폭을 흔든다 — 실측 40번 이동에 `resize` 39회, 격자 위 0회).
// `scaleFactor` 가 인자라 세 OS 배율(win 125/150/175% · mac 2× · linux 1×/Wayland 분수)을 단위 시험으로 고정한다.

export interface OverlaySize {
  width: number;
  height: number;
}

/**
 * 크기를 쓴 뒤 이만큼(ms) 안에 오는 `resize` 는 그 쓰기의 메아리로 본다.
 * Windows 는 `setBounds` 안에서 동기로 내지만 mac·linux 는 한 틱 뒤에 오기도 한다. 창틀을 잡아 늘리는 손은 이보다 훨씬 길다.
 */
export const OVERLAY_SIZE_ECHO_MS = 250;

/**
 * 장부와 이만큼(px) 안에서만 다른 크기는 메아리로 본다 — 시간 그물이 늦게 온 메아리를 놓쳐도
 * 배율 반올림(±1~2px)은 이 거리 안이다. 사람은 3px 을 늘리려고 창틀을 잡지 않는다.
 */
export const OVERLAY_SIZE_ECHO_PX = 3;

/** 격자를 찾는 상한 — 이보다 성긴 격자(110% 같은 드문 배율)는 좌표를 눈에 띄게 뭉개므로 쓰지 않는다. */
const DIP_STEP_MAX = 8;

/**
 * 이 배율에서 물리 픽셀이 정수가 되는 DIP 배수 — 150% 는 2, 125%·175% 는 4, 정수 배율은 1.
 * 격자를 못 찾거나(110% → 10) 값이 이상하면 1 — 흔들림은 남지만 자라지는 않는다(자람은 "되묻지 않는다"가 막는다).
 */
export function dipStepFor(scaleFactor: number): number {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return 1;
  for (let k = 1; k <= DIP_STEP_MAX; k += 1) {
    const phys = k * scaleFactor;
    if (Math.abs(phys - Math.round(phys)) < 1e-6) return k;
  }
  return 1;
}

/** 값을 격자에 맞춘다 — 가장 가까운 배수로(격자 1 이면 반올림뿐). */
export function snapDip(value: number, step: number): number {
  const k = Number.isFinite(step) && step >= 1 ? Math.round(step) : 1;
  return Math.round(value / k) * k;
}

/**
 * 창을 옮길 때 쓸 사각형 — 자리는 새 값, 크기는 장부 값. 둘 다 격자에 맞춘다.
 * 창이 돌려준 크기를 넣지 마라 — 배율 반올림이 섞여 되쓸 때마다 자란다.
 */
export function movedBounds(
  ledger: OverlaySize,
  x: number,
  y: number,
  step = 1,
): { x: number; y: number; width: number; height: number } {
  return {
    x: snapDip(x, step),
    y: snapDip(y, step),
    width: snapDip(ledger.width, step),
    height: snapDip(ledger.height, step),
  };
}

/**
 * §5.5 #17-27 ①-1 — 넓힌 가로 자리를 창이 실제로 앉는 값(격자에 맞춘 x, `movedBounds`)으로 기억한다.
 * 계산한 x 면 되돌릴 때 최대 2px(125·175%) 어긋나 "사용자가 옮겼다"로 읽혀(`shrinkSpanBack` 여유 1px) 창이 제자리로 못 돌아간다.
 * 폭은 장부(`entry.size`)와 대조하므로 그대로 둔다.
 */
export function landedSpan(span: { x: number; w: number }, step: number): { x: number; w: number } {
  return { x: snapDip(span.x, step), w: span.w };
}

/**
 * 창이 알려 온 크기(`resize`)를 장부에 받아들일 것인가.
 * @returns 받아들일 크기, 또는 `null`(장부 유지). 무시: 끄는 중(`following` — 그동안 크기를 쓰는 이는 우리뿐) ·
 *   `OVERLAY_SIZE_ECHO_MS` 안의 메아리 · 장부와 `OVERLAY_SIZE_ECHO_PX` 안의 차이(늦은 메아리). 그 밖(창틀을 잡아 늘림)은 받는다.
 */
export function acceptReportedSize(input: {
  ledger: OverlaySize;
  /** 우리가 마지막으로 크기를 쓴 시각(ms). */
  writtenAt: number;
  reported: OverlaySize;
  now: number;
  following: boolean;
}): OverlaySize | null {
  if (input.following) return null;
  if (input.now - input.writtenAt < OVERLAY_SIZE_ECHO_MS) return null;
  const width = Math.round(input.reported.width);
  const height = Math.round(input.reported.height);
  if (!(width > 0) || !(height > 0)) return null;
  if (Math.abs(width - input.ledger.width) <= OVERLAY_SIZE_ECHO_PX
    && Math.abs(height - input.ledger.height) <= OVERLAY_SIZE_ECHO_PX) return null;
  return { width, height };
}

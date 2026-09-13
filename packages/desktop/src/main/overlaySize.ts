// SCENARIO.md §5.5 #17-6 (H-19) — **창 크기는 장부가 답한다(창에 되묻지 않는다).**
//
// Windows 의 분수 배율(125%·150%)에서 Electron 창은 DIP ↔ 물리 픽셀 변환을 **쓸 때와 읽을 때
// 따로** 반올림한다. 그래서 `setPosition()`(크기를 창에 되물어 다시 쓴다)을 한 번 부를 때마다
// 폭이 1px 자라고, `getBounds()` 로 읽은 크기를 그대로 되쓰면 2px 자란다(실측 — 150% 에서
// 40번 호출에 +40px). 커서 폴링은 16ms 마다 창을 옮기므로, 끄는 1초마다 60px 씩 창이 저절로
// 커졌다(사용자 보고 — "창이 마음대로 계속 조금씩 커짐").
//
// 규칙은 하나다: **우리가 정한 크기(DIP)를 장부에 적어 두고, 창에는 늘 그 값을 쓴다.** 창이
// 되돌려 주는 크기는 반올림 메아리라 장부에 넣지 않는다 — 단 **사용자가 창틀을 잡아 늘린**
// 크기는 받아들여야 한다. 그 둘을 가르는 것이 이 파일이다.
//
// 좌표도 마찬가지다. 배율 격자를 벗어난 좌표(150% 에서 홀수 px)는 물리 픽셀 폭을 1px 씩 흔들어
// 렌더러가 틱마다 창을 다시 놓는다(실측 — 격자 밖 40번 이동에 `resize` 39회, 격자 위 0회).
// 그래서 좌표·크기를 그 화면의 격자에 맞춰 쓴다.
//
// electron 에 붙어 있지 않다 — `scaleFactor` 를 **인자로 받으므로** Windows 개발기에서 세 OS 의
// 배율(win 125/150/175% · mac Retina 2× · linux 1×/Wayland 분수)을 단위 테스트로 함께 고정한다.

export interface OverlaySize {
  width: number;
  height: number;
}

/**
 * 우리가 크기를 쓴 뒤 이만큼 안에 오는 `resize` 는 **그 쓰기의 메아리**로 본다(ms).
 *
 * Windows 는 `setBounds` 안에서 동기로 `resize` 를 내지만 mac·linux 는 한 틱 뒤에 오기도 한다.
 * 사람이 창틀을 잡아 늘리는 손은 이보다 훨씬 오래 걸리므로 그 손을 놓칠 일은 없다.
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
 * 이 배율에서 **물리 픽셀이 정수가 되는 DIP 배수** — 150% 는 2, 125%·175% 는 4, 정수 배율은 1.
 *
 * 격자를 못 찾거나(110% → 10) 값이 이상하면 1 — 흔들림은 남지만 창이 자라지는 않는다(자람은
 * 격자가 아니라 "되묻지 않는다"가 막는다).
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
 * 창을 옮길 때 쓸 사각형 — 자리는 새 값, 크기는 **장부 값**(창에 되묻지 않는다). 둘 다 격자에 맞춘다.
 *
 * 창이 되돌려 주는 크기를 이 사각형에 넣지 않는 것이 규칙의 전부다 — 그 값에는 배율 반올림이
 * 섞여 있어 되쓸 때마다 자란다.
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
 * 창이 알려 온 크기(`resize`)를 장부에 받아들일 것인가.
 *
 * @returns 받아들일 크기, 또는 `null`(장부를 그대로 둔다).
 *   - 끌고 있는 중(`following` — 커서 폴링·칩 드래그)이면 무시: 그동안 크기를 쓰는 이는 우리뿐이다.
 *   - 우리가 방금(`OVERLAY_SIZE_ECHO_MS` 안) 쓴 크기의 메아리면 무시.
 *   - 장부와 `OVERLAY_SIZE_ECHO_PX` 안에서만 다르면 무시(늦게 온 메아리).
 *   - 그 밖(사용자가 창틀을 잡아 늘렸다)이면 받아들인다.
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

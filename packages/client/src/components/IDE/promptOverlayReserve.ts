/**
 * 제안 프롬프트 상자(§4 `PromptBox`) 우상단 오버레이(복사·즉시 전송)가 먹는 폭. 번역 라벨·전송 뒤 라벨 교체·글꼴 로드·글자 크기로 폭이 흔들려
 * 상수(`pr-20`)로는 못 맞춘다 — 실측값으로 비울 픽셀을 정하는 규칙만 여기 둔다.
 */

/** 버튼 묶음과 글자 사이 숨 쉴 틈(px) — 오버레이의 `right-1.5`(6px) + 글자가 버튼에 닿지 않을 여백. */
export const PROMPT_OVERLAY_GAP_PX = 12;

/** 실측 전 첫 프레임 · `ResizeObserver` 없는 환경에서 쓰는 임시 예약(px). 종전 `pr-20` 과 같은 값. */
export const PROMPT_RESERVE_FALLBACK_PX = 80;

/** 예약 상한(상자 폭 대비) — 버튼 묶음이 상자보다 넓은 좁은 창에서 그대로 비우면 `break-words` 가 글자를 한 줄에 하나씩 세운다. */
const RESERVE_MAX_RATIO = 0.65;

/**
 * 실측 폭 → 비울 픽셀. `overlayWidth` 가 0(마운트 직전)·비유한이면 고정값(0 이면 첫 프레임에 글자가 버튼 밑에 깔렸다 튄다).
 * 올림해 0.4px 물림을 막는다. `boxWidth` 를 모르면 상한 없이.
 */
export function promptOverlayReserve(overlayWidth: number, boxWidth: number): number {
  if (!Number.isFinite(overlayWidth) || overlayWidth <= 0) return PROMPT_RESERVE_FALLBACK_PX;
  const want = Math.ceil(overlayWidth + PROMPT_OVERLAY_GAP_PX);
  if (!Number.isFinite(boxWidth) || boxWidth <= 0) return want;
  return Math.max(0, Math.min(want, Math.floor(boxWidth * RESERVE_MAX_RATIO)));
}

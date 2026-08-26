/**
 * 제안 프롬프트 상자(§4 v2.60 `PromptBox`) 우상단 오버레이가 먹는 폭 계산.
 *
 * 그 상자는 `<pre>` 위에 복사 버튼 + 즉시 전송 버튼을 절대 배치로 띄운다. 종전엔 본문이 비켜 갈 자리를
 * `pr-20`(80px) 상수로 잡았는데, 즉시 전송 버튼에는 **번역되는 글자 라벨**이 붙는다("즉시 전송" /
 * "Send now" / "Envoyer maintenant" / "भेज दिया गया" …). 라벨이 길수록 버튼 묶음이 넓어져 80px 을
 * 넘고, 그만큼 프롬프트 첫 줄이 버튼 밑으로 파고들어 글자가 가려졌다.
 *
 * 폭을 바꾸는 것이 언어만도 아니다 — 전송 뒤 라벨 교체(`즉시 전송`→`전송됨`), 글꼴 뒤늦은 로드,
 * 사용자 글자 크기까지 전부 폭을 흔든다. **상수로는 맞출 수 없고 실측만이 맞다.** 그 실측값을 받아
 * 실제로 비울 픽셀을 정하는 규칙만 여기 순수 함수로 둔다(DOM 없이 그대로 단위 테스트).
 */

/** 버튼 묶음과 글자 사이 숨 쉴 틈(px) — 오버레이의 `right-1.5`(6px) + 글자가 버튼에 닿지 않을 여백. */
export const PROMPT_OVERLAY_GAP_PX = 12;

/** 실측 전 첫 프레임 · `ResizeObserver` 없는 환경에서 쓰는 임시 예약(px). 종전 `pr-20` 과 같은 값. */
export const PROMPT_RESERVE_FALLBACK_PX = 80;

/**
 * 예약 상한 — 상자 폭의 이 비율까지만.
 *
 * 좁은 창(IDE 를 잘게 나눠 쓰는 사람)에서는 버튼 묶음이 상자보다 넓어질 수 있는데, 그때 실측값을
 * 그대로 비우면 본문 폭이 0 이 되어 `break-words` 가 글자를 **한 줄에 하나씩** 세로로 세운다.
 * 가려지는 것보다 나쁜 그림이라 상한을 둔다.
 */
const RESERVE_MAX_RATIO = 0.65;

/**
 * 오버레이 실측 폭(`overlayWidth`)과 상자 실측 폭(`boxWidth`)으로 `<pre>` 오른쪽에 비울 픽셀을 정한다.
 *
 * - `overlayWidth` 가 아직 0(마운트 직전)이거나 유한하지 않으면 예전 고정값으로 물러난다 —
 *   0 으로 접어 버리면 첫 프레임에 글자가 버튼 밑에 깔렸다가 튀는 게 보인다.
 * - 올림(`ceil`)한다. 0.4px 이 남아 글자 획 끝이 버튼에 물리는 것을 막는다.
 * - `boxWidth` 를 모르면(0/비유한 — 아직 레이아웃 전) 상한 없이 실측값을 그대로 쓴다.
 */
export function promptOverlayReserve(overlayWidth: number, boxWidth: number): number {
  if (!Number.isFinite(overlayWidth) || overlayWidth <= 0) return PROMPT_RESERVE_FALLBACK_PX;
  const want = Math.ceil(overlayWidth + PROMPT_OVERLAY_GAP_PX);
  if (!Number.isFinite(boxWidth) || boxWidth <= 0) return want;
  return Math.max(0, Math.min(want, Math.floor(boxWidth * RESERVE_MAX_RATIO)));
}

/**
 * 제안 프롬프트 상자의 오른쪽 예약 폭 — 버튼 묶음이 넓어져도 글자가 그 밑으로 파고들지 않는지.
 *
 * 이 값이 실측보다 작으면 프롬프트 첫 줄이 "복사 / 즉시 전송" 버튼에 가려진다(고정 `pr-20`=80px 이
 * 정확히 그랬다 — 한국어 라벨에서도 넘쳤고, 라벨이 더 긴 로케일은 더 크게 넘쳤다). 반대로 좁은 창에서
 * 상한 없이 비우면 본문 폭이 0 이 되어 글자가 세로로 선다. 두 실패를 여기서 못 박는다.
 */
import { describe, it, expect } from 'vitest';
import {
  promptOverlayReserve,
  PROMPT_OVERLAY_GAP_PX,
  PROMPT_RESERVE_FALLBACK_PX,
} from './promptOverlayReserve.js';

describe('promptOverlayReserve', () => {
  it('실측 폭 + 여백을 비운다', () => {
    expect(promptOverlayReserve(96, 800)).toBe(96 + PROMPT_OVERLAY_GAP_PX);
  });

  it('라벨이 긴 로케일(버튼 묶음이 넓어진 경우) 종전 고정값 80px 보다 크게 비운다', () => {
    // "Envoyer maintenant" 처럼 라벨이 길면 묶음이 140px 을 넘는다.
    expect(promptOverlayReserve(148, 900)).toBeGreaterThan(80);
  });

  it('한국어 라벨(즉시 전송) 실측 폭에서도 고정 80px 로는 모자랐음을 고정한다', () => {
    // 아이콘 버튼(≈26) + gap(4) + 번개+"즉시 전송"(≈70) ≈ 100px.
    expect(promptOverlayReserve(100, 900)).toBeGreaterThan(80);
  });

  it('소수점 실측은 올려서 글자 획이 버튼에 물리지 않게 한다', () => {
    expect(promptOverlayReserve(96.2, 800)).toBe(Math.ceil(96.2 + PROMPT_OVERLAY_GAP_PX));
  });

  it('좁은 상자에서는 상한(상자 폭의 65%)을 넘지 않는다', () => {
    expect(promptOverlayReserve(200, 220)).toBe(Math.floor(220 * 0.65));
  });

  it('상한이 걸려도 본문 폭이 남는다', () => {
    const boxW = 180;
    expect(promptOverlayReserve(400, boxW)).toBeLessThan(boxW);
  });

  it('아직 측정 전(0)이면 예전 고정값으로 물러난다', () => {
    expect(promptOverlayReserve(0, 800)).toBe(PROMPT_RESERVE_FALLBACK_PX);
  });

  it('음수·NaN 실측도 고정값으로 물러난다', () => {
    expect(promptOverlayReserve(-5, 800)).toBe(PROMPT_RESERVE_FALLBACK_PX);
    expect(promptOverlayReserve(Number.NaN, 800)).toBe(PROMPT_RESERVE_FALLBACK_PX);
  });

  it('상자 폭을 모르면 상한 없이 실측값을 쓴다', () => {
    expect(promptOverlayReserve(300, 0)).toBe(300 + PROMPT_OVERLAY_GAP_PX);
    expect(promptOverlayReserve(300, Number.NaN)).toBe(300 + PROMPT_OVERLAY_GAP_PX);
  });
});

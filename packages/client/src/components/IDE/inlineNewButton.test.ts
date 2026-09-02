import { describe, it, expect } from 'vitest';
import { shouldShowInlineNew, INLINE_NEW_WIDTH, INLINE_NEW_MIN_GAP } from './inlineNewButton.js';

/**
 * §5.5 #17-40 — 인라인 `+`(새 세션) 노출 판정 회귀.
 *
 * 고정하는 약속: 마지막 탭 오른쪽에 **버튼 폭 + 최소 간격**이 남을 때만 인라인 `+` 가 뜬다.
 * 이게 어긋나면 세션이 늘었을 때 같은 `+` 가 나란히 두 개 찍힌다.
 */

// 스크롤 영역 400px 기준 — 인라인 `+` 가 뜨려면 탭이 400-32-24=344px 안에서 끝나야 한다.
const WIDTH = 400;
const LIMIT = WIDTH - INLINE_NEW_WIDTH - INLINE_NEW_MIN_GAP;

describe('shouldShowInlineNew — 탭이 꽉 차면 인라인 + 는 물러난다', () => {
  it('탭이 없으면 보인다', () => {
    expect(shouldShowInlineNew(0, WIDTH)).toBe(true);
  });

  it('탭이 여유롭게 끝나면 보인다', () => {
    expect(shouldShowInlineNew(150, WIDTH)).toBe(true);
  });

  it('버튼 + 최소 간격이 딱 남는 자리까지는 보인다', () => {
    expect(shouldShowInlineNew(LIMIT, WIDTH)).toBe(true);
  });

  it('1px 이라도 모자라면 숨는다 — 그때부터 오른쪽 + 와 붙어 보인다', () => {
    expect(shouldShowInlineNew(LIMIT + 1, WIDTH)).toBe(false);
  });

  it('탭이 폭을 다 먹으면 숨는다', () => {
    expect(shouldShowInlineNew(WIDTH, WIDTH)).toBe(false);
  });

  it('탭이 넘쳐 스크롤이 생긴 경우도 숨는다 — 끝까지 밀면 고정 + 에 맞닿는다', () => {
    expect(shouldShowInlineNew(1200, WIDTH)).toBe(false);
  });

  it('아직 폭을 재지 못한 순간(0)에는 화면을 건드리지 않는다', () => {
    expect(shouldShowInlineNew(0, 0)).toBe(true);
    expect(shouldShowInlineNew(1200, 0)).toBe(true);
  });

  it('자기 폭을 세지 않는다 — 같은 탭 배치면 답이 하나로 고정된다(진동 방지)', () => {
    // 숨긴 뒤 다시 재도(탭 좌표는 그대로) 판정이 뒤집히지 않아야 한다.
    const first = shouldShowInlineNew(LIMIT + 10, WIDTH);
    const second = shouldShowInlineNew(LIMIT + 10, WIDTH);
    expect(first).toBe(false);
    expect(second).toBe(first);
  });

  it('버튼 폭·간격을 바꿔 부르면 그 값으로 판정한다', () => {
    expect(shouldShowInlineNew(300, WIDTH, 32, 0)).toBe(true);
    expect(shouldShowInlineNew(300, WIDTH, 32, 80)).toBe(false);
  });
});

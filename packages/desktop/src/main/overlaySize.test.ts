/**
 * overlaySize.test.ts — §5.5 #17-6 (H-19) **창 크기는 장부가 답한다.**
 *
 * 분수 배율에서 창이 저절로 자라던 원인은 "창에 크기를 되묻는 것"이었다. 이 파일은 그 규칙을
 * 지키는 순수 함수 넷을 세 OS 의 배율 값으로 한꺼번에 고정한다(`scaleFactor` 가 인자다).
 */
import { describe, expect, it } from 'vitest';
import {
  OVERLAY_SIZE_ECHO_MS,
  OVERLAY_SIZE_ECHO_PX,
  acceptReportedSize,
  dipStepFor,
  movedBounds,
  snapDip,
} from './overlaySize';

describe('dipStepFor — 물리 픽셀이 정수가 되는 DIP 배수', () => {
  it('정수 배율(win 100% · mac Retina 2× · linux 1×)은 격자가 1 이다', () => {
    expect(dipStepFor(1)).toBe(1);
    expect(dipStepFor(2)).toBe(1);
    expect(dipStepFor(3)).toBe(1);
  });

  it('150% 는 2, 125%·175% 는 4 — Windows 에서 흔한 세 배율', () => {
    expect(dipStepFor(1.5)).toBe(2);
    expect(dipStepFor(1.25)).toBe(4);
    expect(dipStepFor(1.75)).toBe(4);
  });

  it('격자가 너무 성긴 배율(110% → 10)과 이상한 값은 1 로 떨어진다 — 자람은 격자가 막는 것이 아니다', () => {
    expect(dipStepFor(1.1)).toBe(1);
    expect(dipStepFor(0)).toBe(1);
    expect(dipStepFor(-1.5)).toBe(1);
    expect(dipStepFor(Number.NaN)).toBe(1);
  });
});

describe('snapDip — 가장 가까운 격자 배수', () => {
  it('격자 2 에서 홀수는 짝수로 간다(150% 에서 홀수 px 은 물리 픽셀을 흔든다)', () => {
    expect(snapDip(841, 2)).toBe(842);
    expect(snapDip(840, 2)).toBe(840);
    expect(snapDip(123.4, 2)).toBe(124);
  });

  it('격자 1 은 반올림뿐이고, 이상한 격자는 1 로 본다', () => {
    expect(snapDip(120.6, 1)).toBe(121);
    expect(snapDip(121, 0)).toBe(121);
    expect(snapDip(121, Number.NaN)).toBe(121);
  });
});

describe('movedBounds — 자리는 새 값, 크기는 장부 값', () => {
  it('크기는 장부에서 오고 창이 알려 준 값은 끼어들 자리가 없다', () => {
    const b = movedBounds({ width: 840, height: 600 }, 123, 77, 2);
    expect(b).toEqual({ x: 124, y: 78, width: 840, height: 600 });
  });

  it('격자 밖 장부 크기도 격자에 맞춰 쓴다 — 홀수 폭은 그 창이 되돌려 주는 값을 매번 바꾼다', () => {
    expect(movedBounds({ width: 845, height: 601 }, 0, 0, 2)).toEqual({ x: 0, y: 0, width: 846, height: 602 });
  });

  it('격자를 안 주면 반올림뿐이다', () => {
    expect(movedBounds({ width: 845, height: 601 }, 10.4, 20.6)).toEqual({ x: 10, y: 21, width: 845, height: 601 });
  });
});

describe('acceptReportedSize — 사용자 리사이즈만 장부에 받는다', () => {
  const ledger = { width: 840, height: 600 };

  it('끌고 있는 중에는 무엇이 와도 무시한다 — 그동안 쓰는 이는 우리뿐이다', () => {
    expect(acceptReportedSize({ ledger, writtenAt: 0, reported: { width: 900, height: 650 }, now: 10_000, following: true })).toBeNull();
  });

  it('방금 쓴 크기의 메아리(시간 그물)는 무시한다', () => {
    expect(acceptReportedSize({ ledger, writtenAt: 1000, reported: { width: 842, height: 602 }, now: 1000 + OVERLAY_SIZE_ECHO_MS - 1, following: false })).toBeNull();
  });

  it('늦게 온 메아리(거리 그물)도 무시한다 — 배율 반올림은 ±1~2px 이다', () => {
    expect(acceptReportedSize({ ledger, writtenAt: 0, reported: { width: 840 + OVERLAY_SIZE_ECHO_PX, height: 600 - OVERLAY_SIZE_ECHO_PX }, now: 10_000, following: false })).toBeNull();
    expect(acceptReportedSize({ ledger, writtenAt: 0, reported: ledger, now: 10_000, following: false })).toBeNull();
  });

  it('사용자가 창틀을 잡아 늘린 크기는 받아들인다', () => {
    expect(acceptReportedSize({ ledger, writtenAt: 0, reported: { width: 900, height: 650 }, now: 10_000, following: false }))
      .toEqual({ width: 900, height: 650 });
  });

  it('0·음수·NaN 은 받지 않는다 — 장부가 무너지면 창이 사라진다', () => {
    expect(acceptReportedSize({ ledger, writtenAt: 0, reported: { width: 0, height: 650 }, now: 10_000, following: false })).toBeNull();
    expect(acceptReportedSize({ ledger, writtenAt: 0, reported: { width: Number.NaN, height: 650 }, now: 10_000, following: false })).toBeNull();
  });
});

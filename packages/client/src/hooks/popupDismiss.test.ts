import { describe, it, expect } from 'vitest';
import {
  createInsideGestureLatch,
  isPointWithinViewport,
  shouldDismissOnBackdropRelease,
  shouldDismissOnOutsidePress,
} from './popupDismiss.js';

// 팝업 닫기 판정은 DOM 없이 검증한다(뷰포트를 인자로 받는 순수 함수).

const viewport = { w: 1920, h: 1080 };

describe('isPointWithinViewport', () => {
  it('창 안에서 뗀 지점은 안으로 본다', () => {
    expect(isPointWithinViewport({ x: 10, y: 10 }, viewport)).toBe(true);
    expect(isPointWithinViewport({ x: 0, y: 0 }, viewport)).toBe(true);
    expect(isPointWithinViewport({ x: 1920, y: 1080 }, viewport)).toBe(true);
  });

  it('창 밖까지 끌고 나간 좌표(음수·초과)는 밖으로 본다', () => {
    expect(isPointWithinViewport({ x: -5, y: 400 }, viewport)).toBe(false);
    expect(isPointWithinViewport({ x: 400, y: -1 }, viewport)).toBe(false);
    expect(isPointWithinViewport({ x: 2400, y: 400 }, viewport)).toBe(false);
    expect(isPointWithinViewport({ x: 400, y: 1200 }, viewport)).toBe(false);
  });
});

describe('shouldDismissOnBackdropRelease', () => {
  it('백드롭에서 누르고 백드롭에서 떼면 닫는다', () => {
    expect(shouldDismissOnBackdropRelease({
      pressedOnBackdrop: true, releasedOnBackdrop: true, releaseWithinViewport: true,
    })).toBe(true);
  });

  it('패널 안에서 시작한 드래그는 백드롭에서 끝나도 닫지 않는다', () => {
    // click 은 두 지점의 공통 조상(=백드롭)에 오지만, 누르기 시작한 곳이 패널이면 닫기 사유가 아니다.
    expect(shouldDismissOnBackdropRelease({
      pressedOnBackdrop: false, releasedOnBackdrop: true, releaseWithinViewport: true,
    })).toBe(false);
  });

  it('백드롭에서 눌렀어도 화면 밖에서 뗐으면 닫지 않는다', () => {
    expect(shouldDismissOnBackdropRelease({
      pressedOnBackdrop: true, releasedOnBackdrop: true, releaseWithinViewport: false,
    })).toBe(false);
  });

  it('백드롭에서 눌러 패널 위에서 떼면 닫지 않는다', () => {
    expect(shouldDismissOnBackdropRelease({
      pressedOnBackdrop: true, releasedOnBackdrop: false, releaseWithinViewport: true,
    })).toBe(false);
  });
});

describe('shouldDismissOnOutsidePress', () => {
  it('팝업 밖을 누르면 닫는다', () => {
    expect(shouldDismissOnOutsidePress({ insidePopup: false, withinViewport: true }, false)).toBe(true);
  });

  it('팝업 안을 누르면 닫지 않는다', () => {
    expect(shouldDismissOnOutsidePress({ insidePopup: true, withinViewport: true }, false)).toBe(false);
  });

  it('화면 밖 좌표에서 온 press 는 닫기 사유가 아니다', () => {
    expect(shouldDismissOnOutsidePress({ insidePopup: false, withinViewport: false }, false)).toBe(false);
  });

  it('팝업 안에서 시작한 제스처가 아직 안 끝났으면 바깥 press 를 무시한다', () => {
    expect(shouldDismissOnOutsidePress({ insidePopup: false, withinViewport: true }, true)).toBe(false);
  });
});

describe('createInsideGestureLatch', () => {
  it('안에서 누른 뒤 떼기 전에 오는 바깥 press 는 닫지 않는다', () => {
    const latch = createInsideGestureLatch();
    expect(latch.press({ insidePopup: true, withinViewport: true })).toBe(false);
    expect(latch.isHeld()).toBe(true);
    // 창 밖으로 끌고 나갔다가 돌아오며 합성된 press
    expect(latch.press({ insidePopup: false, withinViewport: true })).toBe(false);
  });

  it('손을 뗀 뒤의 바깥 press 는 정상적으로 닫는다', () => {
    const latch = createInsideGestureLatch();
    latch.press({ insidePopup: true, withinViewport: true });
    latch.release();
    expect(latch.isHeld()).toBe(false);
    expect(latch.press({ insidePopup: false, withinViewport: true })).toBe(true);
  });

  it('바깥에서 시작한 제스처는 래치를 잠그지 않는다', () => {
    const latch = createInsideGestureLatch();
    expect(latch.press({ insidePopup: false, withinViewport: true })).toBe(true);
    expect(latch.isHeld()).toBe(false);
  });
});

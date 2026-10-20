import { describe, it, expect, vi } from 'vitest';
import { MENU_VIEWPORT_MARGIN } from '../BubbleMap/canvasMenuPlacement.js';
import { followVisibleViewport, placeBelowAnchor, viewportMaxHeight, visibleViewport } from './popupPlacement.js';

/**
 * 떠 있는 상자 자리 회귀 — 폰에서 가상 키보드가 올라온 화면(시각 뷰포트만 준다)에서도 상자가 **보이는 화면 안**에
 * 서야 한다. 종전에는 `innerHeight` 로 접어 키보드 밑에 깔렸다.
 */

const desktop = { left: 0, top: 0, width: 1280, height: 800 };
/** 폰 세로 화면에 키보드가 올라와 아래 절반이 가려진 상태. */
const phoneWithKeyboard = { left: 0, top: 0, width: 390, height: 420 };

describe('visibleViewport — 보이는 화면을 읽는다', () => {
  it('시각 뷰포트가 있으면 그 값(키보드가 줄인 높이·핀치 이동)을 쓴다', () => {
    const v = visibleViewport({
      innerWidth: 390, innerHeight: 844,
      visualViewport: { offsetLeft: 12, offsetTop: 30, width: 300, height: 420 },
    });
    expect(v).toEqual({ left: 12, top: 30, width: 300, height: 420 });
  });

  it('없으면 창 크기로 폴백한다', () => {
    expect(visibleViewport({ innerWidth: 1280, innerHeight: 800, visualViewport: null })).toEqual(desktop);
  });

  it('상자 최대 높이는 위아래 여백을 뺀 값 — 음수가 되지 않는다', () => {
    expect(viewportMaxHeight(phoneWithKeyboard)).toBe(420 - MENU_VIEWPORT_MARGIN * 2);
    expect(viewportMaxHeight({ ...desktop, height: 4 })).toBe(0);
  });
});

describe('placeBelowAnchor — 글자 바로 아래, 모자라면 위로', () => {
  const size = { width: 300, height: 80 };

  it('자리가 있으면 앵커 바로 아래 · 앵커 왼쪽에 선다(넓은 화면은 종전과 같다)', () => {
    expect(placeBelowAnchor({ left: 200, top: 100, bottom: 120 }, size, desktop, 6)).toEqual({ left: 200, top: 126 });
  });

  it('아래가 키보드에 가리면 위로 뒤집는다', () => {
    const pos = placeBelowAnchor({ left: 20, top: 380, bottom: 400 }, size, phoneWithKeyboard, 6);
    expect(pos.top).toBe(380 - 80 - 6);
  });

  it('위도 모자라면 화면 위끝 여백에 붙는다(화면 밖으로 나가지 않는다)', () => {
    const pos = placeBelowAnchor({ left: 20, top: 40, bottom: 60 }, { width: 300, height: 400 }, phoneWithKeyboard, 6);
    expect(pos.top).toBe(MENU_VIEWPORT_MARGIN);
  });

  it('오른쪽 끝의 앵커는 화면 안으로 접힌다 — 폰 폭보다 넓은 상자는 왼쪽 여백에서 시작한다', () => {
    expect(placeBelowAnchor({ left: 350, top: 100, bottom: 120 }, size, phoneWithKeyboard, 6).left)
      .toBe(390 - MENU_VIEWPORT_MARGIN - 300);
    expect(placeBelowAnchor({ left: 350, top: 100, bottom: 120 }, { width: 500, height: 80 }, phoneWithKeyboard, 6).left)
      .toBe(MENU_VIEWPORT_MARGIN);
  });

  it('핀치로 옮겨 간 화면에서는 그 화면의 끝을 기준으로 접는다', () => {
    const pinched = { left: 100, top: 200, width: 300, height: 400 };
    const pos = placeBelowAnchor({ left: 0, top: 0, bottom: 10 }, size, pinched, 6);
    expect(pos.left).toBe(100 + MENU_VIEWPORT_MARGIN);
    expect(pos.top).toBe(200 + MENU_VIEWPORT_MARGIN);
  });
});

describe('followVisibleViewport — 화면이 바뀌면 다시 맞춘다', () => {
  function fakeWindow() {
    const visual = new EventTarget();
    const win = Object.assign(new EventTarget(), { visualViewport: visual });
    return { win, visual };
  }

  it('처음 한 번 바로 부르고, 창 크기·키보드(시각 뷰포트 크기)·핀치 이동마다 다시 부른다', () => {
    const { win, visual } = fakeWindow();
    const update = vi.fn();
    followVisibleViewport(update, win);
    expect(update).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('scroll'));
    expect(update).toHaveBeenCalledTimes(4);
  });

  it('돌려준 정리 함수가 건 리스너를 모두 뗀다', () => {
    const { win, visual } = fakeWindow();
    const update = vi.fn();
    const stop = followVisibleViewport(update, win);
    stop();
    win.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('scroll'));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('시각 뷰포트가 없는 환경에서도 창 크기만으로 돈다', () => {
    const win = Object.assign(new EventTarget(), { visualViewport: null });
    const update = vi.fn();
    const stop = followVisibleViewport(update, win);
    win.dispatchEvent(new Event('resize'));
    expect(update).toHaveBeenCalledTimes(2);
    stop();
  });
});

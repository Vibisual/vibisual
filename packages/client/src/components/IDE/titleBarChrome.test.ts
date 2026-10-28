import { describe, it, expect } from 'vitest';
import { autoFloatOnMultiPane, resolveTitleBarChrome, touchWindowMode, type TitleBarChromeInput } from './titleBarChrome.js';

/** IDE 타이틀바 폰 접기: 데스크톱에선 아무것도 사라지지 않고, 폰에서도 나갈 길([붙이기/떼기]·[닫기])이 남는다. */

const base: TitleBarChromeInput = {
  narrow: false,
  isModal: true,
  isDocked: false,
  fullWindow: false,
  disableDock: false,
};

const at = (patch: Partial<TitleBarChromeInput>) => resolveTitleBarChrome({ ...base, ...patch });

describe('resolveTitleBarChrome — 데스크톱은 기존 화면 그대로', () => {
  it('모달에서 손잡이가 하나도 접히지 않는다', () => {
    expect(at({})).toEqual({
      showSlotTabs: true,
      showTypeBadge: true,
      showDockMenu: true,
      showCollapse: true,
      showMaximize: true,
    });
  });

  it('붙어 있어도 그대로다', () => {
    expect(at({ isModal: false, isDocked: true })).toEqual({
      showSlotTabs: true,
      showTypeBadge: true,
      showDockMenu: true,
      showCollapse: true,
      showMaximize: true,
    });
  });
});

describe('resolveTitleBarChrome — 폰 폭에서 접는 것들', () => {
  it('풀스크린 모달에서는 붙이기·접기·최대화가 전부 빠진다(닫기 자리 확보)', () => {
    expect(at({ narrow: true })).toEqual({
      showSlotTabs: false,
      showTypeBadge: false,
      showDockMenu: false,
      showCollapse: false,
      showMaximize: false,
    });
  });

  it('붙어 있는 창에서는 [붙이기/떼기] 메뉴와 겹친 창 탭 줄을 남긴다 — 폰에서 창에 갇히지 않게', () => {
    const chrome = at({ narrow: true, isModal: false, isDocked: true });
    expect(chrome.showDockMenu).toBe(true);
    // 겹친 뒤쪽 창을 앞으로 꺼내는 유일한 손잡이라 접으면 그 창에 영영 못 닿는다.
    expect(chrome.showSlotTabs).toBe(true);
    // 붙어 있는 창은 화면 전체가 아니므로 크기 손잡이도 뜻이 있다.
    expect(chrome.showCollapse).toBe(true);
    expect(chrome.showMaximize).toBe(true);
  });

  it('떠 있는 창(모달 아님·안 붙음)에서도 크기 손잡이는 남는다', () => {
    const chrome = at({ narrow: true, isModal: false });
    expect(chrome.showCollapse).toBe(true);
    expect(chrome.showMaximize).toBe(true);
    // 붙어 있지 않으니 폰에서 붙이기 메뉴는 접는다(폰에 도킹은 뜻이 없다).
    expect(chrome.showDockMenu).toBe(false);
  });

  it('정체 뱃지는 폰에서 항상 접는다(같은 사실이 하단 상태바에 있다)', () => {
    for (const patch of [{}, { isModal: false }, { isDocked: true, isModal: false }]) {
      expect(at({ narrow: true, ...patch }).showTypeBadge).toBe(false);
    }
  });

  it('안 붙어 있으면 겹친 창 탭 줄은 접는다(겹칠 일 자체가 없다)', () => {
    expect(at({ narrow: true }).showSlotTabs).toBe(false);
    expect(at({ narrow: true, isModal: false }).showSlotTabs).toBe(false);
  });
});

describe('resolveTitleBarChrome — 오버레이 창·도킹 끔', () => {
  it('독립 창(fullWindow)은 붙이기·접기를 안 그린다 — 그 창에 뜻이 없는 손잡이들', () => {
    for (const narrow of [false, true]) {
      const chrome = resolveTitleBarChrome({ ...base, narrow, fullWindow: true, disableDock: true });
      expect(chrome.showDockMenu).toBe(false);
      expect(chrome.showCollapse).toBe(false);
    }
  });

  // §17-6 (H-5) — 독립 창은 `frame:false + transparent` 라 시스템 최대화가 없다 — 접으면 키우는 길이 변 끌기뿐이다.
  it('독립 창에서는 [최대화]를 남긴다 — 폭과 무관하게', () => {
    for (const narrow of [false, true]) {
      const chrome = resolveTitleBarChrome({ ...base, narrow, fullWindow: true, disableDock: true });
      expect(chrome.showMaximize).toBe(true);
    }
  });

  it('독립 창이 아닌 폰 풀스크린 모달에서는 종전대로 [최대화]도 접는다', () => {
    expect(at({ narrow: true }).showMaximize).toBe(false);
  });

  it('도킹이 꺼진 창은 데스크톱에서도 붙이기 메뉴가 없다', () => {
    expect(at({ disableDock: true }).showDockMenu).toBe(false);
  });
});

/**
 * 터치 기기(넓은 태블릿 포함) — 떠 있는 창 끌기·변 끌기·도킹 두께 손잡이가 전부 마우스 이벤트라
 * 손가락으로는 창을 옮기지도 두께를 바꾸지도 못한다. 그런 창으로 들어가는 문을 닫고, 나올 문은 남긴다.
 */
describe('터치 기기 — 손으로 못 다루는 창은 세우지 않는다', () => {
  it('넓은 화면이어도 안 붙은 창에서는 [붙이기/떼기] 를 접는다', () => {
    expect(at({ touch: true }).showDockMenu).toBe(false);
    expect(at({ touch: true, isModal: false }).showDockMenu).toBe(false);
  });

  it('붙어 있으면 남긴다 — 나올 길([떼기])을 막지 않는다', () => {
    expect(at({ touch: true, isModal: false, isDocked: true }).showDockMenu).toBe(true);
  });

  it('터치 판정은 다른 손잡이를 건드리지 않는다(넓은 화면의 접기·최대화·정체 뱃지는 그대로)', () => {
    const chrome = at({ touch: true });
    expect(chrome.showCollapse).toBe(true);
    expect(chrome.showMaximize).toBe(true);
    expect(chrome.showTypeBadge).toBe(true);
  });

  it('마우스 기기(생략·false)는 종전 그대로다', () => {
    expect(at({}).showDockMenu).toBe(true);
    expect(at({ touch: false }).showDockMenu).toBe(true);
  });

  it('떠 있는 창은 모달로 선다 — 모달·붙은 창은 그대로, 마우스 기기는 그대로', () => {
    expect(touchWindowMode('floating', true, false)).toBe('modal');
    expect(touchWindowMode('modal', true, false)).toBe('modal');
    expect(touchWindowMode('docked', true, false)).toBe('docked');
    expect(touchWindowMode('floating', false, false)).toBe('floating');
  });

  it('독립 창(fullWindow)은 판정 밖이다 — 그 창의 자리와 크기는 OS 창의 몫', () => {
    expect(touchWindowMode('floating', true, true)).toBe('floating');
  });

  it('창이 둘이어도 터치에서는 모달을 떠 있는 창으로 풀지 않는다 — 풀었다 되돌리는 되감기가 생긴다', () => {
    expect(autoFloatOnMultiPane(2, false)).toBe(true);
    expect(autoFloatOnMultiPane(1, false)).toBe(false);
    expect(autoFloatOnMultiPane(2, true)).toBe(false);
    // 불변량 — 터치에서는 "풀어도 된다"와 "모달로 되돌린다"가 동시에 참이 되지 않는다.
    for (const count of [1, 2, 3]) {
      const floats = autoFloatOnMultiPane(count, true);
      expect(floats && touchWindowMode('floating', true, false) === 'modal').toBe(false);
    }
  });
});

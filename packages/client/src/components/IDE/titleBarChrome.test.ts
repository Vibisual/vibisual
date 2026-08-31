import { describe, it, expect } from 'vitest';
import { resolveTitleBarChrome, type TitleBarChromeInput } from './titleBarChrome.js';

/**
 * IDE 타이틀바 폰 다이어트 회귀.
 *
 * 고정하는 약속 둘:
 *   ① 데스크톱(narrow=false)에서는 **무엇도 사라지지 않는다** — 기존 화면 불변.
 *   ② 폰에서 접더라도 **나갈 길은 남는다** — 붙어 있는 창에서는 [붙이기/떼기] 메뉴가 살아 있고,
 *      [닫기]는 애초에 이 판정의 대상이 아니라 항상 그려진다.
 */

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

  // §17-6 (H-5) — 독립 창은 `frame:false + transparent` 라 OS 타이틀바도 시스템 최대화도 없다.
  //   여기서 접으면 그 창을 키우는 길이 **네 변을 손으로 끄는 것뿐**이 된다(사용자 보고).
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

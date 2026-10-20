/**
 * 떠 있는 상자 자리 계산 — 폰 폭(360px)에서 상자가 화면 밖으로 나가지 않는가, 그리고 **데스크톱의
 * 넉넉한 화면에서는 종전 자리 그대로인가**(반응형 손질이 데스크톱 모습을 바꾸면 안 된다).
 */
import { describe, expect, it } from 'vitest';
import {
  DD_GAP,
  DD_LEFT_MIN_WIDTH,
  DD_MAX_HEIGHT,
  DD_VIEWPORT_MARGIN,
  POPUP_VIEWPORT_MARGIN as M,
  clampSpan,
  placeHoverTip,
  placeNearPointer,
  placePortalDropdown,
} from './panelPopupPlacement.js';

const PHONE = { w: 360, h: 740 };
const DESKTOP = { w: 1440, h: 900 };

describe('clampSpan', () => {
  it('안에 들어가면 그대로 둔다', () => {
    expect(clampSpan(100, 200, 1000)).toBe(100);
  });
  it('오른쪽·아래로 넘치면 끝에서 여백만큼 안으로 민다', () => {
    expect(clampSpan(300, 200, 360)).toBe(360 - M - 200);
  });
  it('왼쪽·위로 넘치면 여백에 붙인다', () => {
    expect(clampSpan(-50, 100, 360)).toBe(M);
  });
  it('상자가 화면보다 크면 앞머리를 여백에 붙인다(닫기·제목 쪽이 보이게)', () => {
    expect(clampSpan(40, 500, 360)).toBe(M);
  });
});

describe('placeHoverTip', () => {
  const tip = { w: 224, h: 40 };

  it('화면 가운데 칸 — 칸 위 가운데 그대로(종전 자리)', () => {
    const anchor = { left: 700, top: 400, bottom: 412, width: 12 };
    expect(placeHoverTip(anchor, tip, DESKTOP)).toEqual({ x: 706, y: 394, below: false });
  });

  it('폰 오른쪽 끝 칸 — 상자 오른쪽 끝이 화면 안에 남도록 가운데를 안으로 민다', () => {
    const anchor = { left: 340, top: 400, bottom: 412, width: 12 };
    const { x } = placeHoverTip(anchor, tip, PHONE);
    expect(x + tip.w / 2).toBe(PHONE.w - M);
  });

  it('폰 왼쪽 끝 칸 — 상자 왼쪽 끝이 여백에 선다', () => {
    const anchor = { left: 4, top: 400, bottom: 412, width: 12 };
    const { x } = placeHoverTip(anchor, tip, PHONE);
    expect(x - tip.w / 2).toBe(M);
  });

  it('화면 맨 위 칸 — 위에 자리가 없으면 칸 아래로 뒤집는다', () => {
    const anchor = { left: 300, top: 10, bottom: 22, width: 12 };
    expect(placeHoverTip(anchor, tip, DESKTOP)).toEqual({ x: 306, y: 28, below: true });
  });

  it('위가 모자라도 아래가 더 좁으면 뒤집지 않는다', () => {
    const anchor = { left: 100, top: 30, bottom: 42, width: 12 };
    const short = { w: 360, h: 60 };
    expect(placeHoverTip(anchor, tip, short).below).toBe(false);
  });
});

describe('placePortalDropdown', () => {
  it("'left' — 왼쪽에 자리가 있으면 종전처럼 버튼 왼쪽에 오른쪽 끝을 붙인다", () => {
    const btn = { left: 900, top: 600, bottom: 624, width: 90 };
    const pos = placePortalDropdown(btn, 200, 300, DESKTOP, 'left');
    expect(pos.right).toBe(DESKTOP.w - btn.left + 6);
    expect(pos.left).toBeUndefined();
    expect(pos.maxHeight).toBe(200);
    expect(pos.top).toBe(btn.bottom - 200);
  });

  it("'left' — 폰에서 왼쪽 자리가 없으면 아래 규칙으로 내리고 가로를 화면 안에 둔다", () => {
    // 종전: right = 360 − 16 + 6 = 350 → 280px 패널의 왼쪽 끝이 −270px(화면 밖).
    const btn = { left: 16, top: 500, bottom: 524, width: 90 };
    const pos = placePortalDropdown(btn, 200, 300, PHONE, 'left');
    expect(pos.right).toBeUndefined();
    expect(pos.left).toBeGreaterThanOrEqual(DD_VIEWPORT_MARGIN);
    expect((pos.left ?? 0) + 300).toBeLessThanOrEqual(PHONE.w - DD_VIEWPORT_MARGIN);
  });

  it("'left' — 실측 전에는 최소 폭으로 판정한다", () => {
    const btn = { left: DD_LEFT_MIN_WIDTH + 6 + DD_VIEWPORT_MARGIN - 1, top: 500, bottom: 524, width: 90 };
    expect(placePortalDropdown(btn, null, null, DESKTOP, 'left').right).toBeUndefined();
    const roomy = { ...btn, left: btn.left + 1 };
    expect(placePortalDropdown(roomy, null, null, DESKTOP, 'left').right).toBeDefined();
  });

  it("'below' — 아래가 넉넉하면 버튼 밑에 붙인다", () => {
    const btn = { left: 100, top: 100, bottom: 124, width: 120 };
    const pos = placePortalDropdown(btn, 200, 240, DESKTOP, 'below');
    expect(pos).toEqual({ top: 124 + DD_GAP, left: 100, minWidth: 120, maxHeight: 200 });
  });

  it("'below' — 아래가 모자라고 위가 넓으면 위로 뒤집는다", () => {
    const btn = { left: 100, top: 800, bottom: 824, width: 120 };
    const pos = placePortalDropdown(btn, DD_MAX_HEIGHT, 240, DESKTOP, 'below');
    expect(pos.bottom).toBe(DESKTOP.h - 800 + DD_GAP);
    expect(pos.top).toBeUndefined();
  });

  it("'below' — 폰 오른쪽 끝 버튼이면 패널을 화면 안으로 당긴다", () => {
    const btn = { left: 300, top: 100, bottom: 124, width: 50 };
    const pos = placePortalDropdown(btn, 200, 280, PHONE, 'below');
    expect(pos.left).toBe(PHONE.w - DD_VIEWPORT_MARGIN - 280);
  });
});

describe('placeNearPointer', () => {
  it('넉넉하면 포인터 오른쪽으로 비켜 앉는다', () => {
    expect(placeNearPointer({ x: 100, y: 300 }, { w: 300, h: 170 }, DESKTOP, { minTop: 60 })).toEqual({ left: 112, top: 300 });
  });

  it('폰 오른쪽에서 열면 상자 오른쪽 끝이 화면 안에 남는다', () => {
    const { left } = placeNearPointer({ x: 300, y: 300 }, { w: 300, h: 170 }, PHONE);
    expect(left + 300).toBe(PHONE.w - M);
  });

  it('실측 키로 아래 끝을 맞춘다 — 짐작한 상수가 아니라', () => {
    const { top } = placeNearPointer({ x: 10, y: 700 }, { w: 190, h: 210 }, PHONE, { offsetY: -8, minTop: 60 });
    expect(top + 210).toBe(PHONE.h - M);
  });

  it('머리 띠 아래 바닥(minTop)을 지킨다', () => {
    expect(placeNearPointer({ x: 10, y: 5 }, { w: 190, h: 140 }, PHONE, { offsetY: -8, minTop: 60 }).top).toBe(60);
  });
});

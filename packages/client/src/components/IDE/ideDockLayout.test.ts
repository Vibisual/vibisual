import { describe, it, expect } from 'vitest';
import {
  IDE_DOCK,
  IDE_FLOAT,
  clampDockSize,
  clampFloatGeom,
  initialFloatGeom,
  splitSpansFromDrag,
  computeDockLayout,
  dockSizeFromDrag,
  orderForInsert,
  previewDockRect,
  resolveDockDrop,
  type DockedPane,
} from './ideDockLayout.js';

// §5.5 #17-1 (판올림 번호 발급 대기) — 창을 여러 개 붙이는 순간 좌표는 (변 × 스택 순서 × 반대편 도크)
// 의 함수가 된다. 화면으로만 확인하면 "한 변에 두 개"·"네 변 동시" 같은 조합이 회귀해도 모른다.

const VP = { w: 1600, h: 900 };
const HEADER = IDE_DOCK.HEADER_H;

function pane(paneKey: string, side: DockedPane['side'], size = 480, order = 0, span = 1): DockedPane {
  return { paneKey, side, size, order, span };
}

describe('computeDockLayout', () => {
  it('붙은 창이 없으면 네 변 모두 0 을 비운다', () => {
    const { rects, insets } = computeDockLayout([], VP);
    expect(rects).toEqual({});
    expect(insets).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('우측 도크 하나 — 종전 동작(헤더 아래 세로 전체, 우측 정렬)을 그대로 지킨다', () => {
    const { rects, insets } = computeDockLayout([pane('a', 'right', 480)], VP);
    expect(rects.a).toEqual({ x: VP.w - 480, y: HEADER, w: 480, h: VP.h - HEADER });
    expect(insets.right).toBe(480);
  });

  it('좌·우를 동시에 붙이면 서로 겹치지 않고 캔버스가 가운데 남는다', () => {
    const { rects, insets } = computeDockLayout([pane('l', 'left', 400), pane('r', 'right', 300)], VP);
    expect(rects.l).toEqual({ x: 0, y: HEADER, w: 400, h: VP.h - HEADER });
    expect(rects.r!.x).toBe(VP.w - 300);
    expect(insets.left + insets.right).toBeLessThan(VP.w - IDE_DOCK.KEEP_CANVAS.w + 1);
  });

  it('상/하 도크는 좌우 도크를 뺀 폭만 먹는다 — 네 변 동시에도 겹침 없음', () => {
    const panes = [pane('l', 'left', 400), pane('r', 'right', 300), pane('t', 'top', 200), pane('b', 'bottom', 150)];
    const { rects } = computeDockLayout(panes, VP);
    expect(rects.t).toEqual({ x: 400, y: HEADER, w: VP.w - 400 - 300, h: 200 });
    expect(rects.b).toEqual({ x: 400, y: VP.h - 150, w: VP.w - 400 - 300, h: 150 });
    // 좌 도크의 오른쪽 끝 = 상단 도크의 왼쪽 끝(빈틈도 겹침도 없다).
    expect(rects.l!.x + rects.l!.w).toBe(rects.t!.x);
  });

  it('같은 변에 둘을 이어 붙이면 긴 축을 균등 분할한다(순서는 order)', () => {
    const { rects } = computeDockLayout([pane('b', 'right', 480, 1), pane('a', 'right', 480, 0)], VP);
    const band = VP.h - HEADER;
    expect(rects.a).toEqual({ x: VP.w - 480, y: HEADER, w: 480, h: Math.floor(band / 2) });
    expect(rects.b!.y).toBe(HEADER + Math.floor(band / 2));
    // 나머지 픽셀은 마지막 칸이 흡수 — 두 칸을 합치면 정확히 밴드 전체.
    expect(rects.a!.h + rects.b!.h).toBe(band);
  });

  it('마주 보는 두 변이 화면을 다 먹으려 하면 비율로 함께 줄여 캔버스를 남긴다', () => {
    const { insets } = computeDockLayout([pane('l', 'left', 1200), pane('r', 'right', 1200)], VP);
    expect(insets.left + insets.right).toBeLessThanOrEqual(VP.w - IDE_DOCK.KEEP_CANVAS.w);
    // 같은 두께로 밀었으면 줄어든 뒤에도 서로 같아야 한다(나중에 붙인 창만 손해 보지 않게).
    expect(Math.abs(insets.left - insets.right)).toBeLessThanOrEqual(1);
  });
});

describe('resolveDockDrop', () => {
  it('가장자리에서 멀면 도킹하지 않는다(플로팅 유지)', () => {
    expect(resolveDockDrop({ x: 800, y: 450 }, VP, [])).toBeNull();
  });

  it('네 변 각각을 알아본다', () => {
    expect(resolveDockDrop({ x: 4, y: 450 }, VP, [])).toEqual({ side: 'left', index: 0 });
    expect(resolveDockDrop({ x: VP.w - 4, y: 450 }, VP, [])).toEqual({ side: 'right', index: 0 });
    expect(resolveDockDrop({ x: 800, y: HEADER + 4 }, VP, [])).toEqual({ side: 'top', index: 0 });
    expect(resolveDockDrop({ x: 800, y: VP.h - 4 }, VP, [])).toEqual({ side: 'bottom', index: 0 });
  });

  it('모서리에서는 더 가까운 변이 이긴다', () => {
    // 좌 10px / 상 40px → 좌측.
    expect(resolveDockDrop({ x: 10, y: HEADER + 40 }, VP, [])?.side).toBe('left');
    // 좌 100px / 상 6px → 상단.
    expect(resolveDockDrop({ x: 100, y: HEADER + 6 }, VP, [])?.side).toBe('top');
  });

  it('이미 붙은 변으로 끌면 커서 위치로 끼울 칸이 갈린다 — 이것이 "이어 붙이기"', () => {
    const docked = [pane('a', 'right', 480, 0)];
    // 기존 창의 위쪽 절반 → 그 앞(0)에 끼운다.
    expect(resolveDockDrop({ x: VP.w - 10, y: HEADER + 50 }, VP, docked)).toEqual({ side: 'right', index: 0 });
    // 아래쪽 절반 → 뒤(1)에 붙는다.
    expect(resolveDockDrop({ x: VP.w - 10, y: VP.h - 50 }, VP, docked)).toEqual({ side: 'right', index: 1 });
  });

  it('한 변의 상한을 넘겨 붙이려 하면 스냅하지 않는다', () => {
    const full = Array.from({ length: IDE_DOCK.MAX_PER_SIDE }, (_, i) => pane(`p${i}`, 'right', 480, i));
    expect(resolveDockDrop({ x: VP.w - 10, y: 450 }, VP, full)).toBeNull();
  });

  it('칸이 최소 길이보다 얇아질 화면에서는 더 못 끼운다', () => {
    const tiny = { w: 1600, h: HEADER + 200 }; // 밴드 200px — 둘로 쪼개면 100px < MIN_SLOT
    const docked = [pane('a', 'right', 480, 0)];
    expect(resolveDockDrop({ x: tiny.w - 10, y: HEADER + 100 }, tiny, docked)).toBeNull();
  });
});

describe('orderForInsert', () => {
  it('맨 앞·맨 뒤·사이를 다른 창 번호를 건드리지 않고 낸다', () => {
    expect(orderForInsert([], 0)).toBe(0);
    expect(orderForInsert([0, 1], 0)).toBe(-1);
    expect(orderForInsert([0, 1], 2)).toBe(2);
    expect(orderForInsert([0, 1], 1)).toBe(0.5);
  });
});

describe('previewDockRect', () => {
  it('미리보기는 실제로 앉을 칸과 같은 자리를 그린다', () => {
    const docked = [pane('a', 'right', 480, 0)];
    const target = resolveDockDrop({ x: VP.w - 10, y: VP.h - 50 }, VP, docked)!;
    const preview = previewDockRect(target, VP, docked, 480)!;
    // 실제로 그 자리에 붙였을 때의 좌표와 일치해야 한다.
    const after = computeDockLayout([...docked, pane('new', 'right', 480, 1)], VP);
    expect(preview).toEqual(after.rects.new);
  });
});

describe('clampDockSize / dockSizeFromDrag', () => {
  it('두께는 하한과 "반대편 도크 + 캔버스 최소치" 사이로 잘린다', () => {
    expect(clampDockSize('right', 10, VP, [])).toBe(IDE_DOCK.MIN_SIZE);
    const withLeft = [pane('l', 'left', 600)];
    expect(clampDockSize('right', 9999, VP, withLeft)).toBe(VP.w - 600 - IDE_DOCK.KEEP_CANVAS.w);
  });

  it('손잡이 방향은 붙은 변마다 반대다', () => {
    expect(dockSizeFromDrag('right', 400, -50, 0)).toBe(450);
    expect(dockSizeFromDrag('left', 400, 50, 0)).toBe(450);
    expect(dockSizeFromDrag('bottom', 300, 0, -50)).toBe(350);
    expect(dockSizeFromDrag('top', 300, 0, 50)).toBe(350);
  });
});

describe('같은 변 스택의 몫(span)', () => {
  it('몫이 2:1 이면 길이도 2:1 로 나뉜다(균등 고정 ❌)', () => {
    const { rects } = computeDockLayout(
      [pane('a', 'right', 480, 0, 2), pane('b', 'right', 480, 1, 1)],
      VP,
    );
    const band = VP.h - HEADER;
    expect(rects.a!.h).toBe(Math.floor((band * 2) / 3));
    // 나머지는 마지막 칸이 흡수 — 합치면 정확히 밴드 전체(빈 줄 ❌).
    expect(rects.a!.h + rects.b!.h).toBe(band);
    expect(rects.b!.y).toBe(HEADER + rects.a!.h);
  });

  it('손잡이를 끌면 두 칸의 몫 합이 보존된다', () => {
    const out = splitSpansFromDrag(1, 1, 400, 400, 100, IDE_DOCK.MIN_SLOT);
    expect(out.a + out.b).toBeCloseTo(2);
    expect(out.a).toBeGreaterThan(1); // 아래로 끌었으니 위 칸이 커진다
  });

  it('어느 칸도 최소 길이 아래로는 못 내려간다(0 이 되면 그 창을 다시 못 잡는다)', () => {
    const out = splitSpansFromDrag(1, 1, 400, 400, -9999, IDE_DOCK.MIN_SLOT);
    const lenA = (out.a / (out.a + out.b)) * 800;
    expect(lenA).toBeGreaterThanOrEqual(IDE_DOCK.MIN_SLOT - 0.5);
  });

  it('두 칸이 최소치도 못 채우는 화면에서는 손대지 않는다', () => {
    const out = splitSpansFromDrag(1, 1, 50, 50, 40, IDE_DOCK.MIN_SLOT);
    expect(out).toEqual({ a: 1, b: 1 });
  });
});

describe('떠 있는 창의 자리(clampFloatGeom)', () => {
  it('앱 창이 줄어 화면 밖으로 나간 창을 안으로 되돌린다', () => {
    const small = { w: 900, h: 600 };
    // 1600 폭에서 오른쪽 끝에 놓아 둔 창 — 900 폭에서는 통째로 화면 밖이다.
    const out = clampFloatGeom({ x: 1500, y: 400, w: 600, h: 400 }, small);
    expect(out.x).toBeLessThanOrEqual(small.w - IDE_FLOAT.KEEP_VISIBLE.x);
    expect(out.y).toBeLessThanOrEqual(small.h - IDE_FLOAT.KEEP_VISIBLE.y);
  });

  it('타이틀바가 헤더 밑으로 깔리지 않는다(잡을 수 없게 되면 되찾을 길이 없다)', () => {
    const out = clampFloatGeom({ x: 100, y: -200, w: 600, h: 400 }, VP);
    expect(out.y).toBe(IDE_DOCK.HEADER_H);
  });

  it('크기는 하한과 뷰포트 사이로 잘린다', () => {
    const out = clampFloatGeom({ x: 0, y: 100, w: 10, h: 10 }, VP);
    expect(out.w).toBe(IDE_FLOAT.MIN_W);
    expect(out.h).toBe(IDE_FLOAT.MIN_H);
    const big = clampFloatGeom({ x: 0, y: 100, w: 9999, h: 9999 }, VP);
    expect(big.w).toBe(VP.w);
    expect(big.h).toBe(VP.h - IDE_DOCK.HEADER_H);
  });

  it('처음 뜨는 자리는 창마다 계단식으로 어긋나고 화면 안이다', () => {
    const a = initialFloatGeom(VP, 0);
    const b = initialFloatGeom(VP, 1);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeGreaterThan(a.y);
    for (const g of [a, b]) {
      expect(g.y).toBeGreaterThanOrEqual(IDE_DOCK.HEADER_H);
      expect(g.x).toBeLessThanOrEqual(VP.w - IDE_FLOAT.KEEP_VISIBLE.x);
    }
  });
});

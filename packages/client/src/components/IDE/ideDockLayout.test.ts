import { describe, it, expect } from 'vitest';
import {
  IDE_DOCK,
  IDE_FLOAT,
  clampDockSize,
  clampFloatGeom,
  dragFloatGeom,
  initialFloatGeom,
  isOutsideViewport,
  isPinnedToViewportEdge,
  isPulledFullyOut,
  overflowPastClamp,
  popOutGhostDecision,
  splitSpansFromDrag,
  cascadeFloatGeoms,
  computeDockLayout,
  dockSizeFromDrag,
  dockOrderForDrop,
  dockSlotMates,
  dockSlotsOf,
  dockZoneButtons,
  magnetFloatGeom,
  pushFloatGeoms,
  pushDockSize,
  easeFloatPushOffset,
  resizeFloatGeom,
  sameDockTarget,
  tileFloatGeoms,
  orderForInsert,
  previewDockRect,
  resolveDockDrop,
  type DockedPane,
  type FloatGeom,
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
    expect(resolveDockDrop({ x: 4, y: 450 }, VP, [])).toEqual({ side: 'left', index: 0, mode: 'insert' });
    expect(resolveDockDrop({ x: VP.w - 4, y: 450 }, VP, [])).toEqual({ side: 'right', index: 0, mode: 'insert' });
    expect(resolveDockDrop({ x: 800, y: HEADER + 4 }, VP, [])).toEqual({ side: 'top', index: 0, mode: 'insert' });
    expect(resolveDockDrop({ x: 800, y: VP.h - 4 }, VP, [])).toEqual({ side: 'bottom', index: 0, mode: 'insert' });
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
    expect(resolveDockDrop({ x: VP.w - 10, y: HEADER + 50 }, VP, docked)).toEqual({ side: 'right', index: 0, mode: 'insert' });
    // 아래쪽 절반 → 뒤(1)에 붙는다.
    expect(resolveDockDrop({ x: VP.w - 10, y: VP.h - 50 }, VP, docked)).toEqual({ side: 'right', index: 1, mode: 'insert' });
  });

  it('한 변의 칸 상한을 넘기면 새 칸 대신 **탭으로 합류**한다(죽은 자리 ❌)', () => {
    const full = Array.from({ length: IDE_DOCK.MAX_PER_SIDE }, (_, i) => pane(`p${i}`, 'right', 480, i));
    // 칸 가운데 = 늘 탭 합류.
    expect(resolveDockDrop({ x: VP.w - 10, y: 450 }, VP, full)).toEqual({ side: 'right', index: 1, mode: 'tab' });
    // 앞/뒤 띠도 상한에 걸리면 탭으로 떨어진다 — 손을 떼도 아무 일 없는 자리를 남기지 않는다.
    expect(resolveDockDrop({ x: VP.w - 10, y: HEADER + 4 }, VP, full)).toEqual({ side: 'right', index: 0, mode: 'tab' });
  });

  it('칸이 최소 길이보다 얇아질 화면에서는 더 못 끼운다 — 그 자리는 탭이 받는다', () => {
    const tiny = { w: 1600, h: HEADER + 200 }; // 밴드 200px — 둘로 쪼개면 100px < MIN_SLOT
    const docked = [pane('a', 'right', 480, 0)];
    expect(resolveDockDrop({ x: tiny.w - 10, y: HEADER + 100 }, tiny, docked)).toEqual({ side: 'right', index: 0, mode: 'tab' });
    // 막힌 것은 **그 변**뿐이다 — 아직 빈 변에는 종전대로 새 칸으로 붙는다.
    expect(resolveDockDrop({ x: 10, y: HEADER + 100 }, tiny, docked)).toEqual({ side: 'left', index: 0, mode: 'insert' });
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

// ─── (판올림 번호 발급 대기) 언리얼식 탭 도킹 · 도킹 십자 · 자석 · 정렬 ───

describe('한 칸에 여러 창(탭 도킹)', () => {
  it('order 가 같은 창들은 한 칸을 **같은 자리**로 나눠 쓴다 — 화면이 더 잘리지 않는다', () => {
    const solo = computeDockLayout([pane('a', 'right', 480, 0)], VP);
    const tabbed = computeDockLayout([pane('a', 'right', 480, 0), pane('b', 'right', 480, 0)], VP);
    expect(tabbed.rects.a).toEqual(solo.rects.a);
    expect(tabbed.rects.b).toEqual(solo.rects.a);
    expect(tabbed.insets.right).toBe(solo.insets.right);
  });

  it('칸을 세는 단위는 창이 아니라 슬롯이다', () => {
    const panes = [pane('a', 'right', 480, 0), pane('b', 'right', 480, 0), pane('c', 'right', 480, 1)];
    const slots = dockSlotsOf(panes, 'right');
    expect(slots.map((s) => s.paneKeys)).toEqual([['a', 'b'], ['c']]);
    // 두 칸이므로 밴드는 둘로만 갈린다(창 수 셋과 무관).
    const { rects } = computeDockLayout(panes, VP);
    expect(rects.a!.h + rects.c!.h).toBe(VP.h - HEADER);
  });

  it('같은 칸을 나눠 쓰는 창들을 되찾을 수 있다(그룹 탭 스트립의 재료)', () => {
    const panes = [pane('a', 'right', 480, 0), pane('b', 'right', 480, 0), pane('c', 'left', 480, 0)];
    expect(dockSlotMates(panes, 'a')).toEqual(['a', 'b']);
    expect(dockSlotMates(panes, 'c')).toEqual(['c']);
    expect(dockSlotMates(panes, 'none')).toEqual([]);
  });

  it('칸 한가운데에 놓으면 탭으로 합류한다 — 그 칸의 order 를 그대로 물려받는다', () => {
    const docked = [pane('a', 'right', 480, 3)];
    const target = resolveDockDrop({ x: VP.w - 240, y: 450 }, VP, docked)!;
    expect(target).toEqual({ side: 'right', index: 0, mode: 'tab' });
    expect(dockOrderForDrop(target, docked)).toBe(3);
  });

  it('탭 합류 미리보기는 그 칸 전체를 그린다(실제로 앉을 자리와 같다)', () => {
    const docked = [pane('a', 'right', 480, 0)];
    const target = resolveDockDrop({ x: VP.w - 240, y: 450 }, VP, docked)!;
    const preview = previewDockRect(target, VP, docked, 480)!;
    const after = computeDockLayout([...docked, pane('new', 'right', 480, 0)], VP);
    expect(preview).toEqual(after.rects.new);
    expect(preview).toEqual(after.rects.a);
  });
});

describe('도킹 십자 위젯(dockZoneButtons)', () => {
  it('빈 화면에서는 네 변에 버튼이 하나씩 선다', () => {
    const zones = dockZoneButtons(VP, []);
    expect(zones).toHaveLength(4);
    expect(zones.every((z) => z.kind === 'edge')).toBe(true);
    expect(new Set(zones.map((z) => z.target.side))).toEqual(new Set(['left', 'right', 'top', 'bottom']));
  });

  it('붙은 칸 위에는 앞/탭/뒤 세 버튼이 선다', () => {
    const docked = [pane('a', 'right', 480, 0)];
    const right = dockZoneButtons(VP, docked).filter((z) => z.target.side === 'right');
    expect(right.map((z) => z.kind).sort()).toEqual(['after', 'before', 'tab']);
  });

  it('버튼은 **자기 판정 영역 한가운데**에 선다 — 겨눈 대로 앉는다', () => {
    const docked = [pane('a', 'right', 480, 0), pane('b', 'left', 400, 0)];
    for (const z of dockZoneButtons(VP, docked)) {
      const center = { x: z.rect.x + z.rect.w / 2, y: z.rect.y + z.rect.h / 2 };
      expect(sameDockTarget(resolveDockDrop(center, VP, docked), z.target)).toBe(true);
    }
  });

  it('새 칸을 못 만드는 변에서는 앞/뒤 버튼이 아예 안 뜬다(눌러도 안 되는 버튼 ❌)', () => {
    const full = Array.from({ length: IDE_DOCK.MAX_PER_SIDE }, (_, i) => pane(`p${i}`, 'right', 480, i));
    const right = dockZoneButtons(VP, full).filter((z) => z.target.side === 'right');
    expect(right.every((z) => z.kind === 'tab')).toBe(true);
    expect(right).toHaveLength(IDE_DOCK.MAX_PER_SIDE);
  });
});

describe('자석 정렬(magnetFloatGeom)', () => {
  it('가까운 이웃의 모서리에 딱 붙고 그 선을 알려 준다', () => {
    const neighbor = { x: 800, y: 200, w: 400, h: 300 };
    const out = magnetFloatGeom({ x: 1204, y: 500, w: 300, h: 200 }, [neighbor], VP);
    expect(out.geom.x).toBe(1200); // 이웃의 오른쪽 끝에 왼쪽 모서리를 맞춘다
    expect(out.guideX).toBe(1200);
  });

  it('먼 선에는 붙지 않는다(움직임을 앱이 훔치지 않는다)', () => {
    const neighbor = { x: 800, y: 200, w: 400, h: 300 };
    const out = magnetFloatGeom({ x: 1260, y: 600, w: 300, h: 200 }, [neighbor], VP);
    expect(out.geom.x).toBe(1260);
    expect(out.guideX).toBeNull();
  });

  it('화면 가장자리·헤더 아래에도 붙는다', () => {
    const out = magnetFloatGeom({ x: 5, y: HEADER + 4, w: 600, h: 400 }, [], VP);
    expect(out.geom.x).toBe(0);
    expect(out.geom.y).toBe(HEADER);
  });
});

describe('한 번에 정렬(tile / cascade)', () => {
  it('바둑판은 서로 겹치지 않고 주어진 영역 안에 든다', () => {
    const bounds = { x: 0, y: HEADER, w: 1600, h: 864 };
    const geoms = tileFloatGeoms(4, bounds);
    expect(geoms).toHaveLength(4);
    for (const g of geoms) {
      expect(g.x).toBeGreaterThanOrEqual(bounds.x);
      expect(g.y).toBeGreaterThanOrEqual(bounds.y);
      expect(g.x + g.w).toBeLessThanOrEqual(bounds.x + bounds.w + 1);
    }
    // 2×2 — 첫 줄 두 칸은 가로로 어긋나고, 둘째 줄은 세로로 내려간다.
    expect(geoms[1]!.x).toBeGreaterThan(geoms[0]!.x);
    expect(geoms[2]!.y).toBeGreaterThan(geoms[0]!.y);
  });

  it('계단식은 창마다 어긋나되 영역 밖으로 나가지 않는다', () => {
    const bounds = { x: 0, y: HEADER, w: 1600, h: 864 };
    const geoms = cascadeFloatGeoms(5, bounds);
    expect(geoms[1]!.x).toBeGreaterThan(geoms[0]!.x);
    for (const g of geoms) {
      expect(g.x + g.w).toBeLessThanOrEqual(bounds.x + bounds.w + 1);
      expect(g.y + g.h).toBeLessThanOrEqual(bounds.y + bounds.h + 1);
    }
  });
});

describe('여덟 방향 리사이즈(resizeFloatGeom)', () => {
  const start = { x: 400, y: 200, w: 800, h: 600 };

  it('오른쪽·아래는 좌표를 그대로 두고 크기만 늘린다', () => {
    expect(resizeFloatGeom(start, 'se', 100, 50)).toEqual({ x: 400, y: 200, w: 900, h: 650 });
  });

  it('왼쪽·위를 끌면 좌표가 함께 움직여 반대편 모서리가 제자리에 남는다', () => {
    const out = resizeFloatGeom(start, 'nw', -100, -50);
    expect(out).toEqual({ x: 300, y: 150, w: 900, h: 650 });
    expect(out.x + out.w).toBe(start.x + start.w);
    expect(out.y + out.h).toBe(start.y + start.h);
  });

  it('하한에 부딪히면 좌표도 거기서 멈춘다(크기는 그대로인데 창만 미끄러지지 않게)', () => {
    const out = resizeFloatGeom(start, 'w', 9999, 0);
    expect(out.w).toBe(IDE_FLOAT.MIN_W);
    expect(out.x + out.w).toBe(start.x + start.w);
  });
});

describe('앱 밖으로 꺼내기(isOutsideViewport)', () => {
  it('창 안에서는 아무리 가장자리에 붙어도 밖이 아니다', () => {
    expect(isOutsideViewport({ x: 0, y: HEADER }, VP)).toBe(false);
    expect(isOutsideViewport({ x: VP.w, y: VP.h }, VP)).toBe(false);
    expect(isOutsideViewport({ x: VP.w / 2, y: VP.h / 2 }, VP)).toBe(false);
  });

  it('여유(24px)를 넘어야 밖으로 읽는다 — 가장자리를 스쳤다고 튀어나가지 않는다', () => {
    const m = IDE_FLOAT.POP_OUT_MARGIN;
    expect(isOutsideViewport({ x: VP.w + m, y: 400 }, VP)).toBe(false);
    expect(isOutsideViewport({ x: VP.w + m + 1, y: 400 }, VP)).toBe(true);
    expect(isOutsideViewport({ x: -m - 1, y: 400 }, VP)).toBe(true);
    expect(isOutsideViewport({ x: 800, y: -m - 1 }, VP)).toBe(true);
    expect(isOutsideViewport({ x: 800, y: VP.h + m + 1 }, VP)).toBe(true);
  });
});

describe('가장자리에 막혔을 때도 꺼내진다(isPinnedToViewportEdge)', () => {
  it('네 변 어디든 끝에 닿으면 막힌 것으로 읽는다', () => {
    expect(isPinnedToViewportEdge({ x: 0, y: 400 }, VP)).toBe(true);
    expect(isPinnedToViewportEdge({ x: 800, y: 0 }, VP)).toBe(true);
    // 브라우저가 주는 최대 좌표는 w-1 / h-1 — 끝까지 민 손이 띠 밖으로 새면 안 된다.
    expect(isPinnedToViewportEdge({ x: VP.w - 1, y: 400 }, VP)).toBe(true);
    expect(isPinnedToViewportEdge({ x: 800, y: VP.h - 1 }, VP)).toBe(true);
  });

  it('띠(3px) 안까지만 막힌 것으로 본다 — 가운데는 아니다', () => {
    const e = IDE_FLOAT.POP_OUT_EDGE_PX;
    expect(isPinnedToViewportEdge({ x: e, y: 400 }, VP)).toBe(true);
    expect(isPinnedToViewportEdge({ x: e + 1, y: 400 }, VP)).toBe(false);
    expect(isPinnedToViewportEdge({ x: VP.w - 1 - e, y: 400 }, VP)).toBe(true);
    expect(isPinnedToViewportEdge({ x: VP.w - 2 - e, y: 400 }, VP)).toBe(false);
    expect(isPinnedToViewportEdge({ x: VP.w / 2, y: VP.h / 2 }, VP)).toBe(false);
  });

  it('앱이 최대화된 단일 모니터 — 밖으로는 못 나가도 막힘 판정은 선다', () => {
    // 커서가 뷰포트를 한 픽셀도 못 벗어나는 자리: `isOutsideViewport` 는 끝내 거짓,
    // 그래도 손짓이 닿아야 하므로 막힘 판정이 참이어야 한다(이 둘이 함께 거짓이면 기능이 없는 것).
    const edgeCursor = { x: VP.w - 1, y: VP.h - 1 };
    expect(isOutsideViewport(edgeCursor, VP)).toBe(false);
    expect(isPinnedToViewportEdge(edgeCursor, VP)).toBe(true);
  });

  it('버팀 시간이 있어야 한다 — 0 이면 스치기만 해도 창이 튀어나간다', () => {
    expect(IDE_FLOAT.POP_OUT_EDGE_DWELL_MS).toBeGreaterThan(0);
  });

  it('(H-6) 선이 떠 있을 때의 버팀은 더 짧다 — 같은 시간을 두 번 기다리지 않는다', () => {
    expect(IDE_FLOAT.POP_OUT_EDGE_DWELL_ARMED_MS).toBeGreaterThan(0);
    expect(IDE_FLOAT.POP_OUT_EDGE_DWELL_ARMED_MS).toBeLessThan(IDE_FLOAT.POP_OUT_EDGE_DWELL_MS);
  });
});

// §5.5 #17-6 (H-6) — 밖으로 빼는 **구간**. 종전에는 끄는 내내 `clampFloatGeom` 이 걸려 창이
// 화면 가장자리에서 멎었고(손과 어긋남), 밖으로 나가는 과정을 보여 줄 방법이 없었다.
describe('밖으로 빼는 구간(H-6)', () => {
  const W = 700;
  const H = 500;

  describe('끄는 동안은 가두지 않는다(dragFloatGeom)', () => {
    it('좌표를 그대로 통과시킨다 — 안전망은 손을 뗄 때만 건다', () => {
      const far = { x: VP.w + 400, y: -300, w: W, h: H };
      const dragged = dragFloatGeom(far, VP);
      expect(dragged.x).toBe(far.x);
      expect(dragged.y).toBe(far.y);
      // 같은 값을 `clampFloatGeom` 에 넣으면 되돌아온다 — 그것이 종전에 창이 멎던 자리다.
      const clamped = clampFloatGeom(far, VP);
      expect(clamped.x).toBeLessThan(far.x);
      expect(clamped.y).toBeGreaterThan(far.y);
    });

    it('크기는 정상화한다 — 자리를 안 가둔다고 크기까지 무너지면 안 된다', () => {
      const tiny = dragFloatGeom({ x: 10, y: 10, w: 10, h: 10 }, VP);
      expect(tiny.w).toBe(IDE_FLOAT.MIN_W);
      expect(tiny.h).toBe(IDE_FLOAT.MIN_H);
      const huge = dragFloatGeom({ x: 0, y: 0, w: VP.w * 3, h: VP.h * 3 }, VP);
      expect(huge.w).toBe(VP.w);
      expect(huge.h).toBe(VP.h - HEADER);
    });
  });

  describe('선을 켜는 문턱은 뷰포트가 아니라 클램프 한계다(overflowPastClamp)', () => {
    it('화면 끝에 바짝 붙여 두는 평범한 파킹은 0 이다 — 그 손짓마다 선이 번쩍이면 안 된다', () => {
      // `clampFloatGeom` 이 허락하는 가장 오른쪽 자리 = 최소 가시 폭만 남긴 자리.
      const parked = { x: VP.w - IDE_FLOAT.KEEP_VISIBLE.x, y: HEADER, w: W, h: H };
      expect(overflowPastClamp(parked, VP)).toBe(0);
      // 뷰포트 기준으로 쟀다면 이 자리는 이미 창의 대부분이 "밖"이다(그래서 그 기준을 쓰지 않는다).
      expect(parked.x + parked.w).toBeGreaterThan(VP.w);
    });

    it('그 자리를 넘어선 만큼만 센다 — 두 축 중 큰 쪽', () => {
      const parkedX = VP.w - IDE_FLOAT.KEEP_VISIBLE.x;
      expect(overflowPastClamp({ x: parkedX + 40, y: HEADER, w: W, h: H }, VP)).toBe(40);
      // 위쪽 한계는 헤더 아래 — 헤더 위로 민 만큼이 그대로 잡힌다(타이틀바가 깔리면 잡을 수 없다).
      expect(overflowPastClamp({ x: 100, y: HEADER - 30, w: W, h: H }, VP)).toBe(30);
      expect(overflowPastClamp({ x: 100, y: HEADER + 100, w: W, h: H }, VP)).toBe(0);
    });

    it('선이 뜨는 문턱(24px)이 손 뗌 문턱보다 낮다 — 보여 준 뒤에 내보낸다', () => {
      expect(IDE_FLOAT.POP_OUT_GHOST_ENTER_PX).toBeGreaterThan(0);
    });
  });

  describe('완전히 빼냈는가(isPulledFullyOut)', () => {
    it('앱 화면과 조금이라도 겹치면 아직 아니다', () => {
      expect(isPulledFullyOut({ x: VP.w - 1, y: 300, w: W, h: H }, VP)).toBe(false);
      expect(isPulledFullyOut({ x: 1 - W, y: 300, w: W, h: H }, VP)).toBe(false);
      expect(isPulledFullyOut({ x: 300, y: VP.h - 1, w: W, h: H }, VP)).toBe(false);
      expect(isPulledFullyOut({ x: 300, y: 1 - H, w: W, h: H }, VP)).toBe(false);
    });

    it('네 방향 어디로든 완전히 빠지면 참이다', () => {
      expect(isPulledFullyOut({ x: VP.w, y: 300, w: W, h: H }, VP)).toBe(true);
      expect(isPulledFullyOut({ x: -W, y: 300, w: W, h: H }, VP)).toBe(true);
      expect(isPulledFullyOut({ x: 300, y: VP.h, w: W, h: H }, VP)).toBe(true);
      expect(isPulledFullyOut({ x: 300, y: -H, w: W, h: H }, VP)).toBe(true);
    });

    it('커서는 앱 안인데 창만 빠져나간 경우도 잡는다 — 커서 판정만으로는 놓치던 자리', () => {
      // 타이틀바의 **왼쪽 끝**을 잡고 오른쪽으로 민 손: 커서는 아직 뷰포트 안이다.
      const cursor = { x: VP.w - 2, y: 300 };
      const rect = { x: cursor.x + 4, y: 300, w: W, h: H };
      expect(isOutsideViewport(cursor, VP)).toBe(false);
      expect(isPulledFullyOut(rect, VP)).toBe(true);
    });
  });
});

// (판올림 번호 발급 대기) §5.5 #17-6 (H-7) — **선을 켜는 이유가 하나 모자랐다.**
//
// (H-6) 은 창 자리(클램프 초과)로만 쟀는데, 창 좌상단은 `커서 - 잡은 지점`이다. 타이틀바를
// 가운데쯤 잡으면 커서가 앱 밖으로 나가는 순간에도 창은 아직 클램프 안이라 선이 **한 번도 뜨지
// 않았고**, 그 상태로 팝아웃이 나면 인계할 선이 없어 창이 커서에서 사라졌다(사용자 보고).
describe('선을 켜는 이유는 셋이다(H-7 popOutGhostDecision)', () => {
  const W = 700;
  const H = 500;
  /** 잡은 지점 `grabX` 로 타이틀바를 잡고 커서가 `cx` 에 있을 때의 창 자리. */
  const geomFor = (cx: number, grabX: number, cy = 300, grabY = 20): FloatGeom =>
    ({ x: cx - grabX, y: cy - grabY, w: W, h: H });

  it('평범한 파킹에는 선이 뜨지 않는다 — (H-6) 이 지키던 성질', () => {
    const parked = { x: VP.w - IDE_FLOAT.KEEP_VISIBLE.x, y: HEADER, w: W, h: H };
    const cursor = { x: VP.w - 2, y: HEADER + 20 };
    expect(popOutGhostDecision({ geom: parked, cursor, vp: VP, edgeDwell: false }).show).toBe(false);
  });

  it('커서가 앱 밖으로 나가면 잡은 지점과 무관하게 선이 뜬다 — 회귀의 핵심', () => {
    // 타이틀바 가운데(350px)를 잡은 손. 창 좌상단은 아직 클램프 안이라 (H-6) 기준으로는 0 이다.
    const grabX = 350;
    const cursor = { x: VP.w + 4, y: 300 };
    const geom = geomFor(cursor.x, grabX);
    expect(overflowPastClamp(geom, VP)).toBe(0);
    // 그런데도 손은 이미 앱 밖이다 — 여기서 선이 서 있어야 팝아웃이 인계할 것이 있다.
    const d = popOutGhostDecision({ geom, cursor, vp: VP, edgeDwell: false });
    expect(d.show).toBe(true);
    expect(d.armed).toBe(true);
  });

  it('왼쪽으로 뺄 때도 마찬가지다 — 종전에는 오른쪽 끝을 잡은 손만 선을 봤다', () => {
    const grabX = 350;
    const cursor = { x: -4, y: 300 };
    const geom = geomFor(cursor.x, grabX);
    expect(overflowPastClamp(geom, VP)).toBe(0);
    expect(popOutGhostDecision({ geom, cursor, vp: VP, edgeDwell: false }).show).toBe(true);
  });

  it('선이 서는 자리가 나가는 자리보다 앞이다 — 그 사이가 선이 먼저 서 있을 구간', () => {
    const grabX = 350;
    // 커서가 뷰포트를 막 벗어난 지점 — 아직 `POP_OUT_MARGIN`(24) 을 다 가지 않았다.
    const cursor = { x: VP.w + 2, y: 300 };
    expect(isOutsideViewport(cursor, VP)).toBe(false); // 아직 나가지 않았다
    expect(popOutGhostDecision({ geom: geomFor(cursor.x, grabX), cursor, vp: VP, edgeDwell: false }).show).toBe(true);
  });

  it('창만 클램프를 넘어서도 선은 뜬다 — (H-6) 의 이유는 그대로 산다', () => {
    const cursor = { x: VP.w - 40, y: 300 };
    const geom = { x: VP.w - IDE_FLOAT.KEEP_VISIBLE.x + IDE_FLOAT.POP_OUT_GHOST_ENTER_PX + 1, y: HEADER, w: W, h: H };
    expect(isOutsideViewport(cursor, VP)).toBe(false);
    expect(popOutGhostDecision({ geom, cursor, vp: VP, edgeDwell: false }).show).toBe(true);
  });

  it('가장자리 버팀도 여전히 선을 켠다 — 최대화된 단일 모니터의 유일한 길', () => {
    const geom = { x: 100, y: HEADER + 100, w: W, h: H };
    const cursor = { x: VP.w - 1, y: 300 };
    expect(popOutGhostDecision({ geom, cursor, vp: VP, edgeDwell: false }).show).toBe(false);
    expect(popOutGhostDecision({ geom, cursor, vp: VP, edgeDwell: true }).show).toBe(true);
  });

  it('무장 문턱은 선이 뜨는 문턱보다 높다 — 보여 준 뒤에 내보낸다', () => {
    expect(IDE_FLOAT.POP_OUT_GHOST_COMMIT_PX).toBeGreaterThan(IDE_FLOAT.POP_OUT_GHOST_ENTER_PX);
    const parkedX = VP.w - IDE_FLOAT.KEEP_VISIBLE.x;
    const cursor = { x: VP.w - 2, y: 300 };
    const near = { x: parkedX + IDE_FLOAT.POP_OUT_GHOST_ENTER_PX + 1, y: HEADER, w: W, h: H };
    const far = { x: parkedX + IDE_FLOAT.POP_OUT_GHOST_COMMIT_PX, y: HEADER, w: W, h: H };
    expect(popOutGhostDecision({ geom: near, cursor, vp: VP, edgeDwell: false }).armed).toBe(false);
    expect(popOutGhostDecision({ geom: far, cursor, vp: VP, edgeDwell: false }).armed).toBe(true);
  });
});

// (판올림 번호 발급 대기) §5.5 #17-1 — **자석 밀기.** 종전에는 창끼리 부딪히면 자석이 선에 붙여
//   멈춰 세웠다(그리고 문턱을 넘기면 그대로 겹쳤다). 이제 상대가 밀려나고 미는 창은 안 멎는다.
describe('자석 밀기(pushFloatGeoms)', () => {
  const G = IDE_FLOAT.PUSH_GAP;
  /** 떠 있는 창 하나 — 하한(480×320)을 넘겨야 clampFloatGeom 이 크기를 바꾸지 않는다. */
  function win(key: string, x: number, y: number, w = 500, h = 340) {
    return { key, geom: { x, y, w, h } };
  }

  it('여유 안으로 들어오면 가장 얕게 빠지는 축으로 밀어낸다 — 옆에서 밀면 옆으로', () => {
    const other = win('b', 700, 200);
    // 왼쪽에서 다가온 창이 상대 왼쪽 변을 파고든다.
    const out = pushFloatGeoms({ x: 300, y: 200, w: 500, h: 340 }, [other], VP);
    expect(out.dirs.b).toBe('right');
    // 밀린 뒤 두 창 사이에는 정확히 여유만큼이 남는다(딱 붙이지 않는다).
    expect(out.geoms.b!.x).toBe(300 + 500 + G);
    expect(out.geoms.b!.y).toBe(200); // 축이 아닌 쪽은 건드리지 않는다
  });

  it('여유 밖이면 아무 일도 없다 — 앱이 배치를 함부로 흔들지 않는다', () => {
    const other = win('b', 700, 200);
    const out = pushFloatGeoms({ x: 700 - 500 - G - 1, y: 200, w: 500, h: 340 }, [other], VP);
    expect(out.geoms).toEqual({});
  });

  it('세로로 겹치면 위아래로 민다(축은 손이 민 방향을 따른다)', () => {
    const other = win('b', 300, 500);
    const out = pushFloatGeoms({ x: 300, y: 260, w: 500, h: 340 }, [other], VP);
    expect(out.dirs.b).toBe('down');
    expect(out.geoms.b!.y).toBe(260 + 340 + G);
    expect(out.geoms.b!.x).toBe(300);
  });

  it('밀린 창이 다음 창을 또 민다 — 사슬로 이어진다', () => {
    const b = win('b', 560, 200);
    const c = win('c', 1000, 200);
    const out = pushFloatGeoms({ x: 100, y: 200, w: 500, h: 340 }, [b, c], VP);
    expect(out.geoms.b).toBeDefined();
    expect(out.geoms.c).toBeDefined();
    // b 는 미는 창 옆에, c 는 밀린 b 옆에 — 셋이 여유를 두고 줄지어 선다.
    expect(out.geoms.b!.x).toBe(100 + 500 + G);
    expect(out.geoms.c!.x).toBe(out.geoms.b!.x + 500 + G);
  });

  it('한 번 정한 방향은 지킨다 — 축이 도중에 뒤집히면 창이 손 앞에서 튄다', () => {
    const other = win('b', 700, 200);
    // 아주 조금만 파고든 자리 — 그대로 두면 더 얕은 축(위/아래)으로 갈아탈 만한 상황이다.
    // 오른쪽으로 40px, 위로 22px 만 빠지면 되는 자리 — 그대로 두면 더 얕은 'up' 으로 갈아탄다.
    const mover = { x: 228, y: 530, w: 500, h: 340 };
    const kept = pushFloatGeoms(mover, [other], VP, { b: 'right' });
    expect(kept.dirs.b).toBe('right');
    const fresh = pushFloatGeoms(mover, [other], VP);
    expect(fresh.dirs.b).toBe('up');
  });

  it('밀려도 화면 밖으로 잃지 않는다 — 끝에 닿으면 거기서 버틴다', () => {
    const other = win('b', VP.w - 500, 200);
    const out = pushFloatGeoms({ x: VP.w - 500 - 200, y: 200, w: 500, h: 340 }, [other], VP);
    const landed = out.geoms.b;
    expect(landed).toBeDefined();
    // 오른쪽으로 밀려도 최소 가시 폭은 화면 안에 남는다(그 자락을 잡아 끌어온다).
    expect(landed!.x).toBeLessThanOrEqual(VP.w - IDE_FLOAT.KEEP_VISIBLE.x);
  });

  it('여유는 붙는 자석보다 넓다 — 그래서 창끼리는 선에 붙어 멎지 않는다', () => {
    expect(IDE_FLOAT.PUSH_GAP).toBeGreaterThan(IDE_FLOAT.MAGNET_PX);
  });
});

describe('밀림 따라붙기(easeFloatPushOffset)', () => {
  it('한 프레임에 다 가지 않는다 — 이 지연이 자석처럼 보이게 한다', () => {
    const step = easeFloatPushOffset({ dx: 0, dy: 0 }, { dx: 100, dy: 0 });
    expect(step.done).toBe(false);
    expect(step.dx).toBeGreaterThan(0);
    expect(step.dx).toBeLessThan(100);
  });

  it('반 픽셀 안이면 목표에 정확히 앉힌다 — 소수점이 영영 수렴해 rAF 가 안 멎는 것을 막는다', () => {
    const step = easeFloatPushOffset({ dx: 99.9, dy: 0 }, { dx: 100, dy: 0 });
    expect(step.done).toBe(true);
    expect(step.dx).toBe(100);
  });

  it('밀림이 없으면 곧바로 다 온 것으로 본다', () => {
    expect(easeFloatPushOffset({ dx: 0, dy: 0 }, { dx: 0, dy: 0 }).done).toBe(true);
  });
});

// (판올림 번호 발급 대기) §5.5 #17-1 — 도크 손잡이도 같은 규칙이다: 부딪히면 멈추는 것이 아니라
//   마주 보는 도크가 비켜 준다. 다만 **캔버스 여유는 끝까지 지킨다**(밀기는 남의 자리를 얻는 일이지
//   캔버스를 없애는 일이 아니다).
describe('도크 밀기(pushDockSize)', () => {
  it('반대편이 없으면 종전과 같다 — 캔버스 최소치에서 멎는다', () => {
    const out = pushDockSize('left', 99999, VP, []);
    expect(out.opposite).toBeNull();
    expect(out.size).toBe(VP.w - IDE_DOCK.KEEP_CANVAS.w);
  });

  it('반대편을 안 건드리고 갈 수 있는 데까지는 밀지 않는다', () => {
    const docked = [pane('r', 'right', 480)];
    const room = VP.w - 480 - IDE_DOCK.KEEP_CANVAS.w;
    const out = pushDockSize('left', room - 40, VP, docked);
    expect(out.opposite).toBeNull();
    expect(out.size).toBe(room - 40);
  });

  it('그 문턱을 넘기면 마주 보는 도크가 밀려난다 — 손잡이가 멎지 않는다', () => {
    const docked = [pane('r', 'right', 480)];
    const room = VP.w - 480 - IDE_DOCK.KEEP_CANVAS.w;
    const out = pushDockSize('left', room + 120, VP, docked);
    expect(out.opposite).toEqual({ side: 'right', size: 480 - 120 });
    expect(out.size).toBe(room + 120);
  });

  it('반대편도 자기 하한까지만 양보한다 — 0 으로 접으면 그 창을 읽을 수 없다', () => {
    const docked = [pane('r', 'right', 480)];
    const out = pushDockSize('left', 99999, VP, docked);
    expect(out.opposite!.size).toBe(IDE_DOCK.MIN_SIZE);
    // 밀 만큼 밀어도 캔버스 여유는 남는다.
    expect(out.size + out.opposite!.size).toBe(VP.w - IDE_DOCK.KEEP_CANVAS.w);
  });

  it('상/하 도크는 헤더 아래 높이를 기준으로 민다', () => {
    const docked = [pane('b', 'bottom', 320)];
    const band = VP.h - HEADER;
    const room = band - 320 - IDE_DOCK.KEEP_CANVAS.h;
    const out = pushDockSize('top', room + 30, VP, docked);
    expect(out.opposite).toEqual({ side: 'bottom', size: 320 - 30 });
  });

  it('밀어도 자기 하한 아래로는 안 내려간다', () => {
    expect(pushDockSize('left', 10, VP, []).size).toBe(IDE_DOCK.MIN_SIZE);
  });
});

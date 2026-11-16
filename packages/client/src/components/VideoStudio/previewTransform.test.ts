import { describe, expect, it } from 'vitest';
import { buildDrawList, createEmptyDoc, opBox, opRect, resolveTimeline, safeAreaRect, summarizeLayout, type VideoDoc, type VideoItem, type VideoTrack } from '@vibisual/video';

import {
  CORNERS,
  MIN_BOX_DOC_PX,
  SNAP_SCREEN_PX,
  anchoredBox,
  boxCorners,
  boxTransform,
  guidesTouching,
  handlePoints,
  innerBoxValues,
  insideBox,
  keepReachable,
  movedEnough,
  movedTransform,
  movedValue,
  resizeBox,
  resizeBoxSnapped,
  rotatedBounds,
  screenLength,
  screenToDoc,
  snapLines,
  snapMove,
} from './previewTransform.js';

/** §5.13 (V) 37-21 — 미리보기 끌기의 순수 계산. */
function docWith(items: VideoItem[], extra: Partial<VideoDoc> = {}): VideoDoc {
  const base = createEmptyDoc('drag', 'Drag', 1);
  const tracks: VideoTrack[] = items.map((item, i) => ({ id: `v${i + 1}`, kind: 'visual', items: [item] }));
  return { ...base, ...extra, tracks: [...tracks, ...base.tracks.filter((t) => t.kind !== 'visual')] };
}
const shape = (id: string, transform?: VideoItem['transform'], extra: Partial<VideoItem> = {}): VideoItem => ({ id, kind: 'shape', at: 0, duration: 6, transform, ...extra });
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const resize = { keepAspect: false, minSize: MIN_BOX_DOC_PX };

describe('화면 ↔ 문서 좌표', () => {
  it('판의 왼쪽 위에서 잰 화면 거리를 배율로 나눈다(맞춤 0.5배 · 100%)', () => {
    expect(screenToDoc(300, 140, { left: 100, top: 40 }, 0.5)).toEqual({ x: 400, y: 200 });
    expect(screenToDoc(300, 140, { left: 100, top: 40 }, 1)).toEqual({ x: 200, y: 100 });
  });

  it('배율을 아직 모르면(0) 1 로 본다 — 0 으로 나누지 않는다', () => {
    expect(screenToDoc(10, 20, { left: 0, top: 0 }, 0)).toEqual({ x: 10, y: 20 });
    expect(screenLength(6, 0)).toBe(6);
  });

  it('붙는 문턱은 화면 px 다 — 미리보기를 줄여 볼수록 문서 px 로는 커진다', () => {
    expect(screenLength(SNAP_SCREEN_PX, 0.25)).toBe(24);
    expect(screenLength(SNAP_SCREEN_PX, 1)).toBe(6);
  });

  it('누른 자리에서 4 화면 px 넘게 가야 끌기다', () => {
    expect(movedEnough(2, 2)).toBe(false);
    expect(movedEnough(4, 0)).toBe(true);
    expect(movedEnough(-3, 3)).toBe(true);
    expect(movedEnough(4, 0, 'mouse')).toBe(true);
    expect(movedEnough(4, 0, '')).toBe(true);
  });

  it('터치·펜은 10 화면 px — 손가락 탭이 5px 흔들려도 고르기다', () => {
    for (const type of ['touch', 'pen']) {
      expect(movedEnough(5, 0, type)).toBe(false);
      expect(movedEnough(6, 7, type)).toBe(false);
      expect(movedEnough(10, 0, type)).toBe(true);
      expect(movedEnough(-8, 8, type)).toBe(true);
    }
  });
});

describe('스냅 선 — 검수·배치 요약과 같은 상자·같은 안전 영역', () => {
  const doc = docWith([shape('a', { x: 100, y: 100, width: 200, height: 100 }), shape('b', { x: 600, y: 400, width: 300, height: 200 }), { id: 'cap', kind: 'caption', at: 0, duration: 6, cues: [{ start: 0, end: 6, text: 'hi' }] }]);
  const timeline = resolveTimeline(doc);
  const at = (axis: 'x' | 'y', kind: string) => snapLines(doc, timeline, 1, 'a').filter((l) => l.axis === axis && l.kind === kind).map((l) => l.at);

  it('화면 가운데 · 안전 영역 네 변 · 화면 가장자리', () => {
    const safe = safeAreaRect(doc.size);
    expect(at('x', 'center')).toEqual([doc.size.width / 2]);
    expect(at('y', 'center')).toEqual([doc.size.height / 2]);
    expect(at('x', 'safe')).toEqual([safe.x, safe.x + safe.width]);
    expect(at('y', 'safe')).toEqual([safe.y, safe.y + safe.height]);
    expect(at('x', 'frame')).toEqual([0, doc.size.width]);
    // 안전 영역은 배치 요약이 말하는 것과 같은 사각형이다.
    expect(summarizeLayout({ doc, timeline, t: 1 }).safeArea).toEqual({ x: Math.round(safe.x), y: Math.round(safe.y), width: Math.round(safe.width), height: Math.round(safe.height) });
  });

  it('다른 아이템의 변·가운데 — 끄는 아이템·자막은 뺀다', () => {
    expect(at('x', 'item')).toEqual([600, 750, 900]);
    expect(at('y', 'item')).toEqual([400, 500, 600]);
    const other = buildDrawList(doc, timeline, 1).find((o) => o.itemId === 'b')!;
    expect(opRect(other)).toEqual(box(600, 400, 300, 200));
  });

  it('그 시각에 그려지지 않는 아이템(꺼 둔 것 · 숨긴 트랙)은 선이 없다', () => {
    const off = docWith([shape('a'), shape('b', { x: 600, y: 400, width: 300, height: 200 }, { enabled: false })]);
    expect(snapLines(off, resolveTimeline(off), 1, 'a').some((l) => l.kind === 'item')).toBe(false);
    const hidden: VideoDoc = { ...doc, tracks: doc.tracks.map((t) => (t.id === 'v2' ? { ...t, hidden: true } : t)) };
    expect(snapLines(hidden, resolveTimeline(hidden), 1, 'a').some((l) => l.kind === 'item')).toBe(false);
  });

  it('같은 자리의 선은 앞선 것 하나만 남는다(화면을 채운 아이템의 변 = 화면 가장자리)', () => {
    const full = docWith([shape('a', { x: 10, y: 10, width: 50, height: 50 }), shape('bg')]);
    const lines = snapLines(full, resolveTimeline(full), 1, 'a');
    expect(lines.filter((l) => l.axis === 'x' && l.at === 0).map((l) => l.kind)).toEqual(['frame']);
    expect(lines.filter((l) => l.axis === 'x' && l.at === full.size.width / 2).map((l) => l.kind)).toEqual(['center']);
  });
});

describe('옮길 때 붙기', () => {
  const lines = [
    { axis: 'x', at: 960, kind: 'center' }, { axis: 'y', at: 540, kind: 'center' },
    { axis: 'x', at: 600, kind: 'item' }, { axis: 'x', at: 0, kind: 'frame' },
  ] as const;

  it('가운데가 문턱 안이면 가운데 선에 붙고 그 선을 안내선으로 낸다', () => {
    const snap = snapMove(box(855, 300, 200, 100), lines, 8);
    expect(snap.dx).toBe(5);
    expect(snap.dy).toBe(0);
    expect(snap.guides).toEqual([{ axis: 'x', at: 960, kind: 'center' }]);
  });

  it('왼쪽 변·오른쪽 변도 붙는다 — 가장 가까운 것 하나로', () => {
    expect(snapMove(box(603, 0, 100, 100), lines, 8).dx).toBe(-3);
    expect(snapMove(box(496, 0, 100, 100), lines, 8).dx).toBe(4);
  });

  it('문턱 밖이면 붙지 않고 안내선도 없다', () => {
    expect(snapMove(box(620, 300, 100, 100), lines, 8)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('문턱 0(스냅 끔)이면 아무것도 붙지 않는다', () => {
    expect(snapMove(box(959, 539, 2, 2), lines, 0)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('같은 문서 거리도 미리보기 배율에 따라 붙고 안 붙는다(문턱이 화면 px 라서)', () => {
    const near = box(930, 0, 20, 20);
    expect(snapMove(near, lines, screenLength(SNAP_SCREEN_PX, 1)).dx).toBe(0);
    expect(snapMove(near, lines, screenLength(SNAP_SCREEN_PX, 0.25)).dx).toBe(10);
  });

  it('닿아 있는 선만 고른다', () => {
    expect(guidesTouching(box(600, 0, 100, 100), lines, 0.5)).toEqual([{ axis: 'x', at: 600, kind: 'item' }]);
    expect(guidesTouching(box(601, 0, 100, 100), lines, 0.5)).toEqual([]);
  });
});

describe('화면 밖', () => {
  const frame = { width: 1920, height: 1080 };

  it('끌어서는 상자를 화면 밖으로 완전히 내보내지 못한다 — 남길 몫만큼은 걸친다', () => {
    expect(keepReachable(box(100, 100, 200, 100), -5000, 0, frame, 32)).toEqual({ x: -268, y: 0 });
    expect(keepReachable(box(100, 100, 200, 100), 5000, 5000, frame, 32)).toEqual({ x: 1788, y: 948 });
  });

  it('화면 안에서의 이동은 그대로다', () => {
    expect(keepReachable(box(100, 100, 200, 100), 40, -30, frame, 32)).toEqual({ x: 40, y: -30 });
  });

  it('이미 밖에 있던 상자는 안쪽으로는 끌려온다(더 멀어지지만 않는다)', () => {
    const lost = box(-900, 100, 200, 100);
    expect(keepReachable(lost, -50, 0, frame, 32).x).toBe(0);
    expect(keepReachable(lost, 300, 0, frame, 32).x).toBe(300);
  });

  it('화면 밖 모서리의 손잡이는 가장자리로 당겨 그린다', () => {
    const pts = handlePoints(box(-100, -50, 400, 300), 0, frame);
    expect(pts.nw).toEqual({ x: 0, y: 0 });
    expect(pts.se).toEqual({ x: 300, y: 250 });
    expect(handlePoints(box(1800, 1000, 400, 300), 0, frame).se).toEqual({ x: 1920, y: 1080 });
  });
});

describe('크기 조절', () => {
  const start = box(100, 100, 200, 100);

  it('맞은편 모서리는 제자리다', () => {
    expect(resizeBox(start, 0, 'se', 50, 20, resize)).toEqual(box(100, 100, 250, 120));
    expect(resizeBox(start, 0, 'nw', 50, 20, resize)).toEqual(box(150, 120, 150, 80));
    expect(resizeBox(start, 0, 'ne', 50, 20, resize)).toEqual(box(100, 120, 250, 80));
    expect(resizeBox(start, 0, 'sw', 50, 20, resize)).toEqual(box(150, 100, 150, 120));
  });

  it('크기 하한 아래로는 줄지 않는다', () => {
    const tiny = resizeBox(start, 0, 'se', -1000, -1000, resize);
    expect(tiny).toEqual(box(100, 100, MIN_BOX_DOC_PX, MIN_BOX_DOC_PX));
    const fromWest = resizeBox(start, 0, 'nw', 1000, 1000, resize);
    expect(fromWest.x + fromWest.width).toBe(300);
    expect(fromWest.y + fromWest.height).toBe(200);
  });

  it('Shift — 처음 비율(2:1)을 지킨다. 더 많이 끈 축을 따른다', () => {
    const wide = resizeBox(start, 0, 'se', 100, 0, { ...resize, keepAspect: true });
    expect(wide).toEqual(box(100, 100, 300, 150));
    const tall = resizeBox(start, 0, 'se', 0, 100, { ...resize, keepAspect: true });
    expect(tall).toEqual(box(100, 100, 400, 200));
    const shrunk = resizeBox(start, 0, 'nw', 100, 50, { ...resize, keepAspect: true });
    expect(shrunk.width / shrunk.height).toBeCloseTo(2);
    expect(shrunk.x + shrunk.width).toBeCloseTo(300);
    expect(shrunk.y + shrunk.height).toBeCloseTo(200);
  });

  it('Shift — 하한에서도 비율이 그대로다', () => {
    const tiny = resizeBox(start, 0, 'se', -1000, -1000, { ...resize, keepAspect: true });
    expect(tiny.height).toBe(MIN_BOX_DOC_PX);
    expect(tiny.width).toBe(MIN_BOX_DOC_PX * 2);
  });

  it('돌린 아이템은 그 축을 따라 바뀌고 맞은편 모서리가 화면에서 제자리다', () => {
    const before = boxCorners(start, 90);
    // 90도 돌린 상자에서 화면 아래로 끄는 것은 아이템의 가로를 늘리는 것이다.
    const after = resizeBox(start, 90, 'se', 0, 40, resize);
    expect(after.width).toBeCloseTo(240);
    expect(after.height).toBeCloseTo(100);
    const moved = boxCorners(after, 90);
    expect(moved.nw.x).toBeCloseTo(before.nw.x);
    expect(moved.nw.y).toBeCloseTo(before.nw.y);
    expect(moved.se.y - before.se.y).toBeCloseTo(40);
  });

  it('크기만 주면 맞은편 모서리를 붙든 상자를 낸다', () => {
    expect(anchoredBox(start, 0, 'nw', 50, 40)).toEqual(box(250, 160, 50, 40));
  });

  it('움직이는 모서리의 두 변이 선에 붙는다', () => {
    const lines = [{ axis: 'x', at: 400, kind: 'item' }, { axis: 'y', at: 250, kind: 'safe' }] as const;
    const r = resizeBoxSnapped(start, 'se', 96, 47, resize, lines, 6);
    expect(r.box).toEqual(box(100, 100, 300, 150));
    expect(r.guides).toEqual([...lines]);
    expect(resizeBoxSnapped(start, 'se', 80, 30, resize, lines, 6).guides).toEqual([]);
  });

  it('Shift — 더 가까운 한 변에 맞추고 비율을 지킨다', () => {
    const lines = [{ axis: 'x', at: 400, kind: 'item' }] as const;
    const r = resizeBoxSnapped(start, 'se', 97, 0, { ...resize, keepAspect: true }, lines, 6);
    expect(r.box).toEqual(box(100, 100, 300, 150));
    expect(r.guides).toEqual([...lines]);
  });

  it('맞은편을 넘어가는 선에는 붙지 않는다', () => {
    const lines = [{ axis: 'x', at: 98, kind: 'item' }] as const;
    const r = resizeBoxSnapped(start, 'se', -195, 0, resize, lines, 6);
    expect(r.box.width).toBe(MIN_BOX_DOC_PX);
    expect(r.guides).toEqual([]);
  });
});

describe('회전', () => {
  it('돌린 상자의 외곽 — 90도면 가로·세로가 바뀐다', () => {
    const b = rotatedBounds(box(100, 100, 200, 100), 90);
    expect(b.x).toBeCloseTo(150);
    expect(b.y).toBeCloseTo(50);
    expect(b.width).toBeCloseTo(100);
    expect(b.height).toBeCloseTo(200);
    expect(rotatedBounds(box(1, 2, 3, 4), 0)).toEqual(box(1, 2, 3, 4));
  });

  it('돌린 상자 안팎 판정', () => {
    const b = box(100, 100, 200, 100);
    expect(insideBox(b, 0, 110, 110)).toBe(true);
    expect(insideBox(b, 90, 110, 110)).toBe(false);
    expect(insideBox(b, 90, 200, 60)).toBe(true);
  });

  it('모서리 이름은 돌려도 그 아이템의 모서리다', () => {
    const c = boxCorners(box(0, 0, 200, 100), 180);
    expect(c.nw.x).toBeCloseTo(200);
    expect(c.nw.y).toBeCloseTo(100);
    expect(Object.keys(c)).toEqual([...CORNERS]);
  });
});

describe('표시 상자 → 아이템 transform', () => {
  const size = { width: 1920, height: 1080 };
  const opOf = (item: VideoItem, t = 1) => {
    const doc = docWith([item]);
    return buildDrawList(doc, resolveTimeline(doc), t)[0]!;
  };

  it('옮기기 — 적힌 자리에 거리를 더한다(배치를 안 적은 아이템은 0,0 에서)', () => {
    expect(movedTransform(opOf(shape('a', { x: 100, y: 50, width: 200, height: 100 })), size, 30, -20)).toEqual({ x: 130, y: 30 });
    expect(movedTransform(opOf(shape('a')), size, 12.345, 0)).toEqual({ x: 12.35, y: 0 });
  });

  it('키프레임이 얹은 이동은 적는 값에 섞이지 않는다 — 끈 만큼만 바뀐다', () => {
    const op = opOf(shape('a', { x: 100, y: 50, width: 200, height: 100 }, { keyframes: [{ t: 0, dx: 0 }, { t: 2, dx: 80 }] }), 2);
    expect(op.transform.x).toBe(180);
    expect(movedTransform(op, size, 10, 0)).toEqual({ x: 110, y: 50 });
  });

  it('표시 상자를 그대로 넣으면 적힌 배치가 그대로 나온다(배율·키프레임이 있어도)', () => {
    for (const item of [
      shape('a', { x: 100, y: 50, width: 200, height: 100 }),
      shape('a', { x: 100, y: 50, width: 200, height: 100, scale: 0.5 }),
      shape('a', { x: 100, y: 50, width: 200, height: 100 }, { keyframes: [{ t: 0, dx: 0, scale: 1 }, { t: 1, dx: 40, dy: -10, scale: 1.5 }] }),
    ]) {
      const op = opOf(item);
      expect(boxTransform(op, size, opBox(op))).toEqual({ x: 100, y: 50, width: 200, height: 100 });
    }
  });

  it('배율이 걸린 아이템의 크기는 배율로 되돌려 적는다', () => {
    const op = opOf(shape('a', { x: 100, y: 50, width: 200, height: 100, scale: 0.5 }));
    // 표시 상자 (150,75) 100x50 → 오른쪽 아래로 두 배.
    const patch = boxTransform(op, size, box(150, 75, 200, 100))!;
    expect(patch).toEqual({ x: 50, y: 25, width: 400, height: 200 });
    // 그 배치를 다시 그리면 손으로 끈 그 상자가 나온다.
    const again = opOf(shape('a', { ...patch, scale: 0.5 }));
    expect(opBox(again)).toEqual(box(150, 75, 200, 100));
  });

  it('배율 0 인 아이템은 환산할 수 없다', () => {
    expect(boxTransform(opOf(shape('a', { scale: 0 })), size, box(0, 0, 10, 10))).toBeNull();
  });
});

describe('컴포지션 안쪽 — 값으로 선언한 위치·크기', () => {
  const comp = (propsDecl: NonNullable<VideoDoc['assets'][string]['propsDecl']>, props?: Record<string, unknown>): VideoDoc => ({
    ...docWith([{ id: 'c1', kind: 'composition', assetId: 'comp', at: 0, duration: 4, ...(props ? { props } : {}) }]),
    assets: { comp: { id: 'comp', kind: 'composition', source: { kind: 'file', path: 'a/index.html' }, propsDecl } },
  });
  const num = (name: string, extra: Record<string, number> = {}) => ({ name, type: 'number' as const, ...extra });

  it('number 로 선언한 값만 남는다 — 값은 props, 없으면 선언 기본값', () => {
    const doc = comp([num('cardX', { default: 40 }), num('cardY', { default: 10, min: 0, max: 500, step: 5 })], { cardX: 120 });
    const v = innerBoxValues(doc, 'c1', { x: 'cardX', y: 'cardY' })!;
    expect(v.values.x).toEqual({ name: 'cardX', value: 120, min: undefined, max: undefined, step: 1 });
    expect(v.values.y).toEqual({ name: 'cardY', value: 10, min: 0, max: 500, step: 5 });
    expect(v.move).toBe(true);
    expect(v.corners).toEqual([]);
  });

  it('선언이 없거나 number 가 아니면 그 축은 없는 것이다 — 하나도 없으면 손잡이가 없다', () => {
    const doc = comp([{ name: 'title', type: 'text', default: 'Hi' }, num('cardW', { default: 200 })]);
    expect(innerBoxValues(doc, 'c1', { x: 'title', y: 'nope' })).toBeNull();
    expect(innerBoxValues(doc, 'c1', {})).toBeNull();
    const onlyW = innerBoxValues(doc, 'c1', { x: 'title', w: 'cardW' })!;
    expect(onlyW.move).toBe(false);
    expect(onlyW.corners).toEqual(['se']);
  });

  it('넷이 다 값이면 네 모서리', () => {
    const doc = comp([num('x'), num('y'), num('w', { default: 100 }), num('h', { default: 50 })]);
    expect(innerBoxValues(doc, 'c1', { x: 'x', y: 'y', w: 'w', h: 'h' })!.corners).toEqual([...CORNERS]);
  });

  it('컴포지션이 아닌 아이템·없는 아이템은 null', () => {
    const doc = docWith([shape('s')]);
    expect(innerBoxValues(doc, 's', { x: 'a' })).toBeNull();
    expect(innerBoxValues(doc, 'gone', { x: 'a' })).toBeNull();
  });

  it('문서 거리 → 값: 값 1 이 문서에서 몇 px 인지로 나누고 눈금·범위를 지킨다', () => {
    expect(movedValue({ name: 'x', value: 100, step: 1 }, 30, 0.5)).toBe(160);
    expect(movedValue({ name: 'x', value: 100, step: 5 }, 13, 1)).toBe(115);
    expect(movedValue({ name: 'x', value: 100, step: 1, min: 0, max: 120 }, 500, 1)).toBe(120);
    expect(movedValue({ name: 'x', value: 100, step: 1, min: 0, max: 120 }, -500, 1)).toBe(0);
    expect(movedValue({ name: 'x', value: 0.5, step: 0.1 }, 0.26, 1)).toBe(0.8);
  });
});

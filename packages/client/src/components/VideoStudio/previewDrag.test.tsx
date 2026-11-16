import { createElement, useMemo, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPatch, buildDrawList, createEmptyDoc, hitTest, opBox, resolveTimeline, type VideoAsset, type VideoDoc, type VideoDocOp, type VideoItem, type VideoTrack } from '@vibisual/video';
import type { StagePick } from '@vibisual/video/render';

import { useLocalProps, type LocalProps } from './useLocalProps.js';
import { useLocalTransform } from './useLocalTransform.js';
import { usePreviewInteraction, type PreviewInteraction } from './usePreviewInteraction.js';

/**
 * §5.13 (V) 37-21 — 미리보기에서 끌어 옮기기·크기 조절. 셸과 같은 순서로 묶는다(값 사본 → 배치 사본 → 손짓) — 끄는 동안에는
 * 문서에 쓰지 않고, 놓을 때 평소 편집 경로로 한 번만 쓴다.
 */
const SIZE = { width: 1920, height: 1080 };
const shape = (id: string, transform?: VideoItem['transform'], extra: Partial<VideoItem> = {}): VideoItem => ({ id, kind: 'shape', at: 0, duration: 6, transform, ...extra });
function docWith(items: VideoItem[], assets: Record<string, VideoAsset> = {}): VideoDoc {
  const tracks: VideoTrack[] = items.map((item, i) => ({ id: `v${i + 1}`, kind: 'visual', items: [item] }));
  return { ...createEmptyDoc('vid', 'Demo'), size: SIZE, tracks, assets };
}
const itemOf = (doc: VideoDoc | null, id: string): VideoItem | undefined => doc?.tracks.flatMap((t) => t.items).find((i) => i.id === id);
const MODS = { keepAspect: false, free: false };
/** 훅이 목록의 정체로 효과를 거는 칸 — 렌더마다 새 배열을 주면 끝없이 다시 그린다. */
const NONE: readonly never[] = [];

interface Setup {
  mode?: 'canvas' | 'stage';
  interaction?: 'none' | 'point' | 'note';
  enabled?: boolean;
  selected?: string | null;
  playhead?: number;
  pickAt?: (x: number, y: number) => Promise<StagePick | null>;
  settle?: () => Promise<unknown>;
  reopen?: (itemId: string) => Promise<unknown>;
}

let view: ReactTestRenderer | undefined;
let ix: PreviewInteraction;
let shown: VideoDoc | null;
let selectedNow: string | null;
let saved: VideoDoc;
let sent: VideoDocOp[][];
let setup: Setup;
let force: () => void;
/** 값 손잡이 사본(값 손잡이로 고치는 흉내 · 저장 붙들기 확인). */
let lp: LocalProps;

function Harness(): null {
  const [, setTick] = useState(0);
  force = () => setTick((n) => n + 1);
  const [selected, setSelected] = useState<string | null>(setup.selected ?? null);
  const apply = async (ops: readonly VideoDocOp[]): Promise<boolean> => {
    sent.push([...ops]);
    const result = applyPatch(saved, { baseVersion: saved.version, ops: [...ops] }, 200);
    if (!result.ok) return false;
    saved = result.doc;
    force();
    return true;
  };
  const props = useLocalProps(saved, apply);
  lp = props;
  const layout = useLocalTransform(props.previewDoc, apply);
  const doc = layout.previewDoc;
  const timeline = useMemo(() => (doc ? resolveTimeline(doc) : null), [doc]);
  shown = doc;
  selectedNow = selected;
  ix = usePreviewInteraction({
    projectName: 'demo', doc, timeline, playhead: setup.playhead ?? 1, mode: setup.mode ?? 'stage', interaction: setup.interaction ?? 'none',
    selectedItemId: selected, setSelectedItemId: setSelected,
    pickAt: setup.pickAt ?? (async () => null),
    addPointed: () => undefined, pointed: NONE, notes: NONE, addNote: async () => null,
    onSetProp: props.setProp, onNoteAdded: () => undefined,
    drag: {
      enabled: setup.enabled ?? true, layout, holdProps: props.hold, revertProps: props.revertProps,
      ...(setup.settle ? { settle: setup.settle } : {}), ...(setup.reopen ? { reopen: setup.reopen } : {}),
    },
  });
  return null;
}
function mount(doc: VideoDoc, s: Setup = {}): void {
  saved = doc;
  setup = s;
  act(() => { view = create(createElement(Harness)); });
}
const rerender = (s: Partial<Setup>): void => { setup = { ...setup, ...s }; act(() => force()); };
const flush = async (ms = 0): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
/** 한 번의 끌기 — 누르고, 거쳐 가고, 놓는다. */
function dragBy(from: { x: number; y: number }, steps: readonly { x: number; y: number }[], corner: 'nw' | 'ne' | 'se' | 'sw' | null = null, mods = MODS, scale = 1): boolean {
  let grabbed = false;
  act(() => { grabbed = ix.drag?.begin(from, corner, scale) ?? false; });
  if (!grabbed) return false;
  for (const at of steps) act(() => ix.drag?.move(at, mods));
  return true;
}
const drop = async (): Promise<void> => { await act(async () => { ix.drag?.end(); }); };

beforeEach(() => { vi.useFakeTimers(); sent = []; });
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); });

describe('손잡이가 서는 때', () => {
  const doc = docWith([shape('bg'), shape('card', { x: 100, y: 100, width: 200, height: 100 }), { id: 'cap', kind: 'caption', at: 0, duration: 6, cues: [{ start: 0, end: 6, text: 'hi' }] }]);

  it('고른 아이템의 배치 상자에 네 모서리 손잡이가 선다 — 배치 요약·가리키기와 같은 상자다', () => {
    mount(doc, { selected: 'card' });
    expect(ix.handles).toEqual({ kind: 'item', box: { x: 100, y: 100, width: 200, height: 100 }, rotation: 0, corners: ['nw', 'ne', 'se', 'sw'] });
    const op = buildDrawList(doc, resolveTimeline(doc), 1).find((o) => o.itemId === 'card')!;
    expect(ix.handles!.box).toEqual(opBox(op));
    expect(ix.drag).not.toBeNull();
  });

  it('아무것도 고르지 않았으면 틀은 없다(끌기는 누른 것을 고르면서 시작할 수 있다)', () => {
    mount(doc);
    expect(ix.handles).toBeNull();
    expect(ix.drag).not.toBeNull();
  });

  it.each(['point', 'note'] as const)('%s 모드에서는 손잡이도 끌기도 없다 — 종전 테는 남는다', (interaction) => {
    mount(doc, { selected: 'card', interaction });
    expect(ix.handles).toBeNull();
    expect(ix.drag).toBeNull();
    expect(ix.rings.map((r) => r.id)).toContain('selected');
  });

  it('재생 중·편집할 수 없을 때는 손잡이도 끌기도 없다', () => {
    mount(doc, { selected: 'card', enabled: false });
    expect(ix.handles).toBeNull();
    expect(ix.drag).toBeNull();
    expect(ix.overlaysAt(2).handles ?? null).toBeNull();
    expect(ix.rings.map((r) => r.id)).toContain('selected');
  });

  it('자막은 상자가 없어 손잡이가 없고 끌리지 않는다', () => {
    mount(doc, { selected: 'cap' });
    expect(ix.handles).toBeNull();
    // 자막 띠를 누르고 끌어도 끌기가 시작되지 않는다(그 아래 배경이 대신 끌려가지도 않는다).
    expect(dragBy({ x: 960, y: 950 }, [{ x: 960, y: 900 }])).toBe(false);
    expect(shown).toBe(saved);
  });

  it('그 시각에 그려지지 않는 아이템은 손잡이가 없다', () => {
    mount(docWith([shape('late', { x: 0, y: 0, width: 10, height: 10 }, { at: 3 })]), { selected: 'late', playhead: 1 });
    expect(ix.handles).toBeNull();
  });

  it('제자리 글자 칸이 열려 있으면 손잡이를 걷는다', async () => {
    mount(docWith([{ id: 'word', kind: 'text', at: 0, duration: 6, props: { text: 'Hi', fontSize: 64 } }]), { selected: 'word' });
    expect(ix.handles).not.toBeNull();
    await act(async () => { ix.onDoublePress(960, 540); });
    expect(ix.edit).not.toBeNull();
    expect(ix.handles).toBeNull();
    expect(ix.drag).toBeNull();
  });
});

describe('옮기기 — 끌기 한 번 = 쓰기 한 번', () => {
  const doc = (): VideoDoc => docWith([shape('bg'), shape('card', { x: 100, y: 100, width: 200, height: 100, opacity: 0.8 })]);

  it('끄는 동안에는 화면 사본만 바뀌고, 놓으면 updateItem{transform} 하나가 나간다', async () => {
    mount(doc(), { selected: 'card' });
    const version = saved.version;
    expect(dragBy({ x: 150, y: 150 }, Array.from({ length: 30 }, (_, i) => ({ x: 150 + (i + 1) * 3, y: 150 + (i + 1) * 2 })), null, { keepAspect: false, free: true })).toBe(true);
    expect(sent).toEqual([]);
    expect(saved.version).toBe(version);
    expect(itemOf(shown, 'card')?.transform).toEqual({ x: 190, y: 160, width: 200, height: 100, opacity: 0.8 });
    expect(ix.handles?.box).toEqual({ x: 190, y: 160, width: 200, height: 100 });
    await drop();
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'card', patch: { transform: { x: 190, y: 160, width: 200, height: 100, opacity: 0.8 } } }]]);
    expect(saved.version).toBe(version + 1);
    expect(shown).toBe(saved);
  });

  it('고르지 않은 것을 누른 채 끌면 그것을 고르면서 옮긴다', async () => {
    mount(doc());
    dragBy({ x: 150, y: 150 }, [{ x: 250, y: 150 }], null, { keepAspect: false, free: true });
    expect(selectedNow).toBe('card');
    await drop();
    expect(itemOf(saved, 'card')?.transform).toMatchObject({ x: 200, y: 100 });
  });

  it('고른 것의 상자 안에서 시작하면 위에 다른 것이 덮여 있어도 고른 것을 옮긴다', async () => {
    mount(docWith([shape('card', { x: 100, y: 100, width: 200, height: 100 }), shape('cover')]), { selected: 'card' });
    expect(hitTest(saved, resolveTimeline(saved), 1, 150, 150)?.op.itemId).toBe('cover');
    dragBy({ x: 150, y: 150 }, [{ x: 160, y: 150 }], null, { keepAspect: false, free: true });
    await drop();
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'card', patch: { transform: { x: 110, y: 100, width: 200, height: 100 } } }]]);
    expect(selectedNow).toBe('card');
  });

  it('빈 곳에서는 끌기가 시작되지 않는다', () => {
    mount(docWith([shape('card', { x: 100, y: 100, width: 200, height: 100 })]));
    expect(dragBy({ x: 900, y: 900 }, [{ x: 950, y: 900 }])).toBe(false);
    expect(sent).toEqual([]);
  });

  it('누르기만 하고 놓으면 아무것도 쓰지 않는다', async () => {
    mount(doc(), { selected: 'card' });
    dragBy({ x: 150, y: 150 }, []);
    await drop();
    expect(sent).toEqual([]);
    expect(shown).toBe(saved);
  });

  it('Esc 로 그만두면 문서도 화면도 처음 그대로다', async () => {
    mount(doc(), { selected: 'card' });
    dragBy({ x: 150, y: 150 }, [{ x: 400, y: 400 }]);
    expect(shown).not.toBe(saved);
    let handled = false;
    act(() => { handled = ix.escapeDrag(); });
    expect(handled).toBe(true);
    expect(shown).toBe(saved);
    await drop();
    await flush(1000);
    expect(sent).toEqual([]);
    expect(ix.escapeDrag()).toBe(false);
  });

  it('끌다 재생이 시작되면 끌기를 되돌린다', async () => {
    mount(doc(), { selected: 'card' });
    dragBy({ x: 150, y: 150 }, [{ x: 400, y: 400 }]);
    rerender({ enabled: false });
    expect(shown).toBe(saved);
    await flush(1000);
    expect(sent).toEqual([]);
  });

  it('끌기를 두 번 하면 쓰기도 두 번이다(끌기마다 되돌리기 한 칸)', async () => {
    mount(doc(), { selected: 'card' });
    dragBy({ x: 150, y: 150 }, [{ x: 170, y: 150 }], null, { keepAspect: false, free: true });
    await drop();
    dragBy({ x: 170, y: 150 }, [{ x: 170, y: 190 }], null, { keepAspect: false, free: true });
    await drop();
    expect(sent).toHaveLength(2);
    expect(itemOf(saved, 'card')?.transform).toMatchObject({ x: 120, y: 140 });
  });
});

describe('스냅', () => {
  const doc = (): VideoDoc => docWith([shape('bg'), shape('other', { x: 1000, y: 700, width: 300, height: 200 }), shape('card', { x: 100, y: 100, width: 200, height: 100 })]);

  it('가운데 선 가까이 가면 붙고 안내선이 선다 — 놓으면 붙은 자리가 적힌다', async () => {
    mount(doc(), { selected: 'card' });
    // 상자 가운데 (200,150) → 화면 가운데 (960,540) 에서 4px 못 미친 곳까지.
    dragBy({ x: 200, y: 150 }, [{ x: 956, y: 537 }]);
    expect(ix.handles?.box).toEqual({ x: 860, y: 490, width: 200, height: 100 });
    expect(ix.guides).toEqual(expect.arrayContaining([{ axis: 'x', at: 960, kind: 'center' }, { axis: 'y', at: 540, kind: 'center' }]));
    await drop();
    expect(itemOf(saved, 'card')?.transform).toMatchObject({ x: 860, y: 490 });
    expect(ix.guides).toEqual([]);
  });

  it('다른 아이템의 변에 붙는다', () => {
    mount(doc(), { selected: 'card' });
    dragBy({ x: 100, y: 100 }, [{ x: 797, y: 300 }]);
    // 오른쪽 변(997)이 다른 아이템의 왼쪽 변(1000)에.
    expect(ix.handles?.box.x).toBe(800);
    expect(ix.guides).toContainEqual({ axis: 'x', at: 1000, kind: 'item' });
  });

  it('안전 영역 변에 붙는다', () => {
    mount(doc(), { selected: 'card' });
    dragBy({ x: 100, y: 100 }, [{ x: 99, y: 300 }]);
    expect(ix.handles?.box.x).toBe(SIZE.width * 0.05);
    expect(ix.guides).toContainEqual({ axis: 'x', at: SIZE.width * 0.05, kind: 'safe' });
  });

  it('Ctrl/Cmd 를 누른 채로는 붙지 않는다', () => {
    mount(doc(), { selected: 'card' });
    dragBy({ x: 200, y: 150 }, [{ x: 956, y: 537 }], null, { keepAspect: false, free: true });
    expect(ix.handles?.box).toEqual({ x: 856, y: 487, width: 200, height: 100 });
    expect(ix.guides).toEqual([]);
  });

  it('문턱은 화면 px 다 — 미리보기를 줄여 보면 같은 문서 거리가 붙는다', () => {
    mount(doc(), { selected: 'card' });
    dragBy({ x: 200, y: 150 }, [{ x: 940, y: 300 }], null, MODS, 1);
    expect(ix.handles?.box.x).toBe(840);
    act(() => ix.drag?.cancel());
    dragBy({ x: 200, y: 150 }, [{ x: 940, y: 300 }], null, MODS, 0.25);
    expect(ix.handles?.box.x).toBe(860);
  });

  it('끌어서는 화면 밖으로 완전히 나가지 않는다', async () => {
    mount(doc(), { selected: 'card' });
    dragBy({ x: 150, y: 150 }, [{ x: -5000, y: 150 }], null, { keepAspect: false, free: true });
    await drop();
    const x = itemOf(saved, 'card')!.transform!.x!;
    expect(x + 200).toBe(16);
  });
});

describe('크기 조절', () => {
  it('모서리를 끌면 맞은편 모서리를 붙든 채 크기가 바뀌고 한 번 적힌다', async () => {
    mount(docWith([shape('card', { x: 100, y: 100, width: 200, height: 100 })]), { selected: 'card' });
    expect(dragBy({ x: 300, y: 200 }, [{ x: 330, y: 215 }, { x: 360, y: 240 }], 'se', { keepAspect: false, free: true })).toBe(true);
    expect(sent).toEqual([]);
    expect(ix.handles?.box).toEqual({ x: 100, y: 100, width: 260, height: 140 });
    await drop();
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'card', patch: { transform: { x: 100, y: 100, width: 260, height: 140 } } }]]);
  });

  it('Shift 는 비율을 지킨다', async () => {
    mount(docWith([shape('card', { x: 100, y: 100, width: 200, height: 100 })]), { selected: 'card' });
    dragBy({ x: 300, y: 200 }, [{ x: 400, y: 200 }], 'se', { keepAspect: true, free: true });
    await drop();
    expect(itemOf(saved, 'card')?.transform).toEqual({ x: 100, y: 100, width: 300, height: 150 });
  });

  it('배율이 걸린 아이템도 손으로 끈 상자대로 다시 그려진다', async () => {
    mount(docWith([shape('card', { x: 100, y: 100, width: 200, height: 100, scale: 0.5 })]), { selected: 'card' });
    expect(ix.handles?.box).toEqual({ x: 150, y: 125, width: 100, height: 50 });
    dragBy({ x: 250, y: 175 }, [{ x: 350, y: 225 }], 'se', { keepAspect: false, free: true });
    await drop();
    const op = buildDrawList(saved, resolveTimeline(saved), 1)[0]!;
    expect(opBox(op)).toEqual({ x: 150, y: 125, width: 200, height: 100 });
  });

  it('돌린 아이템은 틀이 함께 돌고(돌리지 않은 테는 걷는다) 맞은편 모서리가 화면에서 제자리다', async () => {
    mount(docWith([shape('card', { x: 100, y: 100, width: 200, height: 100, rotation: 90 })]), { selected: 'card' });
    expect(ix.handles).toMatchObject({ kind: 'item', rotation: 90 });
    expect(ix.rings.map((r) => r.id)).not.toContain('selected');
    // 90도 — 아이템의 오른쪽 아래 모서리는 화면에서 (150, 250). 화면 아래로 40 끌면 아이템의 가로가 는다.
    dragBy({ x: 150, y: 250 }, [{ x: 150, y: 290 }], 'se');
    expect(ix.guides).toEqual([]);
    await drop();
    const t = itemOf(saved, 'card')!.transform!;
    expect(t.width).toBeCloseTo(240);
    expect(t.height).toBeCloseTo(100);
    expect(t.rotation).toBe(90);
  });

  it('반응형 컴포지션은 끄는 동안 틀만 따라가고 놓을 때 한 번 다시 짠다', async () => {
    const comp: VideoAsset = { id: 'comp', kind: 'composition', source: { kind: 'file', path: 'a/index.html' }, responsive: true, duration: 6 };
    mount(docWith([{ id: 'c1', kind: 'composition', assetId: 'comp', at: 0, duration: 6, transform: { x: 0, y: 0, width: 800, height: 600 } }], { comp }), { selected: 'c1' });
    dragBy({ x: 800, y: 600 }, [{ x: 900, y: 650 }, { x: 1000, y: 700 }], 'se', { keepAspect: false, free: true });
    // 문서 사본의 상자 크기는 그대로다(크기가 곧 프레임 주소 — 끄는 동안 프레임을 새로 열지 않는다).
    expect(shown).toBe(saved);
    expect(ix.handles?.box).toEqual({ x: 0, y: 0, width: 1000, height: 700 });
    await drop();
    expect(sent).toHaveLength(1);
    expect(itemOf(saved, 'c1')?.transform).toEqual({ x: 0, y: 0, width: 1000, height: 700 });
  });

  it('반응형 컴포지션도 옮기는 것은 바로 따라온다', () => {
    const comp: VideoAsset = { id: 'comp', kind: 'composition', source: { kind: 'file', path: 'a/index.html' }, responsive: true, duration: 6 };
    mount(docWith([{ id: 'c1', kind: 'composition', assetId: 'comp', at: 0, duration: 6, transform: { x: 0, y: 0, width: 800, height: 600 } }], { comp }), { selected: 'c1' });
    dragBy({ x: 400, y: 300 }, [{ x: 430, y: 300 }], null, { keepAspect: false, free: true });
    expect(itemOf(shown, 'c1')?.transform).toMatchObject({ x: 30, y: 0, width: 800, height: 600 });
  });
});

describe('화살표 키', () => {
  it('고른 것을 1px(큰 걸음 10px) 옮기고, 잠잠해진 뒤 한 번 적는다', async () => {
    mount(docWith([shape('card', { x: 100, y: 100, width: 200, height: 100 })]), { selected: 'card' });
    let moved = false;
    act(() => { moved = ix.nudge(1, 0, false); });
    act(() => { ix.nudge(0, -1, true); });
    expect(moved).toBe(true);
    expect(itemOf(shown, 'card')?.transform).toMatchObject({ x: 101, y: 90 });
    expect(sent).toEqual([]);
    await flush(450);
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'card', patch: { transform: { x: 101, y: 90, width: 200, height: 100 } } }]]);
  });

  it('고른 것이 없거나 끌 수 없는 때에는 키를 받지 않는다', () => {
    mount(docWith([shape('card')]));
    expect(ix.nudge(1, 0, false)).toBe(false);
    rerender({ selected: 'card', enabled: false });
    expect(ix.nudge(1, 0, false)).toBe(false);
  });
});

describe('컴포지션 안쪽 요소 — 위치·크기를 값으로 선언했을 때만', () => {
  const asset = (propsDecl: VideoAsset['propsDecl']): VideoAsset => ({ id: 'comp', kind: 'composition', source: { kind: 'file', path: 'a/index.html' }, duration: 6, width: 3840, height: 2160, ...(propsDecl ? { propsDecl } : {}) });
  const comp = (propsDecl: VideoAsset['propsDecl'], item: Partial<VideoItem> = {}): VideoDoc =>
    docWith([{ id: 'c1', kind: 'composition', assetId: 'comp', at: 0, duration: 6, ...item }], { comp: asset(propsDecl) });
  const POS = [{ name: 'cardX', type: 'number' as const, default: 200 }, { name: 'cardY', type: 'number' as const, default: 100, min: 0, max: 400, step: 10 }];
  const ALL = [...POS, { name: 'cardW', type: 'number' as const, default: 400 }, { name: 'cardH', type: 'number' as const, default: 200 }];
  /** 설계 3840×2160 을 1920×1080 상자에 — 값 1 이 문서 0.5px. */
  const pickWith = (box: StagePick['box'] | undefined) => async (x: number, y: number): Promise<StagePick | null> => {
    const hit = hitTest(saved, resolveTimeline(saved), 1, x, y);
    if (!hit) return null;
    const element = { path: 'div.card > span', tag: 'span', text: 'Hi', prop: null, rect: { x: 0, y: 0, width: 10, height: 10 } };
    return { op: hit.op, rect: { x: 110, y: 60, width: 50, height: 20 }, element, ...(box ? { box } : {}) };
  };
  const CARD = { path: 'div.card', rect: { x: 100, y: 50, width: 200, height: 100 }, scale: 0.5 };
  const press = async (x = 150, y = 80): Promise<void> => { await act(async () => { ix.onPress(x, y); }); };

  it('선언이 있으면 누른 요소에 틀이 서고, x·y 만 선언했으면 모서리 손잡이는 없다', async () => {
    mount(comp(POS), { pickAt: pickWith({ ...CARD, x: 'cardX', y: 'cardY' }) });
    await press();
    expect(selectedNow).toBe('c1');
    expect(ix.handles).toEqual({ kind: 'inner', box: CARD.rect, rotation: 0, corners: [] });
  });

  it('선언이 없으면 손잡이를 지어내지 않는다 — 아이템 틀 그대로', async () => {
    mount(comp(POS), { pickAt: pickWith(undefined) });
    await press();
    expect(ix.handles).toMatchObject({ kind: 'item', box: { x: 0, y: 0, width: 1920, height: 1080 } });
  });

  it('가리킨 값이 number 로 선언돼 있지 않으면 선언이 아니다', async () => {
    mount(comp([{ name: 'cardX', type: 'text', default: 'a' }]), { pickAt: pickWith({ ...CARD, x: 'cardX', y: 'nope' }) });
    await press();
    expect(ix.handles).toMatchObject({ kind: 'item' });
  });

  it('끌면 값 손잡이와 같은 값(props)에 적힌다 — 끄는 동안은 저장하지 않고 놓은 뒤 한 번', async () => {
    mount(comp(POS), { pickAt: pickWith({ ...CARD, x: 'cardX', y: 'cardY' }) });
    await press();
    expect(dragBy({ x: 150, y: 80 }, [{ x: 170, y: 90 }, { x: 190, y: 104 }], null, { keepAspect: false, free: true })).toBe(true);
    // 문서 40px = 값 80(값 1 이 0.5px) · 세로는 눈금 10: 100 + 48 → 150.
    expect(itemOf(shown, 'c1')?.props).toEqual({ cardX: 280, cardY: 150 });
    expect(ix.handles).toMatchObject({ kind: 'inner', box: { x: 140, y: 75, width: 200, height: 100 } });
    await flush(3000);
    expect(sent).toEqual([]);
    await drop();
    expect(sent).toEqual([]);
    await flush(450);
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'c1', patch: { props: { cardX: 280, cardY: 150 } } }]]);
    expect(itemOf(saved, 'c1')?.transform).toBeUndefined();
  });

  it('선언한 범위를 넘지 않는다', async () => {
    mount(comp(POS), { pickAt: pickWith({ ...CARD, x: 'cardX', y: 'cardY' }) });
    await press();
    dragBy({ x: 150, y: 80 }, [{ x: 150, y: 900 }], null, { keepAspect: false, free: true });
    expect(itemOf(shown, 'c1')?.props).toMatchObject({ cardY: 400 });
    // 틀도 값이 간 만큼만 간다(400 - 100 = 300 → 문서 150px).
    expect(ix.handles?.box.y).toBe(200);
  });

  it('한 축만 선언했으면 그 축으로만 움직인다', async () => {
    mount(comp(POS), { pickAt: pickWith({ ...CARD, x: 'cardX' }) });
    await press();
    dragBy({ x: 150, y: 80 }, [{ x: 170, y: 300 }], null, { keepAspect: false, free: true });
    expect(itemOf(shown, 'c1')?.props).toEqual({ cardX: 240 });
    expect(ix.handles?.box).toEqual({ x: 120, y: 50, width: 200, height: 100 });
  });

  it('폭·높이까지 선언했으면 모서리로 크기를 바꾼다 — 왼쪽 위 모서리는 자리도 함께 적는다', async () => {
    mount(comp(ALL), { pickAt: pickWith({ ...CARD, x: 'cardX', y: 'cardY', w: 'cardW', h: 'cardH' }) });
    await press();
    expect(ix.handles?.corners).toEqual(['nw', 'ne', 'se', 'sw']);
    dragBy({ x: 300, y: 150 }, [{ x: 350, y: 170 }], 'se', { keepAspect: false, free: true });
    expect(itemOf(shown, 'c1')?.props).toEqual({ cardW: 500, cardH: 240 });
    await drop();
    await flush(450);
    await press(150, 80);
    dragBy({ x: 100, y: 50 }, [{ x: 80, y: 50 }], 'nw', { keepAspect: false, free: true });
    expect(itemOf(shown, 'c1')?.props).toMatchObject({ cardW: 540, cardX: 160 });
  });

  it('폭만 선언했으면 오른쪽 아래 손잡이 하나, 높이는 그대로다', async () => {
    mount(comp([{ name: 'cardW', type: 'number', default: 400 }]), { pickAt: pickWith({ ...CARD, w: 'cardW' }) });
    await press();
    expect(ix.handles?.corners).toEqual(['se']);
    dragBy({ x: 300, y: 150 }, [{ x: 350, y: 400 }], 'se', { keepAspect: false, free: true });
    expect(itemOf(shown, 'c1')?.props).toEqual({ cardW: 500 });
    expect(ix.handles?.box).toEqual({ x: 100, y: 50, width: 250, height: 100 });
  });

  it('요소 밖에서 끌면 아이템이 옮겨진다(안쪽 값은 그대로)', async () => {
    mount(comp(POS), { pickAt: pickWith({ ...CARD, x: 'cardX', y: 'cardY' }) });
    await press();
    dragBy({ x: 900, y: 900 }, [{ x: 930, y: 900 }], null, { keepAspect: false, free: true });
    expect(itemOf(shown, 'c1')?.transform).toEqual({ x: 30, y: 0 });
    expect(itemOf(shown, 'c1')?.props).toBeUndefined();
  });

  it('Esc 는 끌던 값을 걷고(저장 ❌), 한 번 더 누르면 안쪽 고름을 푼다', async () => {
    mount(comp(POS), { pickAt: pickWith({ ...CARD, x: 'cardX', y: 'cardY' }) });
    await press();
    dragBy({ x: 150, y: 80 }, [{ x: 190, y: 80 }], null, { keepAspect: false, free: true });
    act(() => { ix.escapeDrag(); });
    expect(shown).toBe(saved);
    await flush(1000);
    expect(sent).toEqual([]);
    expect(ix.handles).toMatchObject({ kind: 'inner' });
    act(() => { ix.escapeDrag(); });
    expect(ix.handles).toMatchObject({ kind: 'item' });
  });

  it('놓은 뒤 그 자리를 다시 물어 요소가 따라오지 않았으면 틀을 걷고 그 프레임을 한 번 다시 연다', async () => {
    let follow = true;
    let settled = 0;
    const reopened: string[] = [];
    const box = (): StagePick['box'] => ({ ...CARD, x: 'cardX', y: 'cardY', ...(follow ? {} : { path: 'div.other' }) });
    mount(comp(POS), { pickAt: (x, y) => pickWith(box())(x, y), settle: async () => { settled += 1; }, reopen: async (id) => { reopened.push(id); } });
    await press();
    follow = false;
    dragBy({ x: 150, y: 80 }, [{ x: 190, y: 80 }], null, { keepAspect: false, free: true });
    // 끄는 동안에는 다시 열지 않는다(깜빡이지 않게).
    expect(reopened).toEqual([]);
    await drop();
    await flush(0);
    expect(settled).toBe(1);
    expect(ix.handles).toMatchObject({ kind: 'item' });
    expect(reopened).toEqual(['c1']);
    // 저장은 평소대로 한 번 — 다시 열기는 쓰기가 아니다.
    await flush(450);
    expect(sent).toHaveLength(1);
  });

  it('선언만 하고 값을 따르지 않는 큰 요소 — 그 자리에 여전히 그 요소가 있어도 끌기 전 자리 그대로면 다시 연다', async () => {
    const reopened: string[] = [];
    mount(comp(POS), { pickAt: pickWith({ ...CARD, x: 'cardX', y: 'cardY' }), reopen: async (id) => { reopened.push(id); } });
    await press();
    dragBy({ x: 150, y: 80 }, [{ x: 190, y: 80 }], null, { keepAspect: false, free: true });
    await drop();
    await flush(0);
    expect(reopened).toEqual(['c1']);
    expect(ix.handles).toMatchObject({ kind: 'item' });
  });

  it('놓은 뒤 요소가 따라왔으면 다시 잰 자리에 틀이 선다(다시 열지 않는다)', async () => {
    let rect = CARD.rect;
    const reopened: string[] = [];
    mount(comp(POS), { pickAt: (x, y) => pickWith({ ...CARD, rect, x: 'cardX', y: 'cardY' })(x, y), reopen: async (id) => { reopened.push(id); } });
    await press();
    dragBy({ x: 150, y: 80 }, [{ x: 190, y: 80 }], null, { keepAspect: false, free: true });
    rect = { x: 141, y: 50, width: 200, height: 100 };
    await drop();
    await flush(0);
    expect(ix.handles).toEqual({ kind: 'inner', box: rect, rotation: 0, corners: [] });
    expect(reopened).toEqual([]);
  });

  it.each([{ rotation: 10 }, { scale: 0.5 }])('돌렸거나 배율이 걸린 아이템(%o)은 안쪽 손잡이를 세우지 않는다', async (transform) => {
    mount(comp(POS, { transform }), { pickAt: pickWith({ ...CARD, x: 'cardX', y: 'cardY' }) });
    await press(960, 540);
    expect(ix.handles).toMatchObject({ kind: 'item' });
  });

  it('재생 머리를 옮기면 안쪽 고름을 푼다(그 시각의 자리가 아니다)', async () => {
    mount(comp(POS), { pickAt: pickWith({ ...CARD, x: 'cardX', y: 'cardY' }) });
    await press();
    expect(ix.handles).toMatchObject({ kind: 'inner' });
    rerender({ playhead: 2 });
    expect(ix.handles).toMatchObject({ kind: 'item' });
  });

  it('화살표 키는 선언한 눈금만큼 값을 옮긴다', async () => {
    mount(comp(POS), { pickAt: pickWith({ ...CARD, x: 'cardX', y: 'cardY' }) });
    await press();
    act(() => { ix.nudge(1, 0, false); });
    act(() => { ix.nudge(0, 1, false); });
    expect(itemOf(shown, 'c1')?.props).toEqual({ cardX: 201, cardY: 110 });
    expect(ix.handles?.box).toEqual({ x: 100.5, y: 55, width: 200, height: 100 });
    await flush(450);
    expect(sent).toHaveLength(1);
  });

  it('가리키기 모드에서는 요소를 눌러도 손잡이가 서지 않는다', async () => {
    mount(comp(POS), { interaction: 'point', pickAt: pickWith({ ...CARD, x: 'cardX', y: 'cardY' }) });
    await press();
    expect(ix.handles).toBeNull();
    expect(ix.drag).toBeNull();
  });
});

describe('끊긴 끌기 · 취소는 이번 끌기 몫만(37-21 (L))', () => {
  const FREE = { keepAspect: false, free: true };
  const items = (): VideoDoc => docWith([shape('bg'), shape('other', { x: 1200, y: 700, width: 100, height: 100 }), shape('card', { x: 100, y: 100, width: 200, height: 100, opacity: 0.8 })]);
  const asset: VideoAsset = {
    id: 'comp', kind: 'composition', source: { kind: 'file', path: 'a/index.html' }, duration: 6, width: 3840, height: 2160,
    propsDecl: [{ name: 'cardX', type: 'number', default: 200 }, { name: 'cardY', type: 'number', default: 100 }],
  };
  const comp = (): VideoDoc => docWith([{ id: 'c1', kind: 'composition', assetId: 'comp', at: 0, duration: 6 }], { comp: asset });
  /** 값을 따르는 컴포지션 흉내 — 요소 자리는 지금 화면 사본의 cardX(값 1 = 문서 0.5px). */
  const following = async (x: number, y: number): Promise<StagePick | null> => {
    const hit = hitTest(saved, resolveTimeline(saved), 1, x, y);
    if (!hit) return null;
    const cardX = (itemOf(shown, 'c1')?.props?.['cardX'] as number | undefined) ?? 200;
    const rect = { x: 100 + (cardX - 200) / 2, y: 50, width: 200, height: 100 };
    const element = { path: 'div.card', tag: 'div', text: '', prop: null, rect };
    return { op: hit.op, rect, element, box: { path: 'div.card', rect, scale: 0.5, x: 'cardX', y: 'cardY' } };
  };
  const pressInner = async (): Promise<void> => { await act(async () => { ix.onPress(150, 80); }); };
  const begin = (at: { x: number; y: number }, release?: () => void): boolean => {
    let grabbed = false;
    act(() => { grabbed = ix.drag?.begin(at, null, 1, release) ?? false; });
    return grabbed;
  };

  it('떼기를 놓친 옛 끌기는 새 누름이 취소한다 — 화면이 문서로 돌아가고, 저장하지 않고, 옛 포인터를 푼다', async () => {
    mount(items(), { selected: 'card' });
    let released = 0;
    expect(begin({ x: 150, y: 150 }, () => { released += 1; })).toBe(true);
    act(() => ix.drag?.move({ x: 400, y: 400 }, FREE));
    expect(shown).not.toBe(saved);
    begin({ x: 150, y: 150 });
    expect(released).toBe(1);
    expect(shown).toBe(saved);
    expect(ix.guides).toEqual([]);
    await drop();
    await flush(1000);
    expect(sent).toEqual([]);
  });

  it('놓으면 판이 준 포인터 풀기를 한 번 부르고, 누르기만 하고 떼도 한 번이다', async () => {
    mount(items(), { selected: 'card' });
    let released = 0;
    begin({ x: 150, y: 150 }, () => { released += 1; });
    act(() => ix.drag?.move({ x: 200, y: 150 }, FREE));
    await drop();
    expect(released).toBe(1);
    begin({ x: 200, y: 150 }, () => { released += 1; });
    act(() => ix.drag?.cancel());
    expect(released).toBe(2);
    act(() => ix.drag?.cancel());
    expect(released).toBe(2);
  });

  it('안쪽 요소를 끌던 손짓이 남은 채 새로 누르면 값이 되돌아가고 저장 붙들기가 풀린다', async () => {
    mount(comp(), { pickAt: following });
    await pressInner();
    let released = 0;
    expect(begin({ x: 150, y: 80 }, () => { released += 1; })).toBe(true);
    act(() => ix.drag?.move({ x: 190, y: 80 }, FREE));
    expect(itemOf(shown, 'c1')?.props).toMatchObject({ cardX: 280 });
    begin({ x: 900, y: 900 });
    act(() => ix.drag?.cancel());
    expect(released).toBe(1);
    expect(shown).toBe(saved);
    // 붙들기가 풀렸다 — 값 손잡이로 고친 값은 평소처럼 잠잠해지면 저장된다.
    act(() => lp.setProp('c1', 'title', 'Hi'));
    await flush(450);
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'c1', patch: { props: { title: 'Hi' } } }]]);
  });

  it('끄는 중 판(셸)이 걷히면 저장도 타이머도 남기지 않고 포인터를 푼다', async () => {
    mount(comp(), { pickAt: following });
    await pressInner();
    let released = 0;
    begin({ x: 150, y: 80 }, () => { released += 1; });
    act(() => ix.drag?.move({ x: 190, y: 80 }, FREE));
    act(() => view?.unmount());
    view = undefined;
    expect(released).toBe(1);
    await flush(2000);
    expect(sent).toEqual([]);
  });

  it('끄는 중 재생 머리가 바뀌면 취소한다', async () => {
    mount(items(), { selected: 'card' });
    let released = 0;
    begin({ x: 150, y: 150 }, () => { released += 1; });
    act(() => ix.drag?.move({ x: 400, y: 400 }, FREE));
    rerender({ playhead: 2 });
    expect(released).toBe(1);
    expect(shown).toBe(saved);
    await drop();
    await flush(1000);
    expect(sent).toEqual([]);
  });

  it('안쪽 요소를 끌다 재생이 시작되면 값이 되돌아가고 붙들기가 풀린다', async () => {
    mount(comp(), { pickAt: following });
    await pressInner();
    let released = 0;
    begin({ x: 150, y: 80 }, () => { released += 1; });
    act(() => ix.drag?.move({ x: 190, y: 80 }, FREE));
    rerender({ enabled: false });
    expect(released).toBe(1);
    expect(shown).toBe(saved);
    act(() => lp.setProp('c1', 'title', 'Hi'));
    await flush(450);
    expect(sent).toHaveLength(1);
  });

  it('놓은 끌기의 저장을 기다리는 사이 다시 끌다 취소하면 앞서 놓은 값은 그대로 저장된다', async () => {
    mount(comp(), { pickAt: following });
    await pressInner();
    dragBy({ x: 150, y: 80 }, [{ x: 190, y: 80 }], null, FREE);
    await drop();
    await flush(100);
    expect(sent).toEqual([]);
    expect(ix.handles).toMatchObject({ kind: 'inner', box: { x: 140 } });
    dragBy({ x: 190, y: 80 }, [{ x: 230, y: 80 }], null, FREE);
    expect(itemOf(shown, 'c1')?.props).toMatchObject({ cardX: 360 });
    act(() => { ix.escapeDrag(); });
    expect(itemOf(shown, 'c1')?.props).toMatchObject({ cardX: 280 });
    await flush(450);
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toMatchObject({ op: 'updateItem', itemId: 'c1', patch: { props: { cardX: 280 } } });
  });

  it('값 손잡이로 고친 직후 끌다 취소해도 그 고친 값은 남아 저장된다', async () => {
    mount(comp(), { pickAt: following });
    await pressInner();
    act(() => lp.setProp('c1', 'cardX', 300));
    dragBy({ x: 150, y: 80 }, [{ x: 190, y: 80 }], null, FREE);
    expect(itemOf(shown, 'c1')?.props).toMatchObject({ cardX: 380 });
    act(() => { ix.escapeDrag(); });
    expect(itemOf(shown, 'c1')?.props).toEqual({ cardX: 300 });
    await flush(450);
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'c1', patch: { props: { cardX: 300 } } }]]);
  });

  it('화살표 키로 옮기고 저장을 기다리는 사이 끌다 취소하면 키로 옮긴 자리는 남아 저장된다', async () => {
    mount(items(), { selected: 'card' });
    act(() => { ix.nudge(1, 0, false); });
    dragBy({ x: 150, y: 150 }, [{ x: 400, y: 400 }], null, FREE);
    act(() => { ix.escapeDrag(); });
    expect(itemOf(shown, 'card')?.transform).toMatchObject({ x: 101, y: 100 });
    await flush(450);
    expect(sent).toEqual([[{ op: 'updateItem', itemId: 'card', patch: { transform: { x: 101, y: 100, width: 200, height: 100, opacity: 0.8 } } }]]);
  });
});

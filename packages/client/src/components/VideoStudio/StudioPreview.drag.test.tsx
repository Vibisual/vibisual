import { createElement, createRef, type KeyboardEvent } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoDoc } from '@vibisual/video';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key) }),
}));

import { formatShortcut } from '../../utils/platform.js';
import { StudioPreview, type StudioPreviewProps } from './StudioPreview.js';
import type { PreviewDragHandlers, PreviewHandles } from './usePreviewDrag.js';
import { useStudioKeys, type StudioKeyActions } from './useStudioKeys.js';

/**
 * §5.13 (V) 37-21 — 미리보기 판의 손짓 배선: 누르고 떼면 종전 고르기, 4 화면 px 넘게 끌면 끌기(뒤따르는 click 은 고르기가 아니다).
 * 판은 1920×1080 문서를 960×540 으로 줄여 보인다(배율 0.5) — 화면 좌표가 문서 좌표로 옮겨지는지도 본다.
 */
const doc: VideoDoc = { ...createEmptyDoc('vid', 'Demo'), size: { width: 1920, height: 1080 } };
const HANDLES: PreviewHandles = { kind: 'item', box: { x: 200, y: 100, width: 400, height: 200 }, rotation: 0, corners: ['nw', 'ne', 'se', 'sw'] };

interface Calls { begin: unknown[][]; move: unknown[][]; end: number; cancel: number; press: unknown[][]; double: unknown[][]; captured: number[]; released: number[] }
let calls: Calls;
let renderer: ReactTestRenderer | null = null;

/** 손짓 훅 흉내 — 훅처럼 끝날 때(놓기·취소) 판이 준 `release` 를 한 번 부른다. */
function dragApi(grab = true): PreviewDragHandlers {
  let release: (() => void) | undefined;
  const finish = (): void => { const r = release; release = undefined; r?.(); };
  return {
    begin: (at, corner, scale, r) => { finish(); calls.begin.push([at, corner, scale]); release = grab ? r : undefined; return grab; },
    move: (...args) => { calls.move.push(args); },
    end: () => { calls.end += 1; finish(); },
    cancel: () => { calls.cancel += 1; finish(); },
  };
}

function props(extra: Partial<StudioPreviewProps> = {}): StudioPreviewProps {
  return {
    doc, mode: 'canvas', canvasRef: createRef<HTMLCanvasElement>(), stageHostRef: createRef<HTMLDivElement>(), zoom: 'fit', safeArea: false, interaction: 'none',
    rings: [], pins: [], edit: null, noteDraft: null, empty: null,
    onHover: () => undefined, onLeave: () => undefined,
    onPress: (...args) => { calls.press.push(args); }, onDoublePress: (...args) => { calls.double.push(args); },
    onPin: () => undefined, onDropFiles: () => undefined, onNoteCommit: () => undefined, onNoteCancel: () => undefined,
    ...extra,
  };
}

/** 상자 960×540, 판은 화면 (100, 40) 에서 시작한다. */
function mount(p: StudioPreviewProps): ReactTestRenderer {
  calls = { begin: [], move: [], end: 0, cancel: 0, press: [], double: [], captured: [], released: [] };
  act(() => {
    renderer = create(createElement(StudioPreview, p), {
      createNodeMock: () => ({
        clientWidth: 960, clientHeight: 540,
        getBoundingClientRect: () => ({ left: 100, top: 40, width: 960, height: 540 }),
        setPointerCapture: (id: number) => { calls.captured.push(id); },
        releasePointerCapture: (id: number) => { calls.released.push(id); },
      }),
    });
  });
  return renderer!;
}
const layer = (r: ReactTestRenderer): ReactTestInstance => r.root.findAll((n) => typeof n.props.onPointerDown === 'function' && typeof n.props.onClick === 'function')[0]!;
const handle = (r: ReactTestRenderer, corner: string): ReactTestInstance => r.root.find((n) => n.props['data-drag-handle'] === corner);
const target = { closest: () => null };
const pointer = (clientX: number, clientY: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  clientX, clientY, pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, target,
  currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 40, width: 960, height: 540 }) }, stopPropagation: () => undefined, ...extra,
});
const fire = (node: ReactTestInstance, name: string, event: Record<string, unknown>): void => { act(() => { (node.props[name] as (e: unknown) => void)(event); }); };

afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = null; vi.unstubAllGlobals(); });

describe('누르기와 끌기', () => {
  it('누르고 그 자리에서 떼면 종전 고르기다 — 끌기는 일어나지 않는다', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    fire(layer(r), 'onPointerDown', pointer(300, 140));
    fire(layer(r), 'onPointerMove', pointer(302, 141));
    fire(layer(r), 'onPointerUp', pointer(302, 141));
    fire(layer(r), 'onClick', pointer(302, 141));
    // 화면 (300,140) → 판 기준 (200,100) → 배율 0.5 → 문서 (400,200).
    expect(calls.begin).toEqual([[{ x: 400, y: 200 }, null, 0.5]]);
    expect(calls.move).toEqual([]);
    expect(calls.end).toBe(0);
    expect(calls.cancel).toBe(1);
    expect(calls.press).toEqual([[404, 202]]);
  });

  it('4 화면 px 넘게 가면 끌기다 — 문서 좌표와 보조 키를 넘기고, 뒤따르는 click 은 고르기가 아니다', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    fire(layer(r), 'onPointerDown', pointer(300, 140));
    fire(layer(r), 'onPointerMove', pointer(310, 140, { shiftKey: true }));
    fire(layer(r), 'onPointerMove', pointer(350, 190, { metaKey: true }));
    fire(layer(r), 'onPointerUp', pointer(350, 190));
    fire(layer(r), 'onClick', pointer(350, 190));
    expect(calls.captured).toEqual([7]);
    expect(calls.move).toEqual([
      [{ x: 420, y: 200 }, { keepAspect: true, free: false }],
      [{ x: 500, y: 300 }, { keepAspect: false, free: true }],
    ]);
    expect(calls.end).toBe(1);
    expect(calls.press).toEqual([]);
    // 삼킨 click 은 그 한 번뿐이다.
    fire(layer(r), 'onPointerDown', pointer(600, 300));
    fire(layer(r), 'onPointerUp', pointer(600, 300));
    fire(layer(r), 'onClick', pointer(600, 300));
    expect(calls.press).toEqual([[1000, 520]]);
  });

  it('Ctrl 도 Cmd 와 같은 판정이다(세 OS 같은 키)', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    fire(layer(r), 'onPointerDown', pointer(300, 140));
    fire(layer(r), 'onPointerMove', pointer(340, 140, { ctrlKey: true }));
    expect(calls.move[0]![1]).toEqual({ keepAspect: false, free: true });
  });

  it('끌 것이 없는 자리면 포인터를 붙들지 않는다 — 누르기는 그대로 고르기다', () => {
    const r = mount(props({ drag: dragApi(false) }));
    fire(layer(r), 'onPointerDown', pointer(300, 140));
    fire(layer(r), 'onPointerMove', pointer(400, 240));
    fire(layer(r), 'onPointerUp', pointer(400, 240));
    fire(layer(r), 'onClick', pointer(400, 240));
    expect(calls.captured).toEqual([]);
    expect(calls.move).toEqual([]);
    expect(calls.press).toHaveLength(1);
  });

  it('Alt 는 인스펙터의 손짓이다 — 끌기가 시작되지 않는다', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    fire(layer(r), 'onPointerDown', pointer(300, 140, { altKey: true }));
    fire(layer(r), 'onPointerMove', pointer(400, 240, { altKey: true }));
    expect(calls.begin).toEqual([]);
    expect(calls.move).toEqual([]);
  });

  it('오른쪽 단추·둘째 손가락으로는 끌지 않는다', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    fire(layer(r), 'onPointerDown', pointer(300, 140, { button: 2 }));
    fire(layer(r), 'onPointerDown', pointer(300, 140, { isPrimary: false }));
    expect(calls.begin).toEqual([]);
  });

  it('메모 핀·글자 칸에서 시작한 누름은 끌기가 아니다', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    fire(layer(r), 'onPointerDown', pointer(300, 140, { target: { closest: () => ({}) } }));
    expect(calls.begin).toEqual([]);
  });

  it('포인터가 끊기면(스크롤이 가져감 등) 끌기를 되돌린다', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    fire(layer(r), 'onPointerDown', pointer(300, 140));
    fire(layer(r), 'onPointerMove', pointer(400, 240));
    fire(layer(r), 'onPointerCancel', pointer(400, 240));
    expect(calls.end).toBe(0);
    expect(calls.cancel).toBe(1);
  });

  it('터치·펜은 문턱이 넓다(10 화면 px) — 손가락 탭이 몇 px 흔들려도 고르기다. 마우스는 4px 그대로', () => {
    for (const type of ['touch', 'pen'] as const) {
      const r = mount(props({ drag: dragApi(), handles: HANDLES }));
      fire(layer(r), 'onPointerDown', pointer(300, 140, { pointerType: type }));
      fire(layer(r), 'onPointerMove', pointer(305, 143, { pointerType: type }));
      fire(layer(r), 'onPointerUp', pointer(305, 143, { pointerType: type }));
      fire(layer(r), 'onClick', pointer(305, 143));
      expect(calls.move).toEqual([]);
      expect(calls.press).toHaveLength(1);
      fire(layer(r), 'onPointerDown', pointer(300, 140, { pointerType: type }));
      fire(layer(r), 'onPointerMove', pointer(310, 140, { pointerType: type }));
      expect(calls.move).toHaveLength(1);
      act(() => r.unmount());
      renderer = null;
    }
    const mouse = mount(props({ drag: dragApi(), handles: HANDLES }));
    fire(layer(mouse), 'onPointerDown', pointer(300, 140));
    fire(layer(mouse), 'onPointerMove', pointer(305, 143));
    expect(calls.move).toHaveLength(1);
  });

  it('다른 포인터의 움직임은 섞이지 않는다', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    fire(layer(r), 'onPointerDown', pointer(300, 140));
    fire(layer(r), 'onPointerMove', pointer(900, 500, { pointerId: 9 }));
    fire(layer(r), 'onPointerUp', pointer(900, 500, { pointerId: 9 }));
    expect(calls.move).toEqual([]);
    expect(calls.end + calls.cancel).toBe(0);
  });
});

describe('끊긴 끌기 — 놓지 않았으면 늘 취소(37-21 (L))', () => {
  /** 끄는 중으로 만든다(문턱을 넘긴 움직임까지). */
  const dragging = (r: ReactTestRenderer): void => {
    const moved = calls.move.length;
    fire(layer(r), 'onPointerDown', pointer(300, 140));
    fire(layer(r), 'onPointerMove', pointer(400, 240));
    expect(calls.move).toHaveLength(moved + 1);
  };

  it('포인터 캡처를 잃으면 취소하고 포인터를 푼다 — 뒤늦은 떼기·click 은 아무 일도 하지 않는다', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    dragging(r);
    fire(layer(r), 'onLostPointerCapture', pointer(400, 240));
    expect(calls.cancel).toBe(1);
    expect(calls.end).toBe(0);
    expect(calls.released).toEqual([7]);
    fire(layer(r), 'onPointerMove', pointer(500, 300));
    fire(layer(r), 'onPointerUp', pointer(500, 300));
    fire(layer(r), 'onClick', pointer(500, 300));
    expect(calls.move).toHaveLength(1);
    expect(calls.end).toBe(0);
    expect(calls.press).toEqual([]);
  });

  it('버튼이 떼어진 채 들어온 움직임은 떼는 순간을 놓친 것이다 — 따라가지 않고 취소한다', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    dragging(r);
    fire(layer(r), 'onPointerMove', pointer(450, 260, { buttons: 0 }));
    fire(layer(r), 'onPointerMove', pointer(480, 280));
    expect(calls.move).toHaveLength(1);
    expect(calls.cancel).toBe(1);
    expect(calls.end).toBe(0);
  });

  it('창이 초점을 잃거나(Alt+Tab) 문서가 숨으면 취소한다', () => {
    const win = new EventTarget();
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', page);
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    dragging(r);
    act(() => { win.dispatchEvent(new Event('blur')); });
    expect(calls.cancel).toBe(1);
    expect(calls.released).toEqual([7]);
    dragging(r);
    page.visibilityState = 'hidden';
    act(() => { page.dispatchEvent(new Event('visibilitychange')); });
    expect(calls.cancel).toBe(2);
    expect(calls.end).toBe(0);
    // 끄는 중이 아니면 blur 는 아무 일도 하지 않는다.
    act(() => { win.dispatchEvent(new Event('blur')); });
    expect(calls.cancel).toBe(2);
  });

  it('끄는 중 다시 그려져도(틀·안내선이 바뀜) 끌기는 이어진다', () => {
    const api = dragApi();
    const r = mount(props({ drag: api, handles: HANDLES }));
    dragging(r);
    act(() => r.update(createElement(StudioPreview, props({ drag: api, handles: { ...HANDLES, box: { ...HANDLES.box, x: 300 } } }))));
    fire(layer(r), 'onPointerMove', pointer(420, 250));
    fire(layer(r), 'onPointerUp', pointer(420, 250));
    expect(calls.cancel).toBe(0);
    expect(calls.end).toBe(1);
    expect(calls.released).toEqual([7]);
  });

  it('끄는 중 판이 걷히거나 끌 수 없게 되면(재생·모드 전환) 포인터를 풀고 끌기를 접는다 — 되돌리기는 손짓 훅이 한다', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    dragging(r);
    act(() => r.update(createElement(StudioPreview, props({ drag: null, handles: HANDLES }))));
    expect(calls.released).toEqual([7]);
    fire(layer(r), 'onPointerMove', pointer(500, 300));
    fire(layer(r), 'onPointerUp', pointer(500, 300));
    expect(calls.move).toHaveLength(1);
    expect(calls.end).toBe(0);
    act(() => r.unmount());
    const again = mount(props({ drag: dragApi(), handles: HANDLES }));
    dragging(again);
    act(() => again.unmount());
    renderer = null;
    expect(calls.cancel).toBe(1);
    expect(calls.end).toBe(0);
  });

  it('떼기를 놓친 채 다시 누르면 옛 끌기를 취소한 뒤 새로 시작한다', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    dragging(r);
    fire(layer(r), 'onPointerDown', pointer(600, 300, { pointerId: 8 }));
    expect(calls.cancel).toBe(1);
    expect(calls.released).toEqual([7]);
    expect(calls.begin).toHaveLength(2);
    expect(calls.captured).toEqual([7, 8]);
  });
});

describe('손잡이 틀', () => {
  it('끌 수 있을 때만 선다 — 재생 중·가리키기·메모 모드(drag 없음)에는 판에 아무것도 더하지 않는다', () => {
    const off = mount(props({ handles: HANDLES }));
    expect(off.root.findAll((n) => n.props['data-drag-handle'] !== undefined)).toEqual([]);
    expect(off.root.findAll((n) => n.props['data-drag-frame'] !== undefined)).toEqual([]);
    expect(String(layer(off).props.className)).not.toContain('touch-none');
    act(() => off.unmount());
    const on = mount(props({ drag: dragApi(), handles: HANDLES }));
    expect(on.root.findAll((n) => n.props['data-drag-handle'] !== undefined).map((n) => n.props['data-drag-handle'])).toEqual(['nw', 'ne', 'se', 'sw']);
    expect(on.root.find((n) => n.props['data-drag-frame'] === 'item').props.style).toEqual({ left: 100, top: 50, width: 200, height: 100 });
  });

  it('손잡이는 모서리에 서고 터치에서는 손가락 크기다', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    expect(handle(r, 'se').props.style).toEqual({ left: 300, top: 150 });
    expect(handle(r, 'nw').props.style).toEqual({ left: 100, top: 50 });
    const cls = String(handle(r, 'se').props.className);
    expect(cls).toContain('pointer-coarse:h-11');
    expect(cls).toContain('pointer-coarse:w-11');
    expect(cls).toContain('touch-none');
  });

  it('끌 수 있으면 어느 보기에서나 판이 터치 끌기를 받는다(100% 보기도 스크롤하는 칸이 아니다 — 37-24 (F-2))', () => {
    const fit = mount(props({ drag: dragApi(), handles: HANDLES }));
    expect(String(layer(fit).props.className)).toContain('touch-none');
    act(() => fit.unmount());
    const actual = mount(props({ drag: dragApi(), handles: HANDLES, zoom: 'actual' }));
    expect(String(layer(actual).props.className)).toContain('touch-none');
  });

  it('돌린 아이템은 틀이 함께 돈다', () => {
    const r = mount(props({ drag: dragApi(), handles: { ...HANDLES, rotation: 30 } }));
    expect(r.root.find((n) => n.props['data-drag-frame'] === 'item').props.style).toMatchObject({ transform: 'rotate(30deg)' });
  });

  it('화면 밖 모서리의 손잡이는 가장자리로 당겨 선다', () => {
    const r = mount(props({ drag: dragApi(), handles: { ...HANDLES, box: { x: -200, y: -100, width: 2400, height: 1400 } } }));
    expect(handle(r, 'nw').props.style).toEqual({ left: 0, top: 0 });
    expect(handle(r, 'se').props.style).toEqual({ left: 960, top: 540 });
  });

  it('손잡이를 끌면 그 모서리로 끌기가 시작되고, 누르기만 해도 고르기로 새지 않는다', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    fire(handle(r, 'se'), 'onPointerDown', pointer(400, 190));
    fire(layer(r), 'onPointerMove', pointer(430, 210));
    fire(layer(r), 'onPointerUp', pointer(430, 210));
    fire(layer(r), 'onClick', pointer(430, 210));
    expect(calls.begin).toEqual([[{ x: 600, y: 300 }, 'se', 0.5]]);
    expect(calls.move).toEqual([[{ x: 660, y: 340 }, { keepAspect: false, free: false }]]);
    expect(calls.end).toBe(1);
    expect(calls.press).toEqual([]);
    fire(handle(r, 'nw'), 'onPointerDown', pointer(200, 90));
    fire(layer(r), 'onPointerUp', pointer(200, 90));
    fire(layer(r), 'onClick', pointer(200, 90));
    fire(layer(r), 'onDoubleClick', pointer(200, 90));
    expect(calls.press).toEqual([]);
    expect(calls.double).toEqual([]);
  });

  it('붙은 안내선은 손잡이가 설 때만 그린다', () => {
    const guides = [{ axis: 'x', at: 960, kind: 'center' }, { axis: 'y', at: 540, kind: 'center' }] as const;
    const r = mount(props({ drag: dragApi(), handles: HANDLES, guides }));
    const lines = r.root.findAll((n) => n.props['data-snap-guide'] !== undefined);
    expect(lines.map((n) => n.props.style)).toEqual([{ left: 480 }, { top: 270 }]);
    act(() => r.unmount());
    expect(mount(props({ guides })).root.findAll((n) => n.props['data-snap-guide'] !== undefined)).toEqual([]);
  });

  it('툴팁의 세 키는 플랫폼 표기를 받아 적는다(번역문에 키 이름을 박지 않는다)', () => {
    const r = mount(props({ drag: dragApi(), handles: HANDLES }));
    const title = String(handle(r, 'se').props.title);
    expect(title).toContain('panel.videoStudio.preview.dragHint');
    for (const name of ['lock', 'free', 'nudge']) expect(title).toContain(`"${name}"`);
    // 맥에서는 ⌘·⇧, 그 밖에서는 Ctrl·Shift.
    expect(formatShortcut('Ctrl+Left', true)).toBe('⌘←');
    expect(formatShortcut('Ctrl+Left', false)).toBe('Ctrl+←');
    expect(formatShortcut('Shift', true)).toBe('⇧');
  });
});

describe('Ctrl/Cmd+방향키 — 고른 것 옮기기', () => {
  function keys(over: Partial<StudioKeyActions> = {}) {
    const seen = { nudge: [] as unknown[][], step: [] as number[] };
    let handler!: (event: KeyboardEvent<HTMLDivElement>) => void;
    const actions: StudioKeyActions = {
      disabled: false, hasMedia: true, canSplit: false,
      undo: () => undefined, redo: () => undefined, duplicate: () => undefined, remove: () => undefined, split: () => undefined,
      togglePlay: () => undefined, step: (n) => { seen.step.push(n); }, toggleLoop: () => undefined, toggleSafe: () => undefined, toggleZoom: () => undefined,
      setInteraction: () => undefined, escape: () => false,
      nudge: (...args) => { seen.nudge.push(args); return true; },
      ...over,
    };
    function Harness(): null { handler = useStudioKeys(actions); return null; }
    act(() => { renderer = create(createElement(Harness)); });
    const press = (key: string, mods: Record<string, boolean> = {}, extra: Record<string, unknown> = {}): { prevented: boolean } => {
      const event = { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, nativeEvent: { isComposing: false }, target: { closest: () => null }, prevented: false, preventDefault() { this.prevented = true; }, ...mods, ...extra };
      handler(event as unknown as KeyboardEvent<HTMLDivElement>);
      return event;
    };
    return { seen, press };
  }

  it('Ctrl 이든 Cmd 든 한 칸, Shift 를 더하면 큰 걸음 — 네 방향', () => {
    const k = keys();
    expect(k.press('ArrowLeft', { ctrlKey: true }).prevented).toBe(true);
    k.press('ArrowRight', { metaKey: true });
    k.press('ArrowUp', { ctrlKey: true, shiftKey: true });
    k.press('ArrowDown', { metaKey: true });
    expect(k.seen.nudge).toEqual([[-1, 0, false], [1, 0, false], [0, -1, true], [0, 1, false]]);
    expect(k.seen.step).toEqual([]);
  });

  it('맨 방향키·Shift+방향키는 종전 그대로 프레임 이동이다', () => {
    const k = keys();
    k.press('ArrowLeft');
    k.press('ArrowRight', { shiftKey: true });
    expect(k.seen.step).toEqual([-1, 10]);
    expect(k.seen.nudge).toEqual([]);
  });

  it('옮길 것이 없으면 키를 삼키지 않는다', () => {
    const k = keys({ nudge: () => false });
    expect(k.press('ArrowLeft', { ctrlKey: true }).prevented).toBe(false);
    expect(k.seen.step).toEqual([]);
  });

  it('Alt 가 섞이면 받지 않는다 · 한글 조합 중·입력 칸에서는 비켜 선다', () => {
    const k = keys();
    k.press('ArrowLeft', { ctrlKey: true, altKey: true });
    k.press('ArrowLeft', { ctrlKey: true }, { nativeEvent: { isComposing: true } });
    k.press('ArrowLeft', { ctrlKey: true }, { target: { closest: () => ({}) } });
    expect(k.seen.nudge).toEqual([]);
    expect(k.seen.step).toEqual([]);
  });
});

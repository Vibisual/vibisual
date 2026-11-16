import { createElement, createRef } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoDoc } from '@vibisual/video';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { StudioPreview, type StudioPreviewProps } from './StudioPreview.js';
import type { PreviewDragHandlers } from './usePreviewDrag.js';

/**
 * §5.13 (V) 37-24 (F) — 미리보기 자유 보기의 손짓 배선: 휠은 포인터 자리를 축으로 키우고, 끌 것을 못 잡은 누름·가운데 단추는 화면을 옮긴다.
 * 상자 960×540, 문서 1920×1080 — 맞춤이면 판이 (0, 0) 에서 배율 0.5 로 선다.
 */
const doc: VideoDoc = { ...createEmptyDoc('vid', 'Demo'), size: { width: 1920, height: 1080 } };

let renderer: ReactTestRenderer | null = null;
let wheel: ((e: unknown) => void) | null = null;
let freed = 0;
let presses = 0;
let captured: number[] = [];

function dragApi(grab: boolean): PreviewDragHandlers {
  return { begin: (_at, _corner, _scale, release) => { if (grab) void release; return grab; }, move: () => undefined, end: () => undefined, cancel: () => undefined };
}

function mount(extra: Partial<StudioPreviewProps> = {}): ReactTestRenderer {
  freed = 0; presses = 0; captured = []; wheel = null;
  const p: StudioPreviewProps = {
    doc, mode: 'canvas', canvasRef: createRef<HTMLCanvasElement>(), stageHostRef: createRef<HTMLDivElement>(), zoom: 'free', safeArea: false, interaction: 'none',
    rings: [], pins: [], edit: null, noteDraft: null, empty: null,
    onHover: () => undefined, onLeave: () => undefined, onPress: () => { presses += 1; }, onDoublePress: () => undefined,
    onPin: () => undefined, onDropFiles: () => undefined, onNoteCommit: () => undefined, onNoteCancel: () => undefined,
    onFreeView: () => { freed += 1; },
    ...extra,
  };
  act(() => {
    renderer = create(createElement(StudioPreview, p), {
      createNodeMock: () => ({
        clientWidth: 960, clientHeight: 540,
        getBoundingClientRect: () => ({ left: 100, top: 40, width: 960, height: 540 }),
        setPointerCapture: (id: number) => { captured.push(id); },
        releasePointerCapture: () => undefined,
        addEventListener: (name: string, fn: (e: unknown) => void) => { if (name === 'wheel') wheel = fn; },
        removeEventListener: () => undefined,
      }),
    });
  });
  return renderer!;
}

const box = (r: ReactTestRenderer): ReactTestInstance => r.root.findAll((n) => typeof n.props.onPointerDown === 'function' && typeof n.props.onDragOver === 'function')[0]!;
const layer = (r: ReactTestRenderer): ReactTestInstance => r.root.findAll((n) => typeof n.props.onPointerDown === 'function' && typeof n.props.onClick === 'function')[0]!;
const chip = (r: ReactTestRenderer): ReactTestInstance[] => r.root.findAll((n) => n.props['data-preview-zoom'] !== undefined);
const target = { closest: () => null };
const pointer = (clientX: number, clientY: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  clientX, clientY, pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, target,
  currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 40, width: 960, height: 540 }) }, stopPropagation: () => undefined, preventDefault: () => undefined, ...extra,
});
const fire = (node: ReactTestInstance, name: string, event: Record<string, unknown>): void => { act(() => { (node.props[name] as (e: unknown) => void)(event); }); };
/** 판 위의 누름 — 판이 먼저 받고 상자로 올라간다(버블). */
const down = (r: ReactTestRenderer, event: Record<string, unknown>): void => { fire(layer(r), 'onPointerDown', event); fire(box(r), 'onPointerDown', event); };

afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = null; });

describe('미리보기 자유 보기 — 화면 끌기 (§5.13 37-24 (F))', () => {
  it('끌 것을 못 잡은 누름을 문턱 넘게 끌면 화면이 옮겨지고, 뒤따르는 click 은 고르기가 아니다', () => {
    const r = mount({ drag: dragApi(false) });
    expect(layer(r).props.style).toMatchObject({ left: 0, top: 0, width: 960, height: 540 });
    expect(chip(r)).toHaveLength(0);
    down(r, pointer(400, 300));
    fire(box(r), 'onPointerMove', pointer(430, 320));
    expect(layer(r).props.style).toMatchObject({ left: 30, top: 20, width: 960, height: 540 });
    expect(captured).toEqual([7]);
    expect(chip(r)).toHaveLength(1);
    fire(box(r), 'onPointerUp', pointer(430, 320, { buttons: 0 }));
    fire(layer(r), 'onClick', pointer(430, 320));
    expect(presses).toBe(0);
  });

  it('문턱 안에서 떼면 종전 누르기다 — 화면은 그대로', () => {
    const r = mount({ drag: dragApi(false) });
    down(r, pointer(400, 300));
    fire(box(r), 'onPointerMove', pointer(402, 301));
    fire(box(r), 'onPointerUp', pointer(402, 301, { buttons: 0 }));
    fire(layer(r), 'onClick', pointer(402, 301));
    expect(layer(r).props.style).toMatchObject({ left: 0, top: 0 });
    expect(presses).toBe(1);
  });

  it('끌 것을 잡은 누름은 화면을 옮기지 않는다 — 가운데 단추는 그래도 옮긴다', () => {
    const r = mount({ drag: dragApi(true) });
    down(r, pointer(400, 300));
    fire(box(r), 'onPointerMove', pointer(460, 340));
    expect(layer(r).props.style).toMatchObject({ left: 0, top: 0 });
    fire(layer(r), 'onPointerUp', pointer(460, 340, { buttons: 0 }));
    down(r, pointer(400, 300, { button: 1, buttons: 4 }));
    fire(box(r), 'onPointerMove', pointer(460, 340, { button: 1, buttons: 4 }));
    expect(layer(r).props.style).toMatchObject({ left: 60, top: 40 });
  });

  it('Alt 누름(인스펙터)·단추 위 누름은 화면을 옮기지 않는다', () => {
    const r = mount({});
    down(r, pointer(400, 300, { altKey: true }));
    fire(box(r), 'onPointerMove', pointer(460, 340, { altKey: true }));
    expect(layer(r).props.style).toMatchObject({ left: 0, top: 0 });
    fire(box(r), 'onPointerDown', pointer(400, 300, { target: { closest: () => ({}) } }));
    fire(box(r), 'onPointerMove', pointer(460, 340));
    expect(layer(r).props.style).toMatchObject({ left: 0, top: 0 });
  });

  it('맞춤 보기에서 끌면 자유 보기에 들어섰다고 알린다(한 번의 끌기에 여러 번 알려도 부르는 쪽이 접는다)', () => {
    const r = mount({ zoom: 'fit' });
    down(r, pointer(400, 300));
    fire(box(r), 'onPointerMove', pointer(430, 320));
    expect(freed).toBeGreaterThan(0);
  });
});

describe('미리보기 자유 보기 — 휠 (§5.13 37-24 (F))', () => {
  const wheelAt = (clientX: number, clientY: number, deltaY: number, extra: Record<string, unknown> = {}): { prevented: boolean } => {
    const state = { prevented: false };
    act(() => { wheel?.({ clientX, clientY, deltaY, deltaMode: 0, ctrlKey: false, target, preventDefault: () => { state.prevented = true; }, ...extra }); });
    return state;
  };

  it('위로 굴리면 포인터 아래의 문서 점을 그 자리에 둔 채 커지고, 기본 스크롤을 막는다', () => {
    const r = mount({});
    // 화면 (580, 310) = 상자 안 (480, 270) = 판 한가운데.
    expect(wheelAt(580, 310, -100).prevented).toBe(true);
    const style = layer(r).props.style as { left: number; top: number; width: number; height: number };
    expect(style.width).toBeGreaterThan(960);
    expect(style.left + style.width / 2).toBeCloseTo(480);
    expect(style.top + style.height / 2).toBeCloseTo(270);
    expect(chip(r)).toHaveLength(1);
  });

  it('글 칸 안의 휠은 받지 않는다(그 칸이 스크롤한다)', () => {
    const r = mount({});
    expect(wheelAt(580, 310, -100, { target: { closest: () => ({}) } }).prevented).toBe(false);
    expect(layer(r).props.style).toMatchObject({ width: 960 });
  });

  it('자유 보기 손잡이를 받지 않으면 휠을 달지 않는다', () => {
    mount({ onFreeView: undefined as never });
    expect(wheel).toBeNull();
  });
});

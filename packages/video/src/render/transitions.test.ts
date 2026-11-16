import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAGE_PLAN_HORIZON_S, TRANSITION_BLUR_MAX_PX } from '../constants.js';
import { resolveTimeline } from '../resolveTimeline.js';
import { DEFAULT_DOC_STYLE } from '../style.js';
import type { ChapterTransition, TransitionDirection, VideoDoc, VideoItem } from '../types.js';
import { TRANSITION_DIRECTIONS as VALID_DIRECTIONS, TRANSITION_KINDS as VALID_KINDS, validateDoc } from '../validateDoc.js';
import { Canvas2DBackend, type MediaProvider } from './canvas2d.js';
import { buildDrawList, type DrawOp } from './drawList.js';
import { frameSignature } from './frameSignature.js';
import { HtmlSceneStage } from './htmlStage.js';
import { planKeyframes, planStage } from './stagePlan.js';
import {
  TRANSITION_DIRECTIONS, TRANSITION_KINDS, circleInBox, curtainOffset, easeInOutCubic, transitionBlurFilter, transitionBlurPx,
  transitionDirection, transitionEffect, transitionHasDirection,
} from './transitions.js';

/**
 * §5.13 (V) 37-8 (A)(B) · (Z) 41-3 — 더한 전환(방향·원형 열림·흐림 녹아들기·가림막 닦기)의 표, 그리고 같은 시각에 세 길이 같은 그림을 내는가:
 * 멈춘 미리보기·렌더(DOM 무대의 정확한 한 장) · canvas2d · 재생 중 합성기 예약(못 돌리는 것은 화면 스레드).
 */

const SIZE = { width: 640, height: 360 };
const FPS = 30;

describe('§5.13 37-8 전환 표', () => {
  it('검증 표와 그리기 표가 같은 종류·방향을 안다', () => {
    expect([...TRANSITION_KINDS]).toEqual(VALID_KINDS);
    expect([...TRANSITION_DIRECTIONS]).toEqual(VALID_DIRECTIONS);
  });

  it('방향은 밀기·닦아내기·가림막만 읽고, 안 적으면 방향이 생기기 전과 같은 쪽이다', () => {
    expect(TRANSITION_KINDS.filter(transitionHasDirection)).toEqual(['push', 'wipe', 'curtain']);
    expect(transitionDirection('push')).toBe('left');
    expect(transitionDirection('wipe')).toBe('right');
    expect(transitionDirection('curtain')).toBe('right');
    expect(transitionDirection('push', 'up')).toBe('up');
    expect(transitionDirection('push', 'sideways' as TransitionDirection)).toBe('left');
    expect(transitionDirection('dissolve', 'up')).toBeNull();
    // 방향 없이 적힌 옛 문서는 종전 식 그대로.
    for (const p of [0, 0.2, 0.5, 0.9, 1]) {
      const e = easeInOutCubic(p);
      expect(transitionEffect('push', 'in', p, SIZE)).toMatchObject({ dx: (1 - e) * SIZE.width, dy: 0 });
      expect(transitionEffect('push', 'out', p, SIZE).dx).toBeCloseTo(-e * SIZE.width, 9);
      expect(transitionEffect('wipe', 'in', p, SIZE).clip).toEqual({ x: 0, y: 0, width: e * SIZE.width, height: SIZE.height });
    }
  });

  it.each([
    ['left', -1, 0], ['right', 1, 0], ['up', 0, -1], ['down', 0, 1],
  ] as const)('밀기 %s: 들어오는 장면은 반대편 화면 밖에서 와 제자리에 서고, 나가는 장면은 그쪽으로 화면만큼 나간다', (direction, ux, uy) => {
    const start = transitionEffect('push', 'in', 0, SIZE, direction);
    expect([start.dx, start.dy]).toEqual([-ux * SIZE.width || 0, -uy * SIZE.height || 0]);
    expect(transitionEffect('push', 'in', 1, SIZE, direction)).toMatchObject({ dx: 0, dy: 0, opacity: 1, scale: 1 });
    const gone = transitionEffect('push', 'out', 1, SIZE, direction);
    expect([gone.dx, gone.dy]).toEqual([ux * SIZE.width || 0, uy * SIZE.height || 0]);
    // 두 장면은 늘 화면 한 장만큼 떨어져 함께 간다(틈·겹침 없음).
    for (const p of [0.1, 0.37, 0.5, 0.8]) {
      const a = transitionEffect('push', 'in', p, SIZE, direction);
      const b = transitionEffect('push', 'out', p, SIZE, direction);
      expect(b.dx - a.dx).toBeCloseTo(ux * SIZE.width, 9);
      expect(b.dy - a.dy).toBeCloseTo(uy * SIZE.height, 9);
    }
  });

  it('닦아내기는 네 방향 모두 빈 사각형에서 화면 전체로 자란다', () => {
    for (const direction of TRANSITION_DIRECTIONS) {
      const zero = transitionEffect('wipe', 'in', 0, SIZE, direction).clip!;
      expect(zero.width * zero.height).toBe(0);
      expect(transitionEffect('wipe', 'in', 1, SIZE, direction).clip).toEqual({ x: 0, y: 0, ...SIZE });
      expect(transitionEffect('wipe', 'out', 0.5, SIZE, direction).clip).toBeNull();
    }
    expect(transitionEffect('wipe', 'in', 0.5, SIZE, 'left').clip).toEqual({ x: 320, y: 0, width: 320, height: 360 });
    expect(transitionEffect('wipe', 'in', 0.5, SIZE, 'up').clip).toEqual({ x: 0, y: 180, width: 640, height: 180 });
    expect(transitionEffect('wipe', 'in', 0.5, SIZE, 'down').clip).toEqual({ x: 0, y: 0, width: 640, height: 180 });
  });

  it('원형 열림: 가운데에서 반지름 0 으로 시작해 모서리까지 덮고, 나가는 장면은 그대로다', () => {
    expect(transitionEffect('iris', 'in', 0, SIZE).circle).toEqual({ cx: 320, cy: 180, r: 0 });
    const end = transitionEffect('iris', 'in', 1, SIZE).circle!;
    expect(end.r).toBeCloseTo(Math.hypot(320, 180), 9);
    const mid = transitionEffect('iris', 'in', 0.5, SIZE).circle!;
    expect(mid.r).toBeGreaterThan(0);
    expect(mid.r).toBeLessThan(end.r);
    expect(transitionEffect('iris', 'out', 0.5, SIZE)).toMatchObject({ circle: null, opacity: 1, blur: 0 });
  });

  it('흐림 녹아들기: 들어오는 쪽은 흐림에서 또렷해지며 차오르고 나가는 쪽은 흐려진다 — 양 끝은 흐림 0', () => {
    const max = transitionBlurPx(SIZE);
    expect(max).toBeCloseTo(360 * 0.02, 9);
    expect(transitionEffect('blur', 'in', 0, SIZE)).toMatchObject({ opacity: 0, blur: Math.round(max * 10) / 10 });
    expect(transitionEffect('blur', 'in', 1, SIZE)).toMatchObject({ opacity: 1, blur: 0, scale: 1 });
    expect(transitionEffect('blur', 'out', 0, SIZE)).toMatchObject({ opacity: 1, blur: 0, scale: 1 });
    expect(transitionEffect('blur', 'out', 1, SIZE).blur).toBeCloseTo(max, 1);
    let last = Infinity;
    for (let k = 0; k <= 10; k += 1) {
      const fx = transitionEffect('blur', 'in', k / 10, SIZE);
      expect(fx.blur).toBeLessThanOrEqual(last);
      expect(fx.scale).toBeGreaterThanOrEqual(1);
      last = fx.blur;
    }
  });

  it('흐림 반경은 어느 판형에서도 성능 lint(perf-blur-shadow)가 잡는 40px 아래다', () => {
    expect(TRANSITION_BLUR_MAX_PX).toBeLessThan(40);
    for (const size of [{ width: 320, height: 180 }, { width: 1080, height: 1920 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }, { width: 7680, height: 4320 }]) {
      for (let k = 0; k <= 20; k += 1) {
        expect(transitionEffect('blur', 'in', k / 20, size).blur).toBeLessThanOrEqual(TRANSITION_BLUR_MAX_PX);
        expect(transitionEffect('blur', 'out', k / 20, size).blur).toBeLessThanOrEqual(TRANSITION_BLUR_MAX_PX);
      }
    }
    expect(transitionBlurPx({ width: 3840, height: 2160 })).toBe(TRANSITION_BLUR_MAX_PX);
    expect(transitionBlurFilter(12.34)).toBe('blur(12.3px)');
    expect(transitionBlurFilter(0)).toBe('');
    expect(transitionBlurFilter(undefined)).toBe('');
  });

  it('가림막: 막이 화면 밖에서 와 가운데에서 다 덮고 반대쪽으로 나가며, 다 덮은 그 순간에 장면이 바뀐다', () => {
    expect(curtainOffset(0, SIZE)).toEqual({ dx: -640, dy: 0 });
    expect(curtainOffset(0.5, SIZE)).toEqual({ dx: 0, dy: 0 });
    expect(curtainOffset(1, SIZE)).toEqual({ dx: 640, dy: 0 });
    expect(curtainOffset(0, SIZE, 'left')).toEqual({ dx: 640, dy: 0 });
    expect(curtainOffset(0, SIZE, 'down')).toEqual({ dx: 0, dy: -360 });
    expect(curtainOffset(1, SIZE, 'up')).toEqual({ dx: 0, dy: -360 });
    // 막이 아직 덮으러 가는 동안(앞 가장자리 뒤쪽)엔 나가는 장면만, 지나간 뒤엔 들어오는 장면만 — 막 밖에 두 장면이 함께 보이는 때가 없다.
    for (let k = 0; k <= 30; k += 1) {
      const p = k / 30;
      const covering = curtainOffset(p, SIZE).dx < 0;
      const incoming = transitionEffect('curtain', 'in', p, SIZE).opacity;
      const outgoing = transitionEffect('curtain', 'out', p, SIZE).opacity;
      expect([incoming, outgoing]).toEqual(covering ? [0, 1] : [1, 0]);
    }
  });

  it('circleInBox 는 상자의 회전·배율을 되돌린다 — 다시 변환하면 문서의 그 원이다', () => {
    const circle = { cx: 320, cy: 180, r: 90 };
    expect(circleInBox(circle, { x: 0, y: 0, width: 640, height: 360, rotation: 0, scale: 1 })).toEqual(circle);
    const box = { x: 100, y: 40, width: 300, height: 200, rotation: 30, scale: 1.5 };
    const local = circleInBox(circle, box);
    const rad = (box.rotation * Math.PI) / 180;
    const vx = (local.cx - box.width / 2) * box.scale;
    const vy = (local.cy - box.height / 2) * box.scale;
    expect(box.x + box.width / 2 + vx * Math.cos(rad) - vy * Math.sin(rad)).toBeCloseTo(circle.cx, 9);
    expect(box.y + box.height / 2 + vx * Math.sin(rad) + vy * Math.cos(rad)).toBeCloseTo(circle.cy, 9);
    expect(local.r * box.scale).toBeCloseTo(circle.r, 9);
    expect(circleInBox(circle, { ...box, scale: 0 }).r).toBe(0);
  });
});

// ── 문서 하나: 장면 a(2초) → 전환 → 장면 b(2초). 아이템마다 채움색이 달라 색이 곧 이름표다(덧그림의 z 는 보이는 것에 따라 바뀐다).

const BOX = { x: 100, y: 40, width: 300, height: 200, rotation: 30, scale: 1.5 };

function doc(transition: ChapterTransition | undefined, opts: { boxed?: boolean; style?: boolean; size?: VideoDoc['size'] } = {}): VideoDoc {
  const shape = (id: string, chapter: string, fill: string, extra: Partial<VideoItem> = {}): VideoItem =>
    ({ id, kind: 'shape', chapterId: chapter, at: { chapter, offset: 0 }, duration: 2, props: { shape: 'rect', fill }, ...extra }) as unknown as VideoItem;
  return {
    schemaVersion: 1, id: 'd', title: 'd', version: 1, size: opts.size ?? SIZE, fps: FPS,
    chapters: [
      { id: 'a', title: 'a', duration: 2, status: 'done' },
      { id: 'b', title: 'b', duration: 2, status: 'done', ...(transition ? { transition } : {}) },
    ],
    tracks: [
      { id: 'v0', kind: 'visual', items: [shape('one', 'a', '#111111')] },
      { id: 'v1', kind: 'visual', items: [shape('two', 'b', '#222222', opts.boxed ? { transform: BOX } : {})] },
    ],
    assets: {},
    ...(opts.style ? { style: { ...DEFAULT_DOC_STYLE, accent: '#FF0066' } } : {}),
    createdAt: 0, updatedAt: 0,
  } as unknown as VideoDoc;
}

/** 겹침 구간의 프레임 시각들(시작 포함 · 끝 제외). */
function overlapTimes(d: VideoDoc): number[] {
  const c = resolveTimeline(d).chapters[1]!;
  const out: number[] = [];
  for (let k = Math.ceil(c.start * FPS - 1e-9); k / FPS < c.start + c.overlapIn - 1e-9; k += 1) out.push(k / FPS);
  return out;
}

describe('§5.13 37-8 그리기 목록 — 새 효과 값', () => {
  it('문서 검증: 새 종류·방향은 통과하고 모르는 방향은 걸린다', () => {
    const base = { ...doc({ kind: 'curtain', duration: 0.5, direction: 'up' }) };
    expect(validateDoc(base).ok).toBe(true);
    for (const kind of ['iris', 'blur', 'curtain'] as const) expect(validateDoc(doc({ kind, duration: 0.4 })).ok).toBe(true);
    const bad = validateDoc(doc({ kind: 'push', duration: 0.5, direction: 'north' as TransitionDirection }));
    expect(bad.ok).toBe(false);
  });

  it('원형 열림은 들어오는 장면에 원을, 흐림 녹아들기는 두 장면에 흐림을 싣는다', () => {
    const iris = doc({ kind: 'iris', duration: 0.5 });
    const t = overlapTimes(iris)[7]!;
    const ops = buildDrawList(iris, resolveTimeline(iris), t);
    expect(ops.find((o) => o.itemId === 'two')!.clipCircle).toMatchObject({ cx: 320, cy: 180 });
    expect(ops.find((o) => o.itemId === 'one')!.clipCircle).toBeUndefined();

    const blur = doc({ kind: 'blur', duration: 0.5 });
    const blurOps = buildDrawList(blur, resolveTimeline(blur), t);
    expect(blurOps.find((o) => o.itemId === 'two')!.blur).toBeGreaterThan(0);
    expect(blurOps.find((o) => o.itemId === 'one')!.blur).toBeGreaterThan(0);
    // 전환 밖에서는 흐림이 남지 않는다.
    expect(buildDrawList(blur, resolveTimeline(blur), 3).every((o) => o.blur === undefined)).toBe(true);
  });

  it('가림막은 맨 위 덧그림 하나 — 스타일 강조색(없으면 기본 강조색), 고르기 대상이 아니다. 빛 번짐 덧그림의 이름은 종전 그대로', () => {
    const styled = doc({ kind: 'curtain', duration: 0.5, direction: 'down' }, { style: true });
    const t = overlapTimes(styled)[3]!;
    const ops = buildDrawList(styled, resolveTimeline(styled), t);
    const curtain = ops.at(-1)!;
    expect(curtain).toMatchObject({ itemId: '__transition-curtain-b', synthetic: true, kind: 'shape' });
    expect(curtain.resolved.item.props).toMatchObject({ fill: '#FF0066' });
    expect(curtain.z).toBeGreaterThan(Math.max(...ops.slice(0, -1).map((o) => o.z)));
    // 덧그림의 z 는 전환 내내 같다(장면이 바뀌기 전·후 — 보이는 아이템이 달라져도).
    const zs = overlapTimes(styled).map((at) => buildDrawList(styled, resolveTimeline(styled), at).at(-1)!.z);
    expect(new Set(zs)).toEqual(new Set([styled.tracks.length]));
    expect(curtain.transform).toMatchObject({ x: 0, width: 640, height: 360, opacity: 1 });
    expect(curtain.transform.y).toBeLessThan(0);
    const plain = doc({ kind: 'curtain', duration: 0.5 });
    expect(buildDrawList(plain, resolveTimeline(plain), t).at(-1)!.resolved.item.props).toMatchObject({ fill: DEFAULT_DOC_STYLE.accent });
    const flash = doc({ kind: 'flash', duration: 0.5 });
    expect(buildDrawList(flash, resolveTimeline(flash), t).at(-1)!.itemId).toBe('__transition-flash-b');
  });

  it('프레임 지문은 방향·원·흐림이 바꾼 그림을 가른다(같은 지역 프레임이라도)', () => {
    const sig = (tr: ChapterTransition): string => {
      const d = doc(tr);
      return frameSignature(d, resolveTimeline(d), overlapTimes(d)[7]!, FPS);
    };
    const all = [
      sig({ kind: 'wipe', duration: 0.5 }), sig({ kind: 'wipe', duration: 0.5, direction: 'up' }), sig({ kind: 'wipe', duration: 0.5, direction: 'down' }),
      sig({ kind: 'iris', duration: 0.5 }), sig({ kind: 'blur', duration: 0.5 }), sig({ kind: 'dissolve', duration: 0.5 }),
      sig({ kind: 'curtain', duration: 0.5 }), sig({ kind: 'curtain', duration: 0.5, direction: 'up' }),
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});

// ── 세 길 대조: 가짜 DOM 위의 무대(멈춤 = 렌더와 같은 정확한 한 장 · 재생 = 합성기 예약)와 기록하는 canvas.

interface Anim { readonly keyframes: readonly Record<string, unknown>[]; cancelled: boolean; startTime: number; cancel(): void }

class Element {
  style: Record<string, string> = {};
  children: Element[] = [];
  parent: Element | null = null;
  className = '';
  readonly anims: Anim[] = [];
  constructor(readonly tag: string) {}
  setAttribute(): void {}
  addEventListener(): void {}
  appendChild(child: Element): Element { child.remove(); child.parent = this; this.children.push(child); return child; }
  insertBefore(child: Element): Element { return this.appendChild(child); }
  replaceChildren(...children: Element[]): void { for (const child of [...this.children]) child.remove(); for (const child of children) this.appendChild(child); }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  animate(keyframes: readonly Record<string, unknown>[]): Anim {
    const anim: Anim = { keyframes, cancelled: false, startTime: 0, cancel() { this.cancelled = true; } };
    this.anims.push(anim);
    return anim;
  }
}

let nodes: Element[];
const owners: Array<{ dispose(): void }> = [];

beforeEach(() => {
  nodes = [];
  vi.stubGlobal('window', { addEventListener: () => undefined, removeEventListener: () => undefined });
  vi.stubGlobal('document', {
    createElement: (tag: string) => { const el = new Element(tag); nodes.push(el); return el; },
    getElementById: () => ({}),
    fonts: { ready: Promise.resolve() },
    body: new Element('body'),
  });
});

afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose();
  vi.unstubAllGlobals();
});

function stage(d: VideoDoc): HtmlSceneStage {
  const s = new HtmlSceneStage({ doc: d, timeline: resolveTimeline(d), media: {} as MediaProvider, compositionSrc: () => null, preview: true });
  owners.push(s);
  return s;
}

/** 그려진 상자들을 채움색(아이템마다 다르다)으로 찾는다. */
function wrappers(): Map<string, Element> {
  const out = new Map<string, Element>();
  for (const el of nodes) {
    const fill = el.children[0]?.style['background'];
    if (el.className === 'vs-item' && el.parent && fill !== undefined) out.set(fill, el);
  }
  return out;
}
const fillOf = (op: DrawOp): string => String(op.resolved.item.props?.['fill']);

/** 상자가 지금 화면에 놓인 값(문서 픽셀). 예약이 걸렸으면 그 프레임의 키프레임 값을 얹는다. */
interface Placed { readonly x: number; readonly y: number; readonly opacity: number; readonly scale: number; readonly rotation: number; readonly clipPath: string; readonly filter: string }

function px(v: string | undefined): number {
  return v === undefined || v === '' ? 0 : Number(v.replace('px', ''));
}

function placedFromStyle(el: Element): Placed {
  const m = /rotate\(([-\d.e]+)deg\) scale\(([-\d.e]+)\)/.exec(el.style['transform'] ?? '');
  return {
    x: px(el.style['left']), y: px(el.style['top']), opacity: Number(el.style['opacity'] ?? '1'),
    rotation: m ? Number(m[1]) : 0, scale: m ? Number(m[2]) : 1,
    clipPath: el.style['clipPath'] ?? '', filter: el.style['filter'] ?? '',
  };
}

function placedFromKeyframe(el: Element, frame: Record<string, unknown>): Placed {
  const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) rotate\(([-\d.e]+)deg\) scale\(([-\d.e]+)\)/.exec(String(frame['transform']))!;
  return {
    x: px(el.style['left']) + Number(m[1]), y: px(el.style['top']) + Number(m[2]), opacity: Number(frame['opacity']),
    rotation: Number(m[3]), scale: Number(m[4]),
    clipPath: el.style['clipPath'] ?? '', filter: el.style['filter'] ?? '',
  };
}

async function pausedAt(d: VideoDoc, t: number): Promise<Map<string, Placed>> {
  nodes = [];
  const s = stage(d);
  await s.seek(t);
  const out = new Map([...wrappers()].map(([fill, el]) => [fill, placedFromStyle(el)] as const));
  s.dispose();
  return out;
}

function expectSamePlace(got: Placed, want: Placed, label: string): void {
  expect(got.x, `${label} x`).toBeCloseTo(want.x, 2);
  expect(got.y, `${label} y`).toBeCloseTo(want.y, 2);
  expect(got.opacity, `${label} opacity`).toBeCloseTo(want.opacity, 2);
  expect(got.scale, `${label} scale`).toBeCloseTo(want.scale, 2);
  expect(got.rotation, `${label} rotation`).toBeCloseTo(want.rotation, 2);
  expect(got.clipPath, `${label} clipPath`).toBe(want.clipPath);
  expect(got.filter, `${label} filter`).toBe(want.filter);
}

/** canvas2d 가 아이템마다 한 일(문서 좌표): 불투명도 · 잘라 낸 사각형/원 · 필터 · 상자 가운데와 배율. */
interface Painted { alpha: number; rects: number[][]; arcs: number[][]; filter: string; center: number[]; scale: number }

async function canvasAt(d: VideoDoc, t: number): Promise<Painted[]> {
  const painted: Painted[] = [];
  let cur: Painted | null = null;
  let path: { rect?: number[]; arc?: number[] } = {};
  let depth = 0;
  const context = {
    globalAlpha: 1,
    filter: 'none',
    save(): void { depth += 1; if (depth === 1) { cur = { alpha: 1, rects: [], arcs: [], filter: '', center: [], scale: 1 }; this.filter = 'none'; } },
    restore(): void {
      if (depth === 1 && cur) { cur.alpha = this.globalAlpha; cur.filter = this.filter === 'none' ? '' : this.filter; painted.push(cur); cur = null; this.globalAlpha = 1; }
      depth -= 1;
    },
    beginPath(): void { path = {}; },
    rect(...a: number[]): void { path.rect = a; },
    arc(...a: number[]): void { path.arc = a.slice(0, 3); },
    clip(): void { if (cur && path.rect) cur.rects.push(path.rect); if (cur && path.arc) cur.arcs.push(path.arc); },
    translate(x: number, y: number): void { if (cur && cur.center.length === 0) cur.center = [x, y]; },
    scale(s: number): void { if (cur) cur.scale = s; },
    rotate(): void {}, clearRect(): void {}, fillRect(): void {}, fill(): void {}, stroke(): void {}, roundRect(): void {},
  };
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  const backend = new Canvas2DBackend({ doc: d, timeline: resolveTimeline(d), scenes: {}, media: { getImage: async () => null, getFrame: async () => null }, createCanvas: () => canvas });
  await backend.init(d.size);
  await backend.drawFrame(t);
  backend.dispose();
  return painted.slice(1); // 첫 save/restore 는 배경.
}

/** DOM `clip-path` 를 문서 좌표로 되돌린다(상자의 회전·배율을 다시 입힌다). */
function domCircleInDoc(place: Placed, box: { width: number; height: number }): number[] | null {
  const m = /^circle\(([-\d.e]+)px at ([-\d.e]+)px ([-\d.e]+)px\)$/.exec(place.clipPath);
  if (!m) return null;
  const rad = (place.rotation * Math.PI) / 180;
  const vx = (Number(m[2]) - box.width / 2) * place.scale;
  const vy = (Number(m[3]) - box.height / 2) * place.scale;
  return [
    place.x + box.width / 2 + vx * Math.cos(rad) - vy * Math.sin(rad),
    place.y + box.height / 2 + vx * Math.sin(rad) + vy * Math.cos(rad),
    Number(m[1]) * place.scale,
  ];
}

function domRectInDoc(place: Placed, box: { width: number; height: number }): number[] | null {
  const m = /^inset\(([-\d.e]+)px ([-\d.e]+)px ([-\d.e]+)px ([-\d.e]+)px\)$/.exec(place.clipPath);
  if (!m) return null;
  const [top, right, bottom, left] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return [place.x + left, place.y + top, box.width - left - right, box.height - top - bottom];
}

const CASES: readonly ChapterTransition[] = [
  ...TRANSITION_DIRECTIONS.map((direction): ChapterTransition => ({ kind: 'push', duration: 0.5, direction })),
  ...TRANSITION_DIRECTIONS.map((direction): ChapterTransition => ({ kind: 'wipe', duration: 0.5, direction })),
  ...TRANSITION_DIRECTIONS.map((direction): ChapterTransition => ({ kind: 'curtain', duration: 0.5, direction })),
  { kind: 'iris', duration: 0.5 },
  { kind: 'blur', duration: 0.5 },
];
const label = (tr: ChapterTransition): string => `${tr.kind}${tr.direction ? `-${tr.direction}` : ''}`;

describe('§5.13 37-8 미리보기 = 렌더 — DOM 무대와 canvas2d 가 같은 그리기 목록에서 같은 자리·같은 잘림·같은 흐림을 낸다', () => {
  it.each(CASES.map((tr) => [label(tr), tr] as const))('%s', async (_name, tr) => {
    const d = doc(tr);
    const tl = resolveTimeline(d);
    for (const t of overlapTimes(d)) {
      const ops = buildDrawList(d, tl, t);
      const dom = await pausedAt(d, t);
      const canvas = await canvasAt(d, t);
      expect(dom.size, `t=${t}`).toBe(ops.length);
      expect(canvas, `t=${t}`).toHaveLength(ops.length);
      ops.forEach((op: DrawOp, i) => {
        const place = dom.get(fillOf(op))!;
        const paint = canvas[i]!;
        const box = op.transform;
        const where = `${op.itemId} t=${t}`;
        expect(place.opacity, where).toBeCloseTo(paint.alpha, 6);
        expect(place.x + box.width / 2, where).toBeCloseTo(paint.center[0]!, 6);
        expect(place.y + box.height / 2, where).toBeCloseTo(paint.center[1]!, 6);
        expect(place.scale, where).toBeCloseTo(paint.scale, 6);
        expect(place.filter, where).toBe(paint.filter);
        const rect = domRectInDoc(place, box);
        expect(paint.rects, where).toHaveLength(rect ? 1 : 0);
        rect?.forEach((v, k) => expect(v, where).toBeCloseTo(paint.rects[0]![k]!, 6));
        const circle = domCircleInDoc(place, box);
        expect(paint.arcs, where).toHaveLength(circle ? 1 : 0);
        circle?.forEach((v, k) => expect(v, where).toBeCloseTo(paint.arcs[0]![k]!, 6));
      });
    }
  });

  it('원형 열림: 돌리고 키운 상자에서도 DOM 이 자르는 원은 canvas 가 자르는 문서의 그 원이다', async () => {
    const d = doc({ kind: 'iris', duration: 0.5 }, { boxed: true });
    const tl = resolveTimeline(d);
    for (const t of overlapTimes(d)) {
      const op = buildDrawList(d, tl, t).find((o) => o.itemId === 'two')!;
      const place = (await pausedAt(d, t)).get(fillOf(op))!;
      const paint = (await canvasAt(d, t))[1]!;
      const circle = domCircleInDoc(place, op.transform)!;
      circle.forEach((v, k) => expect(v, `t=${t}`).toBeCloseTo(paint.arcs[0]![k]!, 6));
      expect(circle[2]).toBeCloseTo(op.clipCircle!.r, 6);
    }
  });
});

describe('§5.13 (Z) 41-3 합성기 예약 길 — 재생 중에도 프레임 시각의 값은 멈춘 화면(= 렌더)과 같다', () => {
  it.each(CASES.map((tr) => [label(tr), tr] as const))('%s', async (_name, tr) => {
    const d = doc(tr);
    const tl = resolveTimeline(d);
    const times = overlapTimes(d);
    const from = times[0]!;
    const plan = planStage(d, tl, from, STAGE_PLAN_HORIZON_S, FPS);
    const compositorOnly = tr.kind === 'push' || tr.kind === 'curtain';
    // 자리 이동·불투명도뿐인 전환은 덧그림까지 예약되고, 잘라 보이기·흐림이 걸리는 상자는 화면 스레드 몫이다.
    if (compositorOnly) expect([...plan.items.values()].every((item) => item.plannable)).toBe(true);
    else if (tr.kind === 'blur') expect([...plan.items.values()].map((item) => item.plannable)).toEqual([false, false]);
    else expect(plan.items.get('two')!.plannable).toBe(false);

    nodes = [];
    const s = stage(d);
    s.play({ t: from, perfMs: 0 });
    for (const t of times) {
      await s.seek(t);
      const index = Math.round((t - plan.from) * FPS);
      const want = await (async () => { const keep = nodes; const out = await pausedAt(d, t); nodes = keep; return out; })();
      const live = wrappers();
      expect(want.size).toBe(buildDrawList(d, tl, t).length);
      for (const [fill, wanted] of want) {
        const el = live.get(fill)!;
        expect(el, `${fill} t=${t}`).toBeDefined();
        const anim = el.anims.filter((a) => !a.cancelled).at(-1);
        const item = [...plan.items.values()].find((it) => fillOf(it.first) === fill)!;
        expect(anim !== undefined, `${fill} planned`).toBe(item.plannable);
        const got = anim ? placedFromKeyframe(el, anim.keyframes[index]!) : placedFromStyle(el);
        expectSamePlace(got, wanted, `${label(tr)} ${fill} t=${t}`);
        if (anim) expect(anim.keyframes).toEqual(planKeyframes(item, { primeBefore: false }));
      }
    }
    // 멈추면 그 자리 배치를 쓰고 예약을 걷는다 — 전환이 끝난 뒤의 상자에 잘림·흐림이 남지 않는다.
    s.stopPlay();
    await s.seek(3);
    for (const el of wrappers().values()) {
      expect(el.anims.every((a) => a.cancelled)).toBe(true);
      expect(el.style['clipPath'] ?? '').toBe('');
      expect(el.style['filter'] ?? '').toBe('');
    }
  });

  it('흐림이 걸렸던 상자가 다음 예약에서 합성기로 넘어가면 상자의 흐림을 지운다', async () => {
    const d = doc({ kind: 'blur', duration: 0.5 });
    const times = overlapTimes(d);
    const s = stage(d);
    s.play({ t: times[0]!, perfMs: 0 });
    await s.seek(times[5]!);
    const two = wrappers().get('#222222')!;
    expect(two.style['filter']).toMatch(/^blur\(/);
    expect(two.anims).toHaveLength(0);
    // 예약은 1초마다 다시 짠다 — 전환이 끝난 뒤의 구간에서는 그 상자가 예약된다.
    s.play({ t: 2.6, perfMs: 0 });
    await s.seek(2.6);
    expect(two.anims.filter((a) => !a.cancelled)).toHaveLength(1);
    expect(two.style['filter']).toBe('');
  });
});

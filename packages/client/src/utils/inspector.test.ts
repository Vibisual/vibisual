import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetZoomRectModeForTest,
  cumulativeCssZoom,
  getAdjustedRect,
  probeZoomDividesRects,
  visualClientRect,
} from './inspector.js';

/**
 * §5.4 #15 (B) — Alt 인스펙터 상자는 **화면에 보이는 자리**에 앉는다.
 *
 * IDE 본문은 글자 크기(`ideTextZoom`)를 항목마다 CSS `zoom` 으로 건다. 통합 앱의 엔진(Electron 31 =
 * Chromium 126)은 그 아래 요소의 `getBoundingClientRect` 를 zoom 으로 나눠 주어, 상자가 IDE 본문에서만
 * 오른쪽 아래로 밀리고 커졌다(사용자 보고 — 배율 0.9, "뭔지 모르겠다"). 표준 엔진은 이미 보이는 값을
 * 주므로 거기서는 아무것도 곱하지 않아야 한다 — 두 번 곱하면 같은 사고가 반대 방향으로 난다.
 */

/** DOM 없이 도는 테스트(jsdom 미설치) — 인스펙터가 실제로 읽는 칸만 흉내 낸다. */
class FakeDOMRect {
  x: number;
  y: number;
  width: number;
  height: number;
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
  get left(): number { return this.x; }
  get top(): number { return this.y; }
  get right(): number { return this.x + this.width; }
  get bottom(): number { return this.y + this.height; }
}

interface FakeEl {
  zoom: number;
  parentElement: FakeEl | null;
  assignedSlot: FakeEl | null;
  ownerDocument: { defaultView: { getComputedStyle: (e: FakeEl) => { zoom: string } } };
  getRootNode: () => { host?: FakeEl };
  getBoundingClientRect: () => FakeDOMRect;
}

const VIEW = { getComputedStyle: (e: FakeEl) => ({ zoom: String(e.zoom) }) };

/** `raw` 는 **엔진이 돌려주는 값**이다 — 옛 엔진이면 누적 zoom 으로 나눠진 값. */
function fakeEl(zoom: number, parent: FakeEl | null, raw: [number, number, number, number] = [0, 0, 0, 0]): FakeEl {
  return {
    zoom,
    parentElement: parent,
    assignedSlot: null,
    ownerDocument: { defaultView: VIEW },
    getRootNode: () => ({}),
    getBoundingClientRect: () => new FakeDOMRect(...raw),
  };
}

const asEl = (e: FakeEl): Element => e as unknown as Element;
const zoomOf = (e: Element): number => (e as unknown as FakeEl).zoom;

interface ProbeNode {
  style: { cssText: string };
  parent: ProbeNode | null;
  appendChild: (c: ProbeNode) => ProbeNode;
  remove: () => void;
  getBoundingClientRect: () => { width: number; height: number };
}

/**
 * 잴 상자를 꽂을 문서 — `dividesRects` 면 옛 엔진처럼 zoom 아래 크기를 나눠서, 아니면 보이는 대로 준다.
 * 꽂힌 것이 남는지(`attached`)와 몇 번 쟀는지(`probes`)도 본다.
 */
function engineDoc(dividesRects: boolean): { doc: Document; attached: ProbeNode[]; probes: () => number } {
  const attached: ProbeNode[] = [];
  let probes = 0;
  const createElement = (): ProbeNode => {
    const n: ProbeNode = {
      style: { cssText: '' },
      parent: null,
      appendChild(c) { c.parent = n; return c; },
      remove() {
        const i = attached.indexOf(n);
        if (i >= 0) attached.splice(i, 1);
      },
      getBoundingClientRect() {
        const w = parseFloat(/width:(\d+)px/.exec(n.style.cssText)?.[1] ?? '0');
        const zoomed = n.parent?.style.cssText.includes('zoom:2') ?? false;
        const shown = zoomed && !dividesRects ? w * 2 : w;
        return { width: shown, height: shown };
      },
    };
    return n;
  };
  const doc = {
    body: {
      appendChild(c: ProbeNode) {
        probes += 1;
        attached.push(c);
        return c;
      },
    },
    documentElement: null,
    createElement,
  };
  return { doc: doc as unknown as Document, attached, probes: () => probes };
}

/** 사각형 네 칸 — 소수 오차를 걸러 비교한다. */
function box(r: { left: number; top: number; width: number; height: number }): number[] {
  return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 1000) / 1000);
}

beforeEach(() => {
  vi.stubGlobal('DOMRect', FakeDOMRect);
  __resetZoomRectModeForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetZoomRectModeForTest();
});

describe('probeZoomDividesRects — 엔진이 zoom 아래 사각형을 나눠 주는가', () => {
  it('옛 엔진(Chromium 126 — 통합 앱의 Electron 31)은 나눠 준다', () => {
    const { doc, attached } = engineDoc(true);
    expect(probeZoomDividesRects(doc)).toBe(true);
    expect(attached).toHaveLength(0);
  });

  it('표준 엔진(Chromium 128+)은 보이는 값을 준다', () => {
    const { doc, attached } = engineDoc(false);
    expect(probeZoomDividesRects(doc)).toBe(false);
    expect(attached).toHaveLength(0);
  });
});

describe('cumulativeCssZoom — 조상의 zoom 을 곱한다', () => {
  it('항목 래퍼의 zoom 이 그 안 모든 요소에 곱해진다(겹치면 겹친 만큼)', () => {
    const root = fakeEl(1, null);
    const item = fakeEl(0.9, root);
    const nested = fakeEl(1.5, item);
    const leaf = fakeEl(1, nested);
    expect(cumulativeCssZoom(asEl(leaf), zoomOf)).toBeCloseTo(1.35, 10);
    expect(cumulativeCssZoom(asEl(item), zoomOf)).toBeCloseTo(0.9, 10);
    expect(cumulativeCssZoom(asEl(root), zoomOf)).toBe(1);
  });

  it('그림자 트리의 뿌리는 호스트로, 슬롯에 꽂힌 요소는 슬롯으로 올라간다 — 그려지는 트리를 따른다', () => {
    const host = fakeEl(0.5, fakeEl(1, null));
    const slot: FakeEl = { ...fakeEl(2, null), getRootNode: () => ({ host }) };
    // DOM 부모는 호스트지만 그려지는 부모는 슬롯이다 — 호스트로 곧장 가면 슬롯의 2 를 놓친다.
    const slotted: FakeEl = { ...fakeEl(1, host), assignedSlot: slot };
    expect(cumulativeCssZoom(asEl(slotted), zoomOf)).toBe(1);
    const shadowTop: FakeEl = { ...fakeEl(3, null), getRootNode: () => ({ host }) };
    expect(cumulativeCssZoom(asEl(shadowTop), zoomOf)).toBe(1.5);
  });

  it('기본 읽기는 계산된 스타일의 zoom 이다 — 못 읽는 값은 1 로 본다', () => {
    const odd: FakeEl = {
      ...fakeEl(1, null),
      ownerDocument: { defaultView: { getComputedStyle: () => ({ zoom: 'normal' }) } },
    };
    expect(cumulativeCssZoom(asEl(fakeEl(0.9, odd)))).toBeCloseTo(0.9, 10);
  });
});

describe('visualClientRect / getAdjustedRect — 인스펙터가 그리는 상자', () => {
  it('옛 엔진: IDE 본문(zoom 0.9) 안 요소는 위치·크기를 zoom 만큼 되돌려 보이는 자리에 그린다', () => {
    vi.stubGlobal('document', engineDoc(true).doc);
    // 화면에서 [1400,400] 400×20 인 한 줄 — 엔진은 0.9 로 나눈 [1555.6,444.4] 444.4×22.2 를 준다.
    const line = fakeEl(1, fakeEl(0.9, fakeEl(1, null)), [1400 / 0.9, 400 / 0.9, 400 / 0.9, 20 / 0.9]);
    expect(box(getAdjustedRect(asEl(line), null))).toEqual([1400, 400, 400, 20]);
    expect(getAdjustedRect(asEl(line), null).bottom).toBeCloseTo(420, 6);
  });

  it('옛 엔진이어도 zoom 밖 요소(창 머리·입력창)는 엔진 값 그대로다', () => {
    vi.stubGlobal('document', engineDoc(true).doc);
    const header = fakeEl(1, fakeEl(1, null), [1200, 80, 600, 32]);
    expect(box(visualClientRect(asEl(header)))).toEqual([1200, 80, 600, 32]);
  });

  it('표준 엔진: 이미 보이는 값이라 곱하지 않는다(두 번 곱하면 반대로 어긋난다)', () => {
    vi.stubGlobal('document', engineDoc(false).doc);
    const line = fakeEl(1, fakeEl(0.9, fakeEl(1, null)), [1400, 400, 400, 20]);
    expect(box(getAdjustedRect(asEl(line), null))).toEqual([1400, 400, 400, 20]);
  });

  it('iframe 안 요소는 iframe 자리만큼 옮기고, 둘 다 보이는 값으로 잰다', () => {
    vi.stubGlobal('document', engineDoc(true).doc);
    const inner = fakeEl(1, fakeEl(1.25, fakeEl(1, null)), [100 / 1.25, 40 / 1.25, 80 / 1.25, 16 / 1.25]);
    const frame = fakeEl(1, fakeEl(1, null), [300, 200, 640, 480]);
    const r = getAdjustedRect(asEl(inner), frame as unknown as HTMLIFrameElement);
    expect(box(r)).toEqual([400, 240, 80, 16]);
  });

  it('엔진 동작은 한 번만 잰다 — 마우스가 움직일 때마다 문서에 상자를 꽂지 않는다', () => {
    const engine = engineDoc(true);
    vi.stubGlobal('document', engine.doc);
    const line = fakeEl(1, fakeEl(0.9, fakeEl(1, null)), [10, 10, 10, 10]);
    for (let i = 0; i < 5; i += 1) visualClientRect(asEl(line));
    expect(engine.probes()).toBe(1);
    expect(engine.attached).toHaveLength(0);
  });
});

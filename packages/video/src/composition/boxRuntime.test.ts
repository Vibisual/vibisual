import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { scanComposition } from './lint.js';
import { boxPropNames } from './meta.js';
import { compositionRuntimeScript } from './runtime.js';
import { guideTopicFor, COMPOSITION_GUIDE } from './guide.js';

/**
 * §5.13 (V) 37-21 — 위치·크기를 값으로 선언한 요소(`data-vibi-prop-x|y|w|h`): 심은 읽어서 알릴 뿐이고(DOM 불변),
 * 선언 요소가 있으면 값 변경을 "바로 반영"으로 센다(끄는 동안 프레임을 다시 열지 않게).
 */

type Msg = Record<string, unknown>;

interface FakeEl {
  nodeType: 1;
  tagName: string;
  id: string;
  attrs: Record<string, string>;
  parentElement: FakeEl | null;
  children: FakeEl[];
  box: { left: number; top: number; width: number; height: number };
  textContent: string;
  style: { setProperty(name: string, value: string): void };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  closest(selector: string): FakeEl | null;
}

const BOX_NAMES = ['data-vibi-prop-x', 'data-vibi-prop-y', 'data-vibi-prop-w', 'data-vibi-prop-h'];

/** 심이 쓰는 두 선택자(`[data-vibi-prop]` · 상자 선언 넷)만 아는 가짜 판정. */
function matches(node: FakeEl, selector: string): boolean {
  return selector.split(',').some((part) => {
    const name = /^\[([a-z-]+)\]$/.exec(part.trim())?.[1];
    return name !== undefined && name in node.attrs;
  });
}

function el(tag: string, attrs: Record<string, string> = {}, box: [number, number, number, number] = [0, 0, 10, 10], children: FakeEl[] = []): FakeEl {
  const [left, top, width, height] = box;
  const writes: string[] = [];
  const node: FakeEl = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: attrs['id'] ?? '',
    attrs,
    parentElement: null,
    children,
    box: { left, top, width, height },
    textContent: '',
    style: { setProperty: (name, value) => { writes.push(`${name}=${value}`); } },
    getAttribute(name) { return name in this.attrs ? this.attrs[name]! : null; },
    setAttribute(name, value) { this.attrs[name] = value; },
    getBoundingClientRect() { return this.box; },
    closest(selector) {
      for (let cur: FakeEl | null = this; cur; cur = cur.parentElement) if (matches(cur, selector)) return cur;
      return null;
    },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function flatten(root: FakeEl): FakeEl[] {
  return [root, ...root.children.flatMap(flatten)];
}

function boot(body: FakeEl, hooks = '') {
  const messages: Msg[] = [];
  const listeners: Array<(e: unknown) => void> = [];
  const html = el('html', {}, [0, 0, 640, 360], [body]);
  let under: FakeEl | null = null;
  const parent = { postMessage(msg: unknown): void { messages.push(JSON.parse(JSON.stringify(msg)) as Msg); } };
  const sandbox: Record<string, unknown> = {
    parent,
    innerWidth: 640,
    innerHeight: 360,
    performance: { now: () => 0 },
    requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(0), 0),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    setTimeout,
    clearTimeout,
    addEventListener: (type: string, fn: (e: unknown) => void) => { if (type === 'message') listeners.push(fn); },
    document: {
      readyState: 'complete',
      images: [],
      documentElement: html,
      body,
      addEventListener: () => undefined,
      getAnimations: () => [],
      querySelector: () => null,
      querySelectorAll: (selector: string) => flatten(html).filter((node) => matches(node, selector)),
      getElementsByTagName: () => flatten(html),
      elementFromPoint: () => under,
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var window = globalThis;', ctx);
  vm.runInContext(compositionRuntimeScript({ props: {}, seed: 7, itemId: 'comp-1', fps: 30, duration: 4, width: 640, height: 360 }), ctx);
  if (hooks) vm.runInContext(hooks, ctx);
  let seq = 0;
  const send = (data: Msg): number => {
    const id = (seq += 1);
    for (const fn of listeners) fn({ source: parent, data: { ...data, seq: id } });
    return id;
  };
  const wait = async (answer: string, id: number): Promise<Msg> => {
    for (let i = 0; i < 50; i += 1) {
      const hit = messages.find((m) => m.__vibi === answer && m.seq === id);
      if (hit) return hit;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    throw new Error(`no ${answer}`);
  };
  return {
    pick(target: FakeEl): Promise<Msg> { under = target; return wait('picked', send({ __vibi: 'pick', x: 1, y: 1 })); },
    props(values: Msg): Promise<Msg> { return wait('props-applied', send({ __vibi: 'props', values })); },
  };
}

describe('§5.13 (V) 37-21 런타임 — 상자 선언', () => {
  it('선언한 요소를 집으면 값 이름·그 요소의 경로·사각형을 싣는다(안쪽 자식을 집어도 가장 가까운 선언 요소)', async () => {
    const label = el('span', {}, [50, 60, 80, 20]);
    const card = el('div', { id: 'card', 'data-vibi-prop-x': 'cardX', 'data-vibi-prop-y': 'cardY', 'data-vibi-prop-w': 'cardW' }, [40, 50, 200, 100], [label]);
    const body = el('body', {}, [0, 0, 640, 360], [card]);
    const answer = await boot(body).pick(label);
    expect(answer['box']).toEqual({ x: 'cardX', y: 'cardY', w: 'cardW', path: 'div#card', rect: { x: 40, y: 50, width: 200, height: 100 } });
  });

  it('선언이 없으면 box 를 싣지 않는다(손잡이를 지어내지 않는다)', async () => {
    const title = el('h1', { 'data-vibi-prop': 'title' }, [40, 20, 300, 60]);
    const body = el('body', {}, [0, 0, 640, 360], [title]);
    const answer = await boot(body).pick(title);
    expect(answer).toMatchObject({ __vibi: 'picked', prop: 'title' });
    expect('box' in answer).toBe(false);
  });

  it('빈 이름·너무 긴 이름은 선언으로 치지 않는다', async () => {
    const card = el('div', { 'data-vibi-prop-x': '', 'data-vibi-prop-y': 'y'.repeat(65) }, [40, 50, 200, 100]);
    const body = el('body', {}, [0, 0, 640, 360], [card]);
    expect('box' in (await boot(body).pick(card))).toBe(false);
  });

  it('선언 요소가 가리키는 값이 오면 바로 반영되는 것으로 센다(live) — 프레임을 다시 열지 않는다', async () => {
    const card = el('div', { 'data-vibi-prop-x': 'cardX' }, [40, 50, 200, 100]);
    const body = el('body', {}, [0, 0, 640, 360], [card]);
    expect(await boot(body).props({ cardX: 120 })).toMatchObject({ live: true });
    // 그 값이 실리지 않았으면 종전 판정 그대로다(묶인 곳·onProps·seek 가 없으면 live 가 아니다).
    expect(await boot(body).props({ other: 1 })).toMatchObject({ live: false });
  });
});

describe('§5.13 (V) 37-21 — 탐침 lint · 규약 글', () => {
  const html = (decl: string, attrs: string): string =>
    `<meta name="vibi:duration" content="2"><script type="application/json" id="vibi-props">${decl}</script><style>@keyframes a {}</style><div ${attrs}></div>`;

  it('가리킨 값 이름을 나온 순서대로 읽는다(따옴표 종류·없음 모두)', () => {
    expect(boxPropNames(`<div data-vibi-prop-x="ax" data-vibi-prop-y='ay' data-vibi-prop-w=aw data-vibi-prop-h = "ah"></div>`)).toEqual(['ax', 'ay', 'aw', 'ah']);
    expect(boxPropNames('<h1 data-vibi-prop="title" data-vibi-prop-attr="href"></h1>')).toEqual([]);
  });

  it('number 로 선언되지 않은 값을 가리키면 box-prop-unknown 으로 알린다', () => {
    const codes = (decl: string, attrs: string): string[] => scanComposition({ html: html(decl, attrs), scripts: [], styles: [] }).lint.map((l) => l.code);
    const decl = '{"cardX":{"type":"number","default":0},"label":{"type":"text","default":"a"}}';
    expect(codes(decl, 'data-vibi-prop-x="cardX"')).not.toContain('box-prop-unknown');
    expect(codes(decl, 'data-vibi-prop-x="cardX" data-vibi-prop-y="cardY"')).toContain('box-prop-unknown');
    expect(codes(decl, 'data-vibi-prop-x="label"')).toContain('box-prop-unknown');
    const entry = scanComposition({ html: html(decl, 'data-vibi-prop-y="cardY"'), scripts: [], styles: [] }).lint.find((l) => l.code === 'box-prop-unknown');
    expect(entry).toMatchObject({ level: 'warn' });
    expect(entry?.message).toContain('cardY');
  });

  it('선언 방법은 values 주제와 /composition/guide 합본(값 선언 바로 뒤)에 실린다', () => {
    const values = guideTopicFor('values')!;
    for (const word of ['data-vibi-prop-x', 'data-vibi-prop-w', '"type": "number"', '--vibi-prop-cardX', 'box-prop-unknown']) expect(values).toContain(word);
    const box = COMPOSITION_GUIDE.indexOf('## Position and size as values');
    expect(box).toBeGreaterThan(COMPOSITION_GUIDE.indexOf('## Values — declare what a person may change'));
    expect(box).toBeLessThan(COMPOSITION_GUIDE.indexOf('## Style and formats'));
  });
});

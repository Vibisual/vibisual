import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { compositionRuntimeScript } from './runtime.js';
import { parsePickedSource, scanSourceTags, sourceLineOf, sourceTargetsAtLine } from './sourceMap.js';

/**
 * §5.13 (V) 37-20 — 런타임 심의 읽기 전용 쌍(`pick{src}` · `locate`)을 창 없이 돌린다. 문서 나무는 심이 실제로 읽는 칸만 흉내 낸다
 * (`getElementsByTagName('*')` 의 문서 순서 · `localName` · `id` · `classList` · 상자 · 보임).
 */

type Msg = Record<string, unknown>;

interface FakeEl {
  nodeType: 1;
  localName: string;
  tagName: string;
  id: string;
  classList: string[];
  parentElement: FakeEl | null;
  children: FakeEl[];
  box: { left: number; top: number; width: number; height: number };
  shown: boolean;
  textContent: string;
  /** id·class 밖의 속성 이름. */
  names: string[];
  readonly attributes: { name: string }[];
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  checkVisibility(): boolean;
  closest(): null;
}

function el(tag: string, attrs: { id?: string; cls?: string; names?: string[]; box?: [number, number, number, number]; shown?: boolean } = {}, children: FakeEl[] = []): FakeEl {
  const [left, top, width, height] = attrs.box ?? [10, 10, 100, 40];
  const node: FakeEl = {
    nodeType: 1,
    localName: tag,
    tagName: tag.toUpperCase(),
    id: attrs.id ?? '',
    classList: (attrs.cls ?? '').split(' ').filter((c) => c !== ''),
    parentElement: null,
    children,
    box: { left, top, width, height },
    shown: attrs.shown ?? true,
    textContent: '',
    names: attrs.names ?? [],
    get attributes() {
      return [...(this.id ? ['id'] : []), ...(this.classList.length > 0 ? ['class'] : []), ...this.names].map((name) => ({ name }));
    },
    getAttribute(name) { return name === 'class' ? this.classList.join(' ') : null; },
    getBoundingClientRect() { return this.box; },
    checkVisibility() { return this.shown; },
    closest() { return null; },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function flatten(root: FakeEl): FakeEl[] {
  return [root, ...root.children.flatMap(flatten)];
}

function boot(body: FakeEl) {
  const messages: Msg[] = [];
  const waiters: Array<{ pred: (m: Msg) => boolean; resolve: (m: Msg) => void }> = [];
  const listeners: Array<(e: unknown) => void> = [];
  const html = el('html', {}, [el('head'), body]);
  let under: FakeEl | null = null;
  const parent = {
    postMessage(msg: unknown): void {
      const plain = JSON.parse(JSON.stringify(msg)) as Msg;
      messages.push(plain);
      for (const w of [...waiters]) if (w.pred(plain)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(plain); }
    },
  };
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
      getElementsByTagName: () => flatten(html),
      elementFromPoint: () => under,
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var window = globalThis;', ctx);
  vm.runInContext(compositionRuntimeScript({ props: {}, seed: 7, itemId: 'comp-1', fps: 30, duration: 4, width: 640, height: 360 }), ctx);
  let seq = 0;
  const ask = (data: Msg, answer: string): Promise<Msg> => {
    const id = (seq += 1);
    for (const fn of listeners) fn({ source: parent, data: { ...data, seq: id } });
    const hit = messages.find((m) => m.__vibi === answer && m.seq === id);
    return hit ? Promise.resolve(hit) : new Promise((resolve) => waiters.push({ pred: (m) => m.__vibi === answer && m.seq === id, resolve }));
  };
  return {
    messages,
    pick(target: FakeEl, src: boolean): Promise<Msg> {
      under = target;
      return ask({ __vibi: 'pick', x: 1, y: 1, ...(src ? { src: true } : {}) }, 'picked');
    },
    locate(targets: unknown): Promise<Msg> { return ask({ __vibi: 'locate', targets }, 'located'); },
    seek(t: number): Promise<Msg> { return ask({ __vibi: 'seek', t }, 'ready'); },
    run(code: string): unknown { return vm.runInContext(code, ctx); },
  };
}

const SOURCE = [
  '<body>',                                   // 1
  '<div id="stage">',                         // 2
  '  <h1 class="title">Hello</h1>',           // 3
  '  <p class="sub">sub</p>',                 // 4
  '  <div class="bars"></div>',               // 5
  '  <p>plain</p>',                           // 6
  '</div>',                                   // 7
  '</body>',                                  // 8
].join('\n');

/** 원본 그대로의 나무 + 스크립트가 `.bars` 안에 만든 막대 셋. */
function page() {
  const title = el('h1', { cls: 'title', box: [40, 20, 300, 60] });
  const sub = el('p', { cls: 'sub', box: [40, 90, 200, 30] });
  const made = [0, 1, 2].map((i) => el('div', { cls: 'bar', box: [40 + i * 50, 200, 40, 80] }));
  const bars = el('div', { cls: 'bars', box: [40, 200, 400, 80] }, made);
  const plain = el('p', { box: [40, 300, 100, 20] });
  const stage = el('div', { id: 'stage', box: [0, 0, 640, 360] }, [title, sub, bars, plain]);
  return { body: el('body', {}, [stage]), stage, title, sub, bars, made, plain };
}

describe('§5.13 (V) 37-20 런타임 — pick{src}', () => {
  it('청하지 않으면 src 를 싣지 않는다(지나갈 때의 고르기는 종전 그대로)', async () => {
    const p = page();
    const answer = await boot(p.body).pick(p.title, false);
    expect(answer).toMatchObject({ __vibi: 'picked', path: 'div#stage > h1.title', tag: 'h1' });
    expect('src' in answer).toBe(false);
  });

  it('속성 이름은 id·class·style 을 빼고 소문자로 한 번씩 싣는다', async () => {
    const p = page();
    p.title.names = ['data-vibi-prop', 'STYLE', 'viewBox', 'viewbox'];
    const answer = await boot(p.body).pick(p.title, true);
    expect((answer['src'] as { self: { attrs: string } }).self.attrs).toBe('data-vibi-prop viewbox');
  });

  it('요소와 조상의 자리(같은 태그 가운데 몇째·모두 몇 · 같은 id·class 수)를 알린다 — html·body 는 뺀다', async () => {
    const p = page();
    const answer = await boot(p.body).pick(p.made[1]!, true);
    expect(answer['src']).toEqual({
      self: { tag: 'div', n: 3, of: 5, id: '', cls: 'bar', attrs: '', same: 3 },
      up: [
        { tag: 'div', n: 1, of: 5, id: '', cls: 'bars', attrs: '', same: 1 },
        { tag: 'div', n: 0, of: 5, id: 'stage', cls: '', attrs: '', same: 1 },
      ],
    });
  });

  it('원본과 맞추면 — 원본 요소는 제 줄, 스크립트가 만든 요소는 그것을 품은 요소의 줄', async () => {
    const p = page();
    const b = boot(p.body);
    const index = scanSourceTags(SOURCE);
    const lineOf = async (target: FakeEl) => {
      const src = parsePickedSource((await b.pick(target, true))['src']);
      return src ? sourceLineOf(index, src) : null;
    };
    expect(await lineOf(p.title)).toMatchObject({ line: 3, exact: true });
    expect(await lineOf(p.plain)).toMatchObject({ line: 6, exact: true });
    // div 는 원본 2개·화면 5개라 번호를 믿지 않는다 — id / 하나뿐인 class 로 맞춘다.
    expect(await lineOf(p.stage)).toMatchObject({ line: 2, exact: true });
    expect(await lineOf(p.bars)).toMatchObject({ line: 5, exact: true });
    expect(await lineOf(p.made[2]!)).toMatchObject({ line: 5, exact: false });
  });
});

describe('§5.13 (V) 37-20 런타임 — locate', () => {
  it('그 줄의 요소가 지금 선 상자를 답한다', async () => {
    const p = page();
    const index = scanSourceTags(SOURCE);
    const answer = await boot(p.body).locate(sourceTargetsAtLine(index, 3).targets);
    expect(answer).toMatchObject({ total: 1, rects: [{ x: 40, y: 20, width: 300, height: 60 }] });
  });

  it('찾았지만 안 보이면(숨김·크기 0·무대 밖) 수만 세고 상자는 없다', async () => {
    const index = scanSourceTags(SOURCE);
    for (const hide of [(e: FakeEl) => { e.shown = false; }, (e: FakeEl) => { e.box.width = 0; }, (e: FakeEl) => { e.box.left = 700; }]) {
      const p = page();
      hide(p.sub);
      expect(await boot(p.body).locate(sourceTargetsAtLine(index, 4).targets)).toMatchObject({ total: 1, rects: [] });
    }
  });

  it('개수가 어긋난 태그는 id·class 가 원본에서 하나뿐일 때만 찾고, 아니면 찾지 못한다', async () => {
    const p = page();
    const b = boot(p.body);
    const index = scanSourceTags(SOURCE);
    expect(await b.locate(sourceTargetsAtLine(index, 5).targets)).toMatchObject({ total: 1, rects: [{ x: 40, y: 200, width: 400, height: 80 }] });
    // 원본에 같은 모양이 둘이면(sig 없음) 번호가 어긋난 채로는 고르지 않는다.
    const twins = scanSourceTags('<div class="row"></div>\n<div class="row"></div>');
    expect(await b.locate(sourceTargetsAtLine(twins, 1).targets)).toMatchObject({ total: 0, rects: [] });
  });

  it('한 줄에 태그가 여럿이면 전부 답하고 같은 요소를 두 번 세지 않는다', async () => {
    const p = page();
    const one = scanSourceTags('<div id="stage"><h1 class="title">a</h1><p class="sub">b</p><div class="bars"></div><p>c</p></div>');
    const targets = sourceTargetsAtLine(one, 1).targets;
    const answer = await boot(p.body).locate([...targets, ...targets]);
    expect(answer['total']).toBe(5);
    expect(answer['rects']).toHaveLength(5);
  });

  it('모양이 틀린 물음에도 답한다(빈 답)', async () => {
    const b = boot(page().body);
    expect(await b.locate('nope')).toMatchObject({ total: 0, rects: [] });
    expect(await b.locate([null, 3, { tag: 7 }])).toMatchObject({ total: 0, rects: [] });
  });

  it('앞서 청한 seek 가 그려진 뒤의 그림으로 답한다', async () => {
    const p = page();
    const b = boot(p.body);
    const index = scanSourceTags(SOURCE);
    const ready = b.seek(1);
    const located = b.locate(sourceTargetsAtLine(index, 3).targets);
    await Promise.all([ready, located]);
    const order = b.messages.map((m) => m.__vibi).filter((tag) => tag === 'ready' || tag === 'located');
    expect(order).toEqual(['ready', 'located']);
  });
});

/**
 * 두 길이 같은 규칙인가 — 줄 L 에 테가 서는 요소(locate) = 집었을 때 제 줄(exact)로 L 이 나오는 요소(pick + sourceLineOf).
 * 요소마다 상자 x 를 달리 두어 답한 상자로 요소를 가려낸다. 한 줄에 태그 하나씩(template 줄만 둘).
 */
async function bothWays(source: string, body: FakeEl) {
  const index = scanSourceTags(source);
  const els = flatten(body).slice(1);
  els.forEach((e, i) => { e.box = { left: i * 8, top: 0, width: 6, height: 6 }; e.shown = true; });
  const b = boot(body);
  const picked = new Map<FakeEl, number | null>();
  for (const e of els) {
    const src = parsePickedSource((await b.pick(e, true))['src']);
    const line = src ? sourceLineOf(index, src) : null;
    picked.set(e, line?.exact ? line.line : null);
  }
  const located = new Map<number, FakeEl[]>();
  for (let line = 1; line <= index.lineCount; line += 1) {
    const at = sourceTargetsAtLine(index, line);
    if (at.kind !== 'element') continue;
    const answer = await b.locate(at.targets);
    located.set(line, (answer['rects'] as { x: number }[]).map((r) => els[r.x / 8]!));
    // template 은 상자가 없어 줄 → 화면의 대상이 아니다(sourceTargetsAtLine 이 뺀다).
    const want = els.filter((e) => picked.get(e) === line && e.localName !== 'template');
    const ids = (list: readonly FakeEl[]): number[] => list.map((e) => els.indexOf(e)).sort((x, y) => x - y);
    expect(ids(located.get(line) ?? []), `line ${line}`).toEqual(ids(want));
  }
  return { lineOf: (e: FakeEl) => picked.get(e) ?? null, at: (line: number) => located.get(line) ?? [] };
}

describe('§5.13 (V) 37-20 런타임 — 스크립트가 DOM 을 바꾼 컴포지션에서 틀린 줄을 내지 않는다(두 길이 같은 규칙)', () => {
  it('재현 A — 두 형제의 순서를 바꾸면: 집으면 제 줄, 줄을 누르면 제 요소', async () => {
    const a = el('div', { cls: 'a' });
    const bEl = el('div', { cls: 'b' });
    const r = await bothWays('<body>\n<div class="a">A</div>\n<div class="b">B</div>\n</body>', el('body', {}, [bEl, a]));
    expect(r.lineOf(bEl)).toBe(3);
    expect(r.lineOf(a)).toBe(2);
    expect(r.at(2)).toEqual([a]);
    expect(r.at(3)).toEqual([bEl]);
  });

  it('재현 B — #loader 를 지우고 div 를 새로 만들면: .title 은 제 줄, 새 div 는 줄이 없고, loader 줄은 화면에 없다', async () => {
    const title = el('div', { cls: 'title' });
    const made = el('div');
    const r = await bothWays('<body>\n<div id="loader">…</div>\n<div class="title">T</div>\n</body>', el('body', {}, [title, made]));
    expect(r.lineOf(title)).toBe(3);
    expect(r.lineOf(made)).toBeNull();
    expect(r.at(2)).toEqual([]);
    expect(r.at(3)).toEqual([title]);
  });

  it('id 없는 빈 div 를 지우고 새로 만들어도 같다', async () => {
    const title = el('div', { cls: 'title' });
    const made = el('div');
    const r = await bothWays('<body>\n<div>loading</div>\n<div class="title">T</div>\n</body>', el('body', {}, [title, made]));
    expect(r.lineOf(title)).toBe(3);
    expect(r.at(2)).toEqual([]);
  });

  it('런타임이 class·속성을 더한 요소는 여전히 제 줄이다(원본 속성 이름이 빠지면 아니다)', async () => {
    const h1 = el('h1', { cls: 't on', names: ['data-vibi-prop', 'aria-hidden'] });
    const para = el('p', { names: [] });
    const r = await bothWays('<body>\n<h1 class="t" data-vibi-prop="x">a</h1>\n<p hidden>b</p>\n</body>', el('body', {}, [h1, para]));
    expect(r.lineOf(h1)).toBe(2);
    expect(r.at(2)).toEqual([h1]);
    expect(r.lineOf(para)).toBeNull();
    expect(r.at(3)).toEqual([]);
  });

  it('template 에서 찍어 낸 것은 여럿이어도 template 줄이고, 원래 있던 요소는 번호로 맞는다', async () => {
    const cells = [0, 1, 2].map(() => el('div', { cls: 'cell' }));
    const list = el('div', { id: 'list' }, cells);
    const tpl = el('template');
    const r = await bothWays('<body>\n<div id="list"></div>\n<template><div class="cell"></div></template>\n</body>', el('body', {}, [list, tpl]));
    expect(r.lineOf(list)).toBe(2);
    for (const cell of cells) expect(r.lineOf(cell)).toBe(3);
    expect(r.lineOf(tpl)).toBe(3);
    expect(r.at(3)).toEqual(cells);
  });

  it('원래 페이지(막대를 만든 것)도 두 길이 맞는다', async () => {
    const p = page();
    const r = await bothWays(SOURCE, p.body);
    expect([p.stage, p.title, p.sub, p.bars, p.plain].map(r.lineOf)).toEqual([2, 3, 4, 5, 6]);
    for (const made of p.made) expect(r.lineOf(made)).toBeNull();
  });

  it('남는 한계 — 모양이 같은 형제가 자리를 바꾸면 구별하지 못하지만, 두 길은 여전히 같은 답이다', async () => {
    const first = el('li', { cls: 'row' });
    const second = el('li', { cls: 'row' });
    const r = await bothWays('<ul>\n<li class="row">1</li>\n<li class="row">2</li>\n</ul>', el('body', {}, [el('ul', {}, [second, first])]));
    expect(r.lineOf(second)).toBe(2);
  });
});

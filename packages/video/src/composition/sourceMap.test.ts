import { describe, expect, it } from 'vitest';

import { SOURCE_ALT_MAX, normalizeClass, parsePickedSource, scanSourceTags, sourceLineOf, sourceTargetsAtLine, type PickedSource, type SourceIndex, type SourceRef } from './sourceMap.js';

/** §5.13 (V) 37-20 — 원본 줄 찾기는 틀린 줄을 말하느니 말하지 않아야 한다(에이전트가 그 줄을 고친다). */

const PAGE = [
  '<!doctype html>',                                  // 1
  '<html>',                                           // 2
  '<head>',                                           // 3
  '  <meta name="vibi:duration" content="4">',        // 4
  '  <style>',                                        // 5
  '    .title > b { color: red; } /* <div> */',       // 6
  '  </style>',                                       // 7
  '</head>',                                          // 8
  '<body>',                                           // 9
  '  <!-- <div class="ghost"></div> -->',             // 10
  '  <div id="stage" class="stage  wide">',           // 11
  '    <h1 class="title" data-vibi-prop="title">',    // 12
  '      Hello <b>there</b>',                         // 13
  '    </h1>',                                        // 14
  '    <p class="sub" title="a > b">sub</p>',         // 15
  '    <ul>',                                         // 16
  '      <li class="row">one',                        // 17
  '      <li class="row">two',                        // 18
  '    </ul>',                                        // 19
  '    <div class="bars"></div>',                     // 20
  '  </div>',                                         // 21
  '  <template id="row-tpl"><div class="cell"><span></span></div></template>', // 22
  '  <script>',                                       // 23
  '    var x = "<div class=\\"fake\\">";',            // 24
  '  </script>',                                      // 25
  '</body>',                                          // 26
  '</html>',                                          // 27
].join('\n');

function ref(tag: string, n: number, of: number, extra: Partial<SourceRef> = {}): SourceRef {
  return { tag, n, of, id: '', cls: '', attrs: '', same: 0, ...extra };
}

function pick(self: SourceRef, ...up: SourceRef[]): PickedSource {
  return { self, up };
}

describe('scanSourceTags — 시작 태그 훑기', () => {
  const index: SourceIndex = scanSourceTags(PAGE);
  const at = (tag: string): number[] => (index.byTag.get(tag) ?? []).map((t) => t.line);

  it('주석·스타일·스크립트 안의 태그 모양 글자는 세지 않는다', () => {
    expect(at('div')).toEqual([11, 20]);
    expect(index.tags.some((t) => t.cls === 'ghost' || t.cls === 'fake')).toBe(false);
  });

  it('따옴표 속 > 에서 태그가 끝나지 않는다', () => {
    expect(index.tags.find((t) => t.tag === 'p')).toMatchObject({ line: 15, col: 5, cls: 'sub' });
    expect(at('ul')).toEqual([16]);
  });

  it('id·class 를 classList 모양으로 적는다(공백 접기·중복 제거)', () => {
    expect(index.tags.find((t) => t.id === 'stage')).toMatchObject({ tag: 'div', cls: 'stage wide', n: 0 });
    expect(normalizeClass(' a\tb  a\nc ')).toBe('a b c');
  });

  it('id·class·style 밖의 속성 이름을 소문자로 한 번씩 적는다(값은 적지 않는다)', () => {
    expect(index.tags.find((t) => t.tag === 'h1')?.attrs).toBe('data-vibi-prop');
    expect(index.tags.find((t) => t.tag === 'p')?.attrs).toBe('title');
    expect(scanSourceTags('<svg viewBox="0 0 1 1" ID="x" Style="a" viewbox="dup" xlink:href="#a"></svg>').tags[0]).toMatchObject({ id: 'x', attrs: 'viewbox xlink:href' });
  });

  it('끝 줄은 닫는 태그의 줄이고, 닫지 않은 li 는 부모가 닫힐 때 끝난다', () => {
    expect(index.tags.find((t) => t.tag === 'h1')).toMatchObject({ line: 12, endLine: 14 });
    expect(index.tags.find((t) => t.id === 'stage')).toMatchObject({ line: 11, endLine: 21 });
    expect(index.tags.filter((t) => t.tag === 'li').map((t) => t.endLine)).toEqual([19, 19]);
    expect(index.tags.find((t) => t.tag === 'script')).toMatchObject({ line: 23, endLine: 25 });
  });

  it('template 안은 문서 순서 번호에서 뺀다(문서 나무에 없다)', () => {
    expect(index.tags.filter((t) => t.template).map((t) => [t.tag, t.n])).toEqual([['div', -1], ['span', -1]]);
    expect(index.byTag.get('span')).toBeUndefined();
  });

  it('줄 수를 센다 — CRLF 도 한 줄이다', () => {
    expect(index.lineCount).toBe(27);
    const crlf = scanSourceTags('<div>\r\n<span></span>\r\n</div>');
    expect(crlf.tags.map((t) => [t.tag, t.line, t.endLine])).toEqual([['div', 1, 3], ['span', 2, 2]]);
  });

  it('svg 안의 스스로 닫는 태그는 열린 채 남지 않고, HTML 의 /> 는 시작 태그다', () => {
    const svg = scanSourceTags('<svg>\n<circle r="1"/>\n<g>\n<path d=""/>\n</g>\n</svg>\n<div/>\ntext\n</div>');
    expect(svg.tags.map((t) => [t.tag, t.line, t.endLine])).toEqual([['svg', 1, 6], ['circle', 2, 2], ['g', 3, 5], ['path', 4, 4], ['div', 7, 9]]);
  });

  it('깨진 입력에도 끝난다(닫히지 않은 태그·따옴표·주석)', () => {
    expect(scanSourceTags('<div class="a').tags).toHaveLength(1);
    expect(scanSourceTags('<!-- never closed <div>').tags).toHaveLength(0);
    expect(scanSourceTags('a < b and <1> and <div =x>').tags.map((t) => t.tag)).toEqual(['div']);
    expect(scanSourceTags('<script>var a = "</scripty>";</script><p>').tags.map((t) => t.tag)).toEqual(['script', 'p']);
    expect(scanSourceTags('').tags).toHaveLength(0);
  });
});

describe('sourceLineOf — 요소 → 줄', () => {
  const index = scanSourceTags(PAGE);

  it('그 태그의 DOM 개수가 원본과 같으면 번호로 맞춘다', () => {
    expect(sourceLineOf(index, pick(ref('p', 0, 1, { cls: 'sub', same: 1 })))).toEqual({ line: 15, col: 5, endLine: 15, exact: true, tag: 'p' });
    expect(sourceLineOf(index, pick(ref('li', 1, 2, { cls: 'row', same: 2 })))).toMatchObject({ line: 18, exact: true });
    // 스크립트가 class·속성을 붙였어도 번호가 믿을 만하면 같은 줄이다.
    expect(sourceLineOf(index, pick(ref('h1', 0, 1, { cls: 'title visible', attrs: 'data-vibi-prop aria-hidden', same: 1 })))).toMatchObject({ line: 12, exact: true });
  });

  it('개수가 다르면(스크립트가 그 태그를 만들었다) 번호를 믿지 않고, id·class 가 원본에서 하나뿐일 때만 맞춘다', () => {
    // div 가 원본 2개인데 화면에 12개 — 번호 0 은 믿지 않지만 id="stage" 는 하나뿐이다.
    expect(sourceLineOf(index, pick(ref('div', 0, 12, { id: 'stage', cls: 'stage wide', same: 1 })))).toMatchObject({ line: 11, exact: true });
    expect(sourceLineOf(index, pick(ref('div', 1, 12, { cls: 'bars', same: 1 })))).toMatchObject({ line: 20, exact: true });
  });

  it('런타임에 만든 요소는 가장 가까운 원본 조상의 줄을 exact:false 로 답한다', () => {
    const made = ref('div', 5, 12, { cls: 'bar', same: 10 });
    const parent = ref('div', 1, 12, { cls: 'bars', same: 1 });
    expect(sourceLineOf(index, pick(made, parent))).toEqual({ line: 20, col: 5, endLine: 20, exact: false, tag: 'div' });
  });

  it('원본에 같은 모양이 여럿이거나 화면에 여럿이면 지어내지 않는다', () => {
    // li.row 는 원본에 둘 — 개수가 어긋나면 어느 줄인지 알 수 없다. 조상(ul)이 답한다.
    expect(sourceLineOf(index, pick(ref('li', 2, 5, { cls: 'row', same: 5 }), ref('ul', 0, 1)))).toMatchObject({ line: 16, exact: false });
    // 조상도 없으면 답이 없다.
    expect(sourceLineOf(index, pick(ref('canvas', 0, 1)))).toBeNull();
    expect(sourceLineOf(index, pick(ref('div', 3, 12, { cls: 'bar', same: 10 })))).toBeNull();
  });

  it('양쪽에 id 가 있는데 다르면 번호가 맞아도 그 줄이 아니다', () => {
    expect(sourceLineOf(index, pick(ref('div', 0, 2, { id: 'other', same: 1 })))).toBeNull();
  });

  it('번호의 원본 태그와 요소가 다르다는 근거가 있으면 번호를 믿지 않는다 — id 가 한쪽에만 있어도, 원본 class·속성 이름이 빠져도', () => {
    // id 가 원본에만 있다(div#stage 자리에 id 없는 div). 원본에서 하나뿐인 모양도 아니니 줄이 없다.
    expect(sourceLineOf(index, pick(ref('div', 0, 2, { same: 1 })))).toBeNull();
    // 원본 h1 의 data-vibi-prop 이 없는 h1 은 번호로는 그 줄이 아니다 — class 가 원본에서 하나뿐이라 ② 로 맞춘다.
    expect(sourceLineOf(index, pick(ref('h1', 0, 1, { cls: 'title', same: 1 })))).toMatchObject({ line: 12, exact: true });
    expect(sourceLineOf(index, pick(ref('h1', 0, 1, { cls: 'heading', attrs: 'data-vibi-prop', same: 1 })))).toBeNull();
    // 원본 class 가 빠진 li 는 번호가 맞아도 그 줄이 아니다(li.row 는 원본에 둘이라 ② 도 없다) — 조상(ul)으로.
    expect(sourceLineOf(index, pick(ref('li', 0, 2, { same: 1 }), ref('ul', 0, 1)))).toMatchObject({ line: 16, exact: false });
  });

  it('재현 A — 스크립트가 class 가 다른 두 형제의 순서를 바꾸면 번호가 아니라 모양으로 맞춘다', () => {
    const src = scanSourceTags('<body>\n<div class="a">A</div>\n<div class="b">B</div>\n</body>');
    // DOM: [div.b, div.a] — 개수는 같다.
    expect(sourceLineOf(src, pick(ref('div', 0, 2, { cls: 'b', same: 1 })))).toMatchObject({ line: 3, exact: true });
    expect(sourceLineOf(src, pick(ref('div', 1, 2, { cls: 'a', same: 1 })))).toMatchObject({ line: 2, exact: true });
  });

  it('재현 B — 스크립트가 #loader 를 지우고 div 를 새로 만들면, .title 은 제 줄이고 새 div 는 줄이 없다', () => {
    const src = scanSourceTags('<body>\n<div id="loader">…</div>\n<div class="title">T</div>\n</body>');
    // DOM: [div.title, div(새것)] — 개수는 같다.
    expect(sourceLineOf(src, pick(ref('div', 0, 2, { cls: 'title', same: 1 })))).toMatchObject({ line: 3, exact: true });
    expect(sourceLineOf(src, pick(ref('div', 1, 2)))).toBeNull();
  });

  it('id 없는 빈 div 를 지우고 새로 만들어도 — class 가 붙은 요소는 빈 원본 자리를 차지하지 않는다', () => {
    const src = scanSourceTags('<body>\n<div>loading</div>\n<div class="title">T</div>\n</body>');
    // 번호 0 의 원본은 class 없는 div — 포함 관계는 맞지만 이 요소의 class 모양이 다른 원본 요소(3행)와 꼭 같다.
    expect(sourceLineOf(src, pick(ref('div', 0, 2, { cls: 'title', same: 1 })))).toMatchObject({ line: 3, exact: true });
    expect(sourceLineOf(src, pick(ref('div', 1, 2)))).toBeNull();
    // 같은 모양이 원본에 없으면(런타임이 더한 class) 번호를 그대로 믿는다.
    expect(sourceLineOf(src, pick(ref('div', 0, 2, { cls: 'shown', same: 1 })))).toMatchObject({ line: 2, exact: true });
  });

  it('맞바뀔 후보가 너무 많으면 class 가 꼭 같을 때만 번호를 믿는다', () => {
    const many = Array.from({ length: SOURCE_ALT_MAX + 1 }, (_, i) => `<div class="c${i}"></div>`);
    const src = scanSourceTags(['<div>plain</div>', ...many].join('\n'));
    const of = SOURCE_ALT_MAX + 2;
    expect(sourceTargetsAtLine(src, 1).targets[0]?.alt).toBeNull();
    expect(sourceLineOf(src, pick(ref('div', 0, of)))).toMatchObject({ line: 1, exact: true });
    expect(sourceLineOf(src, pick(ref('div', 0, of, { cls: 'shown', same: 1 })))).toBeNull();
    // 후보가 상한 안이면 목록으로 간다.
    expect(sourceTargetsAtLine(scanSourceTags(['<div>plain</div>', ...many.slice(0, 3)].join('\n')), 1).targets[0]?.alt).toEqual(['c0', 'c1', 'c2']);
  });

  it('template 에서 찍어 낸 요소는 화면에 여럿이어도 template 의 그 줄이다', () => {
    expect(sourceLineOf(index, pick(ref('div', 4, 9, { cls: 'cell', same: 7 })))).toMatchObject({ line: 22, exact: true });
  });
});

describe('sourceTargetsAtLine — 줄 → 요소', () => {
  const index = scanSourceTags(PAGE);

  it('그 줄에서 시작하는 요소를 번호·개수와 함께 낸다', () => {
    expect(sourceTargetsAtLine(index, 15)).toEqual({ kind: 'element', line: 15, endLine: 15, targets: [{ tag: 'p', n: 0, of: 1, id: '', cls: 'sub', attrs: 'title', alt: [], sig: true }] });
    expect(sourceTargetsAtLine(index, 17).targets).toEqual([{ tag: 'li', n: 0, of: 2, id: '', cls: 'row', attrs: '', alt: [], sig: false }]);
    // alt = 같은 태그·같은 id 에 class 를 더 가진 다른 원본 요소의 class 모양(template 안도 — 찍어 낸 것이 그 자리에 올 수 있다).
    expect(sourceTargetsAtLine(index, 20).targets[0]?.alt).toEqual([]);
    expect(sourceTargetsAtLine(scanSourceTags('<div></div>\n<div class="a b"></div>\n<div id="x" class="c"></div>\n<template><div class="t"></div></template>'), 1).targets[0]?.alt).toEqual(['a b', 't']);
  });

  it('한 줄에 태그가 여럿이면 전부 낸다(template 안은 번호 없이 id·class 로만)', () => {
    const one = scanSourceTags('<div><span class="a">x</span><span class="b">y</span></div>');
    expect(sourceTargetsAtLine(one, 1).targets.map((t) => `${t.tag}.${t.cls}#${t.n}`)).toEqual(['div.#0', 'span.a#0', 'span.b#1']);
    expect(sourceTargetsAtLine(index, 22)).toMatchObject({ kind: 'element', targets: [{ tag: 'div', n: -1, of: -1, cls: 'cell', sig: true }, { tag: 'span', n: -1, of: -1, sig: false }] });
  });

  it('시작 태그가 없는 줄은 그 줄을 품은 가장 안쪽 요소다', () => {
    expect(sourceTargetsAtLine(index, 13)).toMatchObject({ kind: 'element', targets: [{ tag: 'b' }] });
    expect(sourceTargetsAtLine(index, 14)).toMatchObject({ kind: 'enclosing', line: 12, endLine: 14, targets: [{ tag: 'h1' }] });
    expect(sourceTargetsAtLine(index, 21)).toMatchObject({ kind: 'enclosing', line: 11, endLine: 21, targets: [{ tag: 'div', id: 'stage' }] });
  });

  it('script·style·head·body 줄은 화면 요소가 아니다', () => {
    for (const line of [1, 3, 4, 6, 9, 10, 24, 26, 99]) expect(sourceTargetsAtLine(index, line).kind, `line ${line}`).toBe('none');
  });
});

describe('parsePickedSource — 샌드박스의 말은 모양대로만 받는다', () => {
  it('맞는 모양만 남기고 조상은 8겹까지', () => {
    const up = Array.from({ length: 12 }, (_, i) => ({ tag: 'DIV', n: i, of: 20, id: '', cls: '', same: 0 }));
    const parsed = parsePickedSource({ self: { tag: 'H1', n: 0, of: 1, id: 'a'.repeat(400), cls: 'title', same: 1, extra: 'x' }, up: [...up, null, 7] });
    expect(parsed?.self).toEqual({ tag: 'h1', n: 0, of: 1, id: 'a'.repeat(200), cls: 'title', attrs: '', same: 1 });
    expect(parsed?.up).toHaveLength(8);
  });

  it('모양이 틀리면 없는 것으로 본다', () => {
    expect(parsePickedSource(null)).toBeUndefined();
    expect(parsePickedSource({ self: { n: 0 } })).toBeUndefined();
    expect(parsePickedSource({ self: { tag: 'p', n: 'x', of: Number.NaN } })?.self).toMatchObject({ n: -1, of: -1 });
  });
});

/**
 * §5.13 (V) 37-20 — 화면 요소 ↔ 원본 HTML 줄(순수, 문자열만).
 * 내주는 컴포지션에 줄 표식을 심지 않는다(렌더와 같은 바이트 — 38-1). 원본의 시작 태그만 한 번 훑어 "같은 태그의 문서 순서 번호"로 맞춘다 — 파서가 만든 요소의 문서 순서는 원본의 시작 태그 순서와 같다.
 * 번호는 그 태그의 DOM 개수가 원본과 같고 그 자리의 원본 태그가 그 요소라는 근거가 맞을 때만 믿는다(`fitsPosition`). 아니면 `id`·`class` 가
 * 원본에서 하나뿐일 때만, 그것도 아니면 조상의 줄(런타임 생성), 없으면 답하지 않는다 — 규칙과 남는 한계는 37-20 (C).
 * 나무는 짓지 않는다 — 끝 줄은 닫는 태그까지의 근사(닫지 않은 `p`·`li` 는 부모가 닫힐 때까지)이고 줄 → 요소의 "품은 요소" 찾기에만 쓴다.
 */

/** 원본의 시작 태그 하나. */
export interface SourceTag {
  /** 소문자 태그 이름. */
  readonly tag: string;
  /** `<` 의 줄·칸(1부터). */
  readonly line: number;
  readonly col: number;
  /** 이 요소가 끝나는 줄(닫는 태그의 줄 — 근사). */
  readonly endLine: number;
  /** 같은 태그 가운데 문서 순서 번호(0부터). `<template>` 안이면 -1(문서 나무에 없다). */
  readonly n: number;
  readonly id: string;
  /** 공백 하나로 이은 class 낱말(중복 제거 — `classList` 와 같은 모양). */
  readonly cls: string;
  /** `id`·`class`·`style` 밖의 속성 이름(소문자·중복 제거·공백으로 이음). */
  readonly attrs: string;
  readonly template: boolean;
}

export interface SourceIndex {
  /** 원본 순서 그대로. */
  readonly tags: readonly SourceTag[];
  /** 태그 → `<template>` 밖의 것들(번호 순). */
  readonly byTag: ReadonlyMap<string, readonly SourceTag[]>;
  readonly lineCount: number;
}

/** 런타임이 알려 온 요소 하나의 자리(같은 태그 가운데 몇째·모두 몇 · 같은 `id`·`class` 를 가진 수). 이름이 아니다 — 이름은 `path`. */
export interface SourceRef {
  readonly tag: string;
  readonly n: number;
  readonly of: number;
  readonly id: string;
  readonly cls: string;
  /** 요소에 있는 속성 이름(`SourceTag.attrs` 와 같은 모양). */
  readonly attrs: string;
  readonly same: number;
}

/** 집은 요소와 그 조상들(가까운 것부터). */
export interface PickedSource {
  readonly self: SourceRef;
  readonly up: readonly SourceRef[];
}

/** 찾은 줄. `exact` 가 false 면 그 요소 자신이 아니라 그것을 품은 원본 요소의 줄이다(런타임에 만들어진 요소). */
export interface SourceLine {
  readonly line: number;
  readonly col: number;
  readonly endLine: number;
  readonly exact: boolean;
  readonly tag: string;
}

/**
 * 줄 → 화면 요소를 찾으라고 런타임에 보내는 것. `sig` = `id`·`class` 조합이 원본에서 하나뿐이다.
 * `alt` = 번호 자리의 요소가 이 class 모양이면 맞바뀐 다른 원본 요소일 수 있다(null = 후보가 너무 많아 class 가 꼭 같을 때만 믿는다).
 */
export interface SourceTarget {
  readonly tag: string;
  readonly n: number;
  readonly of: number;
  readonly id: string;
  readonly cls: string;
  readonly attrs: string;
  readonly alt: readonly string[] | null;
  readonly sig: boolean;
}

export interface LineTargets {
  /** `element` = 그 줄에서 시작하는 요소 · `enclosing` = 그 줄을 품은 가장 안쪽 요소 · `none` = 화면 요소가 아닌 줄. */
  readonly kind: 'element' | 'enclosing' | 'none';
  readonly targets: readonly SourceTarget[];
  /** 그 요소(들)의 줄 범위 — 코드 칸이 띠로 보인다. */
  readonly line: number;
  readonly endLine: number;
}

/** 런타임이 자르는 길이와 같다(양쪽이 같은 글자를 비교해야 한다). */
export const SOURCE_REF_TEXT_MAX = 200;
/** 조상을 몇 겹까지 싣는가. */
export const SOURCE_REF_MAX_UP = 8;
/** 한 줄에서 런타임에 묻는 요소 수 상한. */
export const SOURCE_LINE_MAX_TARGETS = 16;
/** `SourceTarget.alt` 후보 상한 — 넘으면 null(묻는 글이 커지지 않게). */
export const SOURCE_ALT_MAX = 32;

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/** 안쪽이 태그로 읽히지 않는 요소(닫는 태그까지 통째로 건너뛴다). */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
/** 화면에 상자가 없어 테를 두를 수 없는 것. */
const NON_VISUAL_TAGS = new Set(['html', 'head', 'body', 'script', 'style', 'meta', 'link', 'title', 'base', 'template', 'noscript']);

interface MutableTag { tag: string; line: number; col: number; endLine: number; n: number; id: string; cls: string; attrs: string; template: boolean }

function isAlpha(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

function isNameEnd(code: number): boolean {
  return isSpace(code) || code === 47 /* / */ || code === 62 /* > */;
}

/** `classList` 와 같은 모양으로 — 공백으로 가르고 중복을 걷는다. */
export function normalizeClass(raw: string): string {
  const seen = new Set<string>();
  for (const word of raw.split(/[ \t\n\r\f]+/)) if (word !== '') seen.add(word);
  return [...seen].join(' ').slice(0, SOURCE_REF_TEXT_MAX);
}

/** 근거로 견주는 속성 이름에서 뺀다 — 따로 견주거나(`id`·`class`) 스크립트가 늘 만진다(`style`). 런타임 `attrNames` 와 같다. */
const SKIP_ATTRS = new Set(['id', 'class', 'style']);

/** 속성 이름들 → 공백으로 이은 한 줄(런타임 `attrNames` 와 같은 모양 — 길이를 넘는 이름은 통째로 뺀다). */
function joinAttrNames(names: Iterable<string>): string {
  let out = '';
  for (const name of names) {
    const next = out === '' ? name : `${out} ${name}`;
    if (next.length > SOURCE_REF_TEXT_MAX) break;
    out = next;
  }
  return out;
}

function words(text: string): string[] {
  return text.split(' ').filter((word) => word !== '');
}

/** `want` 의 낱말이 `have` 에 모두 있다. */
function covers(have: string, want: string): boolean {
  const set = new Set(words(have));
  return words(want).every((word) => set.has(word));
}

function sameWords(a: string, b: string): boolean {
  return covers(a, b) && covers(b, a);
}

/** 줄 시작 자리들 — `\n`, 또는 `\n` 이 따르지 않는 `\r`(에디터와 같은 줄 세기). */
function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 10) starts.push(i + 1);
    else if (c === 13 && text.charCodeAt(i + 1) !== 10) starts.push(i + 1);
  }
  return starts;
}

/** 원본의 시작 태그를 한 번 훑는다. 주석·doctype·날글 요소(`script`·`style` …)·따옴표 속 `>` 는 건너뛴다. */
export function scanSourceTags(html: string): SourceIndex {
  const len = html.length;
  const starts = lineStartsOf(html);
  // 태그는 앞에서 뒤로만 나오므로 줄 찾기도 앞으로만 간다(이진 탐색 없이 한 번 훑기).
  let cursor = 0;
  const lineAt = (pos: number): number => {
    while (cursor + 1 < starts.length && (starts[cursor + 1] as number) <= pos) cursor += 1;
    return cursor + 1;
  };
  const tags: MutableTag[] = [];
  const counts = new Map<string, number>();
  const open: MutableTag[] = [];
  let templateDepth = 0;
  let foreignDepth = 0;

  const closeTop = (endLine: number): void => {
    const top = open.pop();
    if (!top) return;
    top.endLine = endLine;
    if (top.tag === 'template') templateDepth -= 1;
    if (top.tag === 'svg' || top.tag === 'math') foreignDepth -= 1;
  };

  let i = 0;
  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    const next = html.charCodeAt(lt + 1);
    if (next === 33 /* ! */ || next === 63 /* ? */) {
      const comment = html.startsWith('<!--', lt);
      const end = comment ? html.indexOf('-->', lt + 4) : html.indexOf('>', lt + 2);
      i = end < 0 ? len : end + (comment ? 3 : 1);
      continue;
    }
    if (next === 47 /* / */) {
      let j = lt + 2;
      while (j < len && !isNameEnd(html.charCodeAt(j))) j += 1;
      const name = html.slice(lt + 2, j).toLowerCase();
      const end = html.indexOf('>', j);
      const at = lineAt(lt);
      // 가장 가까운 같은 이름의 열린 요소까지 닫는다(그 사이의 닫지 않은 것은 여기서 끝난 것으로 본다). 짝이 없으면 무시.
      let depth = -1;
      for (let k = open.length - 1; k >= 0; k -= 1) if ((open[k] as MutableTag).tag === name) { depth = k; break; }
      if (depth >= 0) while (open.length > depth) closeTop(at);
      i = end < 0 ? len : end + 1;
      continue;
    }
    if (!isAlpha(next)) { i = lt + 1; continue; }

    let j = lt + 1;
    while (j < len && !isNameEnd(html.charCodeAt(j))) j += 1;
    const name = html.slice(lt + 1, j).toLowerCase();
    let id = '';
    let cls = '';
    let hasId = false;
    let hasClass = false;
    const attrNames = new Set<string>();
    let selfClosing = false;
    while (j < len) {
      while (j < len && isSpace(html.charCodeAt(j))) j += 1;
      const c = html.charCodeAt(j);
      if (c === 62) break;
      if (c === 47) { selfClosing = html.charCodeAt(j + 1) === 62; j += 1; continue; }
      const nameStart = j;
      while (j < len) {
        const a = html.charCodeAt(j);
        if (isSpace(a) || a === 61 || a === 62 || a === 47) break;
        j += 1;
      }
      const attr = html.slice(nameStart, j).toLowerCase();
      while (j < len && isSpace(html.charCodeAt(j))) j += 1;
      let value = '';
      if (html.charCodeAt(j) === 61 /* = */) {
        j += 1;
        while (j < len && isSpace(html.charCodeAt(j))) j += 1;
        const q = html.charCodeAt(j);
        if (q === 34 || q === 39) {
          const close = html.indexOf(q === 34 ? '"' : "'", j + 1);
          const stop = close < 0 ? len : close;
          value = html.slice(j + 1, stop);
          j = close < 0 ? len : close + 1;
        } else {
          const valueStart = j;
          while (j < len && !isSpace(html.charCodeAt(j)) && html.charCodeAt(j) !== 62) j += 1;
          value = html.slice(valueStart, j);
        }
      } else if (attr === '') {
        j += 1; // 이름도 값도 아닌 글자(`=` 로 시작 등) — 한 칸 넘어간다.
      }
      // 같은 속성이 두 번이면 첫 것만(HTML 규칙).
      if (attr === 'id' && !hasId) { hasId = true; id = value.slice(0, SOURCE_REF_TEXT_MAX); }
      else if (attr === 'class' && !hasClass) { hasClass = true; cls = normalizeClass(value); }
      else if (attr !== '' && !SKIP_ATTRS.has(attr)) attrNames.add(attr);
    }
    const tagEnd = j < len ? j + 1 : len;
    const line = lineAt(lt);
    const inTemplate = templateDepth > 0;
    const n = inTemplate ? -1 : counts.get(name) ?? 0;
    if (!inTemplate) counts.set(name, n + 1);
    const tag: MutableTag = { tag: name, line, col: lt - (starts[line - 1] as number) + 1, endLine: lineAt(Math.max(lt, tagEnd - 1)), n, id, cls, attrs: joinAttrNames(attrNames), template: inTemplate };
    tags.push(tag);

    if (RAW_TEXT_TAGS.has(name) && !selfClosing) {
      const closer = `</${name}`;
      let at = tagEnd;
      let found = -1;
      while (at < len) {
        const cand = html.indexOf('</', at);
        if (cand < 0) break;
        if (html.slice(cand, cand + closer.length).toLowerCase() === closer && (cand + closer.length >= len || isNameEnd(html.charCodeAt(cand + closer.length)))) { found = cand; break; }
        at = cand + 2;
      }
      if (found < 0) { tag.endLine = starts.length; i = len; continue; }
      const end = html.indexOf('>', found);
      tag.endLine = lineAt(found);
      i = end < 0 ? len : end + 1;
      continue;
    }
    i = tagEnd;
    // `/>` 는 HTML 요소에서는 뜻이 없고(시작 태그다) svg·math 안에서만 스스로 닫는다.
    if (VOID_TAGS.has(name) || (selfClosing && (foreignDepth > 0 || name === 'svg' || name === 'math'))) continue;
    open.push(tag);
    if (name === 'template') templateDepth += 1;
    if (name === 'svg' || name === 'math') foreignDepth += 1;
  }
  while (open.length > 0) closeTop(starts.length);

  const byTag = new Map<string, SourceTag[]>();
  for (const tag of tags) {
    if (tag.template) continue;
    const list = byTag.get(tag.tag);
    if (list) list.push(tag);
    else byTag.set(tag.tag, [tag]);
  }
  return { tags, byTag, lineCount: starts.length };
}

/**
 * 같은 태그·같은 `id` 의 다른 원본 요소 가운데 class 가 `tag` 것을 모두 품고 더 많은 것들의 class 모양. 번호 자리의 요소가 이 모양이면
 * 그 원본 요소와 자리가 맞바뀌었을 수 있다. 너무 많으면 null.
 */
function altClassesOf(index: SourceIndex, tag: SourceTag): string[] | null {
  if (tag.template) return [];
  const want = words(tag.cls).length;
  const out = new Set<string>();
  for (const other of index.tags) {
    if (other === tag || other.tag !== tag.tag || other.id !== tag.id) continue;
    if (words(other.cls).length <= want || !covers(other.cls, tag.cls)) continue;
    out.add(other.cls);
    if (out.size > SOURCE_ALT_MAX) return null;
  }
  return [...out];
}

/**
 * 번호 자리의 원본 태그가 그 요소라는 근거 — `id` 가 엄격히 같고, 원본의 class 낱말·속성 이름이 요소에 모두 있다(런타임이 더한 것은 괜찮다).
 * 요소 class 가 원본보다 많고 `alt` 의 모양과 꼭 같으면 믿지 않는다. ⚠ 런타임 심의 `byPosition`(runtime.ts)과 같은 규칙 — 함께 고친다.
 */
function fitsPosition(src: { readonly id: string; readonly cls: string; readonly attrs: string }, el: { readonly id: string; readonly cls: string; readonly attrs: string }, alt: readonly string[] | null): boolean {
  if (src.id !== el.id || !covers(el.cls, src.cls) || !covers(el.attrs, src.attrs)) return false;
  if (sameWords(el.cls, src.cls)) return true;
  return alt !== null && !alt.some((cls) => sameWords(cls, el.cls));
}

/** 그 자리가 가리키는 원본 태그 — 믿을 수 있을 때만(37-20 (C) ①→②). */
function resolveRef(index: SourceIndex, ref: SourceRef): SourceTag | null {
  const list = index.byTag.get(ref.tag) ?? [];
  if (ref.of === list.length && ref.n >= 0 && ref.n < list.length) {
    const cand = list[ref.n] as SourceTag;
    if (fitsPosition(cand, ref, altClassesOf(index, cand))) return cand;
  }
  if (ref.id === '' && ref.cls === '') return null;
  let only: SourceTag | null = null;
  for (const tag of index.tags) {
    if (tag.tag !== ref.tag || tag.id !== ref.id || tag.cls !== ref.cls) continue;
    if (only) return null;
    only = tag;
  }
  // `<template>` 에서 찍어 낸 요소는 여럿이어도 그 한 줄에서 나왔다. 그 밖은 화면에도 하나뿐이어야 한다.
  return only && (only.template || ref.same === 1) ? only : null;
}

function toLine(tag: SourceTag, exact: boolean): SourceLine {
  return { line: tag.line, col: tag.col, endLine: tag.endLine, exact, tag: tag.tag };
}

/** 집은 요소의 원본 줄. 요소 자신을 못 찾으면 가장 가까운 조상의 줄(`exact:false`), 그것도 없으면 null — 지어내지 않는다. */
export function sourceLineOf(index: SourceIndex, picked: PickedSource): SourceLine | null {
  const self = resolveRef(index, picked.self);
  if (self) return toLine(self, true);
  for (const ref of picked.up) {
    const found = resolveRef(index, ref);
    if (found) return toLine(found, false);
  }
  return null;
}

function toTarget(index: SourceIndex, tag: SourceTag): SourceTarget {
  let same = 0;
  if (tag.id !== '' || tag.cls !== '') {
    for (const other of index.tags) if (other.tag === tag.tag && other.id === tag.id && other.cls === tag.cls) same += 1;
  }
  return { tag: tag.tag, n: tag.n, of: tag.template ? -1 : (index.byTag.get(tag.tag)?.length ?? 0), id: tag.id, cls: tag.cls, attrs: tag.attrs, alt: altClassesOf(index, tag), sig: same === 1 };
}

/** 그 줄의 화면 요소 — 그 줄에서 시작하는 것들, 없으면 그 줄을 품은 가장 안쪽 요소. */
export function sourceTargetsAtLine(index: SourceIndex, line: number): LineTargets {
  const none: LineTargets = { kind: 'none', targets: [], line, endLine: line };
  const starting = index.tags.filter((tag) => tag.line === line && !NON_VISUAL_TAGS.has(tag.tag));
  if (starting.length > 0) {
    const used = starting.slice(0, SOURCE_LINE_MAX_TARGETS);
    return { kind: 'element', targets: used.map((tag) => toTarget(index, tag)), line, endLine: used.reduce((max, tag) => Math.max(max, tag.endLine), line) };
  }
  for (let k = index.tags.length - 1; k >= 0; k -= 1) {
    const tag = index.tags[k] as SourceTag;
    if (tag.line > line || tag.endLine < line) continue;
    if (NON_VISUAL_TAGS.has(tag.tag)) return none;
    return { kind: 'enclosing', targets: [toTarget(index, tag)], line: tag.line, endLine: tag.endLine };
  }
  return none;
}

function asRef(raw: unknown): SourceRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (key: string): number => (typeof r[key] === 'number' && Number.isFinite(r[key]) ? Math.trunc(r[key] as number) : -1);
  const text = (key: string): string => (typeof r[key] === 'string' ? (r[key] as string).slice(0, SOURCE_REF_TEXT_MAX) : '');
  const tag = text('tag').toLowerCase();
  if (tag === '') return null;
  return { tag, n: num('n'), of: num('of'), id: text('id'), cls: text('cls'), attrs: text('attrs'), same: num('same') };
}

/** 샌드박스에서 온 `src` 를 모양대로만 받는다(믿지 않는 문서의 말이다). 틀리면 undefined. */
export function parsePickedSource(raw: unknown): PickedSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const self = asRef(r['self']);
  if (!self) return undefined;
  const up: SourceRef[] = [];
  if (Array.isArray(r['up'])) {
    for (const entry of r['up'].slice(0, SOURCE_REF_MAX_UP)) {
      const ref = asRef(entry);
      if (ref) up.push(ref);
    }
  }
  return { self, up };
}

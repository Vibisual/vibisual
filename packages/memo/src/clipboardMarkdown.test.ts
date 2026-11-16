import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipboardElementToMarkdown, clipboardHtmlToMarkdown } from './clipboardMarkdown.js';
import { clipboardBreaks } from './clipboardBreaks.js';

class TextNode {
  readonly nodeType = 3;
  constructor(readonly textContent: string) {}
}
class Tag {
  readonly nodeType = 1;
  readonly tagName: string;
  parent: Tag | null = null;
  attrs: Record<string, string> = {};
  readonly childNodes: (TextNode | Tag)[];
  constructor(tag: string, nodes: (string | Tag)[]) {
    this.tagName = tag.toUpperCase(); this.childNodes = nodes.map(node => typeof node === 'string' ? new TextNode(node) : node);
    this.children.forEach(child => { child.parent = this; });
  }
  get children(): Tag[] { return this.childNodes.filter(node => node instanceof Tag); }
  get textContent(): string { return this.childNodes.map(node => node.textContent).join(''); }
  getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
  hasAttribute(name: string): boolean { return name in this.attrs; }
  attr(attrs: Record<string, string>): Tag { this.attrs = attrs; return this; }
  closest(tag: string): Tag | null { return this.tagName === tag.toUpperCase() ? this : this.parent?.closest(tag) ?? null; }
  querySelectorAll(tag: string): Tag[] { return this.children.flatMap(child => [...(child.tagName === tag.toUpperCase() ? [child] : []), ...child.querySelectorAll(tag)]); }
  querySelector(tag: string): Tag | null { return this.querySelectorAll(tag)[0] ?? null; }
}
const e = (tag: string, ...nodes: (string | Tag)[]): Tag => new Tag(tag, nodes);
// Node 환경에는 DOM이 없으므로 변환기가 읽는 표준 트리 속성만 제공한다.
const md = (element: Tag): string => clipboardElementToMarkdown(element as unknown as Element);
const table = (): Tag => e('table', e('tr', e('th', 'Name'), e('th', 'State')), e('tr', e('td', 'one'), e('td', 'done')));
afterEach(() => vi.unstubAllGlobals());

describe('clipboard Markdown', () => {
  it('keeps prose, cell formatting, empty cells, pipes, breaks and column alignment', () => {
    const source = e('div', e('p', 'Before ', e('strong', 'table')), e('table',
      e('thead', e('tr', e('th', 'Item').attr({ align: 'left' }), e('th', 'State').attr({ style: 'text-align: center' }), e('th', 'Count').attr({ align: 'right' }))),
      e('tbody', e('tr', e('td', e('strong', 'A'), ' | ', e('em', 'B'), e('br'), e('del', 'old')), e('td', e('code', 'x | `y`')), e('td')),
        e('tr', e('td', e('a', 'docs').attr({ href: 'https://example.test/a(b)' })), e('td', 'x\\y'), e('td', '2')))), e('p', 'After'));
    expect(md(source)).toBe('Before **table**\n\n| Item | State | Count |\n| :--- | :---: | ---: |\n| **A** \\| *B*<br>~~old~~ | `` x \\| `y` `` |  |\n| [docs](https://example.test/a%28b%29) | x\\\\y | 2 |\n\nAfter');
  });
  it('keeps path buttons as text and ignores controls, executable tags and unsafe links', () => {
    const source = e('div', table(), e('button', 'copy').attr({ 'data-clipboard-ignore': '' }), e('button', 'src/main.ts'),
      e('script', 'bad()'), e('iframe', 'remote'), e('img').attr({ src: 'https://example.test/pixel', alt: 'diagram' }),
      e('a', 'unsafe').attr({ href: 'javascript:bad()' }), e('span', 'hidden').attr({ 'aria-hidden': 'true' }));
    const text = md(source);
    expect(text).toContain('src/main.tsdiagramunsafe'); expect(text).not.toMatch(/copy|bad|remote|pixel|hidden|javascript/);
  });
  it('expands merged cells without dropping following columns or nested table rows', () => {
    const source = e('table', e('tr', e('th', 'A').attr({ colspan: '2' }), e('th', 'C')),
      e('tr', e('td', 'one').attr({ rowspan: '2' }), e('td', 'two'), e('td', 'three')), e('tr', e('td', 'four'), e('td', 'five')));
    expect(md(source)).toBe('| A |  | C |\n| --- | --- | --- |\n| one | two | three |\n|  | four | five |');
  });
  it('preserves literal Markdown punctuation and code fences around a table', () => {
    const source = e('div', e('p', '*literal* [text] <br>'), table(), e('pre', e('code', 'const x = `a`;\n  next();\n')));
    expect(md(source)).toContain('\\*literal\\* \\[text\\] &lt;br\\>');
    expect(md(source)).toContain('```\nconst x = `a`;\n  next();\n```');
  });
  it('reads HTML only inside an inert template and declines non-table fragments', () => {
    const fragment = e('div', table());
    const template = { innerHTML: '', content: fragment };
    const createElement = vi.fn(() => template);
    vi.stubGlobal('document', { createElement });
    expect(clipboardHtmlToMarkdown('<table>fragment</table>')).toBe(md(fragment));
    expect(createElement).toHaveBeenCalledWith('template'); expect(template.innerHTML).toBe('<table>fragment</table>');
    template.content = e('div', e('p', 'plain'));
    expect(clipboardHtmlToMarkdown('<p>plain</p>')).toBeNull();
    vi.stubGlobal('document', undefined); expect(clipboardHtmlToMarkdown('<table></table>')).toBeNull();
  });
  it('enables only unadorned line break tags inside table cells', () => {
    const tree = { type: 'root', children: [{ type: 'html', value: '<br>' }, { type: 'tableCell', children: [
      { type: 'html', value: '<br />' }, { type: 'html', value: '<br onmouseover="bad()">' }, { type: 'html', value: '<img src="remote">' },
    ] }] };
    clipboardBreaks()(tree);
    expect(tree.children[0]).toEqual({ type: 'html', value: '<br>' });
    expect(tree.children[1]?.children?.[0]).toEqual({ type: 'break' });
    expect(tree.children[1]?.children?.[1]?.type).toBe('html');
    expect(tree.children[1]?.children?.[2]?.type).toBe('html');
  });
});

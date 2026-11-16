/** Minimal DOM surface for selection tests; positions include element boundaries as well as text. */
export class ClipboardNode {
  parentElement: ClipboardNode | null = null;
  childNodes: ClipboardNode[] = [];
  private attrs = new Map<string, string>();
  constructor(readonly nodeName: string, private value = '') {}
  get nodeType(): number { return this.nodeName === '#text' ? 3 : 1; }
  get tagName(): string { return this.nodeName; }
  get children(): ClipboardNode[] { return this.childNodes.filter(node => node.nodeType === 1); }
  get textContent(): string { return this.nodeType === 3 ? this.value : this.childNodes.map(node => node.textContent).join(''); }
  get attributes(): { name: string }[] { return [...this.attrs.keys()].map(name => ({ name })); }
  get style(): { textAlign: string } { return { textAlign: /text-align:\s*(\w+)/.exec(this.getAttribute('style') ?? '')?.[1] ?? '' }; }
  get ownerDocument(): typeof clipboardDocument { return clipboardDocument; }
  get innerHTML(): string { return this.childNodes.map(node => node.outerHTML).join(''); }
  get outerHTML(): string {
    if (this.nodeType === 3) return this.value;
    const attrs = [...this.attrs].map(([name, value]) => ` ${name}="${value}"`).join('');
    return `<${this.nodeName.toLowerCase()}${attrs}>${this.innerHTML}</${this.nodeName.toLowerCase()}>`;
  }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  append(...nodes: ClipboardNode[]): void { nodes.forEach(node => this.appendChild(node)); }
  appendChild(node: ClipboardNode): ClipboardNode { node.remove(); node.parentElement = this; this.childNodes.push(node); return node; }
  remove(): void {
    const parent = this.parentElement;
    if (parent) parent.childNodes = parent.childNodes.filter(node => node !== this);
    this.parentElement = null;
  }
  replaceWith(...nodes: ClipboardNode[]): void {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.childNodes.indexOf(this);
    nodes.forEach(node => { node.remove(); node.parentElement = parent; });
    parent.childNodes.splice(index, 1, ...nodes); this.parentElement = null;
  }
  cloneNode(deep: boolean): ClipboardNode {
    const clone = new ClipboardNode(this.nodeName, this.value);
    this.attrs.forEach((value, name) => clone.setAttribute(name, value));
    if (deep) clone.append(...this.childNodes.map(node => node.cloneNode(true)));
    return clone;
  }
  contains(node: ClipboardNode): boolean { return this === node || this.childNodes.some(child => child.contains(node)); }
  matches(selector: string): boolean {
    return selector.split(',').some(part => {
      const query = part.trim();
      if (query === '*') return this.nodeType === 1;
      if (query.startsWith('.')) return (this.getAttribute('class') ?? '').split(' ').includes(query.slice(1));
      const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(query);
      if (attr) return attr[2] === undefined ? this.hasAttribute(attr[1]!) : this.getAttribute(attr[1]!) === attr[2];
      return this.tagName.toLowerCase() === query;
    });
  }
  closest(selector: string): ClipboardNode | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector: string): ClipboardNode[] {
    return this.childNodes.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]);
  }
  querySelector(selector: string): ClipboardNode | null { return this.querySelectorAll(selector)[0] ?? null; }
}

export const clipboardDocument = {
  createElement: (tag: string): ClipboardNode => new ClipboardNode(tag.toUpperCase()),
  createTextNode: (text: string): ClipboardNode => new ClipboardNode('#text', text),
  getSelection: (): Selection | null => null,
};

export function tag(name: string, ...children: (ClipboardNode | string)[]): ClipboardNode {
  const node = clipboardDocument.createElement(name);
  node.append(...children.map(child => typeof child === 'string' ? clipboardDocument.createTextNode(child) : child));
  return node;
}

export function selection(root: ClipboardNode, start: ClipboardNode, from: number, end: ClipboardNode, to: number): Selection {
  const bounds = new Map<ClipboardNode, [number, number]>(); let position = 0;
  const walk = (node: ClipboardNode): void => {
    const left = position++;
    if (node.nodeType === 3) position += node.textContent.length;
    else node.childNodes.forEach(walk);
    bounds.set(node, [left + 1, position]); position++;
  };
  walk(root);
  const first = bounds.get(start)![0] + from; const last = bounds.get(end)![0] + to;
  let ancestor = start;
  while (!ancestor.contains(end)) ancestor = ancestor.parentElement!;
  const range = {
    startContainer: start, endContainer: end, startOffset: from, endOffset: to, commonAncestorContainer: ancestor,
    intersectsNode: (node: ClipboardNode): boolean => { const bound = bounds.get(node)!; return bound[1] > first && bound[0] < last; },
  };
  return { isCollapsed: first === last, rangeCount: 1, getRangeAt: () => range } as unknown as Selection;
}

export const asElement = (node: ClipboardNode): HTMLElement => node as unknown as HTMLElement;

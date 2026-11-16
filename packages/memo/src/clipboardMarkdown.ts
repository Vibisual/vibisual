import { clipboardTable } from './clipboardTable.js';

const OMIT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'META', 'LINK']);
const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION']);
const WRAP: Readonly<Record<string, string>> = { STRONG: '**', B: '**', EM: '*', I: '*', DEL: '~~', S: '~~', STRIKE: '~~' };

function escapeText(text: string): string {
  return text.replace(/[\t\r\n ]+/g, ' ').replace(/\\/g, '\\\\').replace(/([`*_[\]~|#>])/g, '\\$1')
    .replace(/</g, '&lt;').replace(/^(\s*)([-+]\s|\d+[.)]\s)/, '$1\\$2');
}

function code(text: string, cell: boolean): string {
  const value = text.replace(/\r?\n/g, ' ');
  const fence = '`'.repeat(Math.max(0, ...(value.match(/`+/g) ?? []).map(run => run.length)) + 1);
  const padding = value.startsWith('`') || value.endsWith('`') || (/^ .* $/.test(value) && !!value.trim()) ? ' ' : '';
  return `${fence}${padding}${cell ? value.replace(/\|/g, '\\|') : value}${padding}${fence}`;
}

function link(element: Element, text: string): string {
  const href = element.getAttribute('href')?.trim() ?? '';
  if (!/^(?:https?:\/\/|mailto:|#|\/|\.\.?\/)/i.test(href)) return text;
  const target = href.replace(/[\s<>|\\()]/g, char => encodeURIComponent(char).replace(/\(/g, '%28').replace(/\)/g, '%29'));
  return `[${text}](${target})`;
}

function children(node: Node, cell = false): string {
  return Array.from(node.childNodes, child => convert(child, cell)).join('');
}

function list(element: Element, cell: boolean): string {
  let order = Number(element.getAttribute('start')) || 1;
  const rows = Array.from(element.children).filter(child => child.tagName === 'LI').map(child => {
    const marker = element.tagName === 'OL' ? `${order++}. ` : '- ';
    return marker + children(child, cell).trim().replace(/\n/g, `\n${' '.repeat(marker.length)}`);
  });
  return `\n\n${rows.join('\n')}\n\n`;
}

function convert(node: Node, cell: boolean): string {
  if (node.nodeType === 3) return escapeText(node.textContent ?? '');
  if (node.nodeType !== 1) return '';
  // nodeType으로 좁혀 다른 창의 instanceof 판정에 의존하지 않는다.
  const element = node as Element;
  const tag = element.tagName.toUpperCase();
  if (OMIT.has(tag) || element.hasAttribute('data-clipboard-ignore') || element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return '';
  if (tag === 'TABLE') return `\n\n${clipboardTable(element, item => children(item, true))}\n\n`;
  if (tag === 'BR') return '\n';
  if (tag === 'IMG') return escapeText(element.getAttribute('alt') ?? '');
  if (tag === 'INPUT') return element.getAttribute('type') === 'checkbox' ? `[${element.hasAttribute('checked') ? 'x' : ' '}] ` : '';
  if (tag === 'PRE') {
    const text = element.textContent?.replace(/\n$/, '') ?? '';
    const fence = '`'.repeat(Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length)) + 1);
    return `\n\n${fence}\n${text}\n${fence}\n\n`;
  }
  if (tag === 'CODE') return code(element.textContent ?? '', cell);
  if (tag === 'UL' || tag === 'OL') return list(element, cell);
  const text = children(element, cell);
  const marker = WRAP[tag];
  if (marker) return text.trim() ? text.replace(/^(\s*)([\s\S]*?)(\s*)$/, `$1${marker}$2${marker}$3`) : text;
  if (tag === 'A') return link(element, text);
  if (/^H[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${text.trim()}\n\n`;
  if (tag === 'BLOCKQUOTE') return `\n\n${text.trim().split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
  if (tag === 'HR') return '\n\n---\n\n';
  return BLOCK.has(tag) ? `\n\n${text.trim()}\n\n` : text;
}

function normalize(text: string): string { return text.replace(/\n{3,}/g, '\n\n').trim(); }

export function clipboardElementToMarkdown(element: Element): string { return normalize(convert(element, false)); }

/** inert template 안에서만 읽어 이미지 요청·스크립트 실행을 막는다. */
export function clipboardHtmlToMarkdown(html: string): string | null {
  if (!html || typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const template = document.createElement('template');
  template.innerHTML = html;
  if (!template.content.querySelector('table')) return null;
  return normalize(children(template.content));
}

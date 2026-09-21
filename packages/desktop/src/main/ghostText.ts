import { Buffer } from 'node:buffer';

export const GHOST_HINT_MAX_UNITS = 160;

/** Keep the existing UTF-16 budget without cutting a valid surrogate pair in half. */
export function ghostHint(value: unknown): string {
  if (typeof value !== 'string') return '';
  let end = Math.min(value.length, GHOST_HINT_MAX_UNITS);
  const last = value.charCodeAt(end - 1);
  const next = value.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
  return value.slice(0, end);
}

/**
 * encodeURIComponent throws on lone UTF-16 surrogates, including truncated emoji.
 * UTF-8 replaces only malformed units; valid languages/symbols and escaped HTML survive.
 */
export function ghostDocumentUrl(html: string): string {
  return `data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`;
}

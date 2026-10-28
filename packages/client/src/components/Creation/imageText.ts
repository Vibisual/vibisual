/**
 * §5.13 (R-10) — screen, SVG and PNG export share this one function and measurer, so lines break at the same places.
 * Widths come from the real font (`measureText`); words break between words, Hangul/Han/Kana between characters; no-start punctuation stays with the previous character.
 * The font stack ends with each OS's Korean font so Hangul never falls back to tofu or a wider face on one OS only.
 */
export type TextMeasure = (text: string, font: string) => number;

export const IMAGE_FONT_FALLBACKS = ['Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK KR', 'Noto Sans KR', 'sans-serif'] as const;
export const IMAGE_LINE_HEIGHT = 1.2;

function familyKey(name: string): string {
  return name.trim().replace(/^["']|["']$/g, '').toLowerCase();
}
function quoteFamily(name: string): string {
  const bare = name.trim().replace(/^["']|["']$/g, '');
  return /^[a-z-]+$/i.test(bare) && !/\s/.test(bare) ? bare : `"${bare.replace(/"/g, '')}"`;
}
/** `Arial, sans-serif` → `Arial, "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK KR", "Noto Sans KR", sans-serif`. */
export function imageFontStack(family: string): string {
  const own = family.split(',').map(part => part.trim()).filter(Boolean);
  const generic = own.filter(part => ['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy'].includes(familyKey(part)));
  const named = own.filter(part => !generic.includes(part));
  const seen = new Set(named.map(familyKey));
  const fallbacks = IMAGE_FONT_FALLBACKS.filter(name => name !== 'sans-serif' && !seen.has(familyKey(name)));
  const tail = generic.length ? generic : ['sans-serif'];
  return [...named.map(quoteFamily), ...fallbacks.map(quoteFamily), ...tail].join(', ');
}
export function imageFont(size: number, family: string): string {
  return `${size}px ${imageFontStack(family)}`;
}

const CJK = /[ᄀ-ᇿ⺀-⿟぀-ヿ㄀-ㄯ㄰-㆏ㆠ-ㇿ㈀-㋿㐀-䶿一-鿿ꥠ-꥿가-힯ힰ-퟿豈-﫿＀-￯]/u;
/** Must not begin a line: closing brackets, sentence punctuation, prolonged sound marks. */
const NO_START = /^[)\]}>,.!?:;%'"’”·…、。〉》」』】〕ー々！），．：；？］｝]$/u;
/** Must not end a line: opening brackets and currency signs. */
const NO_END = /^[([{<'"‘“$₩〈《「『【〔（［｛]$/u;

interface Token { text: string; space: boolean }
/** Words for space-separated scripts, single characters for CJK; punctuation glued to its neighbour. */
export function tokenizeImageText(paragraph: string): Token[] {
  const raw: Token[] = [];
  let word = '';
  const flush = (): void => { if (word) { raw.push({ text: word, space: false }); word = ''; } };
  for (const ch of Array.from(paragraph)) {
    if (/\s/u.test(ch)) {
      flush();
      const last = raw[raw.length - 1];
      if (last?.space) last.text += ch; else raw.push({ text: ch, space: true });
    } else if (CJK.test(ch)) {
      flush();
      raw.push({ text: ch, space: false });
    } else word += ch;
  }
  flush();
  const tokens: Token[] = [];
  let carry = '';
  for (const token of raw) {
    if (token.space) { if (carry) { tokens.push({ text: carry, space: false }); carry = ''; } tokens.push(token); continue; }
    const text = carry + token.text;
    carry = '';
    const previous = tokens[tokens.length - 1];
    if (NO_START.test(text) && previous && !previous.space) previous.text += text;
    else if (NO_END.test(token.text) && token.text.length === 1) carry = text;
    else tokens.push({ text, space: false });
  }
  if (carry) tokens.push({ text: carry, space: false });
  return tokens;
}

/** Breaks one over-long token at character boundaries (no hyphen, nothing dropped). */
function splitByCharacters(text: string, width: number, measure: TextMeasure, font: string): string[] {
  const out: string[] = [];
  let line = '';
  for (const ch of Array.from(text)) {
    if (line && measure(line + ch, font) > width) { out.push(line); line = ch; } else line += ch;
  }
  if (line) out.push(line);
  return out;
}

export function wrapTextToWidth(text: string, width: number, font: string, measure: TextMeasure): string[] {
  const limit = Math.max(1, width);
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = [];
    let line = '';
    for (const token of tokenizeImageText(paragraph)) {
      if (token.space) {
        if (line) line += token.text; // trailing spaces are trimmed when the line breaks
        continue;
      }
      const candidate = line + token.text;
      if (measure(candidate.trimEnd(), font) <= limit) { line = candidate; continue; }
      if (line.trim()) lines.push(line.trimEnd());
      if (measure(token.text, font) <= limit) { line = token.text; continue; }
      const pieces = splitByCharacters(token.text, limit, measure, font);
      line = pieces.pop() ?? '';
      lines.push(...pieces);
    }
    if (line.trim() || lines.length === 0) lines.push(line.trimEnd());
    return lines;
  });
}

let canvasMeasure: TextMeasure | null | undefined;
const MEASURE_CACHE_MAX = 4_000;
/** Real glyph widths from a 2D canvas. Null where no canvas exists (unit tests pass their own measurer). */
export function canvasTextMeasure(): TextMeasure | null {
  if (canvasMeasure !== undefined) return canvasMeasure;
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') context = new OffscreenCanvas(1, 1).getContext('2d');
    else if (typeof document !== 'undefined') context = document.createElement('canvas').getContext('2d');
  } catch { context = null; }
  if (!context) { canvasMeasure = null; return null; }
  const cache = new Map<string, number>();
  const ctx = context;
  canvasMeasure = (text, font) => {
    const key = `${font}\u0000${text}`;
    const known = cache.get(key);
    if (known !== undefined) return known;
    if (ctx.font !== font) ctx.font = font;
    const width = ctx.measureText(text).width;
    if (cache.size >= MEASURE_CACHE_MAX) cache.clear();
    cache.set(key, width);
    return width;
  };
  return canvasMeasure;
}
/** Fonts loaded later change widths: drop cached measurements. */
export function resetImageTextMeasure(): void {
  canvasMeasure = undefined;
}
/** Only for runtimes without any canvas: CJK ≈ 1em, other glyphs ≈ 0.55em. Never used where a canvas exists. */
export const approximateTextMeasure: TextMeasure = (text, font) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  return Array.from(text).reduce((sum, ch) => sum + (CJK.test(ch) ? size : /\s/.test(ch) ? size * 0.3 : size * 0.55), 0);
};
export function defaultTextMeasure(): TextMeasure {
  return canvasTextMeasure() ?? approximateTextMeasure;
}

/** Waits until every font a document uses can render its text (system fonts resolve at once). */
export async function ensureImageFonts(texts: readonly { text: string; font: string }[]): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts) return;
  await Promise.all(texts.map(({ text, font }) => fonts.load(font, text.slice(0, 200) || 'A').catch(() => [])));
  await fonts.ready;
}

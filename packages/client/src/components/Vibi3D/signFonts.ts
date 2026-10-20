import { parse, type Glyph } from 'opentype.js';
import type { Vibi3DSignFont } from '@vibisual/shared';
import { CreationUiError } from '../Creation/creationErrors.js';
import type { SignFont } from './signGlyphs.js';

// OFL files are bundled locally; the MIT parser supplies the exact same contours to canvas and 3D on every OS.
const files = {
  sans: { regular: new URL('./fonts/nanumgothic/NanumGothic-Regular.ttf', import.meta.url).href, bold: new URL('./fonts/nanumgothic/NanumGothic-Bold.ttf', import.meta.url).href },
  serif: { regular: new URL('./fonts/nanummyeongjo/NanumMyeongjo-Regular.ttf', import.meta.url).href, bold: new URL('./fonts/nanummyeongjo/NanumMyeongjo-Bold.ttf', import.meta.url).href },
  display: { regular: new URL('./fonts/blackhansans/BlackHanSans-Regular.ttf', import.meta.url).href },
} as const;
const fonts = new Map<string, Promise<SignFont>>();
export const SIGN_FONT_LICENSES = [
  { role: 'sans', url: new URL('./fonts/nanumgothic/OFL.txt', import.meta.url).href },
  { role: 'serif', url: new URL('./fonts/nanummyeongjo/OFL.txt', import.meta.url).href },
  { role: 'display', url: new URL('./fonts/blackhansans/OFL.txt', import.meta.url).href },
] as const;
export const SIGN_PARSER_LICENSE = new URL('./fonts/opentype-LICENSE.txt', import.meta.url).href;

export function parseSignFont(bytes: ArrayBuffer, baseWeight = 400): SignFont {
  const font = parse(bytes);
  return { unitsPerEm: font.unitsPerEm, baseWeight, charToGlyph: value => font.charToGlyph(value),
    getKerningValue: (left, right) => font.getKerningValue(left as Glyph, right as Glyph) };
}
export async function loadSignFont(role: Vibi3DSignFont = 'sans', weight = 400): Promise<SignFont> {
  const bold = role !== 'display' && weight >= 600, path = bold ? files[role as 'sans' | 'serif'].bold : files[role].regular;
  let pending = fonts.get(path);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(path); if (!response.ok) throw new CreationUiError('sign-font-unavailable');
      return parseSignFont(await response.arrayBuffer(), bold ? 700 : 400);
    })().catch(() => { fonts.delete(path); throw new CreationUiError('sign-font-unavailable'); });
    fonts.set(path, pending);
  }
  return pending;
}

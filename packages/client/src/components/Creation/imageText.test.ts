import { describe, expect, it } from 'vitest';
import { IMAGE_LINE_HEIGHT, imageFont, imageFontStack, wrapTextToWidth, type TextMeasure } from './imageText.js';
import { imageSvg, renderImageBlob, wrapImageText } from './imageRender.js';
import { newImageDocument, newImageLayer, type ImageDocument } from './imageSource.js';

/** A deterministic stand-in for canvas measureText: full width for Hangul/CJK, ~0.55 em for Latin, 0.3 em for a space. */
const measure: TextMeasure = (text, font) => {
  const size = Number(/^(\d+(?:\.\d+)?)px/.exec(font)![1]);
  let width = 0;
  for (const ch of text) width += /[가-힯一-鿿぀-ヿ]/.test(ch) ? size : ch === ' ' ? size * 0.3 : size * 0.55;
  return width;
};
const font = imageFont(40, 'Arial, sans-serif');
const KOREAN = '향수병 한정판 출시 기념 특별 할인 행사를 지금 시작합니다';
const ENGLISH = 'The quick brown fox jumps over the lazy dog near the river bank';

describe('(3) text wraps by real width', () => {
  it('breaks an English sentence between words, never inside one, and never wider than the box', () => {
    const lines = wrapTextToWidth(ENGLISH, 400, font, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ').split(/\s+/)).toEqual(ENGLISH.split(' '));
    for (const line of lines) expect(measure(line.trimEnd(), font)).toBeLessThanOrEqual(400);
  });
  it('breaks a long Korean title by character and keeps every line inside the box (the old 0.62em guess overflowed)', () => {
    const lines = wrapTextToWidth(KOREAN, 200, font, measure);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.join('').replace(/\s/g, '')).toBe(KOREAN.replace(/\s/g, ''));
    for (const line of lines) expect(measure(line.trim(), font)).toBeLessThanOrEqual(200);
    // A character-count guess would have put far more Hangul on one line than fits.
    expect(Math.max(...lines.map((line) => line.replace(/\s/g, '').length))).toBeLessThanOrEqual(5);
  });
  it('splits a single word longer than the box instead of overflowing', () => {
    const lines = wrapTextToWidth('Supercalifragilisticexpialidocious', 200, font, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line, font)).toBeLessThanOrEqual(200);
  });
  it('does not start a line with closing punctuation (it travels with the character before it)', () => {
    // Five Hangul fill 200px exactly, so a naive break would put "。" at the start of the second line.
    const lines = wrapTextToWidth('가나다라마。바사아', 200, font, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) expect(line.startsWith('。')).toBe(false);
    expect(lines.join('')).toBe('가나다라마。바사아');
  });
  it('names the default Korean face of all three systems before the generic family', () => {
    const stack = imageFontStack('Arial, sans-serif');
    for (const face of ['Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK KR']) expect(stack).toContain(face);
    expect(stack.indexOf('Noto Sans CJK KR')).toBeLessThan(stack.lastIndexOf('sans-serif'));
    expect(stack.startsWith('Arial')).toBe(true);
  });
});

function poster(): ImageDocument {
  const doc = newImageDocument();
  doc.layers = [
    { ...newImageLayer(doc, 'text', 'Title'), id: 'title', text: KOREAN, x: 40, y: 40, width: 400, height: 300, fontSize: 40 },
    { ...newImageLayer(doc, 'text', 'Line'), id: 'line', text: ENGLISH, x: 40, y: 500, width: 400, height: 300, fontSize: 40 },
  ];
  return doc;
}
const tspans = (svg: string, id: string): string[] => {
  const group = svg.split(`data-layer-id="${id}"`)[1]!.split('</text>')[0]!;
  return [...group.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((match) => match[1]!);
};

describe('(3) screen, SVG and PNG break lines the same way', () => {
  it('the SVG carries exactly the lines the shared wrapper computes, one tspan per line, spacing preserved', () => {
    const doc = poster();
    const svg = imageSvg(doc, {}, measure);
    for (const layer of doc.layers) expect(tspans(svg, layer.id)).toEqual(wrapImageText(layer, measure, doc.style.fontFamily));
    expect(svg).toContain('xml:space="preserve"');
    const title = doc.layers[0]!;
    expect(tspans(svg, 'title').length * title.fontSize! * IMAGE_LINE_HEIGHT).toBeGreaterThan(0);
  });
  it('the PNG is drawn from the identical SVG, after the fonts are ready (widths are measured only then)', async () => {
    const doc = poster();
    const order: string[] = [];
    let release!: () => void;
    const fontsReady = new Promise<void>((resolve) => { release = resolve; });
    let rasterized = '';
    const counting: TextMeasure = (text, face) => { order.push('measure'); return measure(text, face); };
    const png = renderImageBlob(doc, 'project', 'png', {
      measure: counting,
      fonts: async (texts) => { expect(texts.map((item) => item.text)).toEqual([KOREAN, ENGLISH]); order.push('fonts-requested'); await fontsReady; order.push('fonts-ready'); },
      rasterize: async (svg) => { rasterized = svg; return new Blob([svg], { type: 'image/png' }); },
    });
    await Promise.resolve();
    expect(order).toEqual(['fonts-requested']);
    release();
    await png;
    expect(order.indexOf('fonts-ready')).toBeLessThan(order.indexOf('measure'));
    expect(rasterized).toBe(imageSvg(doc, {}, measure));
    const svgFile = await renderImageBlob(doc, 'project', 'svg', { measure, fonts: async () => undefined });
    expect(await svgFile.text()).toBe(rasterized);
  });
  it('the screen draws with the same function as the exports', () => {
    const stage = Object.values(import.meta.glob('../Vibimage/ImageStage.tsx', { query: '?raw', import: 'default', eager: true }))[0] as string;
    expect(stage).toContain('imageSvgBody(');
    expect(stage).not.toMatch(/0\.62/);
  });
});

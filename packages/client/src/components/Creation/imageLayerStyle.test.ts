import { describe, expect, it } from 'vitest';
import { imageSvgBody, imageSvgLayer, wrapImageText } from './imageRender.js';
import { imageVariant, isImageDocument, newImageDocument, newImageLayer, type ImageDocument, type ImageLayer } from './imageSource.js';
import type { TextMeasure } from './imageText.js';

const measure: TextMeasure = (text) => Array.from(text).length * 10;
function withLayer(patch: Partial<ImageLayer>, kind: ImageLayer['kind'] = 'shape'): ImageDocument {
  const doc = newImageDocument();
  return { ...doc, layers: [{ ...newImageLayer(doc, kind, 'L'), id: 'a', x: 10, y: 20, width: 100, height: 50, ...patch }] };
}

describe('optional editor fields (§5.13 (R-9) 레이어 편집기 ⑥)', () => {
  it('older sources without them stay valid and draw exactly as before', () => {
    const doc = withLayer({});
    expect(isImageDocument(doc)).toBe(true);
    expect(imageSvgLayer(doc, doc.layers[0]!, {}, measure)).toBe(`<rect data-layer-id="a" opacity="1" x="10" y="20" width="100" height="50" fill="${doc.layers[0]!.fill}"/>`);
  });
  it('accepts valid values and refuses broken ones', () => {
    expect(isImageDocument(withLayer({ rotation: 45, flipX: true, blend: 'multiply', stroke: '#000000', strokeWidth: 4, radius: 8,
      shadow: { color: '#000000', opacity: 0.4, x: 2, y: 4, blur: 8 } }))).toBe(true);
    for (const bad of [{ rotation: 400 }, { blend: 'plus-lighter' }, { stroke: 'red' }, { fontWeight: 950 }, { lineHeight: 0 },
      { shadow: { color: '#000', opacity: 2, x: 0, y: 0, blur: 0 } }, { flipY: 'yes' }] as Partial<ImageLayer>[]) {
      expect(isImageDocument(withLayer(bad)), JSON.stringify(bad)).toBe(false);
    }
  });
  it('rotates and flips around the box centre, blends, outlines, rounds and casts a shadow', () => {
    const doc = withLayer({ rotation: 30, flipX: true, blend: 'screen', stroke: '#112233', strokeWidth: 3, radius: 500,
      shadow: { color: '#000000', opacity: 0.5, x: 4, y: 6, blur: 10 } });
    const svg = imageSvgLayer(doc, doc.layers[0]!, {}, measure);
    expect(svg).toContain('transform="translate(60 45) rotate(30) scale(-1 1) translate(-60 -45)"');
    expect(svg).toContain('style="mix-blend-mode:screen"');
    expect(svg).toContain('stroke="#112233" stroke-width="3"');
    expect(svg).toContain('rx="25" ry="25"');
    expect(svg).toContain('<filter id="vbi-shadow-a"');
    expect(svg).toContain('stdDeviation="5" flood-color="#000000" flood-opacity="0.5"');
    expect(svg).toContain('filter="url(#vbi-shadow-a)"');
  });
  it('keeps filter ids to safe characters', () => {
    const doc = withLayer({ id: 'x"><script>', shadow: { color: '#000000', opacity: 1, x: 0, y: 0, blur: 0 } } as Partial<ImageLayer>);
    expect(imageSvgLayer(doc, doc.layers[0]!, {}, measure)).toContain('id="vbi-shadow-x___script_"');
  });
  it('text weight, italic, spacing and line height reach both the drawing and the wrapping', () => {
    const doc = withLayer({ text: 'aa bb cc', fontSize: 10, fontWeight: 700, italic: true, letterSpacing: 5, lineHeight: 2, width: 60 }, 'text');
    const layer = doc.layers[0]!;
    // 'aa bb' = 5 chars → 50 + 5×5 spacing = 75 > 60, so spacing pushes each word to its own line.
    expect(wrapImageText(layer, measure)).toEqual(['aa', 'bb', 'cc']);
    const svg = imageSvgBody(doc, {}, measure);
    expect(svg).toContain('font-weight="700" font-style="italic" letter-spacing="5"');
    expect(svg).toContain('y="30">aa</tspan><tspan x="10" y="50">bb');
  });
  it('a hidden layer draws nothing, and derived formats keep rotation and scale spacing', () => {
    const doc = withLayer({ visible: false });
    expect(imageSvgLayer(doc, doc.layers[0]!)).toBe('');
    const text = withLayer({ text: 'hello', letterSpacing: 10, rotation: 12 }, 'text');
    const variant = imageVariant(text, 540, 540, measure);
    expect(variant.layers[0]).toMatchObject({ rotation: 12, letterSpacing: 5 });
  });
});

describe('derived formats scale layer effects', () => {
  it('outlines, corners and shadows grow with the layer', () => {
    const doc = withLayer({ strokeWidth: 4, radius: 10, shadow: { color: '#000000', opacity: 0.5, x: 2, y: 4, blur: 8 } });
    const big = imageVariant({ ...doc, width: 1080, height: 1080 }, 2160, 2160, measure);
    expect(big.layers[0]).toMatchObject({ strokeWidth: 8, radius: 20, shadow: { x: 4, y: 8, blur: 16, opacity: 0.5 } });
  });
});

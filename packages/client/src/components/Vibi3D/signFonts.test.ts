import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import sansRegular from './fonts/nanumgothic/NanumGothic-Regular.ttf?inline';
import sansBold from './fonts/nanumgothic/NanumGothic-Bold.ttf?inline';
import serifRegular from './fonts/nanummyeongjo/NanumMyeongjo-Regular.ttf?inline';
import serifBold from './fonts/nanummyeongjo/NanumMyeongjo-Bold.ttf?inline';
import display from './fonts/blackhansans/BlackHanSans-Regular.ttf?inline';
import { parseSignFont } from './signFonts.js';
import { layoutSignGlyphs } from './signGlyphs.js';

export function fontBytes(data: string): ArrayBuffer {
  if (!data.startsWith('data:')) throw new Error('Bundled font was not inlined by the asset loader');
  return Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), character => character.charCodeAt(0)).buffer;
}
describe('bundled Korean sign font outlines', () => {
  it.each([['sans regular', sansRegular], ['sans bold', sansBold], ['serif regular', serifRegular], ['serif bold', serifBold], ['display', display]])('%s parses actual font bytes and builds Korean outlines', (_name, source) => {
    const font = parseSignFont(fontBytes(source!)), glyphs = layoutSignGlyphs(font, { text: '모퉁이 상점 ABC 123', layout: 'horizontal', size: [4, 1], weight: 400 });
    expect(glyphs.length).toBeGreaterThan(9); expect(glyphs.some(glyph => glyph.shapes.some(shape => shape.holes.length > 0))).toBe(true);
    const geometry = new THREE.ExtrudeGeometry(glyphs.flatMap(glyph => glyph.shapes), { depth: 0.08, bevelEnabled: false }); geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3()); expect(size.x).toBeLessThanOrEqual(3.601); expect(size.y).toBeLessThanOrEqual(0.851); expect(size.z).toBeCloseTo(0.08);
    expect(geometry.getAttribute('position').count).toBeGreaterThan(100); geometry.dispose();
  });
  it('uses actual weight files and keeps holes while fitting a vertical sign', () => {
    const regular = parseSignFont(fontBytes(sansRegular)), bold = parseSignFont(fontBytes(sansBold), 700);
    const first = layoutSignGlyphs(regular, { text: '모퉁이', layout: 'vertical', size: [0.7, 2.5], weight: 400 });
    const second = layoutSignGlyphs(bold, { text: '모퉁이', layout: 'vertical', size: [0.7, 2.5], weight: 700 });
    expect(first.map(glyph => glyph.key)).toEqual(second.map(glyph => glyph.key)); expect(first[0]!.shapes[0]!.getPoints()).not.toEqual(second[0]!.shapes[0]!.getPoints());
    const bounds = new THREE.Box2(); first.forEach(glyph => glyph.shapes.forEach(shape => shape.getPoints().forEach(point => bounds.expandByPoint(point))));
    expect(bounds.getSize(new THREE.Vector2()).y).toBeGreaterThan(bounds.getSize(new THREE.Vector2()).x);
  });
});

import * as THREE from 'three';
import { CreationUiError } from '../Creation/creationErrors.js';

export type SignPathCommand = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number };
export interface SignGlyph { index: number; advanceWidth?: number; getPath(x: number, y: number, size: number): { commands: SignPathCommand[] } }
export interface SignFont { unitsPerEm: number; baseWeight?: number; charToGlyph(value: string): SignGlyph; getKerningValue(left: SignGlyph, right: SignGlyph): number }
export interface SignTextLayout { text: string; layout: 'horizontal' | 'vertical'; size: readonly [number, number, number?]; weight: number }
export interface SignGlyphShape { key: string; character: string; shapes: THREE.Shape[] }

function pathShapes(commands: SignPathCommand[]): THREE.Shape[] {
  const path = new THREE.ShapePath();
  for (const value of commands) {
    if (value.type === 'M') path.moveTo(value.x!, -value.y!);
    else if (value.type === 'L') path.lineTo(value.x!, -value.y!);
    else if (value.type === 'Q') path.quadraticCurveTo(value.x1!, -value.y1!, value.x!, -value.y!);
    else if (value.type === 'C') path.bezierCurveTo(value.x1!, -value.y1!, value.x2!, -value.y2!, value.x!, -value.y!);
    else if (value.type === 'Z') path.currentPath?.closePath();
  }
  return path.toShapes();
}

/** Offset sampled outlines in their own plane. Hole contours move in the opposite direction to filled contours. */
function offsetRing(points: THREE.Vector2[], distance: number): THREE.Vector2[] {
  const values = points.length > 1 && points[0]!.equals(points.at(-1)!) ? points.slice(0, -1) : points;
  if (!distance || values.length < 3) return values.map(point => point.clone());
  const sign = THREE.ShapeUtils.area(values) < 0 ? -1 : 1;
  return values.map((point, index) => {
    const before = values[(index + values.length - 1) % values.length]!, after = values[(index + 1) % values.length]!;
    const incoming = point.clone().sub(before).normalize(), outgoing = after.clone().sub(point).normalize();
    const left = new THREE.Vector2(incoming.y, -incoming.x).multiplyScalar(sign), right = new THREE.Vector2(outgoing.y, -outgoing.x).multiplyScalar(sign);
    const direction = left.add(right), divisor = Math.max(0.15, direction.dot(right));
    return point.clone().add(direction.multiplyScalar(THREE.MathUtils.clamp(distance / divisor, -Math.abs(distance) * 4, Math.abs(distance) * 4)));
  });
}
export function offsetSignShapes(shapes: THREE.Shape[], distance: number): THREE.Shape[] {
  return shapes.map(shape => {
    const result = new THREE.Shape(offsetRing(shape.getPoints(8), distance));
    result.holes = shape.holes.map(hole => new THREE.Path(offsetRing(hole.getPoints(8), -distance))); return result;
  });
}
function transformShapes(shapes: THREE.Shape[], scale: number, offset: THREE.Vector2): THREE.Shape[] {
  return shapes.map(shape => {
    const transform = (path: THREE.Path): THREE.Vector2[] => path.getPoints(8).map(point => point.multiplyScalar(scale).add(offset));
    const result = new THREE.Shape(transform(shape)); result.holes = shape.holes.map(hole => new THREE.Path(transform(hole))); return result;
  });
}

/** Both canvas artwork and channel meshes use the same bundled-font outlines, spacing and meter-valued layout. */
export function layoutSignGlyphs(font: SignFont, recipe: SignTextLayout): SignGlyphShape[] {
  const result: SignGlyphShape[] = [], bounds = new THREE.Box2(), lines = recipe.text.split('\n');
  const occurrences = new Map<string, number>();
  lines.forEach((line, lineIndex) => {
    let cursor = 0, previous: SignGlyph | undefined;
    for (const character of Array.from(line)) {
      const glyph = font.charToGlyph(character);
      if (glyph.index === 0 && character.trim()) throw new CreationUiError('sign-glyph-missing', { character });
      if (previous && recipe.layout === 'horizontal') cursor += font.getKerningValue(previous, glyph) / font.unitsPerEm;
      const x = recipe.layout === 'horizontal' ? cursor : lineIndex * 1.25;
      const y = recipe.layout === 'horizontal' ? lineIndex * 1.3 : cursor;
      const shapes = offsetSignShapes(pathShapes(glyph.getPath(x, y, 1).commands), (recipe.weight - (font.baseWeight ?? 400)) / 500 * 0.018);
      for (const shape of shapes) for (const point of shape.getPoints(8)) bounds.expandByPoint(point);
      const occurrence = occurrences.get(character) ?? 0; occurrences.set(character, occurrence + 1);
      if (shapes.length) result.push({ key: `glyph-${character.codePointAt(0)!.toString(16)}-${occurrence}`, character, shapes });
      cursor += recipe.layout === 'horizontal' ? (glyph.advanceWidth ?? font.unitsPerEm) / font.unitsPerEm : 1.15; previous = glyph;
    }
  });
  if (bounds.isEmpty()) return result;
  const size = bounds.getSize(new THREE.Vector2()), scale = Math.min(recipe.size[0]! * 0.9 / Math.max(size.x, 0.001), recipe.size[1]! * 0.85 / Math.max(size.y, 0.001));
  const offset = bounds.getCenter(new THREE.Vector2()).multiplyScalar(-scale);
  return result.map(value => ({ ...value, shapes: transformShapes(value.shapes, scale, offset) }));
}

import { describe, expect, it } from 'vitest';
import { newImageDocument, newImageLayer, type ImageDocument, type ImageLayer } from '../Creation/imageSource.js';
import { alignLayers, arrangeLayers, distributeLayers, duplicateLayers, moveLayerToIndex, moveLayers, patchLayers, removeLayers } from './imageArrange.js';

function doc(...layers: Partial<ImageLayer>[]): ImageDocument {
  const base = { ...newImageDocument(), width: 1000, height: 500 };
  return { ...base, layers: layers.map((patch, i) => ({ ...newImageLayer(base, 'shape', `L${i}`), id: `l${i}`, x: 0, y: 0, width: 100, height: 100, ...patch })) };
}
const ids = (d: ImageDocument): string[] => d.layers.map((l) => l.id);
const at = (d: ImageDocument, id: string): ImageLayer => d.layers.find((l) => l.id === id)!;

describe('imageArrange', () => {
  it('aligns one layer to the canvas and several to their common box; locked layers stay', () => {
    const one = alignLayers(doc({ x: 10 }), ['l0'], 'right');
    expect(at(one, 'l0').x).toBe(900);
    const many = alignLayers(doc({ x: 10, y: 0 }, { x: 300, y: 50 }, { x: 600, locked: true }), ['l0', 'l1', 'l2'], 'bottom');
    expect(at(many, 'l0').y).toBe(50);
    expect(at(many, 'l2').y).toBe(0);
    expect(at(alignLayers(doc({ x: 0 }, { x: 400 }), ['l0', 'l1'], 'hcenter'), 'l0').x).toBe(200);
  });
  it('aligns a rotated layer by the box it really covers', () => {
    const rotated = alignLayers(doc({ x: 100, y: 100, width: 100, height: 50, rotation: 90 }), ['l0'], 'left');
    expect(at(rotated, 'l0').x).toBeCloseTo(-25);
  });
  it('distributes the gaps evenly between the outermost layers', () => {
    const d = distributeLayers(doc({ x: 0, width: 100 }, { x: 150, width: 100 }, { x: 900, width: 100 }), ['l0', 'l1', 'l2'], 'x');
    expect(at(d, 'l1').x).toBe(450);
    expect(distributeLayers(doc({}, {}), ['l0', 'l1'], 'x').layers.map((l) => l.x)).toEqual([0, 0]);
  });
  it('moves the front/back order and keeps the selection order', () => {
    const d = doc({}, {}, {}, {});
    expect(ids(arrangeLayers(d, ['l0', 'l1'], 'front'))).toEqual(['l2', 'l3', 'l0', 'l1']);
    expect(ids(arrangeLayers(d, ['l3'], 'back'))).toEqual(['l3', 'l0', 'l1', 'l2']);
    expect(ids(arrangeLayers(d, ['l0', 'l1'], 'forward'))).toEqual(['l2', 'l0', 'l1', 'l3']);
    expect(ids(arrangeLayers(d, ['l2', 'l3'], 'backward'))).toEqual(['l0', 'l2', 'l3', 'l1']);
    expect(ids(arrangeLayers(doc({ locked: true }, {}), ['l0'], 'front'))).toEqual(['l0', 'l1']);
  });
  it('drops a dragged layer at an array slot; a locked layer keeps its place', () => {
    const d = doc({}, {}, {});
    expect(ids(moveLayerToIndex(d, 'l0', 3))).toEqual(['l1', 'l2', 'l0']);
    expect(ids(moveLayerToIndex(d, 'l2', 0))).toEqual(['l2', 'l0', 'l1']);
    expect(moveLayerToIndex(d, 'l1', 1)).toBe(d);
    expect(moveLayerToIndex(doc({ locked: true }, {}), 'l0', 2).layers[0]!.id).toBe('l0');
  });
  it('duplicates in place above each original with new ids, removes, moves and patches only unlocked layers', () => {
    const dup = duplicateLayers(doc({}, { locked: true }), ['l0', 'l1'], 20);
    expect(dup.ids).toHaveLength(1);
    expect(dup.doc.layers[1]).toMatchObject({ x: 20, y: 20, name: 'L0' });
    expect(ids(removeLayers(doc({}, { locked: true }), ['l0', 'l1']))).toEqual(['l1']);
    expect(moveLayers(doc({}, { locked: true }), ['l0', 'l1'], 5, 6).layers.map((l) => [l.x, l.y])).toEqual([[5, 6], [0, 0]]);
    expect(patchLayers(doc({ locked: true }), ['l0'], { opacity: 0.5 }).layers[0]!.opacity).toBe(1);
    expect(patchLayers(doc({ locked: true }), ['l0'], { locked: false }).layers[0]!.locked).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { VIBI3D_SHAPES, validateVibi3DCommand, validateVibi3DRecipe, type Vibi3DVec3 } from '@vibisual/shared';

const rectangle = (x: number, y: number, w: number, h: number): Vibi3DVec3[] => [[x, y, 0], [x + w, y, 0], [x + w, y + h, 0], [x, y + h, 0]];
const outer = rectangle(0, 0, 4, 4);

describe('bounded native geometry contracts', () => {
  it('keeps legacy dimensions and supports all new editable geometry recipes', () => {
    expect(VIBI3D_SHAPES).toHaveLength(14);
    const recipes = [{ kind: 'box', width: 0.0001 }, { kind: 'roundedBox', width: 2, height: 1, depth: 1, bevelRadius: 0.1, bevelSegments: 3 },
      { kind: 'capsule', radius: 0.3, height: 2 }, { kind: 'sweep', profile: rectangle(-0.1, -0.1, 0.2, 0.2), path: [[0, 0, 0], [1, 2, 0], [2, 2, 1]] },
      { kind: 'stairs', width: 2, height: 3.2, depth: 4, steps: 16, creaseAngle: 35 },
      { kind: 'wall', width: 5, height: 3.2, thickness: 0.3, openings: [{ id: 'window-a', x: 1, y: 1, w: 2, h: 1.5, reveal: 0.1 }] },
      { kind: 'extrude', points: outer, depth: 0.5, holes: [rectangle(1, 1, 2, 2)], bevel: { enabled: true, thickness: 0.05, size: 0.05, segments: 2 } }];
    for (const recipe of recipes) {
      expect(validateVibi3DRecipe(recipe)).toEqual(recipe);
      expect(validateVibi3DCommand({ type: 'geometry', id: 'part', recipe })).toEqual({ type: 'geometry', id: 'part', recipe });
    }
  });

  it('normalizes wall shorthand into the same create contract, without another execution path', () => {
    const command = { type: 'wall', id: 'shop-front', width: 4, height: 3, thickness: 0.2,
      openings: [{ x: 1, y: 0, w: 1, h: 2.2 }], position: [0, 0, 2], material: { color: '#AABBCC' } };
    expect(validateVibi3DCommand(command)).toEqual({ type: 'create', id: 'shop-front', name: 'Wall', position: [0, 0, 2],
      material: { color: '#aabbcc' }, recipe: { kind: 'wall', width: 4, height: 3, thickness: 0.2, openings: command.openings } });
    expect(validateVibi3DCommand({ ...command, kind: 'box' })).toBeNull();
    expect(validateVibi3DCommand({ ...command, source: 'run-code' })).toBeNull();
  });

  it('rejects self crossings, touching/outside/nested holes and keeps winding independent', () => {
    const make = (holes: Vibi3DVec3[][]) => validateVibi3DRecipe({ kind: 'extrude', points: outer, holes });
    expect(make([rectangle(1, 1, 1, 1).reverse()])).not.toBeNull();
    for (const holes of [[rectangle(0, 1, 1, 1)], [rectangle(3.5, 1, 1, 1)],
      [rectangle(1, 1, 2, 2), rectangle(1.5, 1.5, 0.25, 0.25)], [rectangle(1, 1, 1, 1), rectangle(2, 1, 1, 1)]]) expect(make(holes)).toBeNull();
    for (const points of [[[0, 0, 0], [2, 2, 0], [0, 2, 0], [2, 0, 0]], [...outer, outer[0]], [[0, 0, 0], [1, 0, 0], [2, 0, 0]]]) {
      expect(validateVibi3DRecipe({ kind: 'extrude', points })).toBeNull();
    }
    expect(make(Array.from({ length: 33 }, (_, i) => rectangle((i % 8) * 0.4 + 0.1, Math.floor(i / 8) * 0.4 + 0.1, 0.1, 0.1)))).toBeNull();
  });

  it('limits wall opening work and validates physical aperture bounds including reveal', () => {
    const wall = { kind: 'wall', width: 100, height: 3, thickness: 0.2 };
    const holes = Array.from({ length: 32 }, (_, index) => ({ id: `slot-${index}`, x: index * 2, y: 1, w: 1, h: 1 }));
    expect(validateVibi3DRecipe({ ...wall, openings: holes })).not.toBeNull();
    expect(validateVibi3DRecipe({ ...wall, openings: [...holes, { x: 65, y: 1, w: 1, h: 1 }] })).toBeNull();
    for (const openings of [[{ x: -1, y: 1, w: 1, h: 1 }], [{ x: 99.5, y: 1, w: 1, h: 1 }],
      [{ x: 1, y: 1, w: 1, h: 1, reveal: 0.3 }], [{ x: 1, y: 1, w: 0.2, h: 1, reveal: 0.1 }],
      [{ x: 1, y: 1, w: 2, h: 1 }, { x: 2, y: 1, w: 2, h: 1 }],
      [{ id: 'same', x: 1, y: 1, w: 1, h: 1 }, { id: 'same', x: 3, y: 1, w: 1, h: 1 }]]) expect(validateVibi3DRecipe({ ...wall, openings })).toBeNull();
    expect(validateVibi3DRecipe({ ...wall, openings: [{ x: 1, y: 0, w: 1, h: 3 }, { x: 2, y: 0, w: 1, h: 3 }] })).not.toBeNull();
  });

  it('rejects unbounded tessellation, degenerate sweeps and shape-inapplicable inputs', () => {
    for (const recipe of [{ kind: 'roundedBox', width: 1, bevelRadius: 0.6 }, { kind: 'roundedBox', bevelSegments: 17 },
      { kind: 'capsule', height: 1, radius: 0.6 }, { kind: 'stairs', steps: 65 }, { kind: 'stairs', steps: 2.5 },
      { kind: 'sweep', profile: outer, path: [[0, 0, 0], [0, 0, 0]] }, { kind: 'sweep', profile: outer.map(([x, y]) => [x, y, 1]), path: [[0, 0, 0], [1, 1, 1]] },
      { kind: 'extrude', points: outer, depth: 0.2, bevel: { thickness: 0.11 } }, { kind: 'box', creaseAngle: 181 },
      { kind: 'box', steps: 3 }, { kind: 'box', width: NaN }, { kind: 'wall', thickness: 0 }]) expect(validateVibi3DRecipe(recipe)).toBeNull();
  });

  it('round trips recipe data without retaining mutable caller references', () => {
    const value = { kind: 'extrude', points: outer, holes: [rectangle(1, 1, 1, 1)], bevel: { size: 0.02 } };
    const parsed = validateVibi3DRecipe(JSON.parse(JSON.stringify(value)))!;
    expect(parsed).toEqual(value);
    parsed.holes![0]![0]![0] = 9; parsed.bevel!.size = 8;
    expect(value.holes[0]![0]![0]).toBe(1); expect(value.bevel.size).toBe(0.02);
  });
});

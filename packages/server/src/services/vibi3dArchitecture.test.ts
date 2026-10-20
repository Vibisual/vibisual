import { describe, expect, it } from 'vitest';
import { VIBI3D_ARCHITECTURE_KINDS, VIBI3D_PROP_KINDS, validateVibi3DArchitectureCommand, validateVibi3DArchitectureRecipe,
  resolveVibi3DFacadeLayout, validateVibi3DCommand, validateVibi3DSnapshot, getVibi3DCommandDefinition } from '@vibisual/shared';

describe('native architectural command contracts', () => {
  it('shares the command vocabulary, identity and saved recipe settings for all six generators', () => {
    for (const type of VIBI3D_ARCHITECTURE_KINDS) {
      const command = { type, id: `${type}-stable`, name: 'Corner shop', parentId: 'scene', position: [2, 0, 3], rotation: [0, 90, 0] };
      expect(validateVibi3DCommand(command)).toEqual(command);
      expect(validateVibi3DArchitectureRecipe({ kind: type })).toEqual({ kind: type });
      expect(getVibi3DCommandDefinition(type)!.timeoutMs).toBe(120000);
    }
    for (const style of VIBI3D_PROP_KINDS) {
      const recipe = { kind: 'prop', style, ...(style === 'wire' ? { path: [[0, 4, 0], [5, 4, 0]], sag: 0.4 } : {}) };
      expect(validateVibi3DArchitectureRecipe(recipe)).toEqual(recipe);
    }
  });

  it('allows partial updates but validates dimensions after merging saved values', () => {
    for (const type of VIBI3D_ARCHITECTURE_KINDS) for (const detail of ['draft', 'architectural']) {
      expect(validateVibi3DArchitectureCommand({ type, detail })).toEqual({ type, detail });
      expect(validateVibi3DArchitectureRecipe({ kind: type, detail })).toEqual({ kind: type, detail });
    }
    expect(validateVibi3DArchitectureCommand({ type: 'facade', detail: 'unknown' })).toBeNull();
    expect(validateVibi3DArchitectureCommand({ type: 'facade', floorModules: [['open', 'open'], ['window', 'balcony']] }))
      .toEqual({ type: 'facade', floorModules: [['open', 'open'], ['window', 'balcony']] });
    expect(validateVibi3DArchitectureCommand({ type: 'facade', id: 'face', bandHeight: 2 })).toEqual({ type: 'facade', id: 'face', bandHeight: 2 });
    expect(validateVibi3DArchitectureRecipe({ kind: 'facade', height: 4, floors: 4, bandHeight: 2 })).toBeNull();
    expect(validateVibi3DArchitectureRecipe({ kind: 'facade', height: 16, floors: 4, bandHeight: 2 })).not.toBeNull();
    expect(validateVibi3DArchitectureCommand({ type: 'prop', id: 'wire', style: 'wire', sag: 1 })).not.toBeNull();
    expect(validateVibi3DArchitectureRecipe({ kind: 'prop', style: 'wire', sag: 1 })).toBeNull();
    for (const command of [{ type: 'storefront', awning: false, projectingSign: false }, { type: 'rooftop', waterTank: false, antenna: false },
      { type: 'street', crosswalk: false, laneMarkings: false, manholes: 0 }]) expect(validateVibi3DCommand(command)).toEqual(command);
  });

  it('validates L and polygon footprints without boolean geometry or self-intersections', () => {
    const footprints = [{ kind: 'rect', width: 12, depth: 9 }, { kind: 'l', width: 12, depth: 9, wingWidth: 4, wingDepth: 3 },
      { kind: 'polygon', points: [[-4, -4], [4, -4], [4, 0], [0, 4], [-4, 4]] }];
    for (const footprint of footprints) expect(validateVibi3DArchitectureRecipe({ kind: 'building', footprint, floors: 5, groundFloorHeight: 4.2, upperFloorHeight: 3.1 })).not.toBeNull();
    for (const footprint of [{ kind: 'l', width: 12, depth: 9, wingWidth: 12, wingDepth: 3 }, { kind: 'l', width: 12, depth: 9, wingWidth: 3, wingDepth: 0 },
      { kind: 'polygon', points: [[0, 0], [1, 1], [0, 1], [1, 0]] }, { kind: 'polygon', points: [[0, 0], [201, 0], [0, 1]] }]) {
      expect(validateVibi3DCommand({ type: 'building', footprint })).toBeNull();
    }
  });

  it('rejects nonbuildable complete recipes while supporting zero-valued optional parts', () => {
    for (const recipe of [{ kind: 'facade', width: 0.25, bays: 50 }, { kind: 'facade', height: 0.05, floors: 20 },
      { kind: 'facade', width: 200, bayWidth: 0.25 }, { kind: 'facade', bayWidth: 20, bays: 50 },
      { kind: 'storefront', width: 0.25 }, { kind: 'storefront', height: 0.05 }, { kind: 'storefront', height: 3, signBandHeight: 3 },
      { kind: 'building', floors: 20, groundFloorHeight: 12, upperFloorHeight: 10 }]) expect(validateVibi3DArchitectureRecipe(recipe)).toBeNull();
    for (const recipe of [{ kind: 'storefront', width: 0.75, height: 1, signBandHeight: 0, depth: 0.05 },
      { kind: 'facade', width: 0.25, bays: 1, floors: 1, height: 1, bandHeight: 0 },
      { kind: 'rooftop', railingHeight: 0 }, { kind: 'street', kerbHeight: 0 }]) expect(validateVibi3DArchitectureRecipe(recipe)).toEqual(recipe);
  });

  it('uses explicit floor heights ahead of regular floor counts and matches derived bay dimensions', () => {
    expect(resolveVibi3DFacadeLayout({ bayWidth: 4, bays: 3, floorHeights: [4.2, 3.1], floors: 4 })).toEqual({ width: 12, bays: 3, bayWidth: 4, floorHeights: [4.2, 3.1], bandHeight: 0.18 });
    expect(resolveVibi3DFacadeLayout({ width: 11, bayWidth: 4, height: 6, floors: 2 })).toEqual({ width: 11, bays: 3, bayWidth: 11 / 3, floorHeights: [3, 3], bandHeight: 0.18 });
  });

  it('rejects code, type overrides, unbounded arrays and foreign command fields', () => {
    for (const command of [{ type: 'building', kind: 'street' }, { type: 'building', floors: 21 }, { type: 'building', code: 'run()' },
      { type: 'facade', bays: 1.5 }, { type: 'facade', floorModules: [['window', 'external']] }, { type: 'facade', floorHeights: Array(21).fill(3) },
      { type: 'storefront', awning: { colors: ['red', '#ffffff'] } }, { type: 'street', lanes: 9 }, { type: 'rooftop', waterTank: { radius: 0 } },
      { type: 'prop', style: 'external-model' }, { type: 'prop', path: [[0, 0, 0], [0, 0, 0]] }, { type: 'building', position: [Infinity, 0, 0] }]) {
      expect(validateVibi3DCommand(command)).toBeNull();
    }
  });

  it('stores independent recipe metadata alongside geometry in snapshots and tolerates old snapshots', () => {
    const architecture = { kind: 'storefront', awning: { colors: ['#AA0000', '#FFFFFF'] }, width: 4 };
    const node = { id: 'shop', name: 'shop', type: 'Group', parentId: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    const base = { sessionId: 'architecture', projectId: 'fixture', fileName: 'building', revision: 1, selectedId: null };
    const result = validateVibi3DSnapshot({ ...base, nodes: [{ ...node, architecture }] })!;
    expect(result.nodes[0]!.architecture).toEqual({ ...architecture, awning: { colors: ['#aa0000', '#ffffff'] } });
    expect(validateVibi3DSnapshot({ ...base, nodes: [node] })!.nodes[0]).not.toHaveProperty('architecture');
    expect(validateVibi3DSnapshot({ ...base, nodes: [{ ...node, architecture: { kind: 'unknown' } }] })!.nodes[0]).not.toHaveProperty('architecture');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(architecture.awning.colors).toEqual(['#AA0000', '#FFFFFF']);
  });
});

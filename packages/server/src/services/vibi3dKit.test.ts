import { describe, expect, it } from 'vitest';
import { VIBI3D_BUILTIN_MODULES, VIBI3D_LIMITS, validateVibi3DCommand, validateVibi3DCommandRequest, validateVibi3DSnapshot,
  validateVibi3DKitModules, validateVibi3DInstance, validateVibi3DStats, buildVibi3DStatsWarnings, getVibi3DRequestTimeoutMs, vibi3DJsonBytes } from '@vibisual/shared';

const placement = { type: 'place', id: 'shop-west', moduleId: 'shop', position: [0, 0, 0] };
const array = { type: 'array', id: 'windows', moduleId: 'window', counts: [100, 100, 1], step: [2, 3, 0] };
const module = { id: 'shop', name: 'Shop', revision: 1, prototypeId: 'prototype-shop', builtin: 'korean-retail/storefront-glass' };
const view = { sessionId: 'kit-scene', projectId: 'fixture', fileName: 'scene', revision: 0, selectedId: null,
  nodes: [{ id: 'shop-west', name: 'Shop', type: 'Group', parentId: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }] };

describe('stable native module and placement contracts', () => {
  it('supports exactly the eight bundled modules or one existing subtree as the source', () => {
    expect(VIBI3D_BUILTIN_MODULES).toHaveLength(8);
    for (const builtin of VIBI3D_BUILTIN_MODULES) expect(validateVibi3DCommand({ type: 'kitModule', id: 'module', builtin })).toEqual({ type: 'kitModule', id: 'module', builtin });
    expect(validateVibi3DCommand({ type: 'kitModule', id: 'module', sourceId: 'original', expectedModuleRevision: 2 })).not.toBeNull();
    for (const command of [{ type: 'kitModule', id: 'module' }, { type: 'kitModule', id: 'module', sourceId: 'original', builtin: VIBI3D_BUILTIN_MODULES[0] },
      { type: 'kitModule', id: 'module', builtin: 'url' }, { type: 'kitModule', id: 'module', sourceId: 'original', expectedModuleRevision: 0 },
      { type: 'kitModule', id: 'module', sourceId: 'original', code: 'run()' }]) expect(validateVibi3DCommand(command)).toBeNull();
  });

  it('requires stable placement ids and limits grid work before generation', () => {
    expect(validateVibi3DCommand(placement)).toEqual(placement);
    expect(validateVibi3DCommand(array)).toEqual(array);
    expect(validateVibi3DCommand({ ...placement, snap: false, scale: [1, 2, 3], rotation: [0, 90, 0] })).not.toBeNull();
    for (const command of [{ ...placement, id: undefined }, { ...placement, instanceId: 3 }, { ...placement, scale: [-1, 1, 1] },
      { ...placement, scale: [0, 1, 1] }, { ...placement, snap: 0 }, { ...placement, snap: true }, { ...array, counts: [101, 100, 1] },
      { ...array, counts: [0, 1, 1] }, { ...array, counts: [1.5, 1, 1] }, { ...array, step: [0, 3, 0] }]) expect(validateVibi3DCommand(command)).toBeNull();
  });

  it('persists module revision and stable cell identity without leaking a GPU index', () => {
    const instance = { moduleId: 'shop', moduleRevision: 2, placementId: 'shop-west', arrayId: 'shop-grid', cell: [0, 2, 0] };
    const input = { ...view, kitModules: [module], nodes: [{ ...view.nodes[0], instance }] };
    const parsed = validateVibi3DSnapshot(input)!;
    expect(parsed.kitModules).toEqual([module]); expect(parsed.nodes[0]!.instance).toEqual(instance);
    parsed.nodes[0]!.instance!.cell![1] = 9; expect(instance.cell[1]).toBe(2);
    expect(JSON.stringify(parsed)).not.toContain('instanceId');
    expect(validateVibi3DSnapshot({ ...input, nodes: [{ ...view.nodes[0], instance: { ...instance, placementId: 'other' } }] })).toBeNull();
    expect(validateVibi3DInstance({ ...instance, instanceId: 2 })).toBeNull();
    expect(validateVibi3DInstance({ ...instance, cell: [-1, 2, 0] })).toBeNull();
    expect(validateVibi3DInstance({ ...instance, cell: undefined })).toBeNull();
    expect(validateVibi3DKitModules([module, module])).toBeNull();
    expect(validateVibi3DKitModules([module, { ...module, id: 'other' }])).toBeNull();
    expect(validateVibi3DKitModules([{ ...module, partCount: 129 }])).toBeNull();
    expect(validateVibi3DSnapshot(view)).not.toBeNull();
  });

  it('caps logical instances across the whole snapshot, not only per array', () => {
    const nodes = Array.from({ length: VIBI3D_LIMITS.placements + 1 }, (_, index) => ({ ...view.nodes[0], id: `placement-${index}`,
      instance: { moduleId: 'shop', moduleRevision: 1, placementId: `placement-${index}` } }));
    expect(validateVibi3DSnapshot({ ...view, nodes })).toBeNull();
    nodes.pop(); expect(validateVibi3DSnapshot({ ...view, nodes })).not.toBeNull();
  });
});

describe('bounded batch size and measured scene statistics', () => {
  it('accepts 500 edits, rejects 501, counts UTF8 bytes and gives large batches a bounded deadline', () => {
    const command = { type: 'update', id: 'shop-west', position: [0, 0, 0] };
    const commands = Array(500).fill(command);
    expect(validateVibi3DCommandRequest({ commandId: 'large', expectedRevision: 0, commands })!.commands).toHaveLength(500);
    expect(validateVibi3DCommandRequest({ commandId: 'large', expectedRevision: 0, commands: [...commands, command] })).toBeNull();
    expect(vibi3DJsonBytes('한')).toBe(5);
    expect(getVibi3DRequestTimeoutMs([command])).toBe(30_000);
    expect(getVibi3DRequestTimeoutMs([{ type: 'array' }])).toBe(120_000);
    expect(getVibi3DRequestTimeoutMs(commands)).toBe(300_000);
    const cycle: unknown[] = []; cycle.push(cycle); expect(vibi3DJsonBytes(cycle)).toBe(Infinity);
    expect(validateVibi3DCommandRequest({ commandId: 'stats', expectedRevision: 0, commands: [{ type: 'stats' }, command] })).toBeNull();
  });

  it('derives warnings from bounded counters and distinguishes unavailable metrics from zero', () => {
    const stats = { sceneRevision: 4, objects: 20, instances: 5000, triangles: 2_000_001, drawCalls: 501,
      drawCallsSource: 'estimated', textureBytes: 256 * 1024 * 1024 + 1, textureBytesEstimated: true, warnings: [{ message: 'forged' }] };
    const parsed = validateVibi3DStats(stats)!;
    expect(parsed.warnings.map(warning => warning.metric)).toEqual(['triangles', 'drawCalls', 'textureBytes']);
    expect(parsed.warnings).toEqual(buildVibi3DStatsWarnings(parsed));
    const unavailable = { ...stats, drawCalls: undefined, drawCallsSource: 'unavailable' };
    expect(validateVibi3DStats(unavailable)!.warnings.map(warning => warning.metric)).not.toContain('drawCalls');
    for (const invalid of [{ ...stats, triangles: Infinity }, { ...stats, textureBytes: -1 }, { ...stats, objects: 0.5 },
      { ...stats, drawCalls: undefined }, { ...stats, textureBytesEstimated: false }, { ...stats, script: 'code' }]) expect(validateVibi3DStats(invalid)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { VIBI3D_SIGN_KINDS, VIBI3D_SIGN_FONTS, validateVibi3DCommand, validateVibi3DCommandRequest,
  validateVibi3DSignRecipe, validateVibi3DDecalRecipe, validateVibi3DMascotRecipe, validateVibi3DSnapshot, validateVibi3DImageSource } from '@vibisual/shared';

const source = { kind: 'blob' as const, ref: `vibi-blob:${'a'.repeat(64)}.png` };
const sign = { kind: 'fascia', text: '달빛 공방\nMOON WORKS', font: 'sans', size: [3, 0.8, 0.1] };
const decal = { target: 'glass', position: [0, 1, 0], normal: [0, 0, 1], size: [0.5, 0.3], source };
const view = { sessionId: 'decoration-scene', projectId: 'fixture', fileName: 'scene', revision: 0, selectedId: null,
  nodes: [{ id: 'sign', name: 'Sign', type: 'Group', parentId: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }] };

describe('bounded native signage, stickers and mascots', () => {
  it('shares seven sign kinds and three fixed bundled font roles across command validation', () => {
    expect(VIBI3D_SIGN_KINDS).toHaveLength(7); expect(VIBI3D_SIGN_FONTS).toEqual(['sans', 'serif', 'display']);
    for (const kind of VIBI3D_SIGN_KINDS) for (const font of VIBI3D_SIGN_FONTS) {
      const command = { type: 'sign', ...sign, kind, font, weight: 700, layout: 'vertical', lit: true,
        outline: { color: '#AAbbCC', width: 0.02 }, color: '#FFFFFF', background: false };
      expect(validateVibi3DCommand(command)).toEqual({ ...command, color: '#ffffff', outline: { color: '#aabbcc', width: 0.02 } });
    }
    expect(validateVibi3DSignRecipe({ kind: 'panel', source, text: '' })).not.toBeNull();
    expect(validateVibi3DSignRecipe({ kind: 'channel', source, text: '달빛' })).not.toBeNull();
    expect(validateVibi3DCommand({ type: 'sign', id: 'existing', text: '새 이름' })).toEqual({ type: 'sign', id: 'existing', text: '새 이름' });
  });

  it('rejects unbounded text, unsupported fonts, malformed dimensions and executable fields', () => {
    for (const recipe of [{ ...sign, text: '가'.repeat(257) }, { ...sign, text: '\tbad' }, { ...sign, text: '   ' },
      { ...sign, font: 'system-font' }, { ...sign, weight: 650 }, { ...sign, weight: 1000 }, { ...sign, size: [0, 1] },
      { ...sign, size: [1, 1, -0.1] }, { ...sign, size: [1, 1, 1, 1] }, { ...sign, color: 'red' },
      { ...sign, outline: { color: '#ffffff', width: Infinity } }, { ...sign, outline: { color: '#ffffff', width: 0.01, script: 'x' } },
      { ...sign, background: true }, { ...sign, layout: 'diagonal' }, { ...sign, lit: 1 }, { ...sign, code: 'run()' }]) {
      expect(validateVibi3DSignRecipe(recipe)).toBeNull();
    }
    expect(validateVibi3DSignRecipe({ ...sign, text: '🙂'.repeat(256) })).not.toBeNull();
    for (const input of [{ ...source, url: 'https://example.com' }, { kind: 'url', url: 'https://example.com' },
      { kind: 'procedural', preset: 'brick' }, { kind: 'blob', ref: 'data:image/png;base64,AA==' },
      { kind: 'blob', ref: source.ref.replace('.png', '.f32') }, { kind: 'vibimage', docId: '../other' }]) expect(validateVibi3DImageSource(input)).toBeNull();
  });

  it('keeps decal geometry in target-local coordinates with a nonzero normal and explicit projection', () => {
    for (const projection of ['auto', 'flat', 'surface']) expect(validateVibi3DCommand({ type: 'decal', ...decal, projection, rotation: 90 }))
      .toEqual({ type: 'decal', ...decal, projection, rotation: 90 });
    expect(validateVibi3DCommand({ type: 'decal', id: 'sticker', rotation: -45 })).not.toBeNull();
    for (const input of [{ ...decal, target: '../wall' }, { ...decal, position: undefined }, { ...decal, normal: [0, 0, 0] },
      { ...decal, normal: [0, NaN, 1] }, { ...decal, size: [1, 1, 0] }, { ...decal, projection: 'world' },
      { ...decal, rotation: [0, 0, 0] }, { ...decal, rotation: 361 }, { ...decal, source: undefined }]) expect(validateVibi3DDecalRecipe(input)).toBeNull();
    expect(validateVibi3DCommand({ type: 'decal', ...decal, parentId: 'other' })).toBeNull();
    expect(validateVibi3DDecalRecipe(decal)!.position).not.toBe(decal.position);
  });

  it('allows native round assemblies or image standees while refusing a generated 3D source', () => {
    const mascot = { style: 'round', height: 1.6, colors: { body: '#AAbb00', accent: '#001122', face: '#ffffff' } };
    expect(validateVibi3DMascotRecipe(mascot)).toEqual({ ...mascot, colors: { ...mascot.colors, body: '#aabb00' } });
    expect(validateVibi3DCommand({ type: 'mascot', style: 'standee', source, position: [2, 0, 3] })).not.toBeNull();
    for (const input of [{ style: 'standee' }, { style: 'round', source }, { style: 'generated', source },
      { ...mascot, height: 0 }, { ...mascot, height: 21 }, { ...mascot, colors: { body: 'pink' } },
      { ...mascot, colors: { eye: '#ffffff' } }, { ...mascot, modelUrl: 'https://example.com/model.glb' }]) expect(validateVibi3DMascotRecipe(input)).toBeNull();
  });

  it('preserves optional editable recipes without requiring them in legacy v1 snapshots', () => {
    const input = { ...view, nodes: [{ ...view.nodes[0], sign, decal, mascot: { style: 'standee', source } }] };
    const parsed = validateVibi3DSnapshot(input)!;
    expect(parsed.nodes[0]!.sign).toEqual(sign); expect(parsed.nodes[0]!.decal).toEqual(decal);
    expect(parsed.nodes[0]!.mascot).toEqual({ style: 'standee', source });
    parsed.nodes[0]!.sign!.size![0] = 9; expect(sign.size[0]).toBe(3);
    expect(validateVibi3DSnapshot(view)).toEqual(view);
    expect(validateVibi3DSnapshot({ ...view, nodes: [{ ...view.nodes[0], sign: { kind: 'unknown' } }] })!.nodes[0]!.sign).toBeUndefined();
    expect(validateVibi3DCommandRequest({ commandId: 'details', expectedRevision: 0,
      commands: [{ type: 'sign', ...sign }, { type: 'decal', ...decal }, { type: 'mascot', style: 'round' }] })!.commands).toHaveLength(3);
  });
});

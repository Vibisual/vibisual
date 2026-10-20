import { describe, expect, it } from 'vitest';
import { VIBI3D_COMMAND_DEFINITIONS, VIBI3D_AUTHORING_STAGES, buildVibi3DCommandReference, buildVibi3DWorkflowInstructions, getVibi3DCommandDefinition, validateVibi3DCommand } from '@vibisual/shared';

describe('native authoring contract', () => {
  it('documents every accepted basic editing operation exactly once', () => {
    const operations = [
      { type: 'create', name: 'shop', recipe: { kind: 'box' } },
      { type: 'update', id: 'shop', position: [1, 2, 3] },
      { type: 'geometry', id: 'shop', recipe: { kind: 'box', height: 4 } },
      { type: 'material', id: 'shop', material: { roughness: 0.8 } },
      { type: 'duplicate', id: 'shop', count: 2 },
      { type: 'group', ids: ['shop'], name: 'building' },
      { type: 'delete', id: 'shop' },
      { type: 'protect', id: 'shop', locked: true },
      { type: 'light', kind: 'directional' },
      { type: 'camera', position: [1, 2, 3], target: [0, 0, 0] },
      { type: 'shotRemove', id: 'portrait' },
      { type: 'cameraMotion', name: 'shot', keys: [{ time: 0, position: [1, 2, 3], target: [0, 0, 0] }, { time: 1, position: [2, 2, 3], target: [0, 0, 0] }] },
      { type: 'motion', id: 'shop', name: 'move', keys: [{ time: 0, position: [0, 0, 0] }, { time: 1, position: [1, 0, 0] }] },
      { type: 'motionRemove', id: 'shop', name: 'move' },
      { type: 'lighting', intensity: 1 },
      { type: 'select', id: null }, { type: 'undo' }, { type: 'redo' }, { type: 'capture' },
    ];
    for (const operation of operations) {
      expect(validateVibi3DCommand(operation), operation.type).not.toBeNull();
      expect(VIBI3D_COMMAND_DEFINITIONS.filter((entry) => entry.type === operation.type)).toHaveLength(1);
    }
    expect(new Set(VIBI3D_COMMAND_DEFINITIONS.map((entry) => entry.type)).size).toBe(VIBI3D_COMMAND_DEFINITIONS.length);
    expect(getVibi3DCommandDefinition('executeCode')).toBeUndefined();
    expect(validateVibi3DCommand({ type: 'executeCode', code: 'arbitrary()' })).toBeNull();
  });
  it('keeps the staged visual inspection and preservation requirements in the shared prompt', () => {
    const prompt = buildVibi3DWorkflowInstructions();
    expect(VIBI3D_AUTHORING_STAGES).toHaveLength(8);
    expect(new Set(VIBI3D_AUTHORING_STAGES.map((stage) => stage.id)).size).toBe(8);
    for (const stage of VIBI3D_AUTHORING_STAGES) expect(prompt).toContain(stage.id);
    expect(prompt).toContain('actually open');
    expect(prompt).toContain('Do not accept your own candidate');
    expect(prompt).toContain('explicit Blender request');
    expect(prompt).toContain('1080×1920');
    const commands = buildVibi3DCommandReference();
    expect(commands).toContain('checkpoint');
    expect(commands).toContain('propose');
  });
});

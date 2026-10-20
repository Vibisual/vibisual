import { describe, expect, it } from 'vitest';
import { validateVibi3DCommand, validateVibi3DCameraView, validateVibi3DShots, validateVibi3DSnapshot,
  resolveVibi3DCameraFov, resolveVibi3DCameraView, vibi3DCaptureSize, vibi3DCameraAspectRatio, VIBI3D_SHOT_LIMIT } from '@vibisual/shared';

const camera = { position: [3, 1.6, 8], target: [0, 2, 0] };
const shot = { ...camera, id: 'corner', name: 'Corner', lens: 24, aspect: '9:16' };
const snapshot = { sessionId: 'camera', projectId: 'fixture', fileName: 'model', revision: 1, selectedId: null, nodes: [] };

describe('one camera contract for live view, stills and video', () => {
  it('preserves legacy views and accepts partial optics, eye-height and named-shot edits', () => {
    expect(validateVibi3DCameraView(camera)).toEqual(camera);
    expect(validateVibi3DCommand({ type: 'camera', ...camera })).toEqual({ type: 'camera', ...camera });
    for (const edit of [{ lens: 24 }, { fov: 70 }, { aspect: '9:16' }, { eyeHeight: 1.6 }, { shot: { id: 'corner', name: 'Corner' } }]) {
      expect(validateVibi3DCommand({ type: 'camera', ...edit })).toEqual({ type: 'camera', ...edit });
    }
    expect(validateVibi3DCommand({ type: 'shotRemove', id: 'corner' })).toEqual({ type: 'shotRemove', id: 'corner' });
    const withEyeHeight = { type: 'camera', position: [0, 0, 0], target: [0, 0, 0], eyeHeight: 1.6 };
    expect(validateVibi3DCommand(withEyeHeight)).toEqual(withEyeHeight);
    expect(validateVibi3DSnapshot({ ...snapshot, camera: { position: [1e6, 1, 0], target: [0, 0, 0] } })).not.toBeNull();
  });

  it('rejects conflicting optics, invalid directions, unstable ids and unknown fields', () => {
    for (const value of [{ type: 'camera' }, { type: 'camera', lens: 24, fov: 70 }, { type: 'camera', lens: 0 },
      { type: 'camera', lens: 501 }, { type: 'camera', fov: 180 }, { type: 'camera', fov: NaN }, { type: 'camera', eyeHeight: -1 },
      { type: 'camera', aspect: 'auto' }, { type: 'camera', position: [0, 0, 0], target: [0, 0, 0] },
      { type: 'camera', position: [1e6, 0, 0] }, { type: 'camera', ...camera, eyeHeight: Infinity },
      { type: 'camera', shot: { id: 'corner', name: '' } }, { type: 'camera', shot: { id: '../private', name: 'Corner' } },
      { type: 'camera', shot: { id: 'current', name: 'Current' } }, { type: 'camera', shot: { id: 'corner', name: 'Corner', code: 'x' } },
      { type: 'shotRemove', id: 'current' }, { type: 'shotRemove', id: 'corner', all: true }]) expect(validateVibi3DCommand(value)).toBeNull();
    expect(validateVibi3DCameraView({ ...camera, lens: 35, fov: 35 })).toBeNull();
    expect(validateVibi3DCameraView({ ...camera, near: -1 })).toBeNull();
  });

  it('uses the 35 mm film gauge consistently without adding optical metadata to legacy views', () => {
    expect(resolveVibi3DCameraFov({ lens: 50 }, 1)).toBeCloseTo(38.580092, 5);
    expect(resolveVibi3DCameraFov({ lens: 50 }, 9 / 16)).toBeCloseTo(38.580092, 5);
    expect(resolveVibi3DCameraFov({ lens: 50 }, 16 / 9)).toBeCloseTo(22.275333, 5);
    expect(resolveVibi3DCameraFov({ fov: 62 }, 9 / 16)).toBe(62);
    expect(resolveVibi3DCameraView(camera, 16 / 9, 42)).toEqual({ ...camera, aspect: 16 / 9, fov: 42 });
    expect(resolveVibi3DCameraView(shot, 1)!.aspect).toBe(9 / 16);
    expect(validateVibi3DCameraView(camera)).not.toHaveProperty('fov');
    expect(vibi3DCameraAspectRatio(undefined, 2)).toBe(2); expect(vibi3DCameraAspectRatio('1:1', 2)).toBe(1);
  });

  it('bounds shot count and prevents ambiguous string references while cloning stored values', () => {
    const parsed = validateVibi3DShots([shot])!; parsed[0]!.position[0] = 99; expect(shot.position[0]).toBe(3);
    for (const shots of [[shot, shot], [shot, { ...shot, id: 'other' }], [shot, { ...shot, id: 'Corner', name: 'Other' }],
      [{ ...shot, name: 'current' }], [{ ...shot, name: ' Corner ' }]]) expect(validateVibi3DShots(shots)).toBeNull();
    const full = Array.from({ length: VIBI3D_SHOT_LIMIT }, (_, n) => ({ ...shot, id: `shot-${n}`, name: `Shot ${n}` }));
    expect(validateVibi3DShots(full)).toHaveLength(64); expect(validateVibi3DShots([...full, shot])).toBeNull();
    expect(validateVibi3DSnapshot({ ...snapshot, camera, shots: [shot], activeShotId: 'corner' })).toMatchObject({ camera, shots: [shot], activeShotId: 'corner' });
    expect(validateVibi3DSnapshot({ ...snapshot, shots: [shot], activeShotId: 'missing' })).toBeNull();
    expect(validateVibi3DSnapshot(snapshot)).toEqual(snapshot);
  });

  it('provides bounded aspect-based capture sizes and rejects undersized final portrait claims', () => {
    expect(vibi3DCaptureSize()).toEqual([1080, 1920]); expect(vibi3DCaptureSize('9:16', 'final')).toEqual([1080, 1920]);
    expect(vibi3DCaptureSize('16:9', 'draft')).toEqual([1280, 720]); expect(vibi3DCaptureSize('16:9', 'final')).toEqual([1920, 1080]);
    expect(vibi3DCaptureSize('1:1', 'draft')).toEqual([1080, 1080]); expect(vibi3DCaptureSize('1:1', 'final')).toEqual([1080, 1080]);
    const capture = { type: 'capture', aspect: '9:16', quality: 'final', views: ['corner', { ...camera, fov: 70, aspect: '1:1' }] };
    expect(validateVibi3DCommand(capture)).toEqual(capture);
    expect(validateVibi3DCommand({ type: 'capture', quality: 'final', size: [720, 1280] })).toBeNull();
    expect(validateVibi3DCommand({ type: 'capture', quality: 'draft', size: [720, 1280] })).not.toBeNull();
    expect(validateVibi3DCommand({ type: 'capture', quality: 'final', size: [1080, 1920] })).not.toBeNull();
    expect(validateVibi3DCommand({ ...capture, views: [{ ...camera, lens: 24, fov: 70 }] })).toBeNull();
    expect(validateVibi3DCommand({ ...capture, aspect: '4:3' })).toBeNull();
    expect(validateVibi3DCommand({ type: 'capture', size: [4096, 4096], views: ['a', 'b', 'c', 'd'] })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { validateVibi3DSnapshot } from '@vibisual/shared';
import { ModelEditor } from './modelEditor.js';
import { applyModelCameraView, readModelCamera, readModelShots, readActiveModelShot, viewCamera } from './modelCamera.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';
import { captureModel, restoreModel } from './modelHistory.js';

const make = (): ModelEditor => new ModelEditor(new THREE.Group(), [], { projectId: 'project' });
describe('saved camera optics and named shots', () => {
  it('merges lens, aspect and eye height, keeping only lens or fov in persisted data', () => {
    const editor = make(); editor.apply({ type: 'camera', position: [4, 3, 5], target: [0, 2, 0], lens: 35, aspect: '9:16', eyeHeight: 1.6 }, editor.revision);
    const camera = viewCamera(editor.object, false)!, expected = new THREE.PerspectiveCamera(); expected.aspect = 9 / 16; expected.setFocalLength(35);
    expect(camera.fov).toBeCloseTo(expected.fov); expect(camera.aspect).toBe(9 / 16); expect(camera.position.toArray()).toEqual([4, 1.6, 5]);
    editor.apply({ type: 'camera', fov: 70 }, editor.revision); expect(readModelCamera(editor.object)).toEqual({ position: [4, 1.6, 5], target: [0, 2, 0], fov: 70, aspect: '9:16' });
    editor.apply({ type: 'camera', lens: 50 }, editor.revision); expect(readModelCamera(editor.object)?.fov).toBeUndefined();
    expect(validateVibi3DSnapshot(editor.snapshot())).toEqual(editor.snapshot());
  });
  it('saves, selects, renames and removes shots by stable id with complete undo/redo', () => {
    const editor = make(); editor.apply({ type: 'camera', position: [1, 2, 3], target: [0, 0, 0], shot: { id: 'whole', name: 'Whole building' } }, editor.revision);
    const camera = viewCamera(editor.object, false)!; expect(readModelShots(editor.object)[0]!.fov).toBe(45);
    editor.apply({ type: 'camera', position: [5, 1.6, 2], lens: 50, aspect: '9:16', shot: { id: 'close', name: 'Storefront' } }, editor.revision);
    const portraitFov = camera.fov; expect(editor.snapshot().activeShotId).toBe('close');
    editor.apply({ type: 'camera', shot: { id: 'whole', name: 'Entire building' } }, editor.revision);
    expect(camera.position.toArray()).toEqual([1, 2, 3]); expect(camera.fov).toBe(45); expect(readActiveModelShot(editor.object)?.name).toBe('Entire building');
    editor.undo(); expect(camera.fov).toBe(portraitFov); expect(editor.snapshot().activeShotId).toBe('close'); editor.redo();
    editor.apply({ type: 'shotRemove', id: 'whole' }, editor.revision); expect(readModelShots(editor.object).map(shot => shot.id)).toEqual(['close']); expect(editor.snapshot().activeShotId).toBeUndefined();
    editor.undo(); expect(editor.snapshot().activeShotId).toBe('whole');
    editor.apply({ type: 'camera', position: [3, 2, 1] }, editor.revision); expect(editor.snapshot().activeShotId).toBeUndefined();
  });
  it('preserves source camera optics and shots through a source round trip and camera motion', async () => {
    const editor = make(); editor.apply({ type: 'camera', position: [1, 1.6, 5], target: [0, 1, 0], lens: 28, aspect: '9:16', shot: { id: 'corner', name: 'Corner' } }, editor.revision);
    const camera = viewCamera(editor.object, false)!, fov = camera.fov;
    editor.apply({ type: 'cameraMotion', name: 'Walk', keys: [{ time: 0, position: [2, 1.6, 5], target: [0, 1, 0] }, { time: 4, position: [3, 1.6, 2], target: [0, 1, 0] }] }, editor.revision);
    expect(camera.fov).toBe(fov); expect(camera.aspect).toBe(9 / 16); expect(editor.snapshot().activeShotId).toBeUndefined(); expect(editor.snapshot().camera?.lens).toBe(28);
    const loaded = await loadModelSource(serializeModelSource(editor.object, editor.clips)); const reopened = new ModelEditor(loaded.object, loaded.clips);
    expect(reopened.snapshot().camera).toEqual(editor.snapshot().camera); expect(reopened.snapshot().shots).toEqual(editor.snapshot().shots);
    const count = reopened.clips.length; reopened.apply({ type: 'camera', shot: { id: 'corner', name: 'Corner' } }, reopened.revision); expect(reopened.clips).toHaveLength(count); expect(reopened.snapshot().activeShotId).toBe('corner');
  });
  it('uses final output aspect for a named lens shot and preserves legacy fov when no optics were authored', () => {
    const camera = new THREE.PerspectiveCamera(52, 16 / 9); camera.zoom = 2; camera.setViewOffset(1920, 1080, 10, 20, 900, 500); const target = new THREE.Vector3();
    expect(applyModelCameraView(camera, { id: 'shot', name: 'Shot', position: [2, 1.6, 4], target: [0, 1, 0], lens: 35, aspect: '16:9' }, { aspect: 9 / 16, target })).toBe(true);
    const expected = new THREE.PerspectiveCamera(); expected.aspect = 9 / 16; expected.setFocalLength(35); expect(camera.fov).toBeCloseTo(expected.fov); expect(camera.getFocalLength()).toBeCloseTo(35); expect(target.toArray()).toEqual([0, 1, 0]);
    expect(camera.zoom).toBe(1); expect(camera.view?.enabled).toBe(false);
    camera.fov = 52; expect(applyModelCameraView(camera, { position: [2, 3, 4], target: [0, 0, 0] })).toBe(true); expect(camera.fov).toBe(52);
  });
  it('rolls camera optical state back after failed batches and blocks protected cameras and protected roots', () => {
    const editor = make(); editor.apply({ type: 'camera', position: [1, 2, 3], target: [0, 0, 0], fov: 60, aspect: '16:9' }, editor.revision);
    const camera = viewCamera(editor.object, false)!;
    expect(() => editor.apply([{ type: 'camera', lens: 100, aspect: '9:16' }, { type: 'delete', id: 'missing' }], editor.revision)).toThrow(); expect(camera.fov).toBe(60); expect(camera.aspect).toBe(16 / 9);
    editor.apply({ type: 'protect', id: editor.getId(camera)!, locked: true }, editor.revision); expect(() => editor.apply({ type: 'camera', lens: 20 }, editor.revision)).toThrow('object-protected');
    const locked = make(); locked.apply({ type: 'protect', id: locked.getId(locked.object)!, locked: true }, locked.revision);
    expect(() => locked.apply({ type: 'camera', lens: 20 }, locked.revision)).toThrow('object-protected'); expect(viewCamera(locked.object, false)).toBeUndefined();
  });
  it('rejects ambiguous shot names without changing the prior camera or shot list', () => {
    const editor = make(); editor.apply({ type: 'camera', lens: 35, shot: { id: 'a', name: 'Original' } }, editor.revision);
    const before = serializeModelSource(editor.object, editor.clips); expect(() => editor.apply({ type: 'camera', lens: 80, shot: { id: 'b', name: 'Original' } }, editor.revision)).toThrow('camera-shot-conflict');
    expect(serializeModelSource(editor.object, editor.clips)).toEqual(before); expect(() => editor.apply({ type: 'shotRemove', id: 'missing' }, editor.revision)).toThrow('camera-shot-missing');
  });
  it('restores every optical projection property in history, including imported camera crop and zoom', () => {
    const root = new THREE.Group(), camera = new THREE.PerspectiveCamera(55, 1.5, 0.2, 500); root.add(camera);
    camera.zoom = 1.2; camera.focus = 8; camera.filmGauge = 36; camera.filmOffset = 2; camera.setViewOffset(1920, 1080, 10, 20, 900, 500);
    const before = captureModel(root, []), projection = camera.projectionMatrix.clone();
    camera.fov = 20; camera.zoom = 3; camera.filmOffset = 0; camera.clearViewOffset(); restoreModel(before, []);
    expect(camera.projectionMatrix.elements).toEqual(projection.elements); expect(camera.filmGauge).toBe(36); expect(camera.focus).toBe(8); expect(camera.view?.offsetX).toBe(10);
  });
});

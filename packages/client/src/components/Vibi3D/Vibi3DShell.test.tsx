import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Vibi3DCommand } from '@vibisual/shared';
import type { LoadedModel } from './modelIO.js';
import type { Vibi3DBridgeOptions } from './useVibi3DBridge.js';
import { Vibi3DShell } from './Vibi3DShell.js';
import { Vibi3DInspector } from './Vibi3DInspector.js';
import { WindowControls } from '../Layout/WindowControls.js';

const mocks = vi.hoisted(() => ({
  local: vi.fn(), workspace: vi.fn(), export: vi.fn(), dispose: vi.fn(), write: vi.fn(),
  bridge: null as Vibi3DBridgeOptions | null,
  transform: null as unknown,
  controls: null as unknown,
  tick: null as ((time: number) => void) | null,
  target: vi.fn(), targetUpdate: vi.fn(), prepare: null as (() => Promise<boolean>) | null,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }));
vi.mock('../Layout/WindowControls.js', () => ({ WindowControls: () => null }));
vi.mock('../../apps/appWindowLifecycle.js', () => ({
  useAppWindowTarget: mocks.target,
  updateAppWindowTarget: mocks.targetUpdate,
  useAppWindowTransferGuard: (_params: unknown, prepare: () => Promise<boolean>) => { mocks.prepare = prepare; },
}));
vi.mock('./Vibi3DAgentPanel.js', () => ({ Vibi3DAgentPanel: () => null }));
vi.mock('./useVibi3DBridge.js', () => ({ useVibi3DBridge: (options: Vibi3DBridgeOptions) => {
  mocks.bridge = options; return { connected: true, error: null, publishNow: async () => undefined };
} }));
vi.mock('./modelIO.js', async (original) => ({ ...await original<typeof import('./modelIO.js')>(),
  loadLocalModel: mocks.local, loadWorkspaceModel: mocks.workspace, exportModelGlb: mocks.export, disposeModel: mocks.dispose,
}));
vi.mock('../../utils/workspaceMedia.js', async (original) => ({ ...await original<typeof import('../../utils/workspaceMedia.js')>(), writeWorkspaceMedia: mocks.write }));
vi.mock('three', async (original) => {
  const actual = await original<typeof import('three')>();
  return { ...actual, WebGLRenderer: class {
    domElement = { width: 800, height: 600, addEventListener: vi.fn(), removeEventListener: vi.fn(), remove: vi.fn(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
    outputColorSpace = '';
    setPixelRatio = vi.fn(); setSize = vi.fn(); render = vi.fn(); dispose = vi.fn();
  } };
});
vi.mock('three/examples/jsm/controls/OrbitControls.js', async () => {
  const { Vector3 } = await import('three');
  return { OrbitControls: class {
    target = new Vector3(); enabled = true; update = vi.fn(); dispose = vi.fn();
    constructor() { mocks.controls = this; }
  } };
});
vi.mock('three/examples/jsm/controls/TransformControls.js', async () => {
  const { EventDispatcher, Object3D } = await import('three');
  return { TransformControls: class extends EventDispatcher {
    object?: THREE.Object3D; axis = null; enabled = true;
    constructor() { super(); mocks.transform = this; }
    setSize = vi.fn(); setMode = vi.fn(); getHelper = () => new Object3D(); dispose = vi.fn();
    attach(object: THREE.Object3D) { this.object = object; }
    detach() { this.object = undefined; }
  } };
});

let renderer: ReactTestRenderer | null;
function mount(params: Record<string, string> = { projectId: 'C:/project' }): void {
  renderer = create(createElement(Vibi3DShell, { appId: 'vibi3d', params }), {
    createNodeMock: (element) => element.type === 'div' && element.props.className === 'absolute inset-0'
      ? { clientWidth: 800, clientHeight: 600, appendChild: vi.fn() } : { click: vi.fn() },
  });
}
function button(text: string) { return renderer!.root.findAllByType('button').find((node) => node.children.join('') === text)!; }
function inspector() { return renderer!.root.findByType(Vibi3DInspector).props as Parameters<typeof Vibi3DInspector>[0]; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function fixture(fileName = 'test.glb', animated = false): LoadedModel {
  const object = new THREE.Group(); object.name = 'Model';
  const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); cube.name = 'Cube'; object.add(cube);
  return { object, fileName, clips: animated ? [new THREE.AnimationClip('Move', 1, [new THREE.VectorKeyframeTrack('Cube.position', [0, 1], [0, 0, 0, 10, 0, 0])])] : [] };
}
async function open(model: LoadedModel): Promise<void> {
  mocks.local.mockResolvedValueOnce(model);
  await act(async () => { renderer!.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [new File([''], model.fileName)], value: model.fileName } }); });
}
function command(value: Vibi3DCommand): void { act(() => inspector().onCommand(value)); }

beforeEach(() => {
  vi.clearAllMocks(); mocks.bridge = null; mocks.tick = null; mocks.prepare = null; renderer = null;
  mocks.local.mockReset(); mocks.workspace.mockReset(); mocks.export.mockResolvedValue(new ArrayBuffer(16));
  mocks.write.mockResolvedValue({ ok: true, path: 'saved.glb' });
  mocks.targetUpdate.mockResolvedValue(undefined);
  vi.stubGlobal('window', { devicePixelRatio: 1, setTimeout });
  vi.stubGlobal('requestAnimationFrame', (fn: (time: number) => void) => { mocks.tick = fn; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = vi.fn(); });
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); vi.unstubAllGlobals(); });

describe('Vibi3D shell edit flow', () => {
  it('allows the empty shell to transfer without exporting or requiring a project', async () => {
    act(() => mount({}));
    let ready: boolean | undefined;
    await act(async () => { ready = await mocks.prepare!(); });
    expect(ready).toBe(true);
    expect(mocks.export).not.toHaveBeenCalled(); expect(mocks.targetUpdate).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([{ appWindowId: 'embedded' }, { appWindowHosted: '1' }])('leaves native chrome to its host (%j)', (host) => {
    act(() => mount({ projectId: 'C:/project', ...host }));
    expect(renderer!.root.findAllByType(WindowControls)).toHaveLength(0);
    expect(renderer!.root.findByType('header').props.className.split(' ')).not.toContain('app-drag');
  });

  it('persists a local edited scene and publishes its saved path before allowing transfer', async () => {
    act(() => mount({ projectId: 'C:/project', appWindowId: 'embedded' })); await open(fixture());
    const id = inspector().snapshot.selectedId!;
    command({ type: 'update', id, position: [7, 0, 0] });
    const publishing = deferred<void>(); mocks.targetUpdate.mockReturnValueOnce(publishing.promise);
    let completed = false; let ready!: Promise<boolean>;
    await act(async () => { ready = mocks.prepare!().then(value => { completed = true; return value; }); });
    expect(completed).toBe(false);
    expect(mocks.write).toHaveBeenCalledWith('C:/project', 'test-edit.glb', expect.any(Uint8Array));
    expect(mocks.targetUpdate).toHaveBeenCalledWith(expect.objectContaining({ appWindowId: 'embedded' }), { ref: undefined, file: 'saved.glb' });
    await act(async () => { publishing.resolve(); await ready; });
    expect(await ready).toBe(true);
    expect(mocks.target).toHaveBeenLastCalledWith(expect.anything(), { ref: undefined, file: 'saved.glb' });
    const sessionId = inspector().snapshot.sessionId;
    await act(async () => { renderer!.update(createElement(Vibi3DShell, { appId: 'vibi3d', params: { projectId: 'C:/project', appWindowId: 'embedded', file: 'saved.glb' } })); });
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(inspector().snapshot.sessionId).toBe(sessionId);
    expect(inspector().snapshot.canUndo).toBe(true);
  });

  it('keeps the scene open when transfer cannot save it', async () => {
    act(() => mount()); await open(fixture());
    const sessionId = inspector().snapshot.sessionId;
    mocks.write.mockResolvedValueOnce({ ok: false, error: 'failed' });
    let ready: boolean | undefined;
    await act(async () => { ready = await mocks.prepare!(); });
    expect(ready).toBe(false);
    expect(inspector().snapshot.sessionId).toBe(sessionId);
    expect(mocks.targetUpdate).not.toHaveBeenCalled();
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('Could not save');
  });

  it('does not discard an unsaved scene without a project or during another save', async () => {
    act(() => mount({})); await open(fixture());
    let ready: boolean | undefined;
    await act(async () => { ready = await mocks.prepare!(); });
    expect(ready).toBe(false); expect(mocks.export).not.toHaveBeenCalled();
    act(() => renderer!.unmount()); renderer = null;
    act(() => mount()); await open(fixture());
    const exporting = deferred<ArrayBuffer>(); mocks.export.mockReturnValueOnce(exporting.promise);
    act(() => button('Save GLB').props.onClick());
    await act(async () => { ready = await mocks.prepare!(); });
    expect(ready).toBe(false);
    await act(async () => { exporting.resolve(new ArrayBuffer(16)); });
  });

  it('transfers an unchanged workspace scene without generating another file', async () => {
    mocks.workspace.mockResolvedValueOnce(fixture('source.glb'));
    await act(async () => mount({ projectId: 'C:/project', file: 'models/source.glb' }));
    let ready: boolean | undefined;
    await act(async () => { ready = await mocks.prepare!(); });
    expect(ready).toBe(true);
    expect(mocks.export).not.toHaveBeenCalled();
    expect(mocks.targetUpdate).toHaveBeenCalledWith(expect.anything(), { ref: undefined, file: 'models/source.glb' });
  });

  it('opens the empty app, edits a sample, undoes, and saves the live engine object', async () => {
    act(() => mount());
    await act(async () => { button('Try a cube').props.onClick(); });
    const id = inspector().snapshot.selectedId!;
    command({ type: 'update', id, position: [2, 0, 0] });
    expect(inspector().snapshot.revision).toBe(1);
    expect(inspector().snapshot.nodes.find((node) => node.id === id)?.position).toEqual([2, 0, 0]);
    act(() => button('Undo').props.onClick());
    expect(inspector().snapshot.revision).toBe(2);
    expect(inspector().snapshot.nodes.find((node) => node.id === id)?.position).toEqual([0, 0, 0]);
    act(() => button('Redo').props.onClick());
    await act(async () => { button('Save GLB').props.onClick(); });
    expect(mocks.export).toHaveBeenCalledTimes(1);
    const saved = mocks.export.mock.calls[0]![0] as THREE.Object3D;
    expect(saved.userData['vibi3dId']).toBe(id);
    expect(saved.position.x).toBe(2);
    expect(mocks.write).toHaveBeenCalledWith('C:/project', 'sample-edit.glb', expect.any(Uint8Array));
  });

  it('keeps the current model when a replacement fails', async () => {
    act(() => mount()); await open(fixture());
    const sessionId = inspector().snapshot.sessionId;
    mocks.local.mockRejectedValueOnce(new Error('invalid model'));
    await act(async () => { renderer!.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [new File([''], 'bad.glb')], value: '' } }); });
    expect(inspector().snapshot.sessionId).toBe(sessionId);
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toBe('invalid model');
    expect(mocks.dispose).not.toHaveBeenCalled();
  });

  it('names the textures a model opened without, until another model replaces it', async () => {
    act(() => mount());
    await open({ ...fixture('scene.fbx'), missingTextures: ['a.png', 'b.png', 'c.tga', 'd.psd'] });
    const all = 'a.png\nb.png\nc.tga\nd.psd';
    expect(renderer!.root.findByProps({ title: all }).children.join('')).toBe('panel.vibi3d.missingTextures');
    await open(fixture('next.glb'));
    expect(renderer!.root.findAllByProps({ title: all })).toHaveLength(0);
  });

  it('disposes a load finishing after unmount without installing it', async () => {
    const pending = deferred<LoadedModel>(); mocks.workspace.mockReturnValueOnce(pending.promise);
    act(() => mount({ projectId: 'C:/project', file: 'pending.glb' }));
    act(() => renderer!.unmount()); renderer = null;
    const loaded = fixture();
    await act(async () => { pending.resolve(loaded); });
    expect(mocks.dispose).toHaveBeenCalledWith(loaded.object);
  });

  it('restores the base animation pose before an AI edit and keeps undo independent of playback', async () => {
    act(() => mount()); const model = fixture('animated.glb', true); await open(model);
    const cube = model.object.children[0]!; const cubeId = cube.userData['vibi3dId'] as string;
    act(() => { renderer!.root.findByProps({ 'aria-label': 'Animation time' }).props.onChange({ target: { value: '0.5' } }); });
    expect(cube.position.x).toBe(5);
    expect(inspector().disabled).toBe(true);
    await act(async () => { await mocks.bridge!.execute({ commandId: 'edit', expectedRevision: 0, commands: [{ type: 'update', id: cubeId, position: [3, 0, 0] }] }); });
    expect(cube.position.x).toBe(3);
    expect(inspector().disabled).toBe(false);
    command({ type: 'undo' });
    expect(cube.position.x).toBe(0);
    command({ type: 'redo' });
    act(() => { renderer!.root.findByProps({ 'aria-label': 'Animation time' }).props.onChange({ target: { value: '0.8' } }); });
    expect(cube.position.x).toBe(8);
    await act(async () => { button('Save GLB').props.onClick(); });
    expect(cube.position.x).toBe(3);
    expect(mocks.export).toHaveBeenCalledWith(model.object, model.clips);
  });

  it('commits one gizmo drag as one undo step using XYZ angles for imported Euler orders', async () => {
    act(() => mount()); const model = fixture(); model.object.rotation.set(0.1, 0.2, 0.3, 'ZYX'); await open(model);
    const original = model.object.quaternion.clone();
    const transform = mocks.transform as { dispatchEvent: (event: { type: string }) => void };
    act(() => { transform.dispatchEvent({ type: 'mouseDown' }); });
    model.object.position.x = 4; model.object.rotation.y += 0.4;
    const rotated = model.object.quaternion.clone();
    act(() => { transform.dispatchEvent({ type: 'mouseUp' }); });
    expect(inspector().snapshot.revision).toBe(1);
    expect(model.object.position.x).toBe(4);
    expect(Math.abs(model.object.quaternion.dot(rotated))).toBeCloseTo(1);
    command({ type: 'undo' });
    expect(model.object.position.x).toBe(0);
    expect(Math.abs(model.object.quaternion.dot(original))).toBeCloseTo(1);
  });

  it('loads the latest route when its path changes during an earlier pending load', async () => {
    const old = deferred<LoadedModel>(); const latest = deferred<LoadedModel>();
    mocks.workspace.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    act(() => mount({ projectId: 'C:/project', file: 'old.glb' }));
    act(() => renderer!.update(createElement(Vibi3DShell, { appId: 'vibi3d', params: { projectId: 'C:/project', file: 'latest.glb' } })));
    expect(mocks.workspace).toHaveBeenCalledWith('C:/project', 'latest.glb');
    const oldModel = fixture('old.glb');
    await act(async () => { old.resolve(oldModel); latest.resolve(fixture('latest.glb')); });
    expect(inspector().snapshot.fileName).toBe('latest.glb');
    expect(mocks.dispose).toHaveBeenCalledWith(oldModel.object);
  });

  it('returns to the usable empty view when a pending route file is cleared', async () => {
    const pending = deferred<LoadedModel>(); mocks.workspace.mockReturnValueOnce(pending.promise);
    act(() => mount({ projectId: 'C:/project', file: 'pending.glb' }));
    act(() => renderer!.update(createElement(Vibi3DShell, { appId: 'vibi3d', params: { projectId: 'C:/project' } })));
    expect(button('Try a cube')).toBeDefined();
    const stale = fixture(); await act(async () => { pending.resolve(stale); });
    expect(mocks.dispose).toHaveBeenCalledWith(stale.object);
    await act(async () => { button('Try a cube').props.onClick(); });
    expect(inspector().snapshot.fileName).toBe('sample.glb');
  });

  it('captures a stable camera and pauses animation without resetting its inspected pose', async () => {
    const drawImage = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL: () => 'data:image/jpeg;base64,frame' }) });
    act(() => mount()); const model = fixture('animated.glb', true); await open(model);
    act(() => button('panel.vibi3d.spin').props.onClick());
    act(() => button('Play').props.onClick());
    act(() => mocks.tick!(performance.now() + 100));
    const pose = model.object.children[0]!.position.x;
    expect(pose).toBeGreaterThan(0);
    const before = mocks.bridge!.getSnapshot()!;
    expect(before.playback?.playing).toBe(true);
    let image: string | undefined;
    await act(async () => { image = await mocks.bridge!.capture(); });
    const after = mocks.bridge!.getSnapshot()!;
    expect(image).toBe('data:image/jpeg;base64,frame');
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(after.playback).toEqual({ ...before.playback, playing: false });
    expect(after.camera).toEqual(before.camera);
    expect(model.object.children[0]!.position.x).toBe(pose);
    expect((mocks.controls as { autoRotate: boolean }).autoRotate).toBe(false);
    act(() => mocks.tick!(performance.now() + 200));
    expect(model.object.children[0]!.position.x).toBe(pose);
  });
});

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Vibi3DCommand, Vibi3DDraft, Vibi3DDraftSaveInput, Vibi3DDraftWriteResult } from '@vibisual/shared';
import type { LoadedModel } from './modelIO.js';
import type { Vibi3DBridgeOptions } from './useVibi3DBridge.js';
import { Vibi3DShell } from './Vibi3DShell.js';
import { Vibi3DInspector } from './Vibi3DInspector.js';
import { WindowControls } from '../Layout/WindowControls.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';
import { Vibi3DImageSources } from './Vibi3DImageSources.js';
import { confirmAppWindowClose, DETACHED_APP_WINDOW } from '../../apps/appWindowCloseGuard.js';
import { requestAppWindowClose } from '../../apps/appWindowCloseRetention.js';
import { useAppWindowsStore } from '../../apps/appWindows.js';
import { getAppDialog } from '../../utils/appDialog.js';
import { flushAllDurable, releaseDurableFlushes } from '../../utils/persistFlush.js';
import { ModelDraftApiError } from './modelDraftApi.js';

const mocks = vi.hoisted(() => ({
  local: vi.fn(), workspace: vi.fn(), export: vi.fn(), dispose: vi.fn(), write: vi.fn(),
  bridge: null as Vibi3DBridgeOptions | null,
  transform: null as unknown,
  controls: null as unknown,
  tick: null as ((time: number) => void) | null,
  target: vi.fn(), targetUpdate: vi.fn(), prepare: null as (() => Promise<boolean>) | null,
  renderTexture: vi.fn(),
  renderScene: vi.fn(), rendererSize: vi.fn(),
  readDraft: vi.fn(), saveDraft: vi.fn(), listDrafts: vi.fn(), discardDraft: vi.fn(),
  releaseTransfer: null as (() => void) | null,
}));
const draftStore = new Map<string, { version: number; draft: Vibi3DDraft | null }>();
const draftIdentity = (projectId: string, key: string, actor: string): string => JSON.stringify([projectId, key, actor]);
function persistDraft(projectId: string, input: Vibi3DDraftSaveInput): Vibi3DDraftWriteResult {
  if (input.key.startsWith('doc:') && input.key !== `doc:${input.documentId}`) throw new Error('draft-document-mismatch');
  const identity = draftIdentity(projectId, input.key, input.actor);
  const previous = draftStore.get(identity);
  if ((previous?.version ?? 0) !== input.expectedVersion) throw new ModelDraftApiError('draft-version-conflict', 409, { version: previous?.version ?? 0 });
  const version = input.expectedVersion + 1;
  const draft: Vibi3DDraft = { key: input.key, actor: input.actor, version, fileName: input.fileName,
    payload: structuredClone(input.payload), links: structuredClone(input.links ?? []),
    ...(input.documentId ? { documentId: input.documentId, baseRevision: input.baseRevision } : {}),
    createdAt: previous?.draft?.createdAt ?? 1, updatedAt: version };
  draftStore.set(identity, { version, draft });
  return { version, draft, savedVersion: version, replayed: false };
}
vi.mock('./modelDraftApi.js', async original => ({ ...await original<typeof import('./modelDraftApi.js')>(),
  readModelDraft: mocks.readDraft, saveModelDraft: mocks.saveDraft, listModelDrafts: mocks.listDrafts,
  discardModelDraft: mocks.discardDraft,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }));
vi.mock('../Layout/WindowControls.js', () => ({ WindowControls: () => null }));
vi.mock('../../apps/appWindowLifecycle.js', () => ({
  useAppWindowTarget: mocks.target,
  updateAppWindowTarget: mocks.targetUpdate,
  useAppWindowTransferGuard: (_params: unknown, prepare: () => Promise<boolean>, release?: () => void) => { mocks.prepare = prepare; mocks.releaseTransfer = release ?? null; },
}));
vi.mock('./Vibi3DAgentPanel.js', () => ({ Vibi3DAgentPanel: () => null }));
vi.mock('./modelImageLink.js', async (original) => ({ ...await original<typeof import('./modelImageLink.js')>(), renderTextureSource: mocks.renderTexture }));
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
    setPixelRatio = vi.fn(); setSize = mocks.rendererSize; render = mocks.renderScene; dispose = vi.fn();
  } };
});
vi.mock('three/examples/jsm/controls/OrbitControls.js', async () => {
  const { Vector3 } = await import('three');
  return { OrbitControls: class {
    target = new Vector3(); enabled = true; update = vi.fn(); dispose = vi.fn(); camera: unknown;
    constructor(camera: unknown) { mocks.controls = this; this.camera = camera; }
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
      ? { clientWidth: 800, clientHeight: 600, appendChild: vi.fn() } : { click: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
}
function button(text: string) {
  const alias: Record<string, string> = { 'Save source': 'panel.vibi3d.drafts.applyHuman', 'Save GLB': 'panel.vibi3d.drafts.exportGlb' };
  return renderer!.root.findAllByType('button').find((node) => [text, alias[text]].includes(node.children.join('')))!;
}
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
  draftStore.clear();
  mocks.readDraft.mockReset().mockImplementation(async ({ projectId, key, actor }) => draftStore.get(draftIdentity(projectId, key, actor)) ?? { draft: null, version: 0 });
  mocks.saveDraft.mockReset().mockImplementation(async (projectId: string, input: Vibi3DDraftSaveInput) => persistDraft(projectId, input));
  mocks.listDrafts.mockReset().mockImplementation(async (projectId: string) => ({ drafts: [...draftStore.entries()]
    .filter(([key, value]) => (JSON.parse(key) as string[])[0] === projectId && value.draft).map(([, value]) => value.draft!), failed: [] }));
  mocks.discardDraft.mockReset().mockImplementation(async (projectId: string, input: Vibi3DDraftSaveInput) => {
    const version = input.expectedVersion + 1;
    draftStore.set(draftIdentity(projectId, input.key, input.actor), { draft: null, version });
    return { draft: null, version, savedVersion: version, replayed: false };
  });
  mocks.local.mockReset(); mocks.workspace.mockReset(); mocks.export.mockResolvedValue(new ArrayBuffer(16));
  mocks.write.mockResolvedValue({ ok: true, path: 'saved.glb' });
  mocks.targetUpdate.mockResolvedValue(undefined);
  vi.stubGlobal('window', { devicePixelRatio: 1, setTimeout, setInterval, clearInterval });
  vi.stubGlobal('requestAnimationFrame', (fn: (time: number) => void) => { mocks.tick = fn; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = vi.fn(); });
});
afterEach(async () => {
  if (renderer) { await act(async () => { await flushAllDurable(); releaseDurableFlushes(); }); act(() => renderer!.unmount()); }
  useAppWindowsStore.setState({ windows: [], outside: [] }); vi.unstubAllGlobals();
});

describe('Vibi3D shell edit flow', () => {
  it('rejects simultaneous AI edits while explicitly applying the draft to its source', async () => {
    const model = fixture(); const doc = { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Product', revision: 3,
      payload: serializeModelSource(model.object, model.clips), links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
    const committed = deferred<Response>();
    const request = vi.fn(async (url: string, options?: RequestInit) => options?.method === 'POST' ? committed.promise
      : new Response(JSON.stringify(url.includes('/impact') ? { impacts: [] } : url.includes('/outputs') ? { outputs: [] }
        : url.includes('/candidates') ? { candidates: [] } : url.includes('/runs?') ? { run: null } : { doc })));
    vi.stubGlobal('fetch', request);
    await act(async () => mount({ projectId: 'project', modelId: 'product' }));
    const id = mocks.bridge!.getSnapshot()!.nodes.find(node => node.name === 'Cube')!.id;
    await act(async () => { await mocks.bridge!.execute({ commandId: 'prepared-agent', expectedRevision: 0,
      commands: [{ type: 'update', id, position: [8, 0, 0] }] }); });
    const editedRevision = mocks.bridge!.getSnapshot()!.revision;
    act(() => button('panel.vibi3d.drafts.viewAgent').props.onClick());
    await act(async () => { button('panel.vibi3d.drafts.applyAgent').props.onClick(); });
    await act(async () => { await vi.waitFor(() => expect(request.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true)); });
    await act(async () => { await expect(mocks.bridge!.execute({ commandId: 'racing-edit', expectedRevision: editedRevision,
      commands: [{ type: 'update', id, position: [99, 0, 0] }] })).rejects.toThrow('model-busy'); });
    const submitted = JSON.parse(String(request.mock.calls.find(([, options]) => options?.method === 'POST')![1]!.body));
    await act(async () => { committed.resolve(new Response(JSON.stringify({ doc: { ...doc, revision: 4, payload: submitted.payload } }))); });
    await act(async () => { await vi.waitFor(() => expect(mocks.bridge!.getSnapshot()?.document).toMatchObject({ revision: 4, dirty: false })); });
    expect(mocks.bridge!.getSnapshot()!.nodes.find(node => node.id === id)?.position).toEqual([8, 0, 0]);
  });

  it('adopts a newer clean source head instead of reopening an older saved baseline draft', async () => {
    const model = fixture();
    let doc = { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Product', revision: 3,
      payload: serializeModelSource(model.object, model.clips), links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
    const visibility = new EventTarget();
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: visibility.addEventListener.bind(visibility),
      removeEventListener: visibility.removeEventListener.bind(visibility) });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/head')
      ? { head: { id: doc.id, appId: 'vibi3d', revision: doc.revision, updatedAt: doc.updatedAt, candidateStamp: 0, pendingCandidates: 0 } }
      : url.includes('/impact') ? { impacts: [] } : url.includes('/outputs') ? { outputs: [] }
        : url.includes('/candidates') ? { candidates: [] } : url.includes('/runs?') ? { run: null } : { doc }))));
    await act(async () => mount({ projectId: 'project', modelId: 'product' }));
    await act(async () => { expect(await confirmAppWindowClose(DETACHED_APP_WINDOW)).toBe(true); });
    expect([...draftStore.values()].filter(value => value.draft?.baseRevision === 3)).toHaveLength(2);
    model.object.getObjectByName('Cube')!.position.x = 7;
    doc = { ...doc, revision: 4, updatedAt: 2, payload: serializeModelSource(model.object, model.clips) };
    await act(async () => { visibility.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.waitFor(() => expect(mocks.bridge!.getSnapshot()?.document?.revision).toBe(4)); });
    expect(inspector().snapshot.nodes.find(node => node.name === 'Cube')?.position).toEqual([7, 0, 0]);
    expect(mocks.bridge!.getSnapshot()!.nodes.find(node => node.name === 'Cube')?.position).toEqual([7, 0, 0]);
    await act(async () => { expect(await confirmAppWindowClose(DETACHED_APP_WINDOW)).toBe(true); });
    const saved = [...draftStore.values()].filter(value => value.draft?.key === 'doc:product');
    expect(saved.every(value => value.draft?.baseRevision === 4)).toBe(true);
  });

  it('keeps the remote head and local edits when conflict backup fails, then retries the same backup identity', async () => {
    act(() => mount()); await open(fixture());
    await act(async () => { await confirmAppWindowClose(DETACHED_APP_WINDOW); });
    const old = [...draftStore.values()].find(value => value.draft?.actor === 'human')!.draft!;
    const remote = await loadModelSource(old.payload);
    remote.object.position.x = 9;
    draftStore.set(draftIdentity('C:/project', old.key, 'human'), { version: old.version + 1,
      draft: { ...old, version: old.version + 1, payload: serializeModelSource(remote.object, remote.clips) as unknown as Vibi3DDraft['payload'] } });
    command({ type: 'update', id: inspector().snapshot.selectedId!, position: [2, 0, 0] });
    await act(async () => { expect(await confirmAppWindowClose(DETACHED_APP_WINDOW)).toBe(false); });
    let failBackup = true;
    mocks.saveDraft.mockImplementation(async (projectId: string, input: Vibi3DDraftSaveInput) => {
      if (input.key !== old.key && input.actor === 'human' && failBackup) throw new Error('backup disk full');
      return persistDraft(projectId, input);
    });
    const before = mocks.targetUpdate.mock.calls.length;
    await act(async () => { button('panel.vibi3d.drafts.retry').props.onClick(); });
    const backup = mocks.saveDraft.mock.calls.find(([, input]) => input.key !== old.key && input.actor === 'human')![1] as Vibi3DDraftSaveInput;
    expect(backup.key).toMatch(/^local:/);
    expect(mocks.targetUpdate.mock.calls).toHaveLength(before);
    expect(inspector().snapshot.nodes.find(node => node.id === inspector().snapshot.selectedId)?.position).toEqual([2, 0, 0]);
    failBackup = false;
    await act(async () => { button('panel.vibi3d.drafts.retry').props.onClick(); });
    await act(async () => { await vi.waitFor(() => expect(mocks.targetUpdate).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ draftKey: backup.key }))); });
    const attempts = mocks.saveDraft.mock.calls.map(([, input]) => input as Vibi3DDraftSaveInput).filter(input => input.actor === 'human' && input.key !== old.key);
    expect(new Set(attempts.map(input => input.key))).toEqual(new Set([backup.key]));
    expect(attempts[1]!.requestId).toBe(attempts[0]!.requestId);
    const preserved = draftStore.get(draftIdentity('C:/project', old.key, 'human'))!.draft!;
    const recovered = draftStore.get(draftIdentity('C:/project', backup.key, 'human'))!.draft!;
    expect((await loadModelSource(preserved.payload)).object.position.x).toBe(9);
    expect((await loadModelSource(recovered.payload)).object.position.x).toBe(2);
    await act(async () => { expect(await confirmAppWindowClose(DETACHED_APP_WINDOW)).toBe(true); });
  });

  it('gives a saved copy a fresh draft identity while keeping both old actor lanes recoverable', async () => {
    const model = fixture(); const doc = { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Product', revision: 3,
      payload: serializeModelSource(model.object, model.clips), links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
      const body = options?.method === 'POST' ? JSON.parse(String(options.body)) : null;
      return new Response(JSON.stringify({ doc: body ? { ...doc, id: 'copy', revision: 1, payload: body.payload } : doc }));
    }));
    await act(async () => mount({ projectId: 'project', modelId: 'product' }));
    const id = inspector().snapshot.selectedId!;
    command({ type: 'update', id, position: [5, 0, 0] });
    await act(async () => { button('Save a copy').props.onClick(); });
    await act(async () => { await vi.waitFor(() => expect([...draftStore.values()].some(value => value.draft?.documentId === 'copy')).toBe(true)); });
    const saved = [...draftStore.values()].map(value => value.draft!);
    expect(saved.filter(value => value.key === 'doc:product').map(value => value.actor).sort()).toEqual(['agent', 'human']);
    const copied = saved.find(value => value.documentId === 'copy')!;
    expect(copied.key).toBe('doc:copy');
    expect(copied.key).not.toBe('doc:product');
    expect((await loadModelSource(copied.payload)).object.position.x).toBe(5);
    expect(saved.filter(value => value.key === 'doc:copy')).toHaveLength(2);
    expect(saved.filter(value => value.key === 'doc:copy').every(value => value.documentId === 'copy')).toBe(true);
    expect(mocks.bridge!.getSnapshot()!.document?.id).toBe('copy');
    expect(mocks.targetUpdate).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ ref: 'copy', draftKey: copied.key }));
  });

  it('preserves recovered non-texture links independently for both source-less actor lanes', async () => {
    act(() => mount()); await open(fixture());
    await act(async () => { await confirmAppWindowClose(DETACHED_APP_WINDOW); });
    const key = [...draftStore.values()][0]!.draft!.key;
    for (const value of draftStore.values()) value.draft!.links = [{ id: `${value.draft!.actor}-dependency`, sourceId: 'asset',
      sourceRevision: 2, role: 'reference', targets: [] }];
    act(() => renderer!.unmount()); renderer = null;
    await act(async () => mount({ projectId: 'C:/project', draftKey: key }));
    const id = inspector().snapshot.nodes.find(node => node.name === 'Cube')!.id;
    command({ type: 'update', id, position: [2, 0, 0] });
    await act(async () => { await mocks.bridge!.execute({ commandId: 'linked-agent', expectedRevision: 0,
      commands: [{ type: 'update', id, position: [8, 0, 0] }] }); await confirmAppWindowClose(DETACHED_APP_WINDOW); });
    for (const actor of ['human', 'agent']) {
      const saved = draftStore.get(draftIdentity('C:/project', key, actor))!.draft!;
      expect(saved.links).toEqual([{ id: `${actor}-dependency`, sourceId: 'asset', sourceRevision: 2, role: 'reference', targets: [] }]);
    }
  });

  it('does not apply a texture that finishes decoding after the shutdown snapshot was saved', async () => {
    const decoded = deferred<void>();
    vi.stubGlobal('Image', class { src = ''; decode = () => decoded.promise; });
    act(() => mount()); const model = fixture(); await open(model);
    const cube = model.object.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    command({ type: 'select', id: cube.userData['vibi3dId'] as string });
    act(() => inspector().onTexture!(new File(['image'], 'texture.png')));
    await act(async () => { expect(await flushAllDurable()).toBe(true); });
    await act(async () => { decoded.resolve(); });
    expect(cube.material.map).toBeNull();
    expect(inspector().snapshot.revision).toBe(0);
    act(() => releaseDurableFlushes());
  });

  it('rejects shutdown immediately during a live drag so the user can finish it', async () => {
    act(() => mount()); await open(fixture());
    const transform = mocks.transform as { dispatchEvent: (event: { type: string }) => void };
    act(() => transform.dispatchEvent({ type: 'mouseDown' }));
    await act(async () => { expect(await flushAllDurable()).toBe(false); });
    act(() => transform.dispatchEvent({ type: 'mouseUp' }));
    command({ type: 'update', id: inspector().snapshot.selectedId!, position: [2, 0, 0] });
    expect(inspector().snapshot.nodes.find(node => node.id === inspector().snapshot.selectedId)?.position).toEqual([2, 0, 0]);
  });

  it('applies the AI draft only on explicit request while preserving independently edited human work', async () => {
    const model = fixture(); const doc = { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Product', revision: 3,
      payload: serializeModelSource(model.object, model.clips), links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
    const request = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        const input = JSON.parse(String(options.body));
        return new Response(JSON.stringify({ doc: { ...doc, revision: 4, payload: input.payload } }));
      }
      return new Response(JSON.stringify(url.includes('/impact') ? { impacts: [] } : url.includes('/outputs') ? { outputs: [] }
        : url.includes('/candidates') ? { candidates: [] } : url.includes('/runs?') ? { run: null } : { doc }));
    });
    vi.stubGlobal('fetch', request);
    await act(async () => mount({ projectId: 'project', modelId: 'product' }));
    const id = inspector().snapshot.nodes.find(node => node.name === 'Cube')!.id;
    command({ type: 'update', id, position: [2, 0, 0] });
    await act(async () => { await mocks.bridge!.execute({ commandId: 'independent-agent', expectedRevision: 0,
      commands: [{ type: 'update', id, position: [8, 0, 0] }] }); });
    expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
    expect(mocks.export).not.toHaveBeenCalled();
    act(() => button('panel.vibi3d.drafts.viewAgent').props.onClick());
    await act(async () => { button('panel.vibi3d.drafts.applyAgent').props.onClick(); });
    await act(async () => { await vi.waitFor(() => expect(mocks.bridge!.getSnapshot()!.document?.revision).toBe(4)); });
    const commit = request.mock.calls.find(([, options]) => options?.method === 'POST')!;
    const submitted = JSON.parse(String(commit[1]!.body));
    expect(submitted.baseRevision).toBe(3);
    expect((await loadModelSource(submitted.payload)).object.getObjectByName('Cube')!.position.x).toBe(8);
    act(() => button('panel.vibi3d.drafts.viewHuman').props.onClick());
    expect(inspector().snapshot.nodes.find(node => node.id === id)?.position).toEqual([2, 0, 0]);
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it('acknowledges an agent edit only after its draft is durably saved', async () => {
    act(() => mount()); await open(fixture());
    const before = mocks.bridge!.getSnapshot()!;
    const id = before.nodes.find(node => node.name === 'Cube')!.id;
    const pending = deferred<Vibi3DDraftWriteResult>();
    mocks.saveDraft.mockImplementation((projectId: string, input: Vibi3DDraftSaveInput) => input.actor === 'agent'
      ? pending.promise : Promise.resolve(persistDraft(projectId, input)));
    let acknowledged = false; let running!: Promise<unknown>;
    await act(async () => {
      running = Promise.resolve(mocks.bridge!.execute({ commandId: 'durable-edit', expectedRevision: before.revision,
        commands: [{ type: 'update', id, position: [6, 0, 0] }] })).then(value => { acknowledged = true; return value; });
      await vi.waitFor(() => expect(mocks.saveDraft.mock.calls.some(([, input]) => input.actor === 'agent')).toBe(true));
    });
    expect(acknowledged).toBe(false);
    const call = mocks.saveDraft.mock.calls.find(([, input]) => input.actor === 'agent')!;
    expect(call).toBeDefined();
    await act(async () => { pending.resolve(persistDraft(call[0], call[1])); await running; });
    expect(acknowledged).toBe(true);
    expect(mocks.bridge!.getSnapshot()!.nodes.find(node => node.id === id)?.position).toEqual([6, 0, 0]);
    expect(inspector().snapshot.nodes.find(node => node.id === id)?.position).toEqual([0, 0, 0]);
  });

  it('rejects an agent acknowledgment on save failure while retaining the edited draft', async () => {
    act(() => mount()); await open(fixture());
    const before = mocks.bridge!.getSnapshot()!;
    const id = before.nodes.find(node => node.name === 'Cube')!.id;
    mocks.saveDraft.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => {
      await expect(mocks.bridge!.execute({ commandId: 'failed-save', expectedRevision: before.revision,
        commands: [{ type: 'update', id, position: [6, 0, 0] }] })).rejects.toThrow('disk full');
    });
    expect(mocks.bridge!.getSnapshot()!.nodes.find(node => node.id === id)?.position).toEqual([6, 0, 0]);
    expect(inspector().snapshot.nodes.find(node => node.id === id)?.position).toEqual([0, 0, 0]);
  });

  it('reopens source-less human and AI drafts from their stable key after remounting', async () => {
    act(() => mount()); await open(fixture());
    const id = mocks.bridge!.getSnapshot()!.nodes.find(node => node.name === 'Cube')!.id;
    command({ type: 'update', id, position: [2, 0, 0] });
    await act(async () => { await mocks.bridge!.execute({ commandId: 'agent-draft', expectedRevision: 0,
      commands: [{ type: 'update', id, position: [8, 0, 0] }] }); });
    await act(async () => { expect(await confirmAppWindowClose(DETACHED_APP_WINDOW)).toBe(true); });
    const draftKey = [...draftStore.values()][0]!.draft!.key;
    expect(draftKey).toMatch(/^local:/);
    act(() => renderer!.unmount()); renderer = null;
    await act(async () => mount({ projectId: 'C:/project', draftKey }));
    expect(inspector().snapshot.nodes.find(node => node.id === id)?.position).toEqual([2, 0, 0]);
    expect(mocks.bridge!.getSnapshot()!.nodes.find(node => node.id === id)?.position).toEqual([8, 0, 0]);
    expect(mocks.local).toHaveBeenCalledTimes(1);
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it('quiesces new edits during durable shutdown and resumes editing when shutdown is canceled', async () => {
    act(() => mount()); await open(fixture());
    const id = inspector().snapshot.selectedId!;
    command({ type: 'update', id, position: [2, 0, 0] });
    const pending = deferred<Vibi3DDraftWriteResult>();
    mocks.saveDraft.mockReturnValueOnce(pending.promise);
    let flushing!: Promise<boolean>;
    await act(async () => { flushing = flushAllDurable(); });
    command({ type: 'update', id, position: [9, 0, 0] });
    expect(inspector().snapshot.nodes.find(node => node.id === id)?.position).toEqual([2, 0, 0]);
    const call = mocks.saveDraft.mock.calls[0]!;
    await act(async () => { pending.resolve(persistDraft(call[0], call[1])); await flushing; });
    expect(await flushing).toBe(true);
    act(() => releaseDurableFlushes());
    command({ type: 'update', id, position: [3, 0, 0] });
    expect(inspector().snapshot.nodes.find(node => node.id === id)?.position).toEqual([3, 0, 0]);
  });

  it('keeps live work dirty when a checkpoint replay returns a newer human revision', async () => {
    const model = fixture(); const doc = { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Product', revision: 3,
      payload: serializeModelSource(model.object, model.clips), links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/impact') ? { impacts: [] }
      : url.includes('/outputs') ? { outputs: [] } : url.includes('/candidates') ? { candidates: [] } : url.includes('/docs?') ? { docs: [] }
        : url.includes('/runs?') ? { run: null } : { doc }))));
    await act(async () => { mount({ projectId: 'project', modelId: 'product' }); });
    const before = mocks.bridge!.getSnapshot()!;
    const node = before.nodes.find((item) => item.name === 'Cube')!;
    await act(async () => { await mocks.bridge!.execute({ commandId: 'edit', expectedRevision: before.revision,
      commands: [{ type: 'update', id: node.id, position: [8, 0, 0] }] }); });
    const edited = mocks.bridge!.getSnapshot()!;
    const replay = { doc: { ...doc, revision: 5 }, stage: { id: 'blockout', mode: 'commit', revision: 4 } };
    await act(async () => { await expect(mocks.bridge!.execute({ commandId: 'checkpoint', expectedRevision: edited.revision,
      commands: [{ type: 'checkpoint', stage: 'blockout', label: 'Blockout' }] }, { post: async <T,>() => replay as T })).rejects.toThrow('source-changed-elsewhere'); });
    expect(mocks.bridge!.getSnapshot()!.document).toMatchObject({ revision: 3, dirty: true });
    expect(mocks.bridge!.getSnapshot()!.nodes.find((item) => item.id === node.id)?.position).toEqual([8, 0, 0]);
  });
  it('resumes a saved stage in the same session without committing it or accepting a candidate', async () => {
    const model = fixture(); const doc = { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Product', revision: 3,
      payload: serializeModelSource(model.object, model.clips), links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/impact') ? { impacts: [] }
      : url.includes('/outputs') ? { outputs: [] } : url.includes('/candidates') ? { candidates: [] } : url.includes('/docs?') ? { docs: [] }
        : url.includes('/runs?') ? { run: null } : { doc }))));
    await act(async () => { mount({ projectId: 'project', modelId: 'product' }); });
    const before = mocks.bridge!.getSnapshot()!;
    const node = before.nodes.find((item) => item.name === 'Cube')!;
    await act(async () => { await mocks.bridge!.execute({ commandId: 'edit', expectedRevision: before.revision,
      commands: [{ type: 'update', id: node.id, position: [8, 0, 0] }] }); });
    const edited = mocks.bridge!.getSnapshot()!;
    expect(edited.document).toMatchObject({ dirty: true, humanDirty: false });
    model.object.children[0]!.position.x = 4;
    const restored = { payload: serializeModelSource(model.object, model.clips), stage: { id: 'blockout', mode: 'intermediate' } };
    const post = vi.fn(async (_suffix: string, _body: Record<string, unknown>) => restored);
    await act(async () => { await mocks.bridge!.execute({ commandId: 'resume', expectedRevision: edited.revision,
      commands: [{ type: 'resume', runId: 'previous', stage: 'blockout' }] }, { post: <T,>(...args: [string, Record<string, unknown>]) => post(...args) as Promise<T> }); });
    const after = mocks.bridge!.getSnapshot()!;
    expect(post).toHaveBeenCalledWith('resume', expect.objectContaining({ commandId: 'resume', snapshot: edited }));
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.revision).toBeGreaterThan(edited.revision);
    expect(after.nodes.find((item) => item.name === 'Cube')?.position).toEqual([4, 0, 0]);
    expect(after.document).toMatchObject({ revision: 3, dirty: true, humanDirty: false });
  });
  it('stores a candidate and keeps the independent AI result ready for review', async () => {
    const model = fixture(); const doc = { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Product', revision: 3,
      payload: serializeModelSource(model.object, model.clips), links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/impact') ? { impacts: [] }
      : url.includes('/outputs') ? { outputs: [] } : url.includes('/candidates') ? { candidates: [] } : url.includes('/docs?') ? { docs: [] }
        : url.includes('/runs?') ? { run: null } : { doc }))));
    await act(async () => { mount({ projectId: 'project', modelId: 'product' }); });
    const before = mocks.bridge!.getSnapshot()!;
    const node = before.nodes.find((item) => item.name === 'Cube')!;
    await act(async () => { await mocks.bridge!.execute({ commandId: 'edit', expectedRevision: before.revision,
      commands: [{ type: 'update', id: node.id, position: [8, 0, 0] }] }); });
    const edited = mocks.bridge!.getSnapshot()!;
    const stored = { stage: { id: 'final', mode: 'candidate', label: 'Candidate' } };
    await act(async () => { await mocks.bridge!.execute({ commandId: 'proposal', expectedRevision: edited.revision,
      commands: [{ type: 'propose', label: 'Candidate' }] }, { post: async <T,>() => stored as T }); });
    const after = mocks.bridge!.getSnapshot()!;
    expect(after.sessionId).toBe(before.sessionId); expect(after.revision).toBe(edited.revision);
    expect(after.nodes.find((item) => item.id === node.id)?.position).toEqual([8, 0, 0]);
    expect(after.document).toMatchObject({ id: 'product', revision: 3, dirty: true });
    expect(renderer!.root.findByType(Vibi3DImageSources).props.disabled).toBe(false);
  });

  it.each<Vibi3DCommand>([{ type: 'checkpoint', stage: 'blockout', label: 'Blockout' }, { type: 'resume', runId: 'previous' }])('preserves human edits while the independent agent performs $type', async (workflow) => {
    const model = fixture(); const doc = { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Product', revision: 3,
      payload: serializeModelSource(model.object, model.clips), links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ doc }))));
    await act(async () => mount({ projectId: 'project', modelId: 'product' }));
    const node = inspector().snapshot.nodes.find((item) => item.name === 'Cube')!;
    command({ type: 'update', id: node.id, position: [5, 0, 0] });
    const post = vi.fn(async () => ({ payload: doc.payload, stage: { id: 'stage', mode: 'intermediate', revision: 3 } }));
    await act(async () => { await mocks.bridge!.execute({ commandId: 'checkpoint', expectedRevision: mocks.bridge!.getSnapshot()!.revision,
      commands: [workflow] }, { post: <T,>() => post() as Promise<T> }); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(inspector().snapshot.nodes.find((item) => item.id === node.id)?.position).toEqual([5, 0, 0]);
    expect(mocks.bridge!.getSnapshot()!.nodes.find((item) => item.id === node.id)?.position).toEqual([0, 0, 0]);
  });

  it.each([DETACHED_APP_WINDOW, 'hosted-3d'])('flushes human edits before closing %s without a discard dialog', async (windowId) => {
    act(() => mount({ projectId: 'C:/project', ...(windowId === DETACHED_APP_WINDOW ? {} : { appWindowId: windowId }) }));
    await open(fixture());
    const cube = inspector().snapshot.nodes.find((node) => node.name === 'Cube')!;
    command({ type: 'update', id: cube.id, position: [2, 0, 0] });
    let closed = false;
    await act(async () => { closed = await confirmAppWindowClose(windowId); });
    expect(closed).toBe(true); expect(getAppDialog()).toBeNull();
    expect(inspector().snapshot.nodes.find(node => node.id === cube.id)?.position).toEqual([2, 0, 0]);
    const human = [...draftStore.values()].find(value => value.draft?.actor === 'human')!.draft!;
    const loaded = await loadModelSource(human.payload);
    expect(loaded.object.getObjectByName('Cube')!.position.x).toBe(2);
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it('closes an agent-only view without a discard dialog or saving, and keeps its live editor usable', async () => {
    const windowId = 'hosted-agent';
    const args = { appId: 'vibi3d', projectId: 'C:/project' };
    useAppWindowsStore.setState({ windows: [{ ...args, id: windowId, focusAt: 1 }] });
    act(() => mount({ ...args, appWindowId: windowId })); await open(fixture());
    const before = mocks.bridge!.getSnapshot()!;
    const cube = before.nodes.find(node => node.name === 'Cube')!;
    await act(async () => { await mocks.bridge!.execute({ commandId: 'agent-edit', expectedRevision: before.revision,
      commands: [{ type: 'update', id: cube.id, position: [8, 0, 0] }] }); });
    const destroy = vi.fn(() => useAppWindowsStore.getState().close(windowId));
    await expect(requestAppWindowClose(windowId, destroy)).resolves.toBe(true);
    expect(destroy).not.toHaveBeenCalled();
    expect(useAppWindowsStore.getState().windows).toEqual([expect.objectContaining({ id: windowId, background: true })]);
    expect(getAppDialog()).toBeNull();
    expect(mocks.export).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.dispose).not.toHaveBeenCalled();
    expect(button('Undo').props.disabled).toBe(true);
    await act(async () => { await mocks.bridge!.execute({ commandId: 'agent-continue', expectedRevision: mocks.bridge!.getSnapshot()!.revision,
      commands: [{ type: 'update', id: cube.id, position: [9, 0, 0] }] }); });
    expect(mocks.bridge!.getSnapshot()!.sessionId).toBe(before.sessionId);
    expect(mocks.bridge!.getSnapshot()!.nodes.find(node => node.id === cube.id)?.position).toEqual([9, 0, 0]);
    useAppWindowsStore.getState().open(args);
    expect(useAppWindowsStore.getState().windows).toEqual([expect.objectContaining({ id: windowId, background: false })]);
    expect(mocks.bridge!.getSnapshot()!.sessionId).toBe(before.sessionId);
    expect(mocks.local).toHaveBeenCalledTimes(1);
  });

  it('stores human and agent edits separately and keeps both after closing', async () => {
    act(() => mount()); await open(fixture());
    const before = mocks.bridge!.getSnapshot()!;
    const cube = before.nodes.find(node => node.name === 'Cube')!;
    await act(async () => { await mocks.bridge!.execute({ commandId: 'agent-edit', expectedRevision: before.revision,
      commands: [{ type: 'update', id: cube.id, position: [8, 0, 0] }] }); });
    command({ type: 'update', id: cube.id, position: [2, 0, 0] });
    await act(async () => { expect(await confirmAppWindowClose(DETACHED_APP_WINDOW)).toBe(true); });
    expect(getAppDialog()).toBeNull();
    const entries = [...draftStore.values()].map(value => value.draft!);
    const human = await loadModelSource(entries.find(value => value.actor === 'human')!.payload);
    const agent = await loadModelSource(entries.find(value => value.actor === 'agent')!.payload);
    expect(human.object.getObjectByName('Cube')!.position.x).toBe(2);
    expect(agent.object.getObjectByName('Cube')!.position.x).toBe(8);
    expect(mocks.bridge!.getSnapshot()!.sessionId).toBe(before.sessionId);
    await act(async () => { await mocks.bridge!.execute({ commandId: 'agent-undo', expectedRevision: mocks.bridge!.getSnapshot()!.revision, commands: [{ type: 'undo' }] }); });
    expect(inspector().snapshot.nodes.find(node => node.id === cube.id)?.position).toEqual([2, 0, 0]);
    expect(mocks.bridge!.getSnapshot()!.nodes.find(node => node.id === cube.id)?.position).toEqual([0, 0, 0]);
  });

  it('vetoes close on a failed autosave and keeps edits available for retry', async () => {
    act(() => mount()); await open(fixture());
    command({ type: 'update', id: inspector().snapshot.selectedId!, position: [2, 0, 0] });
    mocks.saveDraft.mockRejectedValueOnce(new Error('disk unavailable'));
    await act(async () => { expect(await confirmAppWindowClose(DETACHED_APP_WINDOW)).toBe(false); });
    expect(inspector().snapshot.revision).toBe(1);
    expect(getAppDialog()).toBeNull();
    expect(JSON.stringify(renderer!.toJSON())).toContain('panel.vibi3d.drafts.closeFailed');
    await act(async () => { expect(await confirmAppWindowClose(DETACHED_APP_WINDOW)).toBe(true); });
    expect(inspector().snapshot.revision).toBe(1);
  });

  it('allows hiding while an agent edit is running without cancelling that edit', async () => {
    act(() => mount()); await open(fixture());
    const progress = deferred<void>();
    let running!: Promise<unknown>;
    await act(async () => {
      running = mocks.bridge!.execute({ commandId: 'long-edit', expectedRevision: mocks.bridge!.getSnapshot()!.revision,
        commands: [{ type: 'update', id: inspector().snapshot.selectedId!, position: [5, 0, 0] }] },
      { post: vi.fn(), progress: () => progress.promise }) as Promise<unknown>;
    });
    expect(await confirmAppWindowClose(DETACHED_APP_WINDOW)).toBe(true);
    expect(getAppDialog()).toBeNull();
    await act(async () => { progress.resolve(); await running; });
    expect(mocks.bridge!.getSnapshot()!.nodes.find(node => node.id === inspector().snapshot.selectedId)?.position).toEqual([5, 0, 0]);
  });

  it('stops continuous rendering in a hidden window but still renders the selected AI draft', async () => {
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    act(() => mount()); await open(fixture());
    act(() => button('panel.vibi3d.drafts.viewAgent').props.onClick());
    const id = mocks.bridge!.getSnapshot()!.nodes.find(node => node.name === 'Cube')!.id;
    mocks.renderScene.mockClear();
    act(() => mocks.tick!(performance.now() + 100));
    expect(mocks.renderScene).not.toHaveBeenCalled();
    await act(async () => { await mocks.bridge!.execute({ commandId: 'hidden-edit', expectedRevision: inspector().snapshot.revision,
      commands: [{ type: 'update', id, position: [7, 0, 0] }] }); });
    expect(mocks.renderScene).toHaveBeenCalled();
    expect(mocks.bridge!.getSnapshot()!.nodes.find(node => node.id === id)?.position).toEqual([7, 0, 0]);
  });

  it('does not capture a mid-drag transform as the human baseline when a texture finishes loading', async () => {
    const decoded = deferred<void>();
    vi.stubGlobal('Image', class { src = ''; decode = () => decoded.promise; });
    act(() => mount()); const model = fixture(); await open(model);
    const cube = model.object.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    command({ type: 'select', id: cube.userData['vibi3dId'] as string });
    act(() => inspector().onTexture!(new File(['image'], 'texture.png')));
    const transform = mocks.transform as { dispatchEvent: (event: { type: string }) => void };
    act(() => transform.dispatchEvent({ type: 'mouseDown' }));
    cube.position.x = 4;
    await act(async () => { decoded.resolve(); });
    expect(cube.material.map).toBeNull();
    expect(inspector().snapshot.revision).toBe(0);
    act(() => transform.dispatchEvent({ type: 'mouseUp' }));
    const pending = confirmAppWindowClose(DETACHED_APP_WINDOW);
    await act(async () => { await pending; });
    expect(cube.position.x).toBe(4);
  });

  it('flushes newer edits made while close is waiting for a durable save', async () => {
    act(() => mount()); await open(fixture());
    const cube = inspector().snapshot.nodes.find((node) => node.name === 'Cube')!;
    command({ type: 'update', id: cube.id, position: [2, 0, 0] });
    const pending = deferred<Vibi3DDraftWriteResult>();
    let queued!: [string, Vibi3DDraftSaveInput];
    mocks.saveDraft.mockImplementationOnce((projectId, input) => { queued = [projectId, input]; return pending.promise; });
    let closed!: Promise<boolean>;
    await act(async () => { closed = confirmAppWindowClose(DETACHED_APP_WINDOW); });
    command({ type: 'update', id: cube.id, position: [3, 0, 0] });
    await act(async () => { pending.resolve(persistDraft(queued[0], queued[1])); await closed; });
    expect(await closed).toBe(true);
    const saved = [...draftStore.values()].find(value => value.draft?.actor === 'human')!.draft!;
    expect((await loadModelSource(saved.payload)).object.getObjectByName('Cube')!.position.x).toBe(3);
  });

  it('sizes CSS pixels separately from the backing buffer and paints a loaded model before any animation frame', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 2, setTimeout, setInterval, clearInterval });
    act(() => mount());
    expect(mocks.rendererSize).toHaveBeenCalledWith(800, 600, true);
    const model = fixture(); await open(model);
    expect(mocks.renderScene.mock.calls.some(([scene]) => (scene as THREE.Scene).children.includes(model.object))).toBe(true);
    expect(mocks.tick).toBeTypeOf('function'); // No animation frame callback was invoked in this test.
  });

  it('(8) moves the view to the saved camera only on open and on a camera command, never on other edits', async () => {
    const model = fixture();
    model.object.userData['vibi3dCamera'] = { position: [5, 5, 5], target: [0, 1, 0] };
    const doc = { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Product', revision: 3,
      payload: serializeModelSource(model.object, model.clips), links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/head')
      ? { head: { id: 'product', appId: 'vibi3d', revision: 3, updatedAt: 1, candidateStamp: 0, pendingCandidates: 0 } } : { doc }))));
    await act(async () => { mount({ projectId: 'project', modelId: 'product' }); });
    const view = () => { const c = mocks.controls as { camera: THREE.PerspectiveCamera; target: THREE.Vector3 }; return { position: c.camera.position.toArray(), target: c.target.toArray() }; };
    expect(view().position).toEqual([5, 5, 5]);
    expect(view().target).toEqual([0, 1, 0]);
    // The person orbits away, then edits an object: the view stays where they put it.
    const controls = mocks.controls as { target: THREE.Vector3; camera: THREE.PerspectiveCamera };
    controls.camera.position.set(1, 2, 3); controls.target.set(0, 0.5, 0);
    const node = inspector().snapshot.nodes.find((item) => item.name === 'Cube')!;
    command({ type: 'update', id: node.id, position: [2, 0, 0] });
    command({ type: 'select', id: node.id });
    expect(view().position).toEqual([1, 2, 3]);
    expect(view().target).toEqual([0, 0.5, 0]);
    // A camera command is the one edit that moves the view.
    command({ type: 'camera', position: [7, 3, 7], target: [0, 1, 0] });
    expect(view().position).toEqual([7, 3, 7]);
    expect(view().target).toEqual([0, 1, 0]);
  });

  it('keeps the scene dirty when a replay returns newer content and requires a copy before saving it', async () => {
    const model = fixture(); const doc = { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Product', revision: 3,
      payload: serializeModelSource(model.object, model.clips), links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
    // The replayed save answers with the server's current state — a revision someone else made after ours (5 > 3 + 1).
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => new Response(JSON.stringify(options?.method === 'POST'
      ? { doc: { ...doc, revision: 5 } } : url.includes('/impact') ? { impacts: [] } : url.includes('/outputs') ? { outputs: [] }
        : url.includes('/candidates') ? { candidates: [] } : url.includes('/docs?') ? { docs: [] } : { doc })));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { mount({ projectId: 'project', modelId: 'product' }); });
    const node = inspector().snapshot.nodes.find((item) => item.name === 'Cube')!;
    command({ type: 'update', id: node.id, position: [5, 0, 0] });
    await act(async () => { button('Save source').props.onClick(); });
    expect(inspector().snapshot.nodes.find((item) => item.id === node.id)?.position).toEqual([5, 0, 0]);
    expect(renderer!.root.findByType(Vibi3DImageSources).props.disabled).toBe(true);
    const count = fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST').length;
    expect(count).toBe(1);
    await act(async () => { button('Save source').props.onClick(); });
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(count);
  });

  it('does not commit a late rendered texture after switching the project or source', async () => {
    const model = fixture(); const payload = serializeModelSource(model.object, model.clips);
    const doc = { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Product', revision: 3,
      payload, links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
    const image = { ...doc, id: 'image', appId: 'vibimage' };
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => new Response(JSON.stringify(url.includes('/impact') ? { impacts: [] }
      : url.includes('/outputs') ? { outputs: [] } : url.includes('/candidates') ? { candidates: [] } : url.includes('/docs?') ? { docs: [image] }
        : { ok: true, doc: url.includes('/docs/image?') ? image : doc })));
    vi.stubGlobal('fetch', fetchMock);
    const rendered = deferred<{ texture: THREE.Texture; hasAlpha: boolean }>(); mocks.renderTexture.mockReturnValueOnce(rendered.promise);
    await act(async () => { mount({ projectId: 'project', modelId: 'product' }); });
    const before = inspector().snapshot.sessionId; let settled!: Promise<unknown>;
    await act(async () => { settled = renderer!.root.findByType(Vibi3DImageSources).props.onApply('image').catch((error: Error) => error); });
    await act(async () => {
      renderer!.update(createElement(Vibi3DShell, { appId: 'vibi3d', params: { projectId: 'different-project', modelId: 'different-source' } }));
    });
    await act(async () => { rendered.resolve({ texture: new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1), hasAlpha: false }); await settled; });
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    expect(inspector().snapshot.sessionId).toBe(before);
  });

  it('does not install a late texture commit into the newly requested source', async () => {
    const model = fixture(); const doc = { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Product', revision: 3,
      payload: serializeModelSource(model.object, model.clips), links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
    const image = { ...doc, id: 'image', appId: 'vibimage' }; const committed = deferred<Response>();
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => url.includes('/blobs/missing') ? new Response(JSON.stringify({ missing: [] })) : options?.method === 'POST' ? committed.promise : new Response(JSON.stringify(url.includes('/impact') ? { impacts: [] }
      : url.includes('/outputs') ? { outputs: [] } : url.includes('/candidates') ? { candidates: [] } : url.includes('/docs?') ? { docs: [image] }
        : { ok: true, doc: url.includes('/docs/image?') ? image : doc })));
    vi.stubGlobal('fetch', fetchMock); mocks.renderTexture.mockResolvedValueOnce({ texture: new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1), hasAlpha: false });
    await act(async () => { mount({ projectId: 'project', modelId: 'product' }); });
    const before = inspector().snapshot.sessionId; let settled!: Promise<void>;
    mocks.targetUpdate.mockClear();
    await act(async () => { settled = renderer!.root.findByType(Vibi3DImageSources).props.onApply('image'); });
    await act(async () => { await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/commit'))).toBe(true)); });
    await act(async () => { renderer!.update(createElement(Vibi3DShell, { appId: 'vibi3d', params: { projectId: 'project', modelId: 'another-source' } })); });
    const submitted = JSON.parse(String(fetchMock.mock.calls.find(([url]) => url.includes('/commit'))![1]!.body));
    await act(async () => { committed.resolve(new Response(JSON.stringify({ doc: { ...doc, revision: 4, payload: submitted.payload, links: submitted.links } }))); await settled; });
    expect(inspector().snapshot.sessionId).toBe(before);
    expect(mocks.targetUpdate).not.toHaveBeenCalled();
  });

  it('opens the registry modelId source and preserves local changes when its save conflicts', async () => {
    const model = fixture();
    const doc = { schemaVersion: 1, id: 'product', appId: 'vibi3d', title: 'Product', revision: 3,
      payload: serializeModelSource(model.object, model.clips), links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') return new Response(JSON.stringify({ error: 'revision-conflict', doc }), { status: 409 });
      return new Response(JSON.stringify(url.includes('/impact') ? { impacts: [] } : url.includes('/outputs') ? { outputs: [] } : { ok: true, doc }));
    });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { mount({ projectId: 'project', modelId: 'product' }); });
    const node = inspector().snapshot.nodes.find((item) => item.name === 'Cube')!;
    command({ type: 'update', id: node.id, position: [5, 0, 0] });
    await act(async () => { button('Save source').props.onClick(); });
    expect(inspector().snapshot.nodes.find((item) => item.id === node.id)?.position).toEqual([5, 0, 0]);
    // The reason is a translated code (here the key, as the test translator returns keys).
    expect(renderer!.root.findAllByProps({ role: 'alert' }).some((item) => item.children.join('').includes('revisionConflict'))).toBe(true);
    const commit = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(String(commit[1]!.body))).toMatchObject({ baseRevision: 3, payload: { format: 'vibi3d' } });
  });

  it('saves an editable source and transfers its ref without repeating an unchanged save', async () => {
    let version = 0;
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body)); version++;
        return new Response(JSON.stringify({ ok: true, doc: { id: 'source', appId: 'vibi3d', title: body.title, revision: version, payload: body.payload, links: [], parameters: {} } }));
      }
      return new Response(JSON.stringify(url.includes('/impact') ? { impacts: [] } : { outputs: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    act(() => mount()); await open(fixture());
    await act(async () => { button('Save source').props.onClick(); });
    expect(mocks.targetUpdate).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ ref: 'source', file: undefined, draftKey: expect.stringMatching(/^local:/) }));
    let ready = false;
    await act(async () => { ready = await mocks.prepare!(); });
    expect(ready).toBe(true);
    expect(version).toBe(1);
    expect(mocks.export).not.toHaveBeenCalled();
  });

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

  it('persists both local drafts and publishes their recovery key before allowing transfer', async () => {
    act(() => mount({ projectId: 'C:/project', appWindowId: 'embedded' })); await open(fixture());
    const id = inspector().snapshot.selectedId!;
    command({ type: 'update', id, position: [7, 0, 0] });
    const publishing = deferred<void>(); mocks.targetUpdate.mockReturnValueOnce(publishing.promise);
    let completed = false; let ready!: Promise<boolean>;
    await act(async () => { ready = mocks.prepare!().then(value => { completed = true; return value; }); });
    expect(completed).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.export).not.toHaveBeenCalled();
    expect(mocks.targetUpdate).toHaveBeenCalledWith(expect.objectContaining({ appWindowId: 'embedded' }),
      expect.objectContaining({ draftKey: expect.stringMatching(/^local:/) }));
    await act(async () => { publishing.resolve(); await ready; });
    expect(await ready).toBe(true);
    const saved = [...draftStore.values()].find(value => value.draft?.actor === 'human')!.draft!;
    const model = await loadModelSource(saved.payload);
    expect(model.object.position.x).toBe(7);
    const sessionId = inspector().snapshot.sessionId;
    await act(async () => { renderer!.update(createElement(Vibi3DShell, { appId: 'vibi3d',
      params: { projectId: 'C:/project', appWindowId: 'embedded', draftKey: saved.key } })); });
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(inspector().snapshot.sessionId).toBe(sessionId);
    act(() => mocks.releaseTransfer?.());
    command({ type: 'undo' });
    expect(inspector().snapshot.nodes.find(node => node.id === id)?.position).toEqual([0, 0, 0]);
  });

  it('keeps the scene open when transfer cannot persist its drafts', async () => {
    act(() => mount()); await open(fixture());
    const sessionId = inspector().snapshot.sessionId;
    mocks.targetUpdate.mockClear(); mocks.saveDraft.mockRejectedValueOnce(new Error('disk unavailable'));
    let ready: boolean | undefined;
    await act(async () => { ready = await mocks.prepare!(); });
    expect(ready).toBe(false);
    expect(inspector().snapshot.sessionId).toBe(sessionId);
    expect(mocks.targetUpdate).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain('panel.vibi3d.drafts.closeFailed');
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
    expect(mocks.targetUpdate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ref: undefined, file: 'models/source.glb', draftKey: 'file:models/source.glb' }));
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
    // An unknown failure shows the translated generic sentence, never a raw English message.
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toBe('panel.creation.errors.unexpected');
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

  it('keeps human animation playback separate from AI edits and undo', async () => {
    act(() => mount()); const model = fixture('animated.glb', true); await open(model);
    const cube = model.object.children[0]!; const cubeId = cube.userData['vibi3dId'] as string;
    act(() => { renderer!.root.findByProps({ 'aria-label': 'Animation time' }).props.onChange({ target: { value: '0.5' } }); });
    expect(cube.position.x).toBe(5);
    await act(async () => { await mocks.bridge!.execute({ commandId: 'edit', expectedRevision: 0, commands: [{ type: 'update', id: cubeId, position: [3, 0, 0] }] }); });
    expect(cube.position.x).toBe(5);
    expect(mocks.bridge!.getSnapshot()!.nodes.find(node => node.id === cubeId)?.position).toEqual([3, 0, 0]);
    await act(async () => { await mocks.bridge!.execute({ commandId: 'agent-undo', expectedRevision: mocks.bridge!.getSnapshot()!.revision, commands: [{ type: 'undo' }] }); });
    expect(cube.position.x).toBe(5);
    expect(mocks.bridge!.getSnapshot()!.nodes.find(node => node.id === cubeId)?.position).toEqual([0, 0, 0]);
    await act(async () => { button('Save GLB').props.onClick(); });
    expect(cube.position.x).toBe(0);
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
    await act(async () => mount({ projectId: 'C:/project', file: 'old.glb' }));
    await act(async () => renderer!.update(createElement(Vibi3DShell, { appId: 'vibi3d', params: { projectId: 'C:/project', file: 'latest.glb' } })));
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

  it('captures the AI draft without changing the human animation or camera', async () => {
    const drawImage = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL: () => 'data:image/jpeg;base64,frame' }) });
    act(() => mount()); const model = fixture('animated.glb', true); await open(model);
    act(() => button('panel.vibi3d.spin').props.onClick());
    act(() => button('Play').props.onClick());
    act(() => mocks.tick!(performance.now() + 100));
    const pose = model.object.children[0]!.position.x;
    expect(pose).toBeGreaterThan(0);
    const before = mocks.bridge!.getSnapshot()!;
    expect(before.playback).toBeUndefined();
    let image: string | undefined;
    await act(async () => { image = await mocks.bridge!.capture(); });
    const after = mocks.bridge!.getSnapshot()!;
    expect(image).toBe('data:image/jpeg;base64,frame');
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(after.playback).toBeUndefined();
    expect(after.camera).toEqual(before.camera);
    expect(model.object.children[0]!.position.x).toBe(pose);
    expect((mocks.controls as { autoRotate: boolean }).autoRotate).toBe(true);
    act(() => mocks.tick!(performance.now() + 200));
    expect(model.object.children[0]!.position.x).toBeGreaterThan(pose);
  });
});

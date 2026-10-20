import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreationDoc, CreationValue, Vibi3DCommand, Vibi3DStageRecord } from '@vibisual/shared';
import { ModelAgentDraft } from './modelAgentDraft.js';
import { ModelEditor } from './modelEditor.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';
import { disposeModel } from './modelIO.js';
import type { Vibi3DExecutionContext } from './useVibi3DBridge.js';

const owned: ModelAgentDraft[] = [];
const humans: ModelEditor[] = [];
afterEach(() => {
  owned.splice(0).forEach(draft => draft.dispose());
  humans.splice(0).forEach(editor => { editor.disposeHistory(); disposeModel(editor.object); });
});
async function fixture() {
  const object = new THREE.Group(); object.name = 'Building';
  const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
  cube.name = 'Cube'; object.add(cube);
  const human = new ModelEditor(object, [], { projectId: '/project', fileName: 'Building' }); humans.push(human);
  const payload = serializeModelSource(object, []) as unknown as CreationValue;
  const doc: CreationDoc = { schemaVersion: 1, id: 'model', appId: 'vibi3d', title: 'Building', revision: 3, payload,
    links: [], parameters: {}, lockedPaths: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
  const draft = new ModelAgentDraft('/project', await loadModelSource(payload, 'Building'), doc, 'agent-session');
  owned.push(draft);
  return { human, cube, draft, doc, id: human.getId(cube)! };
}
function stage(mode: Vibi3DStageRecord['mode']): Vibi3DStageRecord {
  return { id: 'stage', label: 'Draft', revision: 3, sceneRevision: 1, sourcePath: 'stage.json', mode, createdAt: 1, captures: [], checks: [] };
}
const context = (value: unknown): Vibi3DExecutionContext => ({ post: async <T,>() => value as T });
async function execute(draft: ModelAgentDraft, command: Vibi3DCommand, executor?: Vibi3DExecutionContext) {
  return draft.execute({ commandId: crypto.randomUUID(), expectedRevision: draft.editor.revision, commands: [command] }, 'owner', executor);
}

describe('independent AI model draft', () => {
  it('retains source-less draft references through payload serialization and restart independently of document links', async () => {
    const { doc } = await fixture();
    const links = [{ id: 'reference', sourceId: 'reference-image', sourceRevision: 4, role: 'design-reference', targets: [] }];
    const sourceLess = new ModelAgentDraft('/project', await loadModelSource(doc.payload, 'Unsaved'), null, 'new-agent', true, links);
    owned.push(sourceLess);
    links[0]!.sourceRevision = 99;
    const saved = { payload: sourceLess.payload(), links: sourceLess.links() };
    const restored = new ModelAgentDraft('/project', await loadModelSource(saved.payload, 'Unsaved'), null, 'restored-agent', true, saved.links);
    owned.push(restored);
    expect(restored.document).toBeNull();
    expect(restored.links()).toEqual([{ id: 'reference', sourceId: 'reference-image', sourceRevision: 4, role: 'design-reference', targets: [] }]);
    saved.links[0]!.sourceRevision = 30;
    expect(restored.links()[0]?.sourceRevision).toBe(4);
  });
  it('restores checkpoint references together with its payload while preserving the original source document', async () => {
    const { draft, doc } = await fixture();
    const links = [{ id: 'reference', sourceId: 'source-image', sourceRevision: 2, role: 'design-reference', targets: [] }];
    await execute(draft, { type: 'resume', runId: 'previous' }, context({ payload: doc.payload, links, stage: stage('intermediate') }));
    expect(draft.links()).toEqual(links); expect(draft.document?.links).toEqual([]);
    links[0]!.sourceRevision = 50;
    expect(draft.links()[0]?.sourceRevision).toBe(2);
  });
  it('isolates human edits, AI edits, material changes and undo across the two models', async () => {
    const { human, cube, draft, id } = await fixture();
    human.apply({ type: 'update', id, position: [5, 0, 0], color: '#ff0000' }, 0);
    expect(draft.editor.snapshot().nodes.find(node => node.id === id)?.position).toEqual([0, 0, 0]);
    await execute(draft, { type: 'update', id, position: [8, 0, 0], color: '#0000ff' });
    expect(cube.position.x).toBe(5);
    expect(cube.material.color.getHexString()).toBe('ff0000');
    human.undo();
    expect(draft.editor.snapshot().nodes.find(node => node.id === id)).toMatchObject({ position: [8, 0, 0], color: '#0000ff' });
    expect(draft.snapshot('owner').document).toMatchObject({ revision: 3, dirty: true, humanDirty: false });
  });

  it.each<Vibi3DCommand>([{ type: 'propose', label: 'Review' }, { type: 'checkpoint', label: 'Review', stage: 'draft' }])(
    'keeps the AI result visible after a candidate $type without changing the source', async command => {
      const { draft, doc, id } = await fixture();
      await execute(draft, { type: 'update', id, position: [8, 0, 0] });
      const original = structuredClone(doc);
      const currentEditor = draft.editor;
      await execute(draft, command, context({ stage: stage('candidate') }));
      expect(draft.editor).toBe(currentEditor);
      expect(draft.editor.snapshot().nodes.find(node => node.id === id)?.position).toEqual([8, 0, 0]);
      expect(draft.document).toEqual(original);
      expect(doc).toEqual(original);
      expect(draft.snapshot('owner').document?.dirty).toBe(true);
    });

  it('resumes a stage in the same session while the human model and committed source stay intact', async () => {
    const { human, draft, doc, id } = await fixture();
    human.apply({ type: 'update', id, position: [4, 0, 0] }, 0);
    const payload = serializeModelSource(human.object, []) as unknown as CreationValue;
    human.apply({ type: 'update', id, position: [5, 0, 0] }, 1);
    await execute(draft, { type: 'resume', runId: 'previous' }, context({ payload, stage: stage('intermediate') }));
    expect(draft.editor.sessionId).toBe('agent-session');
    expect(draft.editor.revision).toBe(1);
    expect(draft.editor.snapshot().nodes.find(node => node.id === id)?.position).toEqual([4, 0, 0]);
    expect(human.snapshot().nodes.find(node => node.id === id)?.position).toEqual([5, 0, 0]);
    expect(draft.document).toEqual(doc);
    expect(draft.snapshot('owner').document?.dirty).toBe(true);
  });

  it('returns stats without changing revision or claiming that a dirty draft was applied', async () => {
    const { draft, id } = await fixture();
    await execute(draft, { type: 'update', id, scale: [2, 2, 2] });
    const result = await execute(draft, { type: 'stats' });
    expect(result.snapshot.revision).toBe(1);
    expect(result.result?.stats).toMatchObject({ objects: 1, triangles: 12 });
    expect(result.snapshot.document?.dirty).toBe(true);
  });

  it('rejects a checkpoint replay that describes a different source revision', async () => {
    const { draft, doc, id } = await fixture();
    await execute(draft, { type: 'update', id, position: [8, 0, 0] });
    await expect(execute(draft, { type: 'checkpoint', stage: 'draft', label: 'Draft' },
      context({ doc: { ...doc, revision: 5 }, stage: { ...stage('commit'), revision: 4 } }))).rejects.toThrow('source-changed-elsewhere');
    expect(draft.document?.revision).toBe(3);
    expect(draft.snapshot('owner').document?.dirty).toBe(true);
    expect(draft.editor.snapshot().nodes.find(node => node.id === id)?.position).toEqual([8, 0, 0]);
  });

  it('rejects a late resume after disposal and does not install the returned scene', async () => {
    const { draft, doc } = await fixture();
    let finish!: (value: unknown) => void;
    const post = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const before = draft.editor;
    const pending = execute(draft, { type: 'resume', runId: 'previous' }, { post: <T,>() => post() as Promise<T> });
    draft.dispose();
    finish({ payload: doc.payload, stage: stage('intermediate') });
    await expect(pending).rejects.toThrow('scene-changed');
    expect(draft.editor).toBe(before);
  });

  it('rejects overlapping requests instead of replacing work made during resume', async () => {
    const { draft, doc, id } = await fixture();
    let finish!: (value: unknown) => void;
    const post = () => new Promise(resolve => { finish = resolve; });
    const pending = execute(draft, { type: 'resume', runId: 'previous' }, { post: <T,>() => post() as Promise<T> });
    await expect(execute(draft, { type: 'update', id, position: [8, 0, 0] })).rejects.toThrow('revision-conflict');
    finish({ payload: doc.payload, stage: stage('intermediate') });
    await pending;
    expect(draft.editor.revision).toBe(1);
  });
});

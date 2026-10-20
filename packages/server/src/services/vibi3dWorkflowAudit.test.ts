import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationValue, Vibi3DSnapshot } from '@vibisual/shared';
import { CreationStore, type CreationHost } from './creationStore.js';
import { Vibi3DWorkflowStore } from './vibi3dWorkflowStore.js';

let root: string; let creation: CreationStore; let workflow: Vibi3DWorkflowStore;
const source: CreationValue = { format: 'vibi3d', version: 1, clips: [], scene: { object: { uuid: 'root', type: 'Group', children: [{ uuid: 'wall', type: 'Mesh' }] } } };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY2sAAAAASUVORK5CYII=';
const command = { type: 'checkpoint' as const, stage: 'details', label: 'Details' };
function prepare() {
  const doc = creation.create(root, { appId: 'vibi3d', payload: source }, 'user');
  const view: Vibi3DSnapshot = { sessionId: 'scene', projectId: root, fileName: 'model', revision: 1,
    selectedId: null, nodes: [], document: { id: doc.id, revision: doc.revision, dirty: false } };
  workflow.start(root, doc.id, view, 'run'); return { doc, view };
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi3d-audit-'));
  const host: CreationHost = { resolveProjectPath: value => value === root ? root : null,
    atomicWriteFile: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); } };
  creation = new CreationStore(host); workflow = new Vibi3DWorkflowStore(host, creation, process.platform);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('vibi3d-audit-')) throw new Error('unsafe-fixture-path');
  fs.rmSync(root, { recursive: true, force: true });
});
describe('workflow adversarial persistence audit', () => {
  it('keeps captures when an earlier identical HTTP attempt externalizes after its successful retry', async () => {
    const { doc, view } = prepare();
    let release!: (payload: CreationValue) => void;
    vi.spyOn(creation, 'externalize').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const delayed = workflow.save(root, doc.id, 'run', 'checkpoint', view, command, source);
    await workflow.save(root, doc.id, 'run', 'checkpoint', view, command, source);
    const capture = workflow.capture(root, doc.id, 'run', 'capture', view,
      [{ view: 'current', mode: 'lit', quality: 'draft', width: 1, height: 1, dataUrl: png }]);
    release(source); await delayed;
    const saved = workflow.read(root, doc.id)!;
    expect(saved.stages).toHaveLength(1);
    expect(saved.stages[0]!.captures).toEqual(capture);
  });
  it('checks the original request identity again after an overlapping externalization', async () => {
    const { doc, view } = prepare();
    let release!: (payload: CreationValue) => void;
    vi.spyOn(creation, 'externalize').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const delayed = workflow.save(root, doc.id, 'run', 'checkpoint', view, command, { ...source as object, changed: true });
    await workflow.save(root, doc.id, 'run', 'checkpoint', view, command, source);
    release(source);
    await expect(delayed).rejects.toThrow('request-id-reused');
    expect(workflow.resume(root, doc.id, 'run', view).payload).toEqual(source);
  });
  it('requires an explicit agent-owned dirty state before persisting unsaved content', async () => {
    const { doc, view } = prepare();
    const dirty = { ...view, document: { ...view.document!, dirty: true } };
    await expect(workflow.save(root, doc.id, 'run', 'unknown', dirty, command, source)).rejects.toThrow('unsaved-user-edits');
    await expect(workflow.save(root, doc.id, 'run', 'human', { ...dirty, document: { ...dirty.document, humanDirty: true } }, command, source)).rejects.toThrow('unsaved-user-edits');
    await expect(workflow.save(root, doc.id, 'run', 'agent', { ...dirty, document: { ...dirty.document, humanDirty: false } }, command, source)).resolves.toMatchObject({ stage: { mode: 'intermediate' } });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CreationDoc, CreationValue } from '@vibisual/shared';
import { forgetKnownBlobs } from '../Creation/creationBlobs.js';
import { ModelEditor } from './modelEditor.js';
import { loadModelSource, modelLockedPaths, saveModelDocument, serializeModelSource } from './modelSource.js';
import { commitModelTexture, prepareModelTexture, readTextureSource } from './modelImageLink.js';
import { compareModelSources } from './modelComparison.js';

const rendered = (hasAlpha = false) => ({ texture: new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1), hasAlpha });
function fixture(): { editor: ModelEditor; doc: CreationDoc; source: CreationDoc } {
  const editor = new ModelEditor(new THREE.Group());
  editor.apply([{ type: 'create', id: 'body', name: 'Bottle', recipe: { kind: 'cylinder', height: 2 } }, { type: 'create', id: 'label', name: 'Label', recipe: { kind: 'plane', width: 1, height: 1 } }], 0);
  editor.apply({ type: 'update', id: 'body', position: [2, 3, 4] }, 1);
  editor.clips.push(new THREE.AnimationClip('Imported', 2, [new THREE.NumberKeyframeTrack(`${editor.findObject('body')!.uuid}.position[x]`, [0, 2], [2, 5])]));
  const doc: CreationDoc = { schemaVersion: 1, id: 'model', appId: 'vibi3d', title: 'Product', revision: 2,
    payload: { ...serializeModelSource(editor.object, editor.clips), generatorCode: 'makeBottle({height: 2})', conditions: { preserve: 'logo' } } as unknown as CreationValue,
    parameters: { size: 2 }, lockedPaths: [], links: [], createdAt: 1, updatedAt: 1, label: '', author: 'user' };
  const source = { ...doc, id: 'image', appId: 'vibimage', title: 'Label artwork', revision: 7 };
  return { editor, doc, source };
}
type Call = [string, RequestInit | undefined];
const body = (call: Call): Record<string, unknown> => JSON.parse(String(call[1]!.body)) as Record<string, unknown>;
afterEach(() => { vi.unstubAllGlobals(); forgetKnownBlobs('project'); });
describe('image source as linked model texture', () => {
  it('updates only the chosen object on a separate model and restores the embedded texture on reopen', async () => {
    const { editor, doc, source } = fixture(); const before = structuredClone(doc.payload);
    const prepared = await prepareModelTexture('project', doc, source, ['label'], rendered());
    expect(doc.payload).toEqual(before);
    expect((editor.findObject('label') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.map).toBeNull();
    expect(compareModelSources(doc.payload, prepared.payload).map((item) => item.id)).toEqual(['label']);
    expect(prepared.links[0]).toMatchObject({ sourceId: 'image', sourceRevision: 7, targets: ['label'], role: 'model-texture' });
    expect(prepared.links[0]).not.toHaveProperty('policy');
    expect(prepared.payload.generatorCode).toBe('makeBottle({height: 2})');
    expect(prepared.payload).toHaveProperty('conditions', { preserve: 'logo' });
    const reopened = await loadModelSource(prepared.payload); const current = new ModelEditor(reopened.object, reopened.clips);
    const map = (current.findObject('label') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.map;
    expect((map?.image as { data: Uint8Array }).data).toEqual(new Uint8Array([255, 0, 0, 255]));
    expect(current.findObject('body')!.position.toArray()).toEqual([2, 3, 4]);
    expect(current.clips[0]!.name).toBe('Imported');
  });
  it('makes a material transparent only for a picture with transparent pixels', async () => {
    const { doc, source } = fixture();
    const material = async (hasAlpha: boolean): Promise<THREE.MeshStandardMaterial> => {
      const prepared = await prepareModelTexture('project', doc, source, ['label'], rendered(hasAlpha));
      const reopened = await loadModelSource(prepared.payload);
      return (new ModelEditor(reopened.object).findObject('label') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material;
    };
    expect((await material(false)).transparent).toBe(false);
    expect((await material(true)).transparent).toBe(true);
  });
  it('pins the selected new image revision while preserving other object links', async () => {
    const { doc, source } = fixture();
    doc.links = [{ id: 'old', role: 'model-texture', sourceId: 'image', sourceRevision: 3, targets: ['label'] },
      { id: 'body-link', role: 'model-texture', sourceId: 'other-image', sourceRevision: 1, targets: ['body'] }];
    const prepared = await prepareModelTexture('project', doc, source, ['label'], rendered(), 'old');
    expect(prepared.links).toHaveLength(2);
    expect(prepared.links.find((link) => link.id === 'old')?.sourceRevision).toBe(7);
    expect(prepared.links.find((link) => link.id === 'body-link')).toEqual(doc.links[1]);
    expect(doc.links[0]!.sourceRevision).toBe(3);
  });
  it('rejects protected or missing targets without mutating the saved original', async () => {
    const { editor, doc, source } = fixture(); editor.apply({ type: 'protect', id: 'label', locked: true }, editor.revision);
    doc.payload = serializeModelSource(editor.object, editor.clips) as unknown as CreationValue;
    const before = structuredClone(doc.payload);
    await expect(prepareModelTexture('project', doc, source, ['label'], rendered())).rejects.toThrow('object-protected');
    await expect(prepareModelTexture('project', doc, source, ['missing'], rendered())).rejects.toThrow('object-missing');
    expect(doc.payload).toEqual(before);
  });
  it('commits payload, links and the locked paths together against the read revision, and reports conflicts', async () => {
    const { editor, doc, source } = fixture(); editor.apply({ type: 'protect', id: 'body', locked: true }, editor.revision);
    // An imported mesh: its vertex array is large binary data (parametric shapes store only their recipe).
    const imported = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(300).map((_, i) => i / 7), 3)));
    imported.name = 'Imported'; editor.object.add(imported);
    doc.payload = serializeModelSource(editor.object, editor.clips) as unknown as CreationValue;
    const prepared = await prepareModelTexture('project', doc, source, ['label'], rendered());
    const fetchMock = vi.fn(async (url: string) => url.includes('/blobs/missing')
      ? new Response(JSON.stringify({ missing: [] })) : new Response(JSON.stringify({ error: 'revision-conflict' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(commitModelTexture('project', doc, prepared)).rejects.toThrow('revision-conflict');
    const commit = (fetchMock.mock.calls as unknown as Call[]).find((call) => call[0].includes('/commit'))!;
    const sent = body(commit);
    expect(sent).toMatchObject({ baseRevision: 2, links: prepared.links, lockedPaths: modelLockedPaths(prepared.payload) });
    expect(modelLockedPaths(prepared.payload)).toContain(`/scene/object/children/@${editor.findObject('body')!.uuid}`);
    // Geometry arrays travel as content-hash references, not as inline numbers.
    expect(JSON.stringify(sent.payload)).toContain('vibi-blob:');
    expect(doc.links).toEqual([]);
  });
  it('a retried texture link sends the same request (the server replays it instead of answering 409)', async () => {
    const { doc, source } = fixture();
    const first = await prepareModelTexture('project', doc, source, ['label'], rendered());
    const second = await prepareModelTexture('project', doc, source, ['label'], rendered());
    expect(JSON.stringify(second.payload)).toBe(JSON.stringify(first.payload));
    expect(second.links).toEqual(first.links);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body ?? '{}')) as { payload?: CreationValue; links?: CreationDoc['links'] };
      return url.includes('/blobs/missing') ? new Response(JSON.stringify({ missing: [] }))
        : new Response(JSON.stringify({ doc: { ...doc, revision: 3, payload: sent.payload, links: sent.links } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    await commitModelTexture('project', doc, first);
    await commitModelTexture('project', doc, second);
    const commits = (fetchMock.mock.calls as unknown as Call[]).filter((call) => call[0].includes('/commit')).map(body);
    expect(commits).toHaveLength(2);
    expect(commits[1]!.requestId).toBe(commits[0]!.requestId);
  });
  it('does not mark a replayed newer human head clean even when the original texture save was a no-op', async () => {
    const { doc, source } = fixture();
    const prepared = await prepareModelTexture('project', doc, source, ['label'], rendered());
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/blobs/missing') ? new Response(JSON.stringify({ missing: [] }))
      : new Response(JSON.stringify({ doc: { ...doc, revision: doc.revision + 1, payload: { human: 'newer content' } } }))));
    await expect(commitModelTexture('project', doc, prepared)).rejects.toThrow('source-changed-elsewhere');
  });
  it('loads the exact requested image revision and rejects other app sources', async () => {
    const { source, doc } = fixture(); const fetchMock = vi.fn(async () => new Response(JSON.stringify({ doc: source }))); vi.stubGlobal('fetch', fetchMock);
    expect(await readTextureSource('project', source.id, 7)).toEqual(source);
    expect((fetchMock.mock.calls as unknown as Call[])[0]![0]).toBe('/api/app/creation/docs/image/revisions/7?projectId=project');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ doc })));
    await expect(readTextureSource('project', doc.id)).rejects.toThrow('unsupported-image-source');
  });
  it('reuses the initial source request after a lost response and creates a fresh explicit copy after success', async () => {
    const { doc } = fixture(); const payload = serializeModelSource(new THREE.Group(), [], doc.payload);
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValue(new Response(JSON.stringify({ doc })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(saveModelDocument('project', null, 'New model', payload)).rejects.toThrow('request-failed');
    await saveModelDocument('project', null, 'New model', payload);
    const sent = (index: number) => JSON.parse(String(fetchMock.mock.calls[index]![1]!.body)) as Record<string, unknown>;
    expect(sent(0).requestId).toBe(sent(1).requestId);
    // After success, an identical new document is a new document (two blank models never collapse into one).
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ doc })));
    await saveModelDocument('project', null, 'New model', payload);
    expect(sent(2).requestId).not.toBe(sent(1).requestId);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ doc })));
    await saveModelDocument('project', doc, doc.title, payload, true);
    expect(sent(3)).toMatchObject({ links: doc.links, parameters: doc.parameters, lockedPaths: [] });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ doc })));
    await saveModelDocument('project', doc, doc.title, payload, true);
    expect(sent(3).requestId).not.toBe(sent(4).requestId);
  });
});

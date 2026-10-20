import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPatch, createEmptyDoc, resolveTimeline, type VideoAsset } from '@vibisual/video';
import type { CreationDoc, Vibi3DShot } from '@vibisual/shared';
import { shotVideoOps, saveShotStills, createShotVideo } from './vibi3dShotOutputs.js';
import { recordCreationOutput } from '../Creation/creationApi.js';
import { writeWorkspaceMedia } from '../../utils/workspaceMedia.js';
import { vibi3dViewSize } from './vibi3dViewSize.js';
// Load the real lazy HTTP dependencies before tests install per-test fetch mocks. Otherwise a cold Vite
// transform (including the locale modules) can outlive a test and send its request through the next mock.
import '../Creation/videoDocumentApi.js';
import '../Creation/creationVideoSource.js';

vi.mock('../Creation/creationApi.js', async original => ({ ...await original<typeof import('../Creation/creationApi.js')>(), recordCreationOutput: vi.fn() }));
vi.mock('../../utils/workspaceMedia.js', () => ({ writeWorkspaceMedia: vi.fn() }));
const asset: VideoAsset = { id: 'scene', kind: 'model', source: { kind: 'file', path: 'building.vibi3d' }, creationSource: { id: 'model', revision: 7, appId: 'vibi3d' } };
const shots: Vibi3DShot[] = ['whole', 'shop', 'corner'].map(id => ({ id, name: id, position: [2, 1.6, 5], target: [0, 3, 0], lens: 24, aspect: '9:16' }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(writeWorkspaceMedia).mockImplementation(async (_root, path) => ({ ok: true, path })); });
afterEach(() => vi.unstubAllGlobals());
describe('saved shot output', () => {
  it('builds an ordinary video document with three stable shot references and the same sky', () => {
    const doc = createEmptyDoc('film', 'Building'), ops = shotVideoOps(doc, asset, { shots });
    const result = applyPatch(doc, { baseVersion: doc.version, ops }); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.doc.size).toEqual({ width: 1080, height: 1920 }); expect(resolveTimeline(result.doc).duration).toBe(12);
    const track = result.doc.tracks.at(-1)!; expect(track.items.map(item => item.props)).toEqual(shots.map(shot => ({ cameraShot: shot.id, modelBackground: 'sky' })));
    expect(result.doc.assets.scene?.creationSource).toEqual(asset.creationSource);
    expect(shotVideoOps(doc, asset, { shots: [...shots].reverse() }).at(-1)).toMatchObject({ track: { items: [...track.items].reverse().map((item, index) => ({ id: item.id, at: index * 4 })) } });
  });
  it('requests camera motion explicitly and retains portrait output without baking or replacing the source', () => {
    const ops = shotVideoOps(createEmptyDoc('motion', ''), asset, { shots: [], motion: { duration: 8, aspect: '9:16' } });
    expect(ops.at(-1)).toMatchObject({ track: { items: [{ duration: 8, props: { cameraMotion: true, modelBackground: 'sky' } }] } });
    expect(() => shotVideoOps(createEmptyDoc('mixed', ''), asset, { shots: [shots[0]!, { ...shots[1]!, aspect: '1:1' }] })).toThrow('shot-aspect-mismatch');
  });
  it('rejects mixed framing before creating an external video document', async () => {
    await expect(createShotVideo('project', { id: 'model' } as CreationDoc, { shots: [shots[0]!, { ...shots[1]!, aspect: '1:1' }] })).rejects.toThrow('shot-aspect-mismatch');
  });
  it('imports the saved source revision through shared APIs and patches with the returned video version', async () => {
    const document = createEmptyDoc('video', 'Building');
    const source = { id: 'model', title: 'Building', revision: 7, appId: 'vibi3d', payload: { format: 'vibi3d', version: 1, scene: { object: { type: 'Group', children: [] } }, clips: [] } } as unknown as CreationDoc;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/app/vibistudio/docs') return Response.json({ doc: document });
      if (url.includes('/revisions/7')) return Response.json({ ok: true, doc: source });
      if (url.startsWith('/api/app/vibistudio/assets?')) {
        expect(JSON.parse(await (init!.body as Blob).text())).toEqual(source.payload);
        return Response.json({ asset });
      }
      if (url.endsWith('/patch')) {
        const body = JSON.parse(init!.body as string);
        expect(body.baseVersion).toBe(document.version);
        const result = applyPatch(document, body); expect(result.ok).toBe(true);
        return Response.json(result);
      }
      throw new Error(url);
    });
    vi.stubGlobal('fetch', fetcher);
    const video = await createShotVideo('project', source, { shots });
    expect(fetcher.mock.calls.map(([url]) => url).filter(url => url.includes('/revisions/'))).toEqual(['/api/app/creation/docs/model/revisions/7?projectId=project']);
    expect(video.assets.scene?.creationSource).toEqual({ id: 'model', revision: 7, appId: 'vibi3d' });
    expect(video.size).toEqual({ width: 1080, height: 1920 });
  });
  it('a repeated output opens a populated video without overwriting its human edits', async () => {
    const existing = { ...createEmptyDoc('video', 'Human title'), tracks: [{ id: 'human-track', kind: 'visual', items: [{ id: 'human-item' }] }] };
    const fetcher = vi.fn(async () => Response.json({ doc: existing })); vi.stubGlobal('fetch', fetcher);
    expect(await createShotVideo('project', { id: 'model', revision: 7 } as CreationDoc, { shots })).toEqual(existing);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('writes immutable PNG outputs of the saved revision and never reports an unrecorded output as success', async () => {
    const doc = { id: 'model', revision: 7 } as CreationDoc;
    const frames = [{ view: 'whole', mode: 'lit' as const, quality: 'final' as const, width: 1080, height: 1920, dataUrl: 'data:image/png;base64,cGl4ZWxz' }];
    const paths = await saveShotStills('project', doc, frames);
    expect(paths[0]).toMatch(/^\.vibisual\/creation\/model\/stills\/[a-f0-9-]+\.png$/);
    expect(recordCreationOutput).toHaveBeenCalledWith('project', 'model', { sourceRevision: 7, path: paths[0], mediaType: 'image/png' });
    vi.mocked(recordCreationOutput).mockRejectedValueOnce(new Error('network'));
    await expect(saveShotStills('project', doc, frames)).rejects.toThrow('output-not-recorded');
  });
  it('fits portrait drawing into a wide or narrow editor without stretching or changing legacy framing', () => {
    expect(vibi3dViewSize(800, 600, '9:16')).toEqual({ width: 338, height: 600, left: 231, top: 0 });
    expect(vibi3dViewSize(300, 900, '9:16')).toEqual({ width: 300, height: 533, left: 0, top: 183.5 });
    expect(vibi3dViewSize(800, 600)).toEqual({ width: 800, height: 600, left: 0, top: 0 });
  });
});

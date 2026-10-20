import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc } from '@vibisual/video';
import type { AppTaskDocumentArgs } from '../../apps/registry.js';
import { prepareVideoTaskDocument } from './videoTaskDocument.js';

vi.mock('../../i18n/index.js', () => ({ default: { t: () => 'Request failed' } }));
vi.mock('./useVideoRenderer.js', () => ({ measureAssets: async () => ({ footage: { duration: 8, width: 1280, height: 720 } }) }));
const request = vi.fn<typeof fetch>();
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status });
const args: AppTaskDocumentArgs = { projectId: '/project', projectName: 'Project', mode: 'copy', source: { ref: 'source', file: 'old.mp4' }, title: 'Variant', requestId: 'one-transition' };
beforeEach(() => { request.mockReset(); vi.stubGlobal('fetch', request); });
afterEach(() => vi.unstubAllGlobals());

describe('video task document preparation', () => {
  it('copies the authoritative document rather than falling back to the prior export', async () => {
    request.mockResolvedValue(json({ doc: { id: 'independent' } }));
    expect(await prepareVideoTaskDocument(args)).toEqual({ ref: 'independent' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe('/api/app/vibistudio/doc/source/copy');
    expect(JSON.parse(request.mock.calls[0]?.[1]?.body as string)).toEqual({ project: 'Project', title: 'Variant', requestId: 'one-transition' });
  });
  it('uses a stable new document ID across a transport retry', async () => {
    request.mockImplementation(async (_url, init) => json({ doc: { id: JSON.parse(init?.body as string).id } }));
    const first = await prepareVideoTaskDocument({ ...args, mode: 'new' });
    const again = await prepareVideoTaskDocument({ ...args, mode: 'new' });
    expect(first).toEqual(again); expect(first.ref).toMatch(/^task-[a-f0-9]{40}$/);
    expect(request.mock.calls.every(([url]) => url === '/api/app/vibistudio/docs')).toBe(true);
  });
  it('imports a file-only source and places the measured asset in its new timeline', async () => {
    const doc = createEmptyDoc('independent', 'Variant');
    request.mockResolvedValueOnce(json({ doc }))
      .mockResolvedValueOnce(json({ asset: { id: 'footage', kind: 'video', source: { kind: 'file', path: '.vibisual/video/assets/copy.mp4' } } }))
      .mockResolvedValueOnce(json({ doc: { ...doc, version: 2 } }));
    expect(await prepareVideoTaskDocument({ ...args, source: { file: 'original.mp4' } })).toEqual({ ref: 'independent' });
    const patch = JSON.parse(request.mock.calls[2]?.[1]?.body as string);
    expect(patch.ops).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'setAsset', asset: expect.objectContaining({ duration: 8 }) }), expect.objectContaining({ op: 'addItem', item: expect.objectContaining({ kind: 'footage', duration: 'auto' }) })]));
    expect(patch.baseVersion).toBe(doc.version);
    expect(patch.ops).toContainEqual({ op: 'setDoc', patch: { size: { width: 1280, height: 720 } } });
  });
  it('propagates save failures and never substitutes an empty new document for a failed copy', async () => {
    request.mockResolvedValue(json({ error: 'copy-composition-unavailable' }, 400));
    await expect(prepareVideoTaskDocument(args)).rejects.toThrow('copy-composition-unavailable');
    expect(request).toHaveBeenCalledTimes(1);
    await expect(prepareVideoTaskDocument({ ...args, source: {} })).rejects.toThrow('no video document');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not reimport into an emptied document that the user already edited', async () => {
    request.mockResolvedValue(json({ doc: { ...createEmptyDoc('independent', 'Variant'), version: 8 } }));
    expect(await prepareVideoTaskDocument({ ...args, source: { file: 'original.mp4' } })).toEqual({ ref: 'independent' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

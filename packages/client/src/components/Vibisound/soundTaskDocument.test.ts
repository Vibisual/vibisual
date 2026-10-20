import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyAudioDoc } from '@vibisual/audio';
import type { AppTaskDocumentArgs } from '../../apps/registry.js';
import { prepareSoundTaskDocument } from './soundTaskDocument.js';

vi.mock('./soundImport.js', () => ({ measureSoundImport: async () => 2 }));
const request = vi.fn<typeof fetch>();
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status });
const args: AppTaskDocumentArgs = { projectId: '/project', projectName: 'Project', mode: 'copy', source: { ref: 'source', file: 'old.wav' }, title: 'Variant', requestId: 'one-transition' };
beforeEach(() => { request.mockReset(); vi.stubGlobal('fetch', request); });
afterEach(() => vi.unstubAllGlobals());

describe('sound task document preparation', () => {
  it('copies the source document and carries the retry ID to its server', async () => {
    request.mockResolvedValue(json({ doc: { id: 'independent' } }));
    expect(await prepareSoundTaskDocument(args)).toEqual({ ref: 'independent' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe('/api/app/vibisound/doc/source/copy');
    expect(JSON.parse(request.mock.calls[0]?.[1]?.body as string)).toEqual({ project: 'Project', title: 'Variant', requestId: 'one-transition' });
  });
  it('creates the same new document on retry and leaves the source reference alone', async () => {
    request.mockImplementation(async (_url, init) => json({ doc: { id: JSON.parse(init?.body as string).id } }));
    const first = await prepareSoundTaskDocument({ ...args, mode: 'new' });
    expect(await prepareSoundTaskDocument({ ...args, mode: 'new' })).toEqual(first);
    expect(first.ref).toMatch(/^task-[a-f0-9]{40}$/); expect(args.source.ref).toBe('source');
  });
  it('imports file-only audio into an independent editable document', async () => {
    const doc = createEmptyAudioDoc('independent', 'Variant');
    request.mockResolvedValueOnce(json({ doc }))
      .mockResolvedValueOnce(json({ asset: { id: 'asset', path: '.vibisual/audio/assets/asset.wav', name: 'original.wav', duration: 2.1, sampleRate: 48000, channels: 2 } }))
      .mockResolvedValueOnce(json({ doc: { ...doc, version: 2 } }));
    expect(await prepareSoundTaskDocument({ ...args, source: { file: 'original.wav' } })).toEqual({ ref: 'independent' });
    const patch = JSON.parse(request.mock.calls[2]?.[1]?.body as string);
    expect(patch.ops).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'addClip', clip: expect.objectContaining({ sourceStart: 0, duration: 2, assetId: 'asset' }) })]));
    expect(patch.baseVersion).toBe(doc.version);
  });
  it('preserves a failure instead of silently returning the original or a blank target', async () => {
    request.mockResolvedValue(json({ error: 'storage-corrupt', message: 'Failed to read original' }, 500));
    await expect(prepareSoundTaskDocument(args)).rejects.toThrow('Failed to read original');
    expect(request).toHaveBeenCalledTimes(1);
    await expect(prepareSoundTaskDocument({ ...args, source: {} })).rejects.toThrow('no audio document');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not reimport into an empty mix that the user already edited', async () => {
    request.mockResolvedValue(json({ doc: { ...createEmptyAudioDoc('independent', 'Variant'), version: 8 } }));
    expect(await prepareSoundTaskDocument({ ...args, source: { file: 'original.wav' } })).toEqual({ ref: 'independent' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

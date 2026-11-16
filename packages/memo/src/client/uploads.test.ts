import { describe, expect, it, vi } from 'vitest';
import { MEMO } from '../config.js';
import type { MemoNote } from '../types.js';
import { MemoAPI, MemoAPIError } from './api.js';
import { MemoEditorSession } from './editorSession.js';
import { MemoUploads, pastedFile } from './uploads.js';

const note = (version = 1): MemoNote => ({ id: 'memo-12345678', owner: 'local', project: 'project', body: '', version, title: '', createdAt: 1, updatedAt: 1,
  aiExcluded: false, pinned: false, context: null, attachments: [], tags: [], tasks: [], deletedAt: null, requestId: 'req-12345678', author: 'user' });
const file = (size: number, name = 'clip.mp4', type = 'video/mp4'): File => new File([new Uint8Array(size)], name, { type });
const idle = async (uploads: MemoUploads): Promise<void> => { await vi.waitFor(() => { if (uploads.items.some(item => item.state !== 'failed')) throw new Error('busy'); }); };
function setup(put: (offset: number, bytes: number) => number | Promise<number>) {
  const api = new MemoAPI('project');
  const chunks = vi.spyOn(api, 'putChunk').mockImplementation(async (_id, bytes, query) => put(Number(query['offset']), bytes.size));
  vi.spyOn(api, 'request').mockResolvedValue({ ok: true });
  const commit = vi.fn(async () => note(2));
  return { api, chunks, commit, uploads: new MemoUploads(api, commit, async () => null) };
}

describe('attachment upload queue', () => {
  it('sends a large file as ordered chunks and commits it once with its size', async () => {
    const { uploads, chunks, commit } = setup((offset, bytes) => offset + bytes);
    const size = MEMO.uploadChunk * 2 + 5;
    uploads.add('memo-12345678', [file(size)]); await idle(uploads);
    expect(chunks.mock.calls.map(([, bytes, query]) => [query['offset'], bytes.size])).toEqual([['0', MEMO.uploadChunk], [String(MEMO.uploadChunk), MEMO.uploadChunk], [String(MEMO.uploadChunk * 2), 5]]);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[1]).toMatchObject({ name: 'clip.mp4', mime: 'video/mp4', size });
    expect(uploads.items).toEqual([]);
  });
  it('resumes from the offset the server reports instead of starting over', async () => {
    let first = true;
    const { uploads, chunks, commit } = setup((offset, bytes) => {
      if (first) { first = false; throw new MemoAPIError('upload-out-of-sync', { received: 3 }); }
      return offset + bytes;
    });
    uploads.add('memo-12345678', [file(10)]); await idle(uploads);
    expect(chunks.mock.calls.map(([, bytes, query]) => [query['offset'], bytes.size])).toEqual([['0', 10], ['3', 7]]);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('keeps a failed upload with its progress and continues from there on retry', async () => {
    let online = false;
    const { uploads, chunks, commit } = setup((offset, bytes) => { if (!online && offset > 0) throw new MemoAPIError('connection-failed'); return offset + bytes; });
    uploads.add('memo-12345678', [file(MEMO.uploadChunk + 4)]); await idle(uploads);
    expect(uploads.items[0]).toMatchObject({ state: 'failed', error: 'connection-failed', sent: MEMO.uploadChunk }); expect(commit).not.toHaveBeenCalled();
    online = true; chunks.mockClear(); uploads.retry(uploads.items[0]!.id); await idle(uploads);
    expect(chunks.mock.calls.map(([, , query]) => query['offset'])).toEqual([String(MEMO.uploadChunk)]);
    expect(commit).toHaveBeenCalledTimes(1); expect(uploads.items).toEqual([]);
  });
  it('rejects empty and oversized files before sending anything and discards a cancelled upload', async () => {
    const { uploads, chunks, api } = setup((offset, bytes) => offset + bytes);
    const huge = file(1); Object.defineProperty(huge, 'size', { value: MEMO.attachmentMax + 1 });
    uploads.add('memo-12345678', [file(0), huge]); await idle(uploads);
    expect(uploads.items.map(item => item.error)).toEqual(['attachment-empty', 'attachment-too-large']); expect(chunks).not.toHaveBeenCalled();
    const id = uploads.items[0]!.id; uploads.cancel(id);
    expect(uploads.items).toHaveLength(1); expect(api.request).toHaveBeenCalledWith(`/uploads/${id}`, 'DELETE');
  });
  it('names a clipboard bitmap by its paste time and leaves named files alone', () => {
    const pasted = pastedFile(new File([new Uint8Array(2)], 'image.png', { type: 'image/png' }), new Date(2026, 10, 11, 22, 5, 9));
    expect(pasted.name).toBe('capture-20261111-220509.png'); expect(pasted.type).toBe('image/png'); expect(pasted.size).toBe(2);
    const named = new File([], 'diagram.png'); expect(pastedFile(named)).toBe(named);
  });
});

describe('attachment commit beside the draft', () => {
  it('waits for the save in flight, then keeps typing made during the commit and saves it on the new version', async () => {
    const api = new MemoAPI('project'); let acknowledge!: (value: MemoNote) => void;
    const request = vi.spyOn(api, 'request').mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve as (value: MemoNote) => void; }));
    const editor = new MemoEditorSession(api); editor.edit({ body: '먼저' }); const saving = editor.flush();
    const bases: number[] = [];
    const committed = editor.sideWrite(async base => { bases.push(base.version); editor.edit({ body: '올리는 동안 쓴 글' }); return { ...note(2), body: '먼저' }; });
    acknowledge({ ...note(1), body: '먼저' }); await saving;
    expect((await committed).version).toBe(2); expect(bases).toEqual([1]);
    expect(editor.draft.body).toBe('올리는 동안 쓴 글'); expect(editor.dirty).toBe(true); expect(editor.note?.version).toBe(2);
    request.mockResolvedValueOnce({ ...note(3), body: '올리는 동안 쓴 글' });
    expect(await editor.flush()).toBe(true);
    expect(request.mock.calls.at(-1)?.[2]).toMatchObject({ baseVersion: 2, body: '올리는 동안 쓴 글' });
  });
  it('releases the save queue when the commit fails', async () => {
    const api = new MemoAPI('project'); const request = vi.spyOn(api, 'request').mockResolvedValue(note(1));
    const editor = new MemoEditorSession(api); editor.edit({ body: 'a' }); await editor.flush();
    await expect(editor.sideWrite(async () => { throw new MemoAPIError('version-conflict'); })).rejects.toThrow('version-conflict');
    editor.edit({ body: 'b' }); request.mockResolvedValueOnce({ ...note(2), body: 'b' });
    expect(await editor.flush()).toBe(true); expect(editor.note?.version).toBe(2);
  });
});

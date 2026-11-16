import { describe, expect, it, vi } from 'vitest';
import type { MemoNote } from '../types.js';
import { MemoAPI, MemoAPIError } from './api.js';
import { MemoEditorSession as MemoEditor } from './editorSession.js';

function note(body: string, version = 1): MemoNote { return { id: 'memo-12345678', owner: 'local', project: 'project', body, version, title: '', createdAt: 1, updatedAt: 1,
  aiExcluded: false, pinned: false, context: null, attachments: [], tags: [], tasks: [], deletedAt: null, requestId: 'req-12345678', author: 'user' }; }

describe('ordered draft saving', () => {
  it('keeps typing that arrives while the previous save is in flight', async () => {
    const api = new MemoAPI('project'); let acknowledge!: (value: MemoNote) => void;
    const request = vi.spyOn(api, 'request').mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve as (value: MemoNote) => void; }))
      .mockResolvedValueOnce(note('나중에 쓴 글', 2));
    const editor = new MemoEditor(api); editor.edit({ body: '먼저 쓴 글' }); const saved = editor.flush();
    editor.edit({ body: '나중에 쓴 글' }); acknowledge(note('먼저 쓴 글'));
    expect(await saved).toBe(true); expect(editor.draft.body).toBe('나중에 쓴 글'); expect(editor.note?.version).toBe(2); expect(request).toHaveBeenCalledTimes(2);
  });
  it('retains the exact failed request for retry and never marks failed storage as saved', async () => {
    const api = new MemoAPI('project'); const request = vi.spyOn(api, 'request').mockRejectedValueOnce(new MemoAPIError('connection-failed')).mockResolvedValueOnce(note('한글 보존'));
    const editor = new MemoEditor(api); editor.edit({ body: '한글 보존' });
    expect(await editor.flush()).toBe(false); expect(editor.dirty).toBe(true); expect(editor.draft.body).toBe('한글 보존');
    expect(await editor.flush()).toBe(true); expect(request.mock.calls[0]?.[2]).toEqual(request.mock.calls[1]?.[2]);
  });
  it('does not send incomplete IME composition and saves the completed syllable', async () => {
    const api = new MemoAPI('project'); const request = vi.spyOn(api, 'request').mockResolvedValue(note('한글'));
    const editor = new MemoEditor(api); editor.composing = true; editor.edit({ body: 'ㅎ' });
    expect(await editor.flush()).toBe(false); expect(request).not.toHaveBeenCalled();
    editor.composing = false; editor.edit({ body: '한글' }); expect(await editor.flush()).toBe(true); expect(editor.note?.body).toBe('한글');
  });
  it('preserves local conflicting text and can keep both copies', async () => {
    const api = new MemoAPI('project'); vi.spyOn(api, 'request').mockRejectedValueOnce(new MemoAPIError('version-conflict')).mockResolvedValueOnce({ ...note('내 변경'), id: 'memo-copy1234' });
    const editor = new MemoEditor(api); editor.reset(note('원본')); editor.edit({ body: '내 변경' });
    expect(await editor.flush()).toBe(false); expect(editor.error).toBe('version-conflict'); expect(editor.draft.body).toBe('내 변경');
    expect(await editor.keepCopy()).toBe(true); expect(editor.note?.id).toBe('memo-copy1234');
  });
  it('drops a payload the server rejected so the corrected draft can be saved', async () => {
    const api = new MemoAPI('project'); const request = vi.spyOn(api, 'request').mockRejectedValueOnce(new MemoAPIError('input-too-long')).mockResolvedValueOnce(note('짧게'));
    const editor = new MemoEditor(api); editor.edit({ title: 'x'.repeat(300) });
    expect(await editor.flush()).toBe(false); expect(editor.error).toBe('input-too-long');
    editor.edit({ title: '짧게' }); expect(editor.error).toBe('');
    expect(await editor.flush()).toBe(true); expect((request.mock.calls[1]?.[2] as { title: string }).title).toBe('짧게');
  });
  it('keeps the same session across the first save of a new note and bumps it when another note opens', async () => {
    const api = new MemoAPI('project'); vi.spyOn(api, 'request').mockResolvedValueOnce(note('a'));
    const editor = new MemoEditor(api); const start = editor.session; editor.edit({ body: 'a' }); await editor.flush();
    expect(editor.session).toBe(start); editor.reset({ ...note('b'), id: 'memo-other1234' }); expect(editor.session).toBe(start + 1);
    editor.reset(null); expect(editor.session).toBe(start + 2);
  });
});

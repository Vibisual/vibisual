import { useState } from 'react';
import { errorCode } from './api.js';
import { useMemoUploads } from './useMemoUploads.js';
import type { useMemos } from './useMemos.js';

type Memos = ReturnType<typeof useMemos>;
/** 화면이 거는 비동기 동작의 공통 틀: 진행 중 잠금과 오류 코드 표시. */
export function useMemoOps(memos: Memos) {
  const { editor, api } = memos;
  const [busy, setBusy] = useState(false);
  const uploads = useMemoUploads(memos);
  const guard = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true); memos.setError('');
    try { await operation(); } catch (error) { memos.setError(errorCode(error)); } finally { setBusy(false); }
  };
  const attach = (files: ArrayLike<File>): void => {
    const originals = Array.from(files);
    if (editor.note) { memos.setError(''); uploads.queue(editor.note.id, originals); return; }
    // 새 메모는 먼저 저장해 붙일 자리를 만든다. 올리기 자체는 잠금 밖에서 돈다.
    void guard(async () => {
      if (!editor.dirty) editor.edit({ body: '' });
      if (await editor.flush() && editor.note) uploads.queue(editor.note.id, originals);
    });
  };
  const exportAll = (): void => { void guard(async () => { if (await editor.flush()) await api.download(api.url('/export'), 'memos.zip'); }); };
  const duplicate = (): void => { void guard(async () => { await memos.duplicate(); }); };
  return { busy, guard, attach, exportAll, duplicate, uploads };
}

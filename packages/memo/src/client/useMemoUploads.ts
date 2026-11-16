import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { MemoNote } from '../types.js';
import { makePreview } from './mediaPreview.js';
import { MemoUploads, type MemoUpload } from './uploads.js';
import type { useMemos } from './useMemos.js';

type Memos = ReturnType<typeof useMemos>;
/** 올리기 줄을 화면에 묶는다. 올리는 동안 편집을 막지 않고, 확정만 저장 줄에 끼운다. */
export function useMemoUploads(memos: Memos): { uploads: readonly MemoUpload[]; queue: (noteId: string, files: readonly File[]) => void; retry: (id: string) => void; cancel: (id: string) => void } {
  const { api, editor } = memos;
  const [, redraw] = useReducer((value: number) => value + 1, 0);
  const refresh = useRef(memos.refresh); refresh.current = memos.refresh;
  const queue = useMemo(() => new MemoUploads(api, async (noteId, payload) => {
    const finalize = (base: MemoNote): Promise<MemoNote> => api.request<MemoNote>(`/notes/${noteId}/assets`, 'POST', { ...payload, baseVersion: base.version });
    // 다른 메모로 옮겨 간 뒤에 끝난 올리기는 편집 중인 초안과 무관하게 그 메모의 최신 판본에 건다.
    const note = editor.note?.id === noteId ? await editor.sideWrite(finalize) : await finalize(await api.request<MemoNote>(`/notes/${noteId}`));
    void refresh.current();
    return note;
  }, makePreview), [api, editor]);
  useEffect(() => { queue.changed = redraw; return () => { queue.changed = () => undefined; queue.stop(); }; }, [queue]);
  return { uploads: queue.items, queue: (noteId, files) => queue.add(noteId, files), retry: id => queue.retry(id), cancel: id => queue.cancel(id) };
}

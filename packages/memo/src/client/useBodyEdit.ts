import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { MemoEditorSession } from './editorSession.js';
import { diffRange, toggleLinePrefix, wrapSelection, type TextEdit } from './textEditing.js';

export type BodyChange = (value: string, start: number, end: number) => TextEdit | null;
export interface BodyEdit { apply: (edit: TextEdit) => void; wrap: (marker: string) => void; prefix: (prefix: string) => void; run: (make: BodyChange) => void }
/**
 * 본문 변환을 execCommand 로 적용해 브라우저 실행취소 기록을 남기고, 안 되면 초안 값을 직접 바꾼다.
 * commit 은 입력 칸 값을 본문에 끼우는 길(M13 에서는 칸이 본문의 한 블록이다), idle 은 열린 칸이 없을 때 도구 줄이 쓰는 길이다.
 */
export function useBodyEdit(editor: MemoEditorSession, ref: RefObject<HTMLTextAreaElement>, session: number,
  commit: (value: string) => void = value => editor.edit({ body: value }), idle?: (make: BodyChange) => void): BodyEdit {
  const caret = useRef<{ start: number; end: number } | null>(null);
  useEffect(() => { ref.current?.focus(); }, [session, ref]);
  useLayoutEffect(() => {
    const target = caret.current; caret.current = null;
    if (target) ref.current?.setSelectionRange(target.start, target.end);
  });
  const apply = (edit: TextEdit): void => {
    const el = ref.current;
    if (el) {
      // 값이 그대로면 접힌 선택에 'delete' 가 실행돼 글자 하나가 지워진다.
      if (el.value === edit.value) { el.setSelectionRange(edit.start, edit.end); return; }
      const { from, to, insert } = diffRange(el.value, edit.value);
      el.focus();
      let done = false;
      // 포커스를 못 받으면(열린 대화상자 뒤) execCommand 가 다른 입력 칸에 글자를 넣는다.
      if (document.activeElement === el) {
        el.setSelectionRange(from, to);
        try { done = document.execCommand(insert ? 'insertText' : 'delete', false, insert) && el.value === edit.value; } catch { done = false; }
      }
      if (done) { el.setSelectionRange(edit.start, edit.end); return; }
    }
    caret.current = { start: edit.start, end: edit.end };
    commit(edit.value);
  };
  const run = (make: BodyChange): void => {
    const el = ref.current;
    if (!el && idle) { idle(make); return; }
    const edit = el ? make(el.value, el.selectionStart, el.selectionEnd) : null;
    if (edit) apply(edit);
  };
  return { apply, run, wrap: marker => run((v, s, e) => wrapSelection(v, s, e, marker)), prefix: p => run((v, s, e) => toggleLinePrefix(v, s, e, p)) };
}

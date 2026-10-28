import { useMemo, useRef } from 'react';
import { useCommand } from '../../hooks/useCommand.js';
import { isInputComposing } from '../../utils/inputComposition.js';
import type { EditResult } from './editorModel.js';
import {
  copyLines,
  deleteLines,
  detectIndentUnit,
  indentLines,
  insertLine,
  moveLines,
  outdentLines,
  selectLines,
  toggleBlockComment,
  toggleLineComment,
  type CommentTokens,
} from './editorLineOps.js';

/**
 * §5.5 #17-27 ⑲ 줄 편집 단축키 — 키는 `shared/keymap.ts` 가 정하고 여기선 `useCommand` 로 듣기만 한다(§5.24 #32). 계산은 `editorLineOps.ts`.
 * 우클릭 메뉴(⑨)도 같은 조작을 쓰므로 `EditorLineOps` 를 돌려준다.
 */

/** 줄 편집 조작 — 처리했으면 `true`, 이 편집창이 할 일이 아니면(읽기 전용·주석 기호 없음) `false`. */
export interface EditorLineOps {
  copyLineUp: () => boolean;
  copyLineDown: () => boolean;
  moveLineUp: () => boolean;
  moveLineDown: () => boolean;
  deleteLine: () => boolean;
  insertLineBelow: () => boolean;
  insertLineAbove: () => boolean;
  selectLine: () => boolean;
  indentLines: () => boolean;
  outdentLines: () => boolean;
  toggleLineComment: () => boolean;
  toggleBlockComment: () => boolean;
}

interface EditorLineCommandDeps {
  textareaRef: { current: HTMLTextAreaElement | null };
  readOnly: boolean;
  comments: CommentTokens;
  /** 계산한 결과를 되돌리기가 이어지게 넣는다(`CodeEditor` 의 commitEdit). */
  commit: (el: HTMLTextAreaElement, next: EditResult) => void;
}

export function useEditorLineCommands(deps: EditorLineCommandDeps): EditorLineOps {
  // 처리기는 등록할 때 한 번 만들어지고(useCommand 가 최신 처리기를 ref 로 부른다), 조작 묶음은 메뉴가
  //   잡아 두므로 — 둘 다 렌더마다 바뀌는 값을 직접 쥐지 않고 이 ref 로 읽는다.
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const ops = useMemo<EditorLineOps>(() => {
    /**
     * 지금 선택으로 계산해 넣는다. `writes` 가 아니면(줄 고르기) 읽기 전용 파일에서도 된다.
     * 결과가 `null`(맨 위에서 위로 옮기기 같은 빈 동작)이어도 **처리한 것**이다 — 키를 아래로 흘리면
     * 브라우저 기본 동작(mac 의 ⌥↑ 문단 이동 등)이 대신 일어난다.
     */
    const run = (
      edit: (text: string, start: number, end: number) => EditResult | null,
      writes = true,
    ): boolean => {
      const { textareaRef, readOnly, commit } = depsRef.current;
      const el = textareaRef.current;
      if (!el || isInputComposing(el)) return false;
      if (writes && readOnly) return false;
      const out = edit(el.value, el.selectionStart, el.selectionEnd);
      if (out) commit(el, out);
      return true;
    };
    const unit = (text: string): string => detectIndentUnit(text);
    return {
      copyLineUp: () => run((t, s, e) => copyLines(t, s, e, 'up')),
      copyLineDown: () => run((t, s, e) => copyLines(t, s, e, 'down')),
      moveLineUp: () => run((t, s, e) => moveLines(t, s, e, 'up')),
      moveLineDown: () => run((t, s, e) => moveLines(t, s, e, 'down')),
      deleteLine: () => run((t, s, e) => deleteLines(t, s, e)),
      insertLineBelow: () => run((t, s, e) => insertLine(t, s, e, 'below')),
      insertLineAbove: () => run((t, s, e) => insertLine(t, s, e, 'above')),
      selectLine: () => run((t, s, e) => selectLines(t, s, e), false),
      indentLines: () => run((t, s, e) => indentLines(t, s, e, unit(t))),
      outdentLines: () => run((t, s, e) => outdentLines(t, s, e, unit(t))),
      // 주석 기호가 없는 언어(평문 등)는 처리하지 않는다 — `Ctrl+/` 가 그대로 흘러 단축키 목록이 뜬다.
      toggleLineComment: () => {
        const { comments } = depsRef.current;
        if (!comments.line && !comments.block) return false;
        return run((t, s, e) => toggleLineComment(t, s, e, comments));
      },
      toggleBlockComment: () => {
        const { comments } = depsRef.current;
        if (!comments.block) return false;
        return run((t, s, e) => toggleBlockComment(t, s, e, comments));
      },
    };
  }, []);

  /** 키가 **이 편집창의 본문**에서 났을 때만 — 분할 편집기에서 옆 편집창의 줄이 움직이면 안 된다. */
  const mine = (e: KeyboardEvent): boolean => e.target === depsRef.current.textareaRef.current;

  useCommand('editor.copyLineUp', (e) => mine(e) && ops.copyLineUp());
  useCommand('editor.copyLineDown', (e) => mine(e) && ops.copyLineDown());
  useCommand('editor.moveLineUp', (e) => mine(e) && ops.moveLineUp());
  useCommand('editor.moveLineDown', (e) => mine(e) && ops.moveLineDown());
  useCommand('editor.deleteLine', (e) => mine(e) && ops.deleteLine());
  useCommand('editor.insertLineBelow', (e) => mine(e) && ops.insertLineBelow());
  useCommand('editor.insertLineAbove', (e) => mine(e) && ops.insertLineAbove());
  useCommand('editor.selectLine', (e) => mine(e) && ops.selectLine());
  useCommand('editor.indentLines', (e) => mine(e) && ops.indentLines());
  useCommand('editor.outdentLines', (e) => mine(e) && ops.outdentLines());
  useCommand('editor.toggleLineComment', (e) => mine(e) && ops.toggleLineComment());
  useCommand('editor.toggleBlockComment', (e) => mine(e) && ops.toggleBlockComment());

  return ops;
}

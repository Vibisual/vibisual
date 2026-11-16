import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type JSX, type KeyboardEvent, type RefObject } from 'react';
import type { MemoEditorSession } from './editorSession.js';
import { filterInserts, insertStamp, mirrorParts, pasteEdit, runSlash, slashQuery, type InsertId } from './insertMenu.js';
import { MemoInsertMenu } from './MemoInsertMenu.js';
import { tableEnter, tableMove } from './tableEditing.js';
import { continueList, flipTask, indentLines, linkSelection, moveLines, toggleTask, wrapSelection, type TextEdit } from './textEditing.js';
import type { MemoText } from './ui.js';
import type { BodyEdit } from './useBodyEdit.js';

export interface BodyCaret { start: number; end: number }
/** 칸 가장자리에서 블록 밖으로 나가는 키(M13 (C)). true 를 돌려주면 그 키의 기본 동작을 막는다. */
export type BodyEdge = (key: 'up' | 'down' | 'left' | 'right' | 'back' | 'del' | 'escape', column: number) => boolean;
interface MemoBodyProps {
  tr: MemoText; editor: MemoEditorSession; locked: boolean; bodyRef: RefObject<HTMLTextAreaElement>; edit: BodyEdit;
  mirrorRef?: RefObject<HTMLDivElement>;
  caret: BodyCaret; setCaret: (caret: BodyCaret) => void; locale: string | undefined;
  /** 칸의 글자 — 본문 전체이거나(M10) 편집 중인 한 블록이다(M13). */
  value: string; commit: (value: string) => void;
  /** 한 블록 칸: 높이는 원문 글자만큼이고 글자 크기를 블록에 맞춘다. */
  block?: { textClass: string | undefined; placeholder?: string; edge: BodyEdge; selectAll: () => void };
}
const TEXT = 'col-start-1 row-start-1 w-full min-w-0 break-words';
const SIZE = 'text-[15px] leading-7';
// 굵고 큰 글자는 글리프가 줄 높이를 1~3px 넘어 textarea 가 그만큼 스크롤된다. 칸 높이는 그대로 두고 입력 칸만 살짝 늘린다.
const FIT = 'h-[calc(100%+4px)] -mb-1';

export function MemoBody({ tr, editor, locked, bodyRef, mirrorRef, edit, caret, setCaret, locale, value: body, commit, block }: MemoBodyProps): JSX.Element {
  const text = `${TEXT} ${block?.textClass ?? SIZE}`;
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [flip, setFlip] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const slash = locked ? null : slashQuery(body, caret.start, caret.end);
  const items = slash ? filterInserts(slash.query, id => tr(`insert.${id}`)) : [];
  const from = slash && slash.from !== dismissed && items.length > 0 ? slash.from : null;
  const query = slash?.query;
  useEffect(() => { setActive(0); }, [from, query]);
  useEffect(() => { if (!slash) setDismissed(null); }, [slash === null]);
  // 목록이 오른쪽으로 넘치면 커서 왼쪽으로 편다.
  useLayoutEffect(() => {
    const el = anchor.current; const menu = el?.querySelector<HTMLElement>('[role="listbox"]'); const frame = el?.offsetParent;
    setFlip(!!el && !!menu && !!frame && el.offsetLeft + menu.offsetWidth > frame.clientWidth && el.offsetLeft >= menu.offsetWidth);
  }, [from]);
  // 겹침 층은 입력 칸과 같은 글자·같은 줄바꿈이라, 체크박스 표식과 삽입 목록을 좌표 계산 없이 그 글자 자리에 세운다.
  const parts = useMemo(() => mirrorParts(body, from, !locked), [body, from, locked]);
  const track = (el: { value: string; selectionStart?: number | null; selectionEnd?: number | null }): void => {
    const start = el.selectionStart ?? el.value.length; const end = el.selectionEnd ?? start;
    if (start !== caret.start || end !== caret.end) setCaret({ start, end });
  };
  const pick = (id: InsertId): void => {
    if (from !== null) edit.apply(runSlash(id, body, from, caret.start, insertStamp(new Date(), locale)));
  };
  const check = (at: number): void => {
    const el = bodyRef.current;
    const next = flipTask(el?.value ?? body, at);
    if (next !== null) edit.apply({ value: next, start: el?.selectionStart ?? caret.start, end: el?.selectionEnd ?? caret.end });
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (editor.composing || event.nativeEvent?.isComposing) return;
    const { value, selectionStart: start, selectionEnd: end } = event.currentTarget;
    const mod = event.ctrlKey || event.metaKey;
    const bare = !mod && !event.altKey;
    if (block && mod && !event.altKey && !event.shiftKey && (event.code === 'KeyA' || event.key.toLowerCase() === 'a')) {
      event.preventDefault(); event.stopPropagation(); block.selectAll(); return;
    }
    if (from !== null && bare) {
      const id = items[active] ?? items[0];
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length); return; }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && id) { event.preventDefault(); pick(id); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(from); return; }
    }
    if (block && (from === null || event.key === 'Delete' || event.key === 'Backspace') && start === end && !event.shiftKey && !mod && !event.altKey) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const key = event.key === 'ArrowUp' && lineStart === 0 ? 'up'
        : event.key === 'ArrowDown' && !value.includes('\n', start) ? 'down'
        : event.key === 'ArrowLeft' && start === 0 ? 'left'
        : event.key === 'ArrowRight' && start === value.length ? 'right'
        : event.key === 'Backspace' && start === 0 ? 'back'
        : event.key === 'Delete' && start === value.length ? 'del'
        : event.key === 'Escape' ? 'escape' : null;
      if (key && block.edge(key, start - lineStart)) { event.preventDefault(); event.stopPropagation(); return; }
    }
    const only = mod && !event.altKey && !event.shiftKey;
    let next: TextEdit | null = null;
    if (event.key === 'Enter' && bare && !event.shiftKey) next = (start === end ? tableEnter(value, start) : null) ?? continueList(value, start, end);
    else if (event.key === 'Tab' && bare) next = (start === end ? tableMove(value, start, event.shiftKey) : null) ?? indentLines(value, start, end, event.shiftKey);
    else if (event.key === 'Enter' && only) next = toggleTask(value, start, end);
    else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.altKey && !mod && !event.shiftKey) next = moveLines(value, start, end, event.key === 'ArrowUp');
    else if (only && event.code === 'KeyB') next = wrapSelection(value, start, end, '**');
    else if (only && event.code === 'KeyI') next = wrapSelection(value, start, end, '*');
    else if (only && event.code === 'KeyK') next = linkSelection(value, start, end);
    else if (mod && !event.altKey && event.shiftKey && event.code === 'KeyX') next = wrapSelection(value, start, end, '~~');
    if (!next) return;
    event.preventDefault(); edit.apply(next);
  };
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (locked || editor.composing) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const html = event.clipboardData?.getData('text/html') ?? '';
    const markdown = event.clipboardData?.getData('text/markdown') ?? '';
    if (!text && !html && !markdown) return;
    const { value, selectionStart, selectionEnd } = event.currentTarget;
    const next = pasteEdit(value, selectionStart, selectionEnd, text, html, markdown);
    if (!next) return;
    event.preventDefault(); setCaret({ start: next.start, end: next.end }); edit.apply(next);
  };
  return <div className={`relative grid grid-cols-1 ${block ? '' : 'min-h-[40vh]'}`}>
    <div ref={mirrorRef} aria-hidden="true" className={`${text} pointer-events-none invisible z-[1] whitespace-pre-wrap`}>
      {parts.map(part => part.kind === 'text' ? part.text
        : part.kind === 'task' ? <span key={part.at} title={tr('toggleCheck')} onMouseDown={event => event.preventDefault()} onClick={() => check(part.at)}
          className={`pointer-events-auto visible cursor-pointer rounded text-transparent ${part.checked ? 'bg-blue-500/25 hover:bg-blue-500/40' : 'bg-gray-700/40 hover:bg-blue-500/30'}`}>{body.slice(part.at - 1, part.at + 2)}</span>
        : <span key="anchor" ref={anchor} data-memo-insert-anchor>
          {/* 바깥 그리드에 위치를 잡으면 스크롤하는 겹침 층이 목록을 자르지 않는다. */}
          <span className={`absolute inline-block [margin-block-start:calc(1lh+0.25rem)] ${flip ? '-translate-x-full' : ''}`}>
            <MemoInsertMenu tr={tr} items={items} active={active} hover={setActive} pick={pick} className="pointer-events-auto visible" />
          </span>
        </span>)}
      {'​'}
    </div>
    <textarea ref={bodyRef} value={body} rows={1} disabled={locked} data-rich-paste="true" placeholder={block ? block.placeholder : tr('capturePlaceholder')} aria-label={tr('body')}
      className={`${text} ${block ? FIT : 'h-full'} resize-none bg-transparent text-gray-100 placeholder:text-gray-600 outline-none disabled:opacity-60 overflow-hidden`}
      onScroll={event => { if (mirrorRef?.current) mirrorRef.current.scrollTop = event.currentTarget.scrollTop; }}
      onCompositionStart={() => { editor.composing = true; }}
      onCompositionEnd={event => { editor.composing = false; commit(event.currentTarget.value); }}
      onChange={event => { track(event.target); commit(event.target.value); }}
      onSelect={event => track(event.currentTarget)} onKeyDown={keyDown} onPaste={paste} />
    {!block && !body && !locked && <p className="pointer-events-none absolute left-0 right-0 top-8 text-xs text-gray-600">{tr('slashHint')}</p>}
    <span role="status" className="sr-only">{from !== null ? tr(`insert.${items[active] ?? items[0] ?? 'todo'}`) : ''}</span>
  </div>;
}

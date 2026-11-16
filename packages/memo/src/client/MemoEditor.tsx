import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import { MEMO } from '../config.js';
import type { MemoClientHost } from '../host.js';
import type { MemoContext } from '../types.js';
import type { MemoEditorSession } from './editorSession.js';
import { focusBodyCaret, type PendingBodyCaret } from './bodyCaretScroll.js';
import { relativeTime, textStats } from './listView.js';
import { MemoAttachments, type MemoMediaActions } from './MemoAttachments.js';
import { blockAt, headingTextClass, joinSegment, rangeFits, rangeOf, segmentOf, splitBlocks, type LiveRange } from './liveBlocks.js';
import { MemoBody, type BodyCaret } from './MemoBody.js';
import { liveEdges } from './liveEdges.js';
import { MemoLiveBody } from './MemoLiveBody.js';
import { MemoContextLink } from './MemoContextLink.js';
import { MemoTableDialog } from './MemoTableDialog.js';
import { MemoTags } from './MemoTags.js';
import { MemoTasks } from './MemoTasks.js';
import { MemoToolbar } from './MemoToolbar.js';
import { findTable, tableEdit, writeTable, type TableModel } from './tableEditing.js';
import { taskMarks, toggleTaskAt, type TextEdit } from './textEditing.js';
import type { MemoText } from './ui.js';
import { useBodyEdit, type BodyChange } from './useBodyEdit.js';

interface MemoEditorProps {
  tr: MemoText; editor: MemoEditorSession; disabled: boolean; host: MemoClientHost; now: number; locale: string | undefined; suggestions: string[];
  attach: (files: ArrayLike<File>) => void; media: MemoMediaActions;
  action: (payload: Record<string, unknown>) => void; history: () => void; duplicate: () => void;
}
const keepInside = (target: Element): boolean => target.closest('[data-memo-keep], dialog, [role="dialog"]') !== null;

export function MemoEditor({ tr, editor, disabled, host, now, locale, suggestions, attach, media, action, history, duplicate }: MemoEditorProps): JSX.Element {
  const bodyRef = useRef<HTMLTextAreaElement>(null); const fileRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const note = editor.note; const draft = editor.draft; const trash = note !== null && note.deletedAt !== null;
  const locked = disabled || trash;
  const stats = useMemo(() => textStats(draft.body), [draft.body]);
  const Markdown = host.Markdown;
  const body = draft.body;
  const [caret, setCaret] = useState<BodyCaret>({ start: 0, end: 0 });
  const [grid, setGrid] = useState<TableModel | null>(null);
  const [gridResult, setGridResult] = useState<TableModel | null>(null);
  useEffect(() => { setCaret({ start: 0, end: 0 }); setGrid(null); }, [editor.session]);
  // §5.13 MEMO M13 — 편집 중인 블록. 문서를 바꾸면 버리고, 빈 메모는 처음부터 칸을 연다.
  const [opened, setOpened] = useState<{ session: number; range: LiveRange | null } | null>(null);
  const pendingCaret = useRef<PendingBodyCaret | null>(null);
  const documentSession = useRef<number | null>(null);
  const pendingEdit = useRef<TextEdit | null>(null);
  const live = !!Markdown;
  const stored = opened?.session === editor.session ? opened.range : (body === '' && !trash ? { start: 0, tail: 0, lead: '' } : null);
  const range = live && !trash && stored && rangeFits(body, stored) ? stored : null;
  const segment = live ? (range ? segmentOf(body, range) : '') : body;
  const blocks = useMemo(() => live ? splitBlocks(segment) : [], [live, segment]);
  const activeBlock = range && !range.lead && blocks.length === 1 ? blocks[0] : undefined;
  const activate = useCallback((next: LiveRange | null, at?: BodyCaret, clickY?: number): void => {
    documentSession.current = null;
    setOpened({ session: editor.session, range: next });
    if (next && at) { pendingCaret.current = { ...at, clickY }; setCaret(at); }
  }, [editor.session]);
  const selectAll = (): void => {
    activate({ start: 0, tail: 0, lead: '' }, { start: 0, end: body.length });
    documentSession.current = editor.session;
  };
  const deleteSelection = (start: number, end: number): void => {
    activate({ start: 0, tail: 0, lead: '' }, { start, end });
    documentSession.current = editor.session;
    pendingEdit.current = { value: body.slice(0, start) + body.slice(end), start, end: start };
  };
  const commit = (value: string): void => {
    if (!live) { editor.edit({ body: value }); return; }
    if (!range) return;
    const joined = joinSegment(body, range, value);
    // 빈 메모의 기본 칸은 상태에 없으므로 첫 글자에서 붙잡아 둔다.
    if (joined.range !== range || opened?.session !== editor.session) setOpened({ session: editor.session, range: joined.range });
    editor.edit({ body: joined.body });
  };
  // 열린 칸이 없을 때 도구 줄 단추는 본문 끝에 넣고 그 블록을 연다(M13 (D)).
  const idle = (make: BodyChange): void => {
    const next = make(body, body.length, body.length);
    if (!next) return;
    editor.edit({ body: next.value });
    const block = blockAt(splitBlocks(next.value), next.start);
    if (block) activate(rangeOf(next.value, block), { start: next.start - block.start, end: Math.min(next.end, block.end) - block.start });
  };
  const edit = useBodyEdit(editor, bodyRef, editor.session, commit, live ? idle : undefined);
  // 커서가 칸 안의 다른 블록으로 넘어가면 칸을 그 블록으로 줄여, 나머지는 바로 서식 모양이 된다(M13 (B)).
  useLayoutEffect(() => {
    if (!range || editor.composing || documentSession.current === editor.session) return;
    if (blocks.length < 2) return;
    const target = blockAt(blocks, caret.start);
    if (!target || caret.end > target.end) return;
    activate({ start: range.start + target.start, tail: range.tail + segment.length - target.end, lead: '' },
      { start: caret.start - target.start, end: caret.end - target.start });
  }, [segment, caret.start, caret.end]);
  useLayoutEffect(() => {
    const at = pendingCaret.current; const el = bodyRef.current;
    if (!at || !el) return;
    pendingCaret.current = null;
    focusBodyCaret(el, activeBlock ? mirrorRef.current : null, at);
    const change = pendingEdit.current; pendingEdit.current = null;
    if (change) edit.apply(change);
  });
  const edge = liveEdges(body, range, activate, value => editor.edit({ body: value }));
  const writing = !locked && (!live || range !== null);
  const table = useMemo(() => writing ? findTable(segment, caret.start) : null, [writing, segment, caret.start]);
  const checks = useMemo(() => taskMarks(draft.body), [draft.body]);
  // 대화상자가 닫혀 포커스가 본문으로 돌아온 뒤에 써야 실행취소 기록에 남는다.
  useEffect(() => {
    if (!gridResult) return;
    setGridResult(null); edit.run((value, start) => writeTable(value, start, gridResult));
  }, [gridResult]);
  const openGrid = (): void => {
    if (table) setGrid({ head: table.head, align: table.align, rows: table.rows });
  };
  const checkRead = (offset: number): void => {
    const next = toggleTaskAt(draft.body, offset);
    if (next !== null) editor.edit({ body: next });
  };
  return <main className="min-w-0 flex-1">
    <MemoToolbar tr={tr} host={host} saved={note !== null} trash={trash} locked={locked} busy={disabled} pinned={draft.pinned} aiExcluded={draft.aiExcluded}
      body={draft.body} edit={edit} locale={locale} inTable={table !== null} tableOp={op => edit.run((value, start) => tableEdit(value, start, op))} openGrid={openGrid} toggle={patch => editor.edit(patch)} pickFiles={() => fileRef.current?.click()}
      history={history} duplicate={duplicate} trashAction={() => action({ action: trash ? 'restore' : 'trash' })} />
    <input ref={fileRef} type="file" multiple className="hidden" tabIndex={-1} aria-hidden="true"
      onChange={event => { if (event.target.files?.length) attach(event.target.files); event.target.value = ''; }} />
    {trash && <p className="border-b border-gray-800 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">{tr('trashHint')}</p>}
    <div data-select-scope="document" className="mx-auto w-full max-w-3xl space-y-6 px-8 py-6 box-narrow:px-4 box-narrow:py-4">
      <div className="space-y-2">
        <input className="w-full bg-transparent text-2xl font-semibold text-gray-100 placeholder:text-gray-600 outline-none disabled:opacity-60" placeholder={tr('title')} aria-label={tr('titleOptional')}
          value={draft.title} maxLength={MEMO.titleMax} disabled={locked} onChange={event => editor.edit({ title: event.target.value })}
          onKeyDown={event => { if (event.key === 'Enter' && !editor.composing && !event.nativeEvent?.isComposing) { event.preventDefault(); bodyRef.current?.focus(); } }} />
        {note && <p className="text-xs text-gray-500">
          {tr('edited', { time: relativeTime(note.updatedAt, now, locale) })} · {tr('version', { version: note.version })} · {tr('stats', { chars: stats.chars.toLocaleString(locale), words: stats.words.toLocaleString(locale) })}
          {checks.length > 0 && <> · {tr('taskProgress', { done: checks.filter(mark => mark.checked).length, total: checks.length })}</>}
        </p>}
      </div>
      {Markdown
        ? <MemoLiveBody body={body} range={range} segment={segment} activeBlock={activeBlock} locked={locked} Markdown={Markdown} activate={activate} toggleTask={checkRead} keepInside={keepInside} selectAll={selectAll} deleteSelection={deleteSelection}
          hint={!body && !locked ? tr('slashHint') : null}>
          {range && <MemoBody key={editor.session} tr={tr} editor={editor} locked={locked} bodyRef={bodyRef} mirrorRef={mirrorRef} edit={edit} caret={caret} setCaret={setCaret} locale={locale}
            value={segment} commit={commit} block={{ edge, selectAll, textClass: headingTextClass(activeBlock?.level), ...(body === '' ? { placeholder: tr('capturePlaceholder') } : {}) }} />}
        </MemoLiveBody>
        : <MemoBody key={editor.session} tr={tr} editor={editor} locked={locked} bodyRef={bodyRef} edit={edit} caret={caret} setCaret={setCaret} locale={locale} value={body} commit={commit} />}
      {draft.body.length > MEMO.bodyMax && <p role="note" className="text-xs text-rose-300">{tr('errors.input-too-long')}</p>}
      <MemoTasks key={`tasks-${editor.session}`} tr={tr} tasks={draft.tasks} locked={locked} change={tasks => editor.edit({ tasks })} />
      <MemoTags key={`tags-${editor.session}`} tr={tr} tags={draft.tags} suggestions={suggestions} locked={locked} composing={() => editor.composing} change={tags => editor.edit({ tags })} />
      <MemoContextLink tr={tr} context={draft.context} contexts={host.contexts(editor.api.project)} locked={locked}
        change={(context: MemoContext | null) => editor.edit({ context })} open={context => host.openContext(editor.api.project, context)} />
      {note && <MemoAttachments key={note.id} tr={tr} api={editor.api} host={host} noteId={note.id} attachments={note.attachments} locale={locale} locked={locked} media={media} />}
    </div>
    {grid && <MemoTableDialog tr={tr} table={grid} close={() => setGrid(null)} apply={table => { setGrid(null); setGridResult(table); }} />}
  </main>;
}

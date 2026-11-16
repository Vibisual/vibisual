import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type ComponentType, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { MEMO } from '../config.js';
import type { MemoClientHost } from '../host.js';
import type { MemoAIJob, MemoCitation, MemoNote } from '../types.js';
import { MemoAIPanel } from './MemoAIPanel.js';
import { MemoEditor } from './MemoEditor.js';
import { MemoErrorBar } from './MemoErrorBar.js';
import { MemoHeader, type MemoSaveState } from './MemoHeader.js';
import { MemoHistory } from './MemoHistory.js';
import { MemoLibrary } from './MemoLibrary.js';
import { MemoSettings } from './MemoSettings.js';
import { MemoSource } from './MemoSource.js';
import { errorCode } from './api.js';
import { IconPaperclip } from './icons.js';
import { formatBytes } from './listView.js';
import { pastedFile } from './uploads.js';
import { useFileDrop } from './useFileDrop.js';
import { useMemoOps } from './useMemoOps.js';
import { useMemos } from './useMemos.js';
import { useMemoShortcuts } from './useMemoShortcuts.js';
import { useNow } from './useNow.js';
import { useSelectionScope } from './selectionScope.js';

interface MemoShellProps { params: Readonly<Record<string, string>>; host: MemoClientHost }
export function MemoShell({ params, host }: MemoShellProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const tr = (key: string, vars?: Record<string, string | number>): string => t(`memo.${key}`, { ...vars, defaultValue: t('memo.errors.generic') });
  const memos = useMemos(params['projectId'] ?? '', params['memoId'], host.mediaUrl);
  const { editor, api } = memos;
  const { busy, guard, attach, exportAll, duplicate, uploads } = useMemoOps(memos);
  const [selected, setSelected] = useState<string[]>([]); const [history, setHistory] = useState(false);
  const [aiOpen, setAIOpen] = useState(false); const [settings, setSettings] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [source, setSource] = useState<{ note: MemoNote; citation: MemoCitation } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null); const searchRef = useRef<HTMLInputElement>(null);
  const now = useNow(MEMO.clockMs); const locale = i18n?.language;
  const note = editor.note; const Scroll = host.Scroll;
  const aiEnabled = host.useAIEnabled ? host.useAIEnabled() : memos.list.settings.aiEnabled;
  host.useLifecycle(params, note?.id ?? null, () => editor.flush());
  useEffect(() => { setSelected([]); }, [memos.query]);
  const suggestions = useMemo(() => [...new Set(memos.list.notes.flatMap(item => item.tags))], [memos.list.notes]);
  const narrow = (): boolean => rootRef.current?.closest('[data-box]')?.getAttribute('data-box')?.includes('narrow') ?? false;
  // 좁은 창은 첫 열림부터 문서가 보여야 한다. 호스트가 data-box 를 셸보다 먼저 layout 단계에서 단다.
  useLayoutEffect(() => { if (narrow()) setLibraryOpen(false); }, []);
  const openNote = (id: string | null): void => { if (busy) return; void memos.open(id); if (narrow()) setLibraryOpen(false); };
  const showSource = (jobId: string, citation: MemoCitation): void => { void guard(async () => {
    const job = await api.request<MemoAIJob>(`/jobs/${jobId}`);
    const found = job.sources.find(value => value.id === citation.noteId && value.version === citation.version);
    if (found) setSource({ note: found, citation });
  }); };
  const locked = busy || memos.loading || (note !== null && note.deletedAt !== null);
  const drop = useFileDrop(attach, locked);
  const paste = (event: ClipboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented) return;
    const files = event.clipboardData?.files;
    // Office 류는 글자와 함께 비트맵도 files 로 노출하므로, 글자가 있으면 기본 붙여넣기를 둔다.
    if (locked || !files?.length || event.clipboardData.getData('text/plain')) return;
    event.preventDefault(); attach(Array.from(files, file => pastedFile(file)));
  };
  const onKeyDown = useMemoShortcuts({
    searchRef, newNote: () => openNote(null), showLibrary: () => setLibraryOpen(true),
    toggleLibrary: () => setLibraryOpen(value => !value), save: () => { void editor.flush(); },
  });
  useSelectionScope(rootRef);
  const status: MemoSaveState = editor.saving ? 'saving' : editor.error ? 'saveFailed' : editor.dirty ? 'unsaved' : note ? 'saved' : 'ready';
  return <div ref={rootRef} onKeyDown={onKeyDown} className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-gray-900 text-gray-100">
    <MemoHeader tr={tr} host={host} status={status} busy={busy} libraryOpen={libraryOpen} aiOpen={aiOpen}
      toggleLibrary={() => setLibraryOpen(value => !value)} newNote={() => openNote(null)} toggleAI={() => setAIOpen(value => !value)} openSettings={() => setSettings(true)} />
    {(memos.error || editor.error) && <MemoErrorBar tr={tr} code={editor.error || memos.error} saveError={editor.error} max={formatBytes(MEMO.attachmentMax, locale)}
      retry={() => { void editor.flush().then(ok => { if (ok) void memos.refresh(); }); }} keepCopy={() => { void editor.keepCopy().then(ok => { if (ok) void memos.refresh(); }); }} />}
    <div className="flex min-h-0 flex-1">
      <MemoLibrary tr={tr} locale={locale} now={now} notes={memos.list.notes} active={note?.id ?? null} selecting={aiOpen} selected={selected} select={setSelected}
        query={memos.query} queryChange={memos.setQuery} open={openNote} searchRef={searchRef} Scroll={Scroll}
        className={libraryOpen ? 'flex basis-72 shrink-0 box-narrow:basis-full' : 'hidden'} />
      {/* 세로 flex 여야 Scroll(fill) 이 높이를 받는다 — 없으면 감싸개가 내용 높이로 늘어 `.scroll-fade` 에 잘리고 편집 영역이 스크롤되지 않는다. */}
      <div {...drop.bind} onPaste={paste} className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${libraryOpen ? 'box-narrow:hidden' : ''}`}>
        <Scroll fill className="min-h-0 min-w-0 flex-1"><div className="flex min-h-full min-w-0 flex-wrap items-start">
          <MemoEditor tr={tr} editor={editor} disabled={busy || memos.loading} host={host} now={now} locale={locale} suggestions={suggestions}
            attach={attach} history={() => setHistory(true)} duplicate={duplicate}
            action={payload => { void guard(async () => { await memos.action(payload); }); }}
            media={{ ...uploads,
              // 내려받기는 스트리밍 주소로 받아 편집을 잠그지 않는다.
              download: asset => { if (note) void api.download(api.media(note.id, asset.id), asset.name).catch((error: unknown) => memos.setError(errorCode(error))); },
              detach: id => { void guard(async () => { await memos.action({ detach: id }); }); } }} />
          {aiOpen && <MemoAIPanel editor={editor} selected={selected} enabled={aiEnabled} tr={tr} changed={memos.refresh} source={showSource} />}
        </div></Scroll>
        {drop.dragging && <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-blue-400/60 bg-gray-900/80 text-sm text-blue-200">
          <IconPaperclip className="h-6 w-6 shrink-0" />{tr('dropHint')}
        </div>}
      </div>
    </div>
    {history && note && <MemoHistory api={api} note={note} tr={tr} Scroll={Scroll} close={() => setHistory(false)}
      revert={version => { void guard(async () => { if (await memos.action({ action: 'revert', version })) setHistory(false); }); }} />}
    {source && <MemoSource {...source} tr={tr} Scroll={Scroll} close={() => setSource(null)} />}
    {settings && <MemoSettings tr={tr} host={host} aiEnabled={aiEnabled} busy={busy} changeAI={enabled => { void memos.changeAI(enabled); }} exportAll={exportAll} close={() => setSettings(false)} />}
  </div>;
}
export function createMemoShell(host: MemoClientHost): ComponentType<{ appId: string; params: Readonly<Record<string, string>> }> {
  return function MemoAppShell({ params }): JSX.Element { return <MemoShell params={params} host={host} />; };
}

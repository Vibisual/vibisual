import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { workspaceFindUrl } from '@vibisual/shared';
import type { EditorPaneFileKind, WorkspaceEntry, WorkspaceFindResult } from '@vibisual/shared';
import { workspaceOpenClaims } from '../../apps/registry.js';
import { isComposingKeyEvent } from '../../utils/inputComposition.js';
import { ScrollFade } from '../ScrollFade.js';
import { formatCheckedAgo } from '../Panel/modelSectionView.js';
import { useIDEBodyLayout } from './ideBodyLayoutContext.js';
import { useIDEPaneActions, useIDEPaneKey, useIDEPaneValue } from './idePane.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { editorFileFromRelPath } from './editorModel.js';
import { splitRelPath } from './explorerModel.js';
import { formatPromptStamp } from './promptStamp.js';
import { PANE_KIND_TEXT, PaneKindGlyph } from './paneKinds.js';
import {
  OPENER_RENDER_MAX,
  cachedFindResult,
  filterOpenerEntries,
  openerExtensionsOf,
  rememberFindResult,
  subscribeOpenerFocus,
  takeOpenerFocus,
} from './paneOpenerModel.js';

/**
 * IDEPaneOpener.tsx — §5.5 #17-27 ⑱ (d) 빈 탭 = 갈래 파일 고르기(최근 고친 순, 받은 목록 안에서 좁히기, 고르면 같은 자리 탭 — `fillPaneOpener`).
 * 목록은 `GET /api/workspace-find` 한 번(⑱ (g)). 앱 선언 확장자는 화면 등록표에서 실어 서버와 판정을 맞춘다. 못 찾으면 [폴더 따라 찾기].
 */

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; result: WorkspaceFindResult };

export const IDEPaneOpener = memo(function IDEPaneOpener({ kind, openerKey }: {
  kind: EditorPaneFileKind;
  /** 이 빈 탭의 키 — 고르면 이 탭이 그 파일 탭이 된다. */
  openerKey: string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const rootPath = useIDEProjectRoot();
  const paneKey = useIDEPaneKey();
  const { fillPaneOpener, setActiveView, toggleSidebar } = useIDEPaneActions();
  const sidebarCollapsed = useIDEPaneValue((o) => o.sidebarCollapsed);
  const { sidebarDrawer, setNavOpen } = useIDEBodyLayout();
  const text = PANE_KIND_TEXT[kind];

  // ─── 목록 — 설 때마다 새로 받되, 받아 둔 것이 있으면 그것부터 그린다 ───
  //   빈 탭은 다른 탭과 오갈 때마다 다시 서므로, 빈 화면에서 기다리게 하지 않는다. 그렇다고 받아 둔 것에
  //   머물면 방금 만들어진 파일이 없다 — 그래서 받아 둔 것을 그리고 같은 조회를 뒤에서 다시 한다.
  const [reloadToken, setReloadToken] = useState(0);
  const [list, setList] = useState<ListState>({ status: 'loading' });
  useEffect(() => {
    if (!rootPath) return;
    // 늦게 온 답이 새 갈래·새 루트의 목록을 덮지 않게 — 이 효과가 접히면 그 답은 버린다.
    let alive = true;
    const url = workspaceFindUrl(rootPath, kind, workspaceOpenClaims());
    const cached = cachedFindResult(url);
    setList(cached ? { status: 'ready', result: cached } : { status: 'loading' });
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return (await r.json()) as WorkspaceFindResult;
      })
      .then((result) => {
        rememberFindResult(url, result);
        if (alive) setList({ status: 'ready', result });
      })
      // 받아 둔 목록이 서 있으면 그대로 둔다 — 다시 받기 실패가 멀쩡한 목록을 오류 화면으로 바꾸지 않게.
      .catch(() => { if (alive && !cached) setList({ status: 'error' }); });
    return () => { alive = false; };
  }, [rootPath, kind, reloadToken]);

  // ─── 이름으로 좁히기 + 키보드 커서 ───
  const [query, setQuery] = useState('');
  const entries = list.status === 'ready' ? list.result.entries : null;
  const filtered = useMemo(() => (entries ? filterOpenerEntries(entries, query) : []), [entries, query]);
  const shown = filtered.length > OPENER_RENDER_MAX ? filtered.slice(0, OPENER_RENDER_MAX) : filtered;
  const [cursor, setCursor] = useState(0);
  useEffect(() => { setCursor(0); }, [query, entries]);

  const listRef = useRef<HTMLDivElement | null>(null);
  // 커서가 움직이면 그 줄이 보이게 — 가장 가까운 쪽으로만 민다(목록이 튀지 않게).
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-opener-row="${String(cursor)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // ─── 초점 — 사용자가 **방금 연** 빈 탭만 가져간다(세션을 오가다 다시 선 탭은 입력창을 뺏지 않는다) ───
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const tryFocus = (): void => {
      if (takeOpenerFocus(paneKey, openerKey)) inputRef.current?.focus();
    };
    tryFocus();
    return subscribeOpenerFocus(tryFocus);
  }, [paneKey, openerKey]);

  const pick = useCallback((entry: WorkspaceEntry): void => {
    if (!rootPath) return;
    fillPaneOpener(openerKey, editorFileFromRelPath(entry.relPath, rootPath));
  }, [rootPath, openerKey, fillPaneOpener]);

  /** [폴더 따라 찾기] — 활동바가 뷰를 펴는 그 문법 그대로(접혀 있으면 펴고, 서랍이면 서랍까지). */
  const browseFolders = useCallback((): void => {
    setActiveView('files');
    if (sidebarCollapsed) toggleSidebar();
    if (sidebarDrawer) setNavOpen(true);
  }, [setActiveView, sidebarCollapsed, toggleSidebar, sidebarDrawer, setNavOpen]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>): void => {
    // 입력기가 먹은 키(한글 조합 확정 · 후보 고르기)는 우리 것이 아니다.
    if (isComposingKeyEvent(e.nativeEvent)) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, shown.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      const hit = shown[cursor];
      if (hit) { e.preventDefault(); pick(hit); }
    } else if (e.key === 'Escape' && query.length > 0) {
      // 검색어가 있을 때의 Esc 는 검색어만 지운다. 빈 칸이면 (H-20) 그대로 창의 것이다.
      e.preventDefault();
      e.stopPropagation();
      setQuery('');
    }
  }, [shown, cursor, pick, query]);

  const extensions = useMemo(() => openerExtensionsOf(kind, workspaceOpenClaims()), [kind]);
  const scope = extensions.length > 0
    ? t('ide.paneOpener.scope', { list: extensions.join(' · ') })
    : t('ide.paneOpener.scopeCode');

  const now = Date.now();
  const locale = i18n.language;

  let body: React.ReactNode;
  if (!rootPath) {
    body = <p className="px-3 py-4 text-center text-[12px] text-gray-500">{t('ide.explorer.noProject')}</p>;
  } else if (list.status === 'loading') {
    body = <p className="px-3 py-4 text-center text-[12px] text-gray-500">{t('ide.explorer.loading')}</p>;
  } else if (list.status === 'error') {
    body = (
      <div className="flex flex-col items-center gap-2 px-3 py-4 text-center text-[12px] text-gray-500">
        <p>{t('ide.paneOpener.error')}</p>
        <button
          type="button"
          onClick={() => setReloadToken((n) => n + 1)}
          className="rounded border border-gray-700 px-2 py-0.5 text-gray-300 transition-colors hover:bg-gray-800"
        >
          {t('ide.explorer.refresh')}
        </button>
      </div>
    );
  } else if (list.result.entries.length === 0) {
    body = <p className="px-3 py-4 text-center text-[12px] text-gray-500">{t(text.empty)}</p>;
  } else if (filtered.length === 0) {
    body = <p className="px-3 py-4 text-center text-[12px] text-gray-500">{t('ide.paneOpener.noMatch', { query: query.trim() })}</p>;
  } else {
    body = (
      <div ref={listRef} className="py-1" role="listbox" aria-label={t(text.open)}>
        {shown.map((entry, i) => {
          const { dir } = splitRelPath(entry.relPath);
          const ago = formatCheckedAgo(entry.mtimeMs, now, locale);
          const stamp = entry.mtimeMs !== undefined ? formatPromptStamp(entry.mtimeMs, locale, now) : null;
          const active = i === cursor;
          return (
            <button
              key={entry.relPath}
              type="button"
              role="option"
              aria-selected={active}
              data-opener-row={i}
              onClick={() => pick(entry)}
              onMouseMove={() => { if (!active) setCursor(i); }}
              title={entry.relPath}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                active ? 'bg-blue-500/15' : 'hover:bg-gray-800/60'
              }`}
            >
              <PaneKindGlyph kind={kind} className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-gray-100">{entry.name}</span>
                {dir && <span className="block truncate text-[12px] text-gray-500">{dir}</span>}
              </span>
              {ago && (
                <span className="flex-shrink-0 text-[12px] text-gray-500" title={stamp?.title}>{ago}</span>
              )}
            </button>
          );
        })}
        {filtered.length > shown.length && (
          <p className="px-3 py-1.5 text-[12px] text-gray-500">
            {t('ide.paneOpener.more', { count: filtered.length - shown.length })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 머리 — 손잡이 줄(⑩)과 같은 높이·톤. 무엇을 여는 탭인지와 그 범위를 말한다. */}
      <div className="flex items-center gap-1.5 border-b border-gray-800 bg-gray-900/60 px-2 py-1">
        <PaneKindGlyph kind={kind} className="h-3.5 w-3.5 flex-shrink-0 text-sky-300" />
        <span className="flex-shrink-0 text-[12px] font-medium text-gray-200">{t(text.open)}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-500" title={scope}>{scope}</span>
        <button
          type="button"
          onClick={() => setReloadToken((n) => n + 1)}
          disabled={!rootPath || list.status === 'loading'}
          title={t('ide.explorer.refresh')}
          aria-label={t('ide.explorer.refresh')}
          className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200 disabled:opacity-30"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
      </div>

      <div className="border-b border-gray-800 px-2 py-1.5">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('ide.paneOpener.search')}
          aria-label={t('ide.paneOpener.search')}
          disabled={!rootPath}
          className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 placeholder:text-gray-600 focus:border-blue-500/60 focus:outline-none disabled:opacity-40"
        />
      </div>

      <ScrollFade fill className="min-h-0 flex-1">
        {body}
      </ScrollFade>

      {/* 끝까지 못 찾았으면 그 사실을 말한다 — 조용히 자르면 없는 줄 알고 찾기를 그만둔다(⑱ (g)). */}
      {list.status === 'ready' && list.result.truncated && (
        <div className="border-t border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[12px] text-amber-200/90">
          {t('ide.paneOpener.truncated')}
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-gray-800 px-2 py-1 text-[12px] text-gray-500">
        <span className="min-w-0 flex-1 truncate">
          {list.status === 'ready' && list.result.entries.length > 0
            ? t('ide.paneOpener.count', { count: query.trim() ? filtered.length : list.result.total })
            : ''}
        </span>
        <button
          type="button"
          onClick={browseFolders}
          title={t('ide.paneOpener.browseHint')}
          className="flex flex-shrink-0 items-center gap-1 rounded border border-gray-700 px-1.5 py-0.5 text-gray-300 transition-colors hover:bg-gray-800"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z" />
          </svg>
          {t('ide.paneOpener.browse')}
        </button>
      </div>
    </div>
  );
});

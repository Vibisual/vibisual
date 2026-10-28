import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { workspaceFindUrl } from '@vibisual/shared';
import type { EditorPaneFileKind, SessionMemoLinkTarget, WorkspaceEntry, WorkspaceFindResult } from '@vibisual/shared';
import { workspaceOpenClaims } from '../../apps/registry.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { POPUP_DISMISS } from '../../hooks/popupDismiss.js';
import { isComposingKeyEvent } from '../../utils/inputComposition.js';
import { ScrollFade } from '../ScrollFade.js';
import { cachedFindResult, filterOpenerEntries, rememberFindResult } from './paneOpenerModel.js';
import { splitLineSuffix, toStreamPathCandidate } from './streamPathLinks.js';
import { fileLinkTarget, mergeLinkFileEntries, urlLinkTarget } from './memoLinks.js';
import { MemoLinkIcon, type MemoLinkIconName } from './memoLinkIcons.js';
import { MEMO_LINK_POPUP_Z } from './MemoLinkBubble.js';
import { placeCanvasMenu } from '../BubbleMap/canvasMenuPlacement.js';
import { followVisibleViewport, viewportMaxHeight, visibleViewport } from './popupPlacement.js';

/**
 * §5.5 #17-36 ⑫ — [링크 ▸]의 두 창. 웹 주소는 스킴을 붙여 주고 http(s) 만 받는다(`parseMemoLinkUrlInput`). 파일 목록은 빈 탭(⑱)의 `GET /api/workspace-find` 와 같은 규칙·캐시.
 * 바깥 누름·Esc 에 닫히고(`useOutsidePressDismiss`), body 포털 + 이벤트가 대화 본문으로 오르지 않게 끊는다.
 */

/** 파일 목록에 한 번에 세우는 줄 수 — 나머지는 "N개 더 — 이름으로 좁히세요" 한 줄로 접는다. */
const FILE_ROWS_MAX = 60;

/** 목록을 받아 오는 갈래 — 링크는 무엇이든 가리킬 수 있으므로 넷을 다 합친다. */
const FIND_KINDS: readonly EditorPaneFileKind[] = ['code', 'html', 'image', 'pdf'];

interface EditorFrameProps {
  x: number;
  y: number;
  title: string;
  icon: MemoLinkIconName;
  onClose: () => void;
  children: React.ReactNode;
}

/** 두 창이 함께 쓰는 틀 — 자리 잡기·닫기·전파 끊기를 한 벌로. */
function EditorFrame({ x, y, title, icon, onClose, children }: EditorFrameProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useOutsidePressDismiss({
    onDismiss: onClose,
    refs: [ref],
    // 입력칸의 우클릭 메뉴(전역 글자 메뉴 — 붙여넣기)는 이 창의 일부로 본다. 그 메뉴를 누르는 순간 창이
    //   닫히면 붙여넣을 칸이 사라져, 주소를 붙여넣는 가장 흔한 손짓이 통째로 헛돈다.
    isInside: (target) => target?.closest('[role="menu"]') != null,
    events: ['pointerdown'],
    graceMs: POPUP_DISMISS.openGraceMs,
  });

  // Esc — 입력기가 먹은 키(조합 취소)는 우리 것이 아니다.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || isComposingKeyEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // 메뉴를 연 자리에서 — 넘치면 **보이는 화면** 안으로 접는다(창이 커져도 다시 잰다). 기준은 시각 뷰포트다 —
  //   폰에서 입력칸에 초점이 가면 가상 키보드가 화면 아래를 덮는데, `innerHeight` 로 접으면 창이 그 밑에 깔렸다.
  //   보이는 화면보다 키 큰 창(파일 목록)은 그 높이까지만 서고 창 안에서 스크롤한다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = (): void => {
      const viewport = visibleViewport();
      el.style.maxHeight = `${viewportMaxHeight(viewport)}px`;
      const { left, top } = placeCanvasMenu({ x, y }, el.getBoundingClientRect(), viewport);
      setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    };
    const stop = followVisibleViewport(place);
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    ro?.observe(el);
    return () => { stop(); ro?.disconnect(); };
  }, [x, y]);

  return createPortal(
    // 포털이라도 리액트 이벤트는 조상(대화 본문·메모 카드)으로 오른다 — 여기서 끊는다.
    <span
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-label={title}
        className="scrollbar-thin fixed flex w-[22rem] max-w-[calc(100vw-16px)] flex-col gap-2 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-3 text-[12px] text-gray-200 shadow-2xl shadow-black/50"
        style={{ left: pos?.left ?? x, top: pos?.top ?? y, zIndex: MEMO_LINK_POPUP_Z, visibility: pos ? 'visible' : 'hidden' }}
      >
        <div className="flex items-center gap-1.5 font-medium text-gray-100">
          <span className="text-sky-300"><MemoLinkIcon name={icon} /></span>
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </div>
        {children}
      </div>
    </span>,
    document.body,
  );
}

const INPUT_CLASS = 'w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-[12px] text-gray-100 placeholder:text-gray-600 focus:border-sky-500/60 focus:outline-none pointer-coarse:py-2';
/** 창 아래 단추 — 터치에서는 손가락 높이로 키운다. */
const BUTTON_CLASS = 'rounded px-2.5 py-1 text-[12px] transition-colors pointer-coarse:py-2';

interface UrlEditorProps {
  x: number;
  y: number;
  /** 미리 채울 글자(고른 글자가 주소처럼 생겼거나, 다시 고르는 링크의 지금 주소). */
  initial: string;
  onApply: (target: SessionMemoLinkTarget) => void;
  onClose: () => void;
}

export function MemoLinkUrlEditor({ x, y, initial, onApply, onClose }: UrlEditorProps): React.JSX.Element {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const submit = (): void => {
    const target = urlLinkTarget(value);
    if (!target) { setInvalid(true); return; }
    onApply(target);
  };

  return (
    <EditorFrame x={x} y={y} title={t('ide.memo.link.urlTitle')} icon="url" onClose={onClose}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        spellCheck={false}
        placeholder={t('ide.memo.link.urlPlaceholder')}
        aria-label={t('ide.memo.link.urlTitle')}
        aria-invalid={invalid}
        onChange={(e) => { setValue(e.target.value); setInvalid(false); }}
        onKeyDown={(e) => {
          if (isComposingKeyEvent(e.nativeEvent)) return;
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
        }}
        className={INPUT_CLASS}
      />
      {invalid && <p className="leading-snug text-rose-300">{t('ide.memo.link.urlInvalid')}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={`${BUTTON_CLASS} text-gray-300 hover:bg-white/10`}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={value.trim().length === 0}
          className={`${BUTTON_CLASS} bg-sky-600 text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400`}
        >
          {t('ide.memo.link.apply')}
        </button>
      </div>
    </EditorFrame>
  );
}

interface FileEditorProps {
  x: number;
  y: number;
  /** 이 화면 프로젝트의 루트 — 없으면 고를 수 없다. */
  rootPath: string | null;
  /** 미리 채울 글자(다시 고르는 링크의 지금 경로). */
  initial: string;
  onApply: (target: SessionMemoLinkTarget) => void;
  onClose: () => void;
}

/** 받아 오는 중 · 실패 · 받음. */
type FileListState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; entries: WorkspaceEntry[] };

/** 목록의 한 줄 — 적은 경로 그대로이거나, 고른 파일. */
type FileRow = { kind: 'literal'; path: string } | { kind: 'entry'; entry: WorkspaceEntry };

export function MemoLinkFileEditor({ x, y, rootPath, initial, onApply, onClose }: FileEditorProps): React.JSX.Element {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(initial);
  const [list, setList] = useState<FileListState>({ status: 'loading' });
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // ─── 목록 — 갈래 넷을 받아 하나로. 받아 둔 것이 있으면 그것부터 그린다 ───
  useEffect(() => {
    if (!rootPath) return;
    let alive = true;
    const claims = workspaceOpenClaims();
    const lists: WorkspaceEntry[][] = FIND_KINDS.map(() => []);
    let anyCached = false;
    const urls = FIND_KINDS.map((kind, i) => {
      const url = workspaceFindUrl(rootPath, kind, claims);
      const cached = cachedFindResult(url);
      if (cached) { lists[i] = cached.entries; anyCached = true; }
      return url;
    });
    if (anyCached) setList({ status: 'ready', entries: mergeLinkFileEntries(lists) });
    const fetched = urls.map((url, i) => fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return (await r.json()) as WorkspaceFindResult;
      })
      .then((result) => {
        rememberFindResult(url, result);
        lists[i] = result.entries;
        // 한 갈래가 올 때마다 갈아 끼운다 — 가장 큰 갈래(코드)를 기다리느라 빈 창을 보여 주지 않게.
        if (alive) setList({ status: 'ready', entries: mergeLinkFileEntries(lists) });
        return true;
      }));
    void Promise.allSettled(fetched).then((results) => {
      // 하나도 못 받았고 받아 둔 것도 없으면 그 사실을 말한다(빈 목록과 실패는 다르다).
      if (alive && !anyCached && results.every((r) => r.status === 'rejected')) setList({ status: 'error' });
    });
    return () => { alive = false; };
  }, [rootPath]);

  // ─── 줄 세우기 — 줄 표기는 떼고 이름으로 좁힌다(고르면 그 줄이 따라간다) ───
  const { body: queryBody, lines } = useMemo(() => splitLineSuffix(query.trim()), [query]);
  const lineSuffix = lines ? query.trim().slice(queryBody.length) : '';
  const entries = list.status === 'ready' ? list.entries : null;
  // 목록의 경로는 `/` 로 적혀 있다 — Windows 에서 `\` 로 적어도 같은 파일이 걸리게 접어서 좁힌다.
  const filtered = useMemo(
    () => (entries ? filterOpenerEntries(entries, queryBody.replace(/\\/g, '/')) : []),
    [entries, queryBody],
  );
  const rows = useMemo<FileRow[]>(() => {
    const out: FileRow[] = [];
    const typed = query.trim();
    // 적은 글자가 경로로 읽히고 목록에 똑같은 것이 없으면 "그대로" 줄을 맨 위에 — 루트 밖·아직 없는 파일도 걸 수 있다.
    const candidate = typed ? toStreamPathCandidate(typed, rootPath) : null;
    const normBody = queryBody.replace(/\\/g, '/').replace(/^\.\//, '');
    // 적은 경로와 **똑같은** 파일은 맨 위 — 이름으로 좁힌 목록은 최근 순이라, 다시 고르기로 연 지금 파일이
    //   더 최근에 고친 비슷한 이름(`src/App.tsx` vs `x/src/App.tsx`) 아래로 밀려 Enter 한 번에 엇갈린다.
    const exact = filtered.find((e) => e.relPath === normBody);
    if (candidate && !exact) out.push({ kind: 'literal', path: typed });
    if (exact) out.push({ kind: 'entry', entry: exact });
    for (const entry of filtered.slice(0, FILE_ROWS_MAX)) {
      if (entry !== exact) out.push({ kind: 'entry', entry });
    }
    return out;
  }, [query, queryBody, filtered, rootPath]);
  const hiddenCount = Math.max(0, filtered.length - FILE_ROWS_MAX);

  useEffect(() => { setCursor(0); }, [query, entries]);
  // 키보드로 옮긴 줄이 보이게 — 목록 안에서만 민다.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row-index="${String(cursor)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const choose = useCallback((row: FileRow | undefined): void => {
    if (!row) return;
    const path = row.kind === 'literal' ? row.path : `${row.entry.relPath}${lineSuffix}`;
    const target = fileLinkTarget(path);
    if (target) onApply(target);
  }, [lineSuffix, onApply]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (isComposingKeyEvent(e.nativeEvent)) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, rows.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(rows[cursor]);
    }
  };

  let body: React.ReactNode;
  if (!rootPath) {
    body = <p className="px-1 py-3 text-center text-gray-500">{t('ide.explorer.noProject')}</p>;
  } else if (list.status === 'loading' && rows.length === 0) {
    body = <p className="px-1 py-3 text-center text-gray-500">{t('ide.memo.link.fileLoading')}</p>;
  } else if (list.status === 'error' && rows.length === 0) {
    body = <p className="px-1 py-3 text-center text-rose-300">{t('ide.paneOpener.error')}</p>;
  } else if (rows.length === 0) {
    body = <p className="px-1 py-3 text-center text-gray-500">{t('ide.paneOpener.noMatch', { query: queryBody })}</p>;
  } else {
    body = (
      <div ref={listRef} role="listbox" aria-label={t('ide.memo.link.fileTitle')} className="flex flex-col py-0.5">
        {rows.map((row, i) => {
          const on = i === cursor;
          const base = `flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left pointer-coarse:py-2 ${on ? 'bg-sky-500/20 text-gray-100' : 'text-gray-300 hover:bg-white/5'}`;
          if (row.kind === 'literal') {
            return (
              <button
                key="literal"
                type="button"
                role="option"
                aria-selected={on}
                data-row-index={i}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(row)}
                className={base}
              >
                <MemoLinkIcon name="link" />
                <span className="min-w-0 flex-1 truncate">{t('ide.memo.link.fileLiteral', { path: row.path })}</span>
              </button>
            );
          }
          const slash = row.entry.relPath.lastIndexOf('/');
          const dir = slash > 0 ? row.entry.relPath.slice(0, slash) : '';
          return (
            <button
              key={row.entry.relPath}
              type="button"
              role="option"
              aria-selected={on}
              data-row-index={i}
              title={row.entry.relPath}
              onMouseEnter={() => setCursor(i)}
              onClick={() => choose(row)}
              className={base}
            >
              <MemoLinkIcon name="file" />
              {/* 이름은 제 폭을 먼저 갖고(경로 칸은 남는 자리만 받는다 — `flex-1` 의 기준 폭 0), 그래도 넘치면
                  이름도 줄어 `…` 가 된다. 종전 `flex-shrink-0` 은 긴 이름이 줄 밖으로 삐져나가 줄임표가 서지 않았다. */}
              <span className="min-w-0 truncate font-medium">{row.entry.name}</span>
              {dir && <span className="min-w-0 flex-1 truncate text-gray-500">{dir}</span>}
            </button>
          );
        })}
        {hiddenCount > 0 && (
          <p className="px-1.5 py-1 text-gray-500">{t('ide.paneOpener.more', { count: hiddenCount })}</p>
        )}
      </div>
    );
  }

  return (
    <EditorFrame x={x} y={y} title={t('ide.memo.link.fileTitle')} icon="file" onClose={onClose}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        spellCheck={false}
        disabled={!rootPath}
        placeholder={t('ide.memo.link.filePlaceholder')}
        aria-label={t('ide.memo.link.fileTitle')}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        className={`${INPUT_CLASS} disabled:opacity-40`}
      />
      <ScrollFade maxHeight={260}>{body}</ScrollFade>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={`${BUTTON_CLASS} text-gray-300 hover:bg-white/10`}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => choose(rows[cursor])}
          disabled={rows.length === 0}
          className={`${BUTTON_CLASS} bg-sky-600 text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400`}
        >
          {t('ide.memo.link.apply')}
        </button>
      </div>
    </EditorFrame>
  );
}

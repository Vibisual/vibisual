import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ScrollFade } from '../ScrollFade.js';
import { useAppBoxTier } from '../../hooks/useBoxTier.js';
import { DocGalleryCard } from './DocGalleryCard.js';
import { StudioIcon } from './studioIcons.js';
import { forgetFailedPosters } from './docPosters.js';
import { GALLERY_PAGE, docLabel, galleryKeyAction, galleryLayout, galleryRows } from './docGalleryModel.js';
import { useDocGalleryActions } from './useDocGalleryActions.js';
import type { DocSummary } from './videoApi.js';

/**
 * §5.13 (V) 37-1 — 머리줄 문서 메뉴의 내용: 문서 갤러리. 손잡이(▾)는 그대로이고 열리는 판만 이것이다.
 * [새 영상] · 제목 검색 · 개수 상한 없는 목록(고친 시각 최근순, 처음 `GALLERY_PAGE`장 + 끝에 닿으면 더) · 카드 항목 메뉴(복제·이름·삭제 — 삭제는 판 안 확인).
 * 판이 포털이라 `box-*` 가 안 닿는다 — 열 수는 `useAppBoxTier` 로 고른다.
 */
export interface DocGalleryProps {
  readonly project: string;
  readonly docs: readonly DocSummary[];
  readonly currentDocId: string | null;
  /** 지금 문서를 고칠 수 없는 때(AI 가 일하는 중 등) — 그 문서의 이름 바꾸기·삭제를 막는다. */
  readonly locked: boolean;
  readonly onClose: () => void;
  readonly onOpenDoc: (id: string) => void;
  readonly onNewDoc: () => void;
  readonly onRenameCurrent: (title: string) => void;
  readonly onRefreshDocs: () => Promise<void>;
  readonly onDocDeleted: (id: string) => void;
}

export function DocGallery(p: DocGalleryProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const layout = galleryLayout(useAppBoxTier());
  const listId = useId();
  const optionId = (id: string): string => `${listId}-${id}`;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [limit, setLimit] = useState(GALLERY_PAGE);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DocSummary | null>(null);
  const [now] = useState(() => Date.now());
  const composing = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const latest = useRef(p);
  latest.current = p;
  const actions = useDocGalleryActions({
    project: p.project, currentDocId: p.currentDocId, onRenameCurrent: p.onRenameCurrent, onRefreshDocs: p.onRefreshDocs, onDocDeleted: p.onDocDeleted,
  });
  const titled = useMemo(() => p.docs.map((d) => (actions.titles[d.id] !== undefined ? { ...d, title: actions.titles[d.id] ?? d.title } : d)), [p.docs, actions.titles]);
  const rows = useMemo(() => galleryRows(titled, query), [titled, query]);

  // 열 때: 낡은 목록을 새로 읽고(이름·길이·고친 시각), 못 얻었던 포스터를 한 번 더 청한다. 열린 문서에 커서를 둔다.
  useEffect(() => { forgetFailedPosters(); void p.onRefreshDocs(); searchRef.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || rows.length === 0) return;
    seeded.current = true;
    setActive(Math.max(0, rows.findIndex((d) => d.id === p.currentDocId)));
  }, [rows, p.currentDocId]);

  const shown = Math.min(rows.length, limit);
  const more = shown < rows.length;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!more || !el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + GALLERY_PAGE);
    }, { rootMargin: '240px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, shown]);

  // 확인 카드가 떠 있는 동안 목록이 없다 — 없는 요소를 가리키지 않는다. 행이 아직 그려지지 않은 쪽(`limit` 밖)도 마찬가지.
  const activeId = !confirming && active >= 0 && active < Math.min(rows.length, limit) ? rows[active]?.id : undefined;
  useEffect(() => { if (active >= limit) setLimit(active + GALLERY_PAGE); }, [active, limit]);
  useEffect(() => { if (confirming) cancelRef.current?.focus(); }, [confirming]);

  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const open = useCallback((doc: DocSummary): void => { latest.current.onClose(); latest.current.onOpenDoc(doc.id); }, []);
  const toggleMenu = useCallback((doc: DocSummary): void => { setMenuFor((cur) => (cur === doc.id ? null : doc.id)); }, []);
  const askDelete = useCallback((doc: DocSummary): void => { setMenuFor(null); setConfirming(doc); }, []);
  const startRename = useCallback((doc: DocSummary): void => { setMenuFor(null); setRenamingId(doc.id); }, []);
  const cancelRename = useCallback((): void => { setRenamingId(null); searchRef.current?.focus(); }, []);
  const commitRename = useCallback((doc: DocSummary, title: string): void => {
    setRenamingId(null);
    void actionsRef.current.rename(doc, title);
  }, []);
  const duplicate = useCallback((doc: DocSummary): void => { setMenuFor(null); void actionsRef.current.duplicate(doc); }, []);
  const lockedId = p.locked ? p.currentDocId : null;
  const confirmDelete = (): void => {
    const doc = confirming;
    if (!doc) return;
    // 확인 카드가 뜬 뒤 그 문서가 잠겼을 수 있다 — 확정 시점에 다시 판정한다.
    if (doc.id === lockedId) return;
    setConfirming(null);
    void actions.remove(doc).then((ok) => { if (ok) searchRef.current?.focus(); });
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // 한글 조합 중에는 어떤 키도 가로채지 않는다(조합 확정 Enter 가 문서를 열면 안 된다).
    const action = galleryKeyAction(e.key, { composing: composing.current || e.nativeEvent.isComposing, count: rows.length, active });
    if (action.kind === 'none') return;
    e.preventDefault();
    e.stopPropagation();
    if (action.kind === 'move') setActive(action.index);
    else if (action.kind === 'close') p.onClose();
    else { const doc = rows[active]; if (doc) open(doc); }
  };

  const label = (key: string, vars?: Record<string, unknown>): string => t(`panel.videoStudio.gallery.${key}`, vars);
  return (
    <div className="flex max-h-[min(36rem,calc(100dvh-1.75rem))] min-h-0 flex-col gap-1.5">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-0.5">
        <button type="button" onClick={() => { p.onClose(); p.onNewDoc(); }}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/15 px-2.5 text-[13px] font-semibold text-slate-100 transition-colors duration-150 ease-out hover:bg-white/10 pointer-coarse:h-10 pointer-coarse:px-3.5">
          <StudioIcon name="plus" className="h-3.5 w-3.5" />{t('panel.videoStudio.header.newDoc')}
        </button>
        <label className="relative flex min-w-40 flex-1 items-center">
          <StudioIcon name="search" className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-slate-500" />
          <input ref={searchRef} type="search" value={query} role="combobox" aria-haspopup="grid" aria-expanded={!confirming} aria-controls={confirming ? undefined : listId} aria-autocomplete="list"
            aria-activedescendant={activeId ? optionId(activeId) : undefined}
            aria-label={label('search')} placeholder={label('search')} autoComplete="off" spellCheck={false}
            onChange={(e) => { setQuery(e.target.value); setActive(0); setLimit(GALLERY_PAGE); setMenuFor(null); }} onKeyDown={onSearchKey}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            className="h-8 w-full rounded-md border border-white/10 bg-vb-sunken pl-7 pr-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-[var(--vs-accent)] pointer-coarse:h-10" />
        </label>
      </div>

      {actions.notice ? (
        <p role="alert" className="mx-0.5 flex shrink-0 items-start gap-2 rounded-md bg-red-500/10 px-2.5 py-1.5 text-[12px] text-red-200">
          <StudioIcon name="warn" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{actions.notice}</span>
          <button type="button" aria-label={t('panel.videoStudio.gallery.dismiss')} onClick={actions.clearNotice}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-red-200 hover:bg-white/10 pointer-coarse:h-8 pointer-coarse:w-8">
            <StudioIcon name="close" className="h-3 w-3" />
          </button>
        </p>
      ) : null}

      {confirming ? (
        <div role="alertdialog" aria-label={label('confirmTitle', { title: docLabel(confirming) })}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setConfirming(null); searchRef.current?.focus(); } }}
          className="mx-0.5 flex flex-col gap-3 rounded-lg border border-red-400/30 bg-red-500/[0.07] p-3">
          <div className="flex flex-col gap-1">
            <p className="break-words text-[13px] font-semibold text-slate-100">{label('confirmTitle', { title: docLabel(confirming) })}</p>
            <p className="text-[12px] text-slate-400">{label('confirmBody')}</p>
          </div>
          <div className="flex justify-end gap-2">
            <button ref={cancelRef} type="button" onClick={() => { setConfirming(null); searchRef.current?.focus(); }}
              className="h-8 rounded-md border border-white/15 px-3 text-[13px] text-slate-200 hover:bg-white/10 pointer-coarse:h-10">{label('cancel')}</button>
            <button type="button" onClick={confirmDelete} disabled={confirming.id === lockedId}
              className="h-8 rounded-md border border-red-400/40 bg-red-500/20 px-3 text-[13px] font-semibold text-red-100 hover:bg-red-500/30 disabled:opacity-40 pointer-coarse:h-10">{label('delete')}</button>
          </div>
        </div>
      ) : (
        <ScrollFade fill className="min-h-0 flex-1">
          {rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-slate-500">
              {query.trim() === '' ? label('empty') : label('noMatch', { query: query.trim() })}
            </p>
          ) : (
            <div id={listId} role="grid" aria-label={t('panel.videoStudio.header.docs')} className={`grid gap-1 ${layout.gridClass}`}>
              {rows.slice(0, shown).map((doc, i) => (
                <DocGalleryCard key={doc.id} project={p.project} doc={doc} optionId={optionId(doc.id)} row={layout.row}
                  current={doc.id === p.currentDocId} active={i === active} now={now} locale={i18n.language}
                  menuOpen={menuFor === doc.id} renaming={renamingId === doc.id} busy={actions.busyId === doc.id}
                  locked={doc.id === lockedId}
                  onOpen={open} onToggleMenu={toggleMenu} onDuplicate={duplicate} onStartRename={startRename} onAskDelete={askDelete}
                  onRenameCommit={commitRename} onRenameCancel={cancelRename} />
              ))}
              {more ? <div ref={sentinelRef} aria-hidden="true" className="col-span-full h-6" /> : null}
            </div>
          )}
        </ScrollFade>
      )}
    </div>
  );
}

import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DocGalleryPoster } from './DocGalleryPoster.js';
import { StudioIcon, type StudioIconName } from './studioIcons.js';
import { docLabel, docRatioLabel, formatDocLength, formatEditedAt } from './docGalleryModel.js';
import type { DocSummary } from './videoApi.js';

/**
 * §5.13 (V) 37-1 — 문서 갤러리 카드 하나(포스터 · 제목 · 판형 · 길이 · 고친 시각 · 항목 메뉴). 수백 장 중 한 장이 바뀌어도 나머지가 다시 그려지지 않게 `memo` —
 * 손잡이는 문서를 받는 안정된 함수다. 항목 메뉴는 겹쳐 뜨는 판이 아니라 카드 안에 펼쳐지는 줄이다(스크롤 영역에 잘리지 않는다).
 */
export interface DocGalleryCardProps {
  readonly project: string;
  readonly doc: DocSummary;
  readonly optionId: string;
  /** 폰 폭 — 포스터가 왼쪽에 서는 가로 줄. */
  readonly row: boolean;
  readonly current: boolean;
  readonly active: boolean;
  readonly now: number;
  readonly locale: string;
  readonly menuOpen: boolean;
  readonly renaming: boolean;
  readonly busy: boolean;
  /** 지금 열린 문서를 고칠 수 없는 때 — 이름 바꾸기·삭제를 막는다. */
  readonly locked: boolean;
  readonly onOpen: (doc: DocSummary) => void;
  readonly onToggleMenu: (doc: DocSummary) => void;
  readonly onDuplicate: (doc: DocSummary) => void;
  readonly onStartRename: (doc: DocSummary) => void;
  readonly onAskDelete: (doc: DocSummary) => void;
  readonly onRenameCommit: (doc: DocSummary, title: string) => void;
  readonly onRenameCancel: () => void;
}

function ActionButton({ icon, label, onClick, danger, disabled }: {
  readonly icon: StudioIconName; readonly label: string; readonly onClick: () => void; readonly danger?: boolean; readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 text-[12px] font-medium transition-colors duration-150 ease-out disabled:opacity-40 pointer-coarse:h-9 pointer-coarse:px-3 ${danger ? 'text-red-300 hover:bg-red-500/15' : 'text-slate-300 hover:bg-white/10 hover:text-slate-50'}`}>
      <StudioIcon name={icon} className="h-3.5 w-3.5 shrink-0" />{label}
    </button>
  );
}

function RenameField({ initial, onCommit, onCancel }: {
  readonly initial: string; readonly onCommit: (title: string) => void; readonly onCancel: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.select(); }, []);
  const commit = (): void => {
    if (done.current) return;
    done.current = true;
    const next = draft.trim();
    if (next === '' || next === initial) onCancel(); else onCommit(next);
  };
  return (
    <input ref={ref} autoFocus value={draft} maxLength={200} aria-label={t('panel.videoStudio.header.title')}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') { done.current = true; onCancel(); }
      }}
      className="h-7 min-w-0 flex-1 rounded-md border border-white/15 bg-vb-sunken px-2 text-[13px] font-semibold text-slate-100 outline-none focus:ring-1 focus:ring-[var(--vs-accent)] pointer-coarse:h-9" />
  );
}

export const DocGalleryCard = memo(function DocGalleryCard(p: DocGalleryCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const { doc } = p;
  const label = docLabel(doc);
  const ratio = docRatioLabel(doc);
  const length = formatDocLength(doc.duration);
  const posterWidth = p.row ? 'w-24 shrink-0' : 'w-full';
  const stripRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (p.active) rowRef.current?.scrollIntoView({ block: 'nearest' }); }, [p.active]);
  useEffect(() => { if (p.menuOpen) stripRef.current?.querySelector('button')?.focus(); }, [p.menuOpen]);
  const meta = (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-slate-400">
      {ratio ? <span className="rounded-full border border-white/15 px-1.5 tabular-nums text-slate-300">{ratio}</span> : null}
      {length ? <span className="tabular-nums">{length}</span> : null}
      <span className="min-w-0 truncate">{formatEditedAt(doc.updatedAt, p.now, p.locale)}</span>
    </span>
  );
  return (
    // grid > row > gridcell — 열기 단추·항목 메뉴·작업 묶음·이름 입력은 셀 안에 둔다(listbox 의 option 은 상호작용 요소를 품지 못한다).
    // 행이 늘 있으니 `aria-activedescendant` 가 이름 고치는 중에도 살아 있는 요소를 가리킨다.
    <div ref={rowRef} id={p.optionId} role="row" aria-selected={p.active} aria-current={p.current ? 'true' : undefined}
      className={`group/gallery relative [content-visibility:auto] ${p.row ? '[contain-intrinsic-size:auto_6rem]' : '[contain-intrinsic-size:auto_11rem]'}`}>
      {p.renaming ? (
        <div role="gridcell" className={`flex gap-2 rounded-lg p-1.5 ${p.row ? 'flex-row items-center' : 'flex-col'}`}>
          <DocGalleryPoster project={p.project} doc={doc} className={posterWidth} />
          <RenameField initial={doc.title} onCommit={(title) => p.onRenameCommit(doc, title)} onCancel={p.onRenameCancel} />
        </div>
      ) : (
        <>
          <div role="gridcell">
            <button type="button" tabIndex={-1} disabled={p.busy} onClick={() => p.onOpen(doc)}
              className={`flex w-full gap-2 rounded-lg p-1.5 text-left transition-colors duration-150 ease-out hover:bg-white/[0.06] disabled:opacity-50 ${p.row ? 'flex-row items-center pr-11' : 'flex-col'} ${p.active ? 'bg-white/10 ring-1 ring-[var(--vs-accent)]' : ''}`}>
              <DocGalleryPoster project={p.project} doc={doc} className={posterWidth} />
              <span className={`flex min-w-0 flex-col gap-0.5 ${p.row ? 'flex-1' : 'pr-9'}`}>
                <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-slate-100">
                  {p.current ? <StudioIcon name="check" className="h-3.5 w-3.5 shrink-0 text-[var(--vs-accent)]" /> : null}
                  <span className="min-w-0 truncate" title={label}>{label}</span>
                </span>
                {meta}
              </span>
            </button>
          </div>
          <div role="gridcell" className={`absolute ${p.row ? 'right-2 top-1/2 -translate-y-1/2' : 'right-3 top-3'}`}>
            <button type="button" aria-haspopup="true" aria-expanded={p.menuOpen} disabled={p.busy}
              aria-label={t('panel.videoStudio.gallery.itemMenu', { title: label })} title={t('panel.videoStudio.gallery.itemMenu', { title: label })}
              onClick={() => p.onToggleMenu(doc)}
              className={`flex h-7 w-7 items-center justify-center rounded-md bg-vb-raised/90 text-slate-300 transition-opacity duration-150 ease-out hover:bg-white/15 hover:text-slate-50 focus-visible:opacity-100 pointer-coarse:h-9 pointer-coarse:w-9 ${p.menuOpen ? 'opacity-100' : 'opacity-0 group-hover/gallery:opacity-100 pointer-coarse:opacity-100'}`}>
              <StudioIcon name="more" className="h-4 w-4" />
            </button>
          </div>
          {p.menuOpen ? (
            <div role="gridcell">
              <div ref={stripRef} role="group" aria-label={t('panel.videoStudio.gallery.itemMenu', { title: label })}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); p.onToggleMenu(doc); } }}
                className="flex flex-wrap gap-1 px-1.5 pb-1.5">
                <ActionButton icon="duplicate" label={t('panel.videoStudio.gallery.duplicate')} disabled={p.busy} onClick={() => p.onDuplicate(doc)} />
                <ActionButton icon="pencil" label={t('panel.videoStudio.header.rename')} disabled={p.busy || p.locked} onClick={() => p.onStartRename(doc)} />
                <ActionButton icon="trash" label={t('panel.videoStudio.gallery.delete')} danger disabled={p.busy || p.locked} onClick={() => p.onAskDelete(doc)} />
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
});

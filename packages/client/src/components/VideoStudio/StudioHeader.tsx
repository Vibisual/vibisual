import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { VIDEO_FORMAT_IDS, formatRatioLabel, type VideoFormatId } from '@vibisual/video';

import { useAppBoxTier } from '../../hooks/useBoxTier.js';
import { StudioIcon } from './studioIcons.js';
import { StudioPopover, PopoverItem } from './StudioPopover.js';
import type { DocSummary } from './videoApi.js';
import { memoLatest } from './studioMemo.js';

/**
 * §5.13 (V) 37-1 — 스튜디오 머리줄: **문서 제목(바로 고치기) · 문서 메뉴 · 판형 칩 · 판 기록 · 내보내기** 넷만.
 *
 * 창이 머리줄 자리를 주면(앱 안 창·분리된 창 — `AppChrome`) 그 자리에 그려져 위쪽 크롬이 한 줄이 되고, "Vibistudio" 는 창의 앱
 * 아이콘 하나로만 남는다. 입력·단추는 창 끌기 판정이 비켜 주고(`button, input`), 빈 곳은 그대로 창을 끈다.
 *
 * 반응형 — 폰 폭 창에서는 판 기록·내보내기의 글자를 걷고 아이콘만 남기며(이름은 aria-label·title), 제목은 0 폭까지 줄지 않게
 * 바닥을 둔다. 창 머리줄 자리로 포털되면 `data-box` 상자 밖이라 `box-*` 변형이 닿지 않는다 — 그래서 등급을 JS 로 읽는다
 * (`useAppBoxTier` — 포털도 React 문맥은 이어받는다. 등급이 바뀔 때만 다시 그린다).
 */
export interface StudioHeaderProps {
  readonly title: string | null;
  readonly onRename: (title: string) => void;
  readonly docs: readonly DocSummary[];
  readonly currentDocId: string | null;
  readonly onOpenDoc: (id: string) => void;
  readonly onNewDoc: () => void;
  readonly format: VideoFormatId | null;
  readonly onFormat: (format: VideoFormatId) => void;
  readonly historyOpen: boolean;
  readonly onToggleHistory: () => void;
  /** AI 가 남긴 새 판 수(판 기록을 연 뒤로). */
  readonly historyBadge: number;
  /** 내보내기 단추 — 진행률(0~1)이 있으면 단추 안에 채워진다. */
  readonly exportProgress: number | null;
  /** §5.13 (AA) 42-8 — 대기열에 남은 일감 수(도는 것 포함). 0 이면 숫자를 걷는다. */
  readonly exportBadge?: number;
  /** §5.13 (AA) 42-8 — 단추 툴팁(진행 · 남은 시간 · 멈춤). */
  readonly exportTitle?: string | null;
  /** §5.13 (AA) 42-8 — 도는 렌더가 멈춰 있다(채움을 흐리게). */
  readonly exportPaused?: boolean;
  readonly exportMenu: (close: () => void) => ReactNode;
  readonly disabled: boolean;
}

/**
 * §5.13 (Y) 40-5 ③ — 값이 같으면 다시 그리지 않는다(손잡이는 늘 최신을 부른다 — `studioMemo.ts`). 내보내기 메뉴는 렌더 중에 불러
 * 그리는 함수라 정체로 비교한다(셸이 그 함수를 메뉴가 기대는 값이 바뀔 때만 새로 만든다).
 */
export const StudioHeader = memoLatest(StudioHeaderView, { fresh: ['exportMenu'] });

function StudioHeaderView(p: StudioHeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<'docs' | 'format' | 'export' | null>(null);
  const docsRef = useRef<HTMLButtonElement>(null);
  const formatRef = useRef<HTMLButtonElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const close = (): void => setMenu(null);
  const commit = (): void => {
    setEditing(false);
    const next = draft.trim();
    if (next !== '' && next !== p.title) p.onRename(next);
  };
  const progress = p.exportProgress;
  const narrow = useAppBoxTier() === 'narrow';
  const historyLabel = t('panel.videoStudio.header.history');
  const exportLabel = t('panel.videoStudio.header.export');
  // 좁으면 제목이 다른 손잡이에 밀려 0 폭이 되지 않게 바닥을 둔다(넓으면 종전대로 줄 수 있다 — 짧은 제목의 칸이 늘지 않게).
  const titleFloor = narrow ? 'min-w-16' : 'min-w-0';

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      {p.title !== null && editing ? (
        <input
          autoFocus
          value={draft}
          aria-label={t('panel.videoStudio.header.title')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditing(false);
          }}
          className={`app-nodrag h-7 ${titleFloor} max-w-72 flex-1 rounded-md border border-white/15 bg-vb-sunken px-2 text-[13px] font-semibold text-slate-100 outline-none focus:ring-1 focus:ring-[var(--vs-accent)] pointer-coarse:h-9`}
        />
      ) : p.title !== null ? (
        <button type="button" disabled={p.disabled} onClick={() => { setDraft(p.title ?? ''); setEditing(true); }}
          title={t('panel.videoStudio.header.rename')}
          className={`app-nodrag h-7 ${titleFloor} max-w-72 truncate rounded-md px-2 text-left text-[13px] font-semibold text-slate-100 hover:bg-white/10 pointer-coarse:h-9`}>
          {p.title}
        </button>
      ) : (
        <span className="min-w-0 truncate px-2 text-[13px] font-semibold text-slate-300">{t('panel.videoStudio.header.noDoc')}</span>
      )}
      <button ref={docsRef} type="button" onClick={() => setMenu(menu === 'docs' ? null : 'docs')} aria-expanded={menu === 'docs'}
        aria-label={t('panel.videoStudio.header.docs')} title={t('panel.videoStudio.header.docs')}
        className="app-nodrag flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-100 pointer-coarse:h-9 pointer-coarse:w-9">
        <StudioIcon name="chevronDown" className="h-3.5 w-3.5" />
      </button>
      {p.format ? (
        <button ref={formatRef} type="button" disabled={p.disabled} onClick={() => setMenu(menu === 'format' ? null : 'format')} aria-expanded={menu === 'format'}
          title={t('panel.videoStudio.header.format')}
          className="app-nodrag flex h-6 shrink-0 items-center gap-1 rounded-full border border-white/15 px-2 text-[12px] tabular-nums text-slate-300 hover:bg-white/10 disabled:opacity-40 pointer-coarse:h-8 pointer-coarse:px-3">
          {formatRatioLabel(p.format)}
          <StudioIcon name="chevronDown" className="h-3 w-3" />
        </button>
      ) : null}
      <span className="flex-1" />
      <button type="button" onClick={p.onToggleHistory} aria-pressed={p.historyOpen} disabled={p.title === null}
        aria-label={narrow ? historyLabel : undefined} title={narrow ? historyLabel : undefined}
        className={`app-nodrag relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors duration-150 ease-out disabled:opacity-35 pointer-coarse:h-9 ${p.historyOpen ? 'bg-white/10 text-slate-50 ring-1 ring-[var(--vs-accent)]' : 'text-slate-300 hover:bg-white/10 hover:text-slate-50'}`}>
        <StudioIcon name="history" />
        {narrow ? null : <span>{historyLabel}</span>}
        {p.historyBadge > 0 ? <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-200 px-1 text-[12px] font-semibold leading-none text-vb-window tabular-nums">{p.historyBadge}</span> : null}
      </button>
      <button ref={exportRef} type="button" disabled={p.title === null} onClick={() => setMenu(menu === 'export' ? null : 'export')} aria-expanded={menu === 'export'}
        aria-label={narrow ? (progress !== null ? `${exportLabel} ${Math.round(progress * 100)}%` : exportLabel) : undefined}
        title={p.exportTitle ?? (narrow ? exportLabel : undefined)}
        className="app-nodrag relative flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-md border border-white/15 px-2.5 text-[12px] font-semibold text-slate-100 hover:bg-white/10 disabled:opacity-35 pointer-coarse:h-9">
        {progress !== null ? (
          <span className={`absolute inset-y-0 left-0 transition-[width] duration-150 ease-out ${p.exportPaused ? 'bg-slate-400 opacity-20' : 'bg-[var(--vs-accent)] opacity-30'}`} style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }} aria-hidden="true" />
        ) : null}
        <span className="relative flex items-center gap-1.5">
          <StudioIcon name={p.exportPaused ? 'pause' : 'export'} />
          {/* 좁으면 이름은 걷고 진행률만(짧은 숫자라 남긴다). */}
          {progress !== null ? <span className="tabular-nums">{Math.round(progress * 100)}%</span> : narrow ? null : exportLabel}
          {(p.exportBadge ?? 0) > 0 ? (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-200 px-1 text-[12px] font-semibold leading-none text-vb-window tabular-nums"
              aria-label={t('panel.videoStudio.export.queue.badge', { count: p.exportBadge ?? 0 })}>{p.exportBadge}</span>
          ) : null}
        </span>
      </button>

      <StudioPopover anchor={docsRef} open={menu === 'docs'} onClose={close} label={t('panel.videoStudio.header.docs')} className="w-64">
        <PopoverItem onClick={() => { close(); p.onNewDoc(); }}>
          <span className="flex items-center gap-2"><StudioIcon name="plus" />{t('panel.videoStudio.header.newDoc')}</span>
        </PopoverItem>
        {p.docs.length > 0 ? <p className="px-2.5 pb-1 pt-2 text-[12px] font-semibold text-slate-500">{t('panel.videoStudio.header.recent')}</p> : null}
        {p.docs.slice(0, 12).map((d) => (
          <PopoverItem key={d.id} active={d.id === p.currentDocId} onClick={() => { close(); p.onOpenDoc(d.id); }}>{d.title || d.id}</PopoverItem>
        ))}
      </StudioPopover>
      <StudioPopover anchor={formatRef} open={menu === 'format'} onClose={close} label={t('panel.videoStudio.header.format')} className="w-56">
        {VIDEO_FORMAT_IDS.map((id) => (
          <PopoverItem key={id} active={id === p.format} hint={formatRatioLabel(id)} onClick={() => { close(); p.onFormat(id); }}>
            {t(`panel.videoStudio.formats.${id}`)}
          </PopoverItem>
        ))}
      </StudioPopover>
      <StudioPopover anchor={exportRef} open={menu === 'export'} onClose={close} align="end" label={t('panel.videoStudio.header.export')} className="w-80">
        {p.exportMenu(close)}
      </StudioPopover>
    </div>
  );
}

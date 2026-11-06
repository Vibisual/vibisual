import { useTranslation } from 'react-i18next';
import { useAppBoxTier } from '../../hooks/useBoxTier.js';
import { VibimageChromeBar } from './VibimageChromeBar.js';

interface ViewerHeaderProps {
  hosted: boolean;
  /** 파일 이름(창 제목도 이것). */
  name: string;
  /** 전체 경로 — 이름에 손을 올리면 보인다. */
  path: string;
  size: { w: number; h: number } | null;
  /** 빠른 편집 — 없으면 단추가 없다. */
  onEdit?: (() => void) | undefined;
  editBusy: boolean;
  /** 레이어 편집 — 없으면 단추가 없다(프로젝트 밖 그림). */
  onLayerEdit?: (() => void) | undefined;
}

/**
 * §5.13 (R-9)(R-10) — 창 머리줄 한 줄: 이름 · 픽셀 크기 · [편집](빠른 편집) · [레이어 편집]. 폰 폭이면 단추는 글리프만 남기고
 * 이름은 `title`·`aria-label` 로 둔다(입구는 지우지 않는다). 머리줄 자리는 창 틀 쪽이라 `box-*:` 대신 등급을 JS 로 읽는다.
 */
export function ViewerHeader(p: ViewerHeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const compact = useAppBoxTier() === 'narrow';
  return (
    <VibimageChromeBar hosted={p.hosted} title={p.name || null}>{(dragRegion) => <>
      <span className={`${dragRegion ? 'app-drag-label ' : ''}min-w-0 truncate text-[13px] font-semibold text-slate-100`} title={p.path || undefined}>
        {p.name || 'Vibimage'}
      </span>
      {p.size && (
        <span className={`${dragRegion ? 'app-drag-label ' : ''}shrink-0 text-[12px] tabular-nums text-slate-500`}>
          {p.size.w} × {p.size.h}
        </span>
      )}
      <div className={`${dragRegion ? 'app-nodrag ' : ''}ml-auto flex shrink-0 items-center gap-1`}>
        {p.onEdit && (
          <HeaderAction primary compact={compact} busy={p.editBusy} label={t('panel.fileEdit.edit')} hint={t('panel.apps.vibimage.editHint')} onClick={p.onEdit}>
            <path d="M12 20h9" />
            <path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </HeaderAction>
        )}
        {p.onLayerEdit && (
          <HeaderAction compact={compact} label={t('panel.apps.vibimage.layerEdit')} hint={t('panel.apps.vibimage.layerEditHint')} onClick={p.onLayerEdit}>
            <path d="m12 2 10 5-10 5L2 7l10-5z" />
            <path d="m2 17 10 5 10-5" />
            <path d="m2 12 10 5 10-5" />
          </HeaderAction>
        )}
      </div>
    </>}</VibimageChromeBar>
  );
}

interface HeaderActionProps {
  label: string;
  hint: string;
  primary?: boolean;
  compact: boolean;
  busy?: boolean;
  onClick: () => void;
  /** 글리프의 stroke 경로들. */
  children: React.ReactNode;
}

/** 머리줄 단추 — 창 틀의 단추(`AppWindow`)와 같은 결: 둥근 모서리 · slate 글자 · 손을 올리면 옅은 바탕. */
function HeaderAction({ label, hint, primary, compact, busy, onClick, children }: HeaderActionProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={hint}
      aria-label={label}
      aria-busy={busy || undefined}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md text-[12px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 pointer-coarse:h-9 ${
        compact ? 'w-7 justify-center pointer-coarse:w-9' : 'px-2.5'
      } ${primary ? 'bg-white/10 text-slate-100 hover:bg-white/15' : 'text-slate-300 hover:bg-white/10 hover:text-slate-100'}`}
    >
      {busy ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-slate-100" aria-hidden="true" />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
          {children}
        </svg>
      )}
      {!compact && label}
    </button>
  );
}

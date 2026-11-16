import { useTranslation } from 'react-i18next';

import { shortcutLabel } from '../../utils/platform.js';
import { StudioIcon, type StudioIconName } from './studioIcons.js';

/** §5.13 (V) 37-22 (H) — 팔레트 한 줄: 아이콘 · 이름 · 설명 한 줄 · 켜짐 표시 · 오른쪽 단축키(`shortcutLabel()`). 흐린 줄은 누를 수 없다. */
export interface StudioPaletteRowProps {
  readonly id: string;
  readonly icon: StudioIconName | null;
  readonly name: string;
  readonly detail?: string | undefined;
  readonly hint?: string | undefined;
  readonly combo?: string | null | undefined;
  readonly active: boolean;
  readonly enabled: boolean;
  readonly checked?: boolean | undefined;
  readonly current?: boolean | undefined;
  readonly more?: boolean | undefined;
  readonly onHover: () => void;
  readonly onRun: () => void;
}

export function StudioPaletteRow(p: StudioPaletteRowProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <li id={p.id} role="option" aria-selected={p.active} aria-disabled={!p.enabled}
      onMouseMove={p.enabled ? p.onHover : undefined}
      // 누르는 순간 검색 칸의 초점을 뺏기지 않게(줄은 초점을 받지 않는다 — 키는 검색 칸이 받는다).
      onMouseDown={(e) => e.preventDefault()}
      onClick={p.enabled ? p.onRun : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 pointer-coarse:py-3 ${p.enabled ? 'cursor-pointer text-slate-200' : 'cursor-default text-slate-500 opacity-60'} ${p.active ? 'bg-white/10 ring-1 ring-[var(--vs-accent)]' : ''}`}>
      {p.icon ? <StudioIcon name={p.icon} className="h-4 w-4 shrink-0 text-slate-400" /> : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{p.name}</span>
          {p.current ? <span className="shrink-0 text-[12px] text-slate-500">{t('panel.videoStudio.palette.current')}</span> : null}
        </span>
        {p.detail ? <span className="block truncate text-[12px] text-slate-500">{p.detail}</span> : null}
      </span>
      {p.checked ? (
        <span className="flex shrink-0 items-center text-[var(--vs-accent)]" aria-label={t('panel.videoStudio.palette.on')} title={t('panel.videoStudio.palette.on')}>
          <StudioIcon name="check" className="h-3.5 w-3.5" />
        </span>
      ) : null}
      {p.hint ? <span className="shrink-0 text-[12px] tabular-nums text-slate-500">{p.hint}</span> : null}
      {p.combo ? <kbd className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 font-sans text-[12px] tabular-nums text-slate-400">{shortcutLabel(p.combo)}</kbd> : null}
      {p.more ? <StudioIcon name="chevronDown" className="h-3.5 w-3.5 shrink-0 -rotate-90 text-slate-500" /> : null}
    </li>
  );
}

import { useTranslation } from 'react-i18next';
import { DIFF_LINE_LIMIT, type DiffLine, type PassReport } from '@vibisual/video';

import { StudioIcon } from './studioIcons.js';
import { diffLineText } from './diffText.js';

/** §5.13 (V) 37-3 — "이번에 바뀐 것" 카드: 맡기기 직전 판 ↔ 지금(`diffDoc`) + 바퀴 보고 + [이 바퀴 되돌리기]. 줄을 누르면 그 장면·아이템으로. */
export interface StudioChangeCardProps {
  readonly lines: readonly DiffLine[];
  readonly report: PassReport | null;
  /** 바퀴가 아직 도는가(보고 전). */
  readonly open: boolean;
  readonly onJump: (target: NonNullable<DiffLine['target']>) => void;
  readonly onUndoPass: (() => void) | null;
}

export function StudioChangeCard(p: StudioChangeCardProps): React.JSX.Element | null {
  const { t } = useTranslation();
  if (p.lines.length === 0 && !p.report) return null;
  const shown = p.lines.slice(0, DIFF_LINE_LIMIT);
  const more = p.lines.length - shown.length;
  return (
    <section className="animate-[vs-in-right_160ms_ease-out] rounded-xl border border-white/10 bg-vb-card p-3" aria-label={t('panel.videoStudio.ai.changed')}>
      <header className="mb-2 flex items-center gap-2">
        <span className="text-[12px] font-semibold text-slate-200">{t('panel.videoStudio.ai.changed')}</span>
        {p.open ? <span className="h-1.5 w-1.5 animate-[vs-breathe_1.2s_ease-in-out_infinite] rounded-full bg-[var(--vs-accent)]" aria-label={t('panel.videoStudio.ai.working')} /> : null}
        <span className="flex-1" />
        {p.onUndoPass ? (
          <button type="button" onClick={p.onUndoPass} className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-slate-400 hover:bg-white/10 hover:text-slate-100 pointer-coarse:py-2">
            <StudioIcon name="undoPass" className="h-3.5 w-3.5" />{t('panel.videoStudio.ai.undoPass')}
          </button>
        ) : null}
      </header>
      {shown.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {shown.map((line, i) => (
            <li key={`${line.kind}-${i}`}>
              {line.target ? (
                <button type="button" onClick={() => line.target && p.onJump(line.target)}
                  className="w-full truncate rounded-md px-1.5 py-1 text-left text-[13px] text-slate-300 hover:bg-white/[0.06] hover:text-slate-50 pointer-coarse:py-2">
                  {diffLineText(t, line)}
                </button>
              ) : (
                <span className="block truncate px-1.5 py-1 text-[13px] text-slate-400">{diffLineText(t, line)}</span>
              )}
            </li>
          ))}
          {more > 0 ? <li className="px-1.5 text-[12px] text-slate-500">{t('panel.videoStudio.ai.moreChanges', { count: more })}</li> : null}
        </ul>
      ) : null}
      {p.report ? (
        <div className="mt-2 border-t border-white/10 pt-2">
          {p.report.summary ? <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-300">{p.report.summary}</p> : null}
          {p.report.warnings.length > 0 ? (
            <ul className="mt-1.5 flex flex-col gap-1">
              {p.report.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5 break-words text-[12px] text-amber-300"><StudioIcon name="warn" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0">{w}</span></li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

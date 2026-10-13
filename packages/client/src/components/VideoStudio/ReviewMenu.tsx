import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MotionFinding } from '@vibisual/video';

import { StudioPopover, PopoverItem } from './StudioPopover.js';
import { StudioIcon } from './studioIcons.js';
import { formatClock } from './PreviewControls.js';

/**
 * §5.13 (V) 37-9 — 장면 줄 위 **검수 표시**를 누르면 뜨는 판: 사람 말 한 줄 + [AI 에게 고치게](그 시각·아이템·검수 결과가 실린
 * 바퀴) + [비트에 맞추기](비트 어긋남 — 코드가 계산한 연산) + [이번엔 넘기기] + [프레임까지 다시 보기].
 */
export interface ReviewMenuProps {
  readonly anchor: HTMLElement;
  readonly finding: MotionFinding;
  readonly busy: boolean;
  readonly framesBusy: boolean;
  readonly withFrames: boolean;
  readonly onFix: () => void;
  readonly onApplyFix: (() => void) | null;
  readonly onSkip: () => void;
  readonly onRunFrames: () => void;
  readonly onClose: () => void;
}

export function ReviewMenu(p: ReviewMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const anchor = useMemo(() => ({ current: p.anchor }), [p.anchor]);
  const run = (fn: () => void) => (): void => { p.onClose(); fn(); };
  const f = p.finding;
  return (
    <StudioPopover anchor={anchor} open onClose={p.onClose} side="above" label={t('panel.videoStudio.review.title')} className="w-72">
      <div className="flex items-start gap-2 px-2.5 pb-2 pt-1">
        <StudioIcon name={f.level === 'info' ? 'info' : 'warn'} className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${f.level === 'error' ? 'text-rose-300' : f.level === 'warn' ? 'text-amber-300' : 'text-slate-400'}`} />
        <div className="min-w-0">
          <p className="text-[13px] leading-snug text-slate-100">{t(`panel.videoStudio.review.${f.code}`, { ...(f.values ?? {}) })}</p>
          <p className="mt-0.5 text-[12px] tabular-nums text-slate-500">{formatClock(f.t)}{f.end !== undefined ? ` – ${formatClock(f.end)}` : ''}</p>
        </div>
      </div>
      <PopoverItem disabled={p.busy} onClick={run(p.onFix)}><span className="flex items-center gap-2"><StudioIcon name="sparkle" />{t('panel.videoStudio.review.fix')}</span></PopoverItem>
      {p.onApplyFix ? (
        <PopoverItem onClick={run(p.onApplyFix)}><span className="flex items-center gap-2"><StudioIcon name="magnet" />{t('panel.videoStudio.review.snap')}</span></PopoverItem>
      ) : null}
      <PopoverItem onClick={run(p.onSkip)}><span className="flex items-center gap-2"><StudioIcon name="close" />{t('panel.videoStudio.review.skip')}</span></PopoverItem>
      <div className="my-1 border-t border-white/10" />
      <PopoverItem disabled={p.framesBusy} onClick={run(p.onRunFrames)}>
        <span className="flex items-center gap-2"><StudioIcon name="film" />{p.framesBusy ? t('panel.videoStudio.review.framesBusy') : t('panel.videoStudio.review.frames')}</span>
      </PopoverItem>
      {!p.withFrames ? <p className="px-2.5 pb-1 text-[12px] leading-snug text-slate-500">{t('panel.videoStudio.review.docOnly')}</p> : null}
    </StudioPopover>
  );
}

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { StudioIcon } from './studioIcons.js';
import { formatClock } from './PreviewControls.js';

/**
 * §5.13 (T-9)(V) 37-1 — **프레임 띠 보기**: 한 구간의 흐름을 한 장으로. [정밀 편집]의 코드 정보 [프레임 띠]가 연다.
 * 바깥을 누르거나 Esc 로 닫는다(셸의 Esc 도 닫는다 — 같은 상태). 띠 아래에 찍은 시각을 적는다(tabular-nums).
 */
export interface FrameStripViewerProps {
  readonly strip: { readonly image: string; readonly times: readonly number[]; readonly title: string };
  readonly onClose: () => void;
}

export function FrameStripViewer({ strip, onClose }: FrameStripViewerProps): React.JSX.Element {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return (
    <div
      className="absolute inset-0 z-30 flex animate-[vs-pop_140ms_ease-out] items-center justify-center bg-black/75 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('panel.videoStudio.composition.strip')}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      <div className="flex max-h-full max-w-full flex-col gap-2 rounded-lg border border-white/10 bg-vb-card p-3 shadow-xl shadow-black/50">
        <div className="flex items-center gap-2">
          <StudioIcon name="film" className="h-3.5 w-3.5 text-slate-400" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-200">{strip.title}</span>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })}
            className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100">
            <StudioIcon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>
        <img src={strip.image} alt={strip.title} className="min-h-0 max-w-full flex-1 object-contain" draggable={false} />
        {strip.times.length > 0 ? (
          <p className="truncate text-[12px] tabular-nums text-slate-500">{strip.times.map((s) => formatClock(s)).join(' · ')}</p>
        ) : null}
      </div>
    </div>
  );
}

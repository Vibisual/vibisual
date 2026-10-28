import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useInspectorPicker } from '../../hooks/useInspectorPicker.js';
import { StudioIcon } from './studioIcons.js';
import { formatClock } from './PreviewControls.js';
import { stripCellAt } from './stripGrid.js';

/** §5.13 (T-9)(V) 37-1 — 프레임 띠 보기(코드 정보 [프레임 띠]가 연다). 바깥·Esc 로 닫는다(셸의 Esc 도 같은 상태). */
export interface FrameStripViewerProps {
  readonly strip: { readonly image: string; readonly times: readonly number[]; readonly title: string; readonly itemId?: string };
  readonly onClose: () => void;
  /** §5.4 #15 (C) — 띠 칸(프레임, 1부터) 하나를 Alt 로 집을 때의 복사 글. 없으면 그림 통째로 집힌다. */
  readonly pickClipboard?: (t: number, frame: number, count: number) => string;
}

export function FrameStripViewer({ strip, onClose, pickClipboard }: FrameStripViewerProps): React.JSX.Element {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  // 그림은 `object-contain` 이라 요소 상자 안에 여백이 있을 수 있다 — 그림 픽셀로 옮겨 칸을 찾고, 상자는 다시 판 안 픽셀로.
  useInspectorPicker(imageRef, pickClipboard ? (at) => {
    const img = imageRef.current;
    const natural = img ? { width: img.naturalWidth, height: img.naturalHeight } : null;
    if (!natural || natural.width <= 0 || natural.height <= 0 || at.width <= 0 || at.height <= 0) return [];
    const scale = Math.min(at.width / natural.width, at.height / natural.height);
    const ox = (at.width - natural.width * scale) / 2;
    const oy = (at.height - natural.height * scale) / 2;
    const cell = stripCellAt(natural, strip.times.length, (at.x - ox) / scale, (at.y - oy) / scale);
    const time = cell ? strip.times[cell.index] : undefined;
    if (!cell || time === undefined) return [];
    return [{
      rect: { x: ox + cell.rect.x * scale, y: oy + cell.rect.y * scale, width: cell.rect.width * scale, height: cell.rect.height * scale },
      label: `#${cell.index + 1} · ${formatClock(time)}`,
      text: strip.title,
      clipboard: pickClipboard(time, cell.index + 1, strip.times.length),
    }];
  } : null);
  return (
    <div
      className="absolute inset-0 z-30 flex animate-[vs-pop_140ms_ease-out] items-center justify-center bg-black/75 p-6 box-narrow:p-2"
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
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100 pointer-coarse:p-2.5">
            <StudioIcon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>
        <img ref={imageRef} src={strip.image} alt={strip.title} className="min-h-0 max-w-full flex-1 object-contain" draggable={false} />
        {strip.times.length > 0 ? (
          // 폰 폭 창·터치에서는 찍은 시각을 말줄임 대신 줄을 바꿔 다 보인다(툴팁이 없다).
          <p className="truncate text-[12px] tabular-nums text-slate-500 box-narrow:whitespace-normal pointer-coarse:whitespace-normal">{strip.times.map((s) => formatClock(s)).join(' · ')}</p>
        ) : null}
      </div>
    </div>
  );
}

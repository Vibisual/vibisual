import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SATELLITE_MAX_BOUNDS } from '@vibisual/shared';

interface Props {
  /** 현재 적용된 상한 (서버 SSOT) */
  value: number;
  /** 포인터 화면 좌표 — 이 근처에 팝업 표시 */
  screenX: number;
  screenY: number;
  onClose: () => void;
  onCommit: (next: number) => void;
}

const { MIN, MAX } = SATELLITE_MAX_BOUNDS;
const clamp = (n: number): number => Math.min(MAX, Math.max(MIN, Math.round(n)));

/** §7.5 v1.62 — 폴더 위성 표시 상한을 포인터 옆 작은 팝업에서 편집 */
export function SatelliteMaxPopup({
  value,
  screenX,
  screenY,
  onClose,
  onCommit,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const commit = useCallback(() => {
    const next = clamp(draft);
    if (next !== value) onCommit(next);
    onClose();
  }, [draft, value, onCommit, onClose]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') onClose();
    },
    [commit, onClose],
  );

  const step = (delta: number): void => setDraft((d) => clamp(d + delta));

  // 화면 가장자리 잘림 방지 (팝업 ~190px)
  const left = Math.min(screenX + 12, window.innerWidth - 206);
  const top = Math.min(Math.max(screenY - 8, 60), window.innerHeight - 140);

  return (
    <div
      ref={ref}
      data-popup="satellite-max"
      className="fixed z-[60] w-[190px] rounded-lg border border-violet-700/60 bg-gray-900 p-3 shadow-2xl shadow-violet-500/30"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-violet-300">
          {t('panel.folderFileTree.maxTitle')}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-gray-500 hover:bg-gray-800 hover:text-gray-200"
          aria-label="close"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* −  값  + */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={draft <= MIN}
          aria-label="decrease"
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border border-gray-700 text-gray-300 hover:border-violet-500 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <input
          type="number"
          autoFocus
          min={MIN}
          max={MAX}
          value={draft}
          onChange={(e) => setDraft(clamp(Number(e.target.value)))}
          onFocus={(e) => e.currentTarget.select()}
          className="h-6 w-full min-w-0 flex-1 rounded border border-gray-700 bg-gray-800 text-center text-sm font-bold text-violet-200 outline-none focus:border-violet-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          onClick={() => step(1)}
          disabled={draft >= MAX}
          aria-label="increase"
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border border-gray-700 text-gray-300 hover:border-violet-500 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* 슬라이더 */}
      <input
        type="range"
        min={MIN}
        max={MAX}
        value={draft}
        onChange={(e) => setDraft(clamp(Number(e.target.value)))}
        className="mt-2.5 h-1 w-full cursor-pointer appearance-none rounded-full bg-gray-700 accent-violet-500"
      />

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-gray-500">{t('panel.folderFileTree.maxHint')}</span>
        <button
          type="button"
          onClick={commit}
          className="rounded bg-violet-600 px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-violet-500"
        >
          {t('panel.folderFileTree.maxSave')}
        </button>
      </div>
    </div>
  );
}

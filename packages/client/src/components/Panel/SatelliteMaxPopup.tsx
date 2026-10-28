import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SATELLITE_MAX_BOUNDS } from '@vibisual/shared';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { placeNearPointer, type BoxSize } from './panelPopupPlacement.js';

/** 실측 전 1차 추정 크기(폭 190 · 키 140) — 마운트 직후 layout effect 가 실제 크기로 바로잡는다. */
const POPUP_SIZE_GUESS: BoxSize = { w: 190, h: 140 };

interface Props {
  /** 현재 적용된 상한 (서버 SSOT) */
  value: number;
  /** 포인터 화면 좌표 — 이 근처에 팝업 표시 */
  screenX: number;
  screenY: number;
  onClose: () => void;
  onCommit: (next: number) => void;
  /** 범위 — 기본 `SATELLITE_MAX_BOUNDS`, 도메인 버블은 `WEB_ENTRY_MAX_BOUNDS`(같은 일에 창 두 벌 ❌). */
  bounds?: { MIN: number; MAX: number };
  /** 제목 i18n 키. 안 주면 폴더 위성 문구. */
  titleKey?: string;
  /** 하단 힌트 i18n 키. 안 주면 폴더 위성 문구. */
  hintKey?: string;
  /**
   * §5.1 #2-1 (D) — 제목 아래 안내 한 줄의 i18n 키(주면 뜬다). 폴더 위성은 "묶음은 한 자리"를 말한다 — 헤더의 위성 수가
   * 상한보다 클 수 있는 이유다. 도메인 버블에는 주지 않는다.
   */
  noteKey?: string;
}

/** §7.5 — 버블별 표시 상한 편집 팝업(§7.22 도메인 버블 공용). */
export function SatelliteMaxPopup({
  value,
  screenX,
  screenY,
  onClose,
  onCommit,
  bounds,
  titleKey,
  hintKey,
  noteKey,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { MIN, MAX } = bounds ?? SATELLITE_MAX_BOUNDS;
  const clamp = useCallback(
    (n: number): number => Math.min(MAX, Math.max(MIN, Math.round(n))),
    [MIN, MAX],
  );
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<BoxSize>(POPUP_SIZE_GUESS);

  // 화면 끝 클램프는 **실제 크기**로 — 안내 한 줄(noteKey)이 붙거나 번역이 길면 키가 140px 을 넘어
  //   종전 상수 가정으로는 아래가 잘렸다. 안내 줄 유무가 바뀔 때만 다시 잰다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize((prev) => (prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
  }, [noteKey]);

  // 바깥 press 로 닫기(공통 규약 — 팝업 안에서 시작한 드래그로는 안 닫힌다).
  useOutsidePressDismiss({ onDismiss: onClose, refs: [ref], capture: false });

  const commit = useCallback(() => {
    const next = clamp(draft);
    if (next !== value) onCommit(next);
    onClose();
  }, [draft, value, onCommit, onClose, clamp]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') onClose();
    },
    [commit, onClose],
  );

  const step = (delta: number): void => setDraft((d) => clamp(d + delta));

  // 화면 가장자리 잘림 방지 — 포인터 오른쪽에 앉히고 넘치면 화면 안으로(위쪽 60px 은 머리 띠 자리).
  const { left, top } = placeNearPointer(
    { x: screenX, y: screenY },
    size,
    { w: window.innerWidth, h: window.innerHeight },
    { offsetX: 12, offsetY: -8, minTop: 60 },
  );

  return (
    <div
      ref={ref}
      data-popup="satellite-max"
      className="fixed z-[60] w-[190px] rounded-lg border border-violet-700/60 bg-gray-900 p-3 shadow-2xl shadow-violet-500/30 pointer-coarse:w-[220px]"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-violet-300">
          {t(titleKey ?? 'panel.folderFileTree.maxTitle')}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-gray-500 hover:bg-gray-800 hover:text-gray-200 pointer-coarse:p-2"
          aria-label={t('common.close')}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {noteKey !== undefined ? (
        <p className="mb-2 text-[12px] leading-snug text-gray-400">{t(noteKey)}</p>
      ) : null}

      {/* −  값  + */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={draft <= MIN}
          aria-label={t('panel.folderFileTree.maxDecrease')}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border border-gray-700 text-gray-300 hover:border-violet-500 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-30 pointer-coarse:h-9 pointer-coarse:w-9"
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
          className="h-6 w-full min-w-0 flex-1 rounded border border-gray-700 bg-gray-800 text-center text-sm font-bold text-violet-200 outline-none focus:border-violet-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none pointer-coarse:h-9"
        />
        <button
          type="button"
          onClick={() => step(1)}
          disabled={draft >= MAX}
          aria-label={t('panel.folderFileTree.maxIncrease')}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border border-gray-700 text-gray-300 hover:border-violet-500 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-30 pointer-coarse:h-9 pointer-coarse:w-9"
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

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[12px] text-gray-500">{t(hintKey ?? 'panel.folderFileTree.maxHint')}</span>
        <button
          type="button"
          onClick={commit}
          className="shrink-0 rounded bg-violet-600 px-2.5 py-0.5 text-[12px] font-medium text-white hover:bg-violet-500 pointer-coarse:min-h-8 pointer-coarse:px-3"
        >
          {t('panel.folderFileTree.maxSave')}
        </button>
      </div>
    </div>
  );
}

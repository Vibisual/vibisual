import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { CaptureSourceInfo } from '@vibisual/shared';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';

// §5.9 화면/프로그램 캡처 — 소스 선택 팝업(OBS/디스코드식).
//
// window.api.capture.listSources()(desktopCapturer, main 전용)로 캡처 가능한 화면·창을
// 받아 썸네일 그리드로 보여주고, 사용자가 하나 고르면 onPick 으로 넘긴다. 실제 라이브
// 스트림은 캡처 버블(BubbleNode)이 고른 소스 id 로 getUserMedia 해서 붙인다(useCaptureStream).
// packaged Electron 한정 — window.api.capture 가 없으면 안내만 표시한다.

interface CaptureSourcePickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (source: CaptureSourceInfo) => void;
}

export function CaptureSourcePicker({ open, onClose, onPick }: CaptureSourcePickerProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [sources, setSources] = useState<CaptureSourceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    const capture = window.api?.capture;
    if (!capture) {
      setUnavailable(true);
      setSources([]);
      return;
    }
    setUnavailable(false);
    setLoading(true);
    try {
      setSources(await capture.listSources());
    } catch {
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const backdrop = useBackdropDismiss(onClose);

  if (!open) return null;

  const screens = sources.filter((s) => s.kind === 'screen');
  const windows = sources.filter((s) => s.kind === 'window');

  const renderCard = (s: CaptureSourceInfo): React.JSX.Element => (
    <button
      key={s.id}
      type="button"
      onClick={() => onPick(s)}
      className="group flex flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-black/30 text-left transition-colors hover:border-sky-400/60 hover:bg-white/[0.05]"
    >
      <div className="flex aspect-video items-center justify-center overflow-hidden bg-black/50">
        {s.thumbnailDataUrl ? (
          <img src={s.thumbnailDataUrl} alt="" className="h-full w-full object-contain" draggable={false} />
        ) : (
          <svg className="h-8 w-8 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
          </svg>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {s.appIconDataUrl && <img src={s.appIconDataUrl} alt="" className="h-4 w-4 shrink-0" draggable={false} />}
        <span className="truncate text-[12px] text-gray-200 group-hover:text-white">{s.name}</span>
      </div>
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" {...backdrop}>
      <div
        className="flex max-h-[82vh] w-[720px] max-w-[94vw] flex-col rounded-xl border border-white/[0.08] bg-gray-900/95 p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="h-4.5 w-4.5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
            </svg>
            <h2 className="text-[15px] font-semibold text-white">
              {t('bubbleMap.capture.pickerTitle', { defaultValue: '화면·프로그램 캡처' })}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="rounded-md p-1 text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
              aria-label={t('bubbleMap.capture.refresh', { defaultValue: '새로고침' })}
            >
              <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
              aria-label={t('common.close', { defaultValue: 'Close' })}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>
        <p className="mb-4 text-[12px] leading-relaxed text-gray-400">
          {t('bubbleMap.capture.pickerSubtitle', { defaultValue: '버블에 라이브로 띄울 화면이나 프로그램 창을 고르세요.' })}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {unavailable ? (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-[12px] text-amber-300">
              {t('bubbleMap.capture.unavailable', { defaultValue: '이 환경에서는 화면 캡처를 쓸 수 없습니다 (패키지 앱에서만 지원).' })}
            </div>
          ) : loading && sources.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-gray-500">
              {t('bubbleMap.capture.loading', { defaultValue: '소스 불러오는 중…' })}
            </div>
          ) : sources.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-gray-500">
              {t('bubbleMap.capture.empty', { defaultValue: '캡처할 수 있는 소스가 없습니다.' })}
            </div>
          ) : (
            <div className="space-y-4">
              {screens.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    {t('bubbleMap.capture.screens', { defaultValue: '화면' })}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">{screens.map(renderCard)}</div>
                </div>
              )}
              {windows.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    {t('bubbleMap.capture.windows', { defaultValue: '프로그램 · 창' })}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">{windows.map(renderCard)}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

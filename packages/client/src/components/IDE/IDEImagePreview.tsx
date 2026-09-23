import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceImageStatus } from './useWorkspaceImage.js';

/**
 * IDEImagePreview.tsx — §5.5 #17-27 ⑭ 편집창 본문 자리에 서는 **그림 한 장**.
 *
 * `CodeEditor` 와 형제다 — 같은 자리에 둘 중 하나만 선다(문서가 이미지면 이쪽). 바탕은 바둑판이라
 * 투명 PNG 의 알파가 눈에 보이고, 그림을 누르면 주석 팝업(#17-25)이 열린다 — 첨부 썸네일과 같은
 * 손버릇이라 사용자가 새로 배울 것이 없다.
 */

interface IDEImagePreviewProps {
  url: string | null;
  status: WorkspaceImageStatus;
  /** 맞춤(패널에 맞춰 축소, 확대 ❌) / 원본 크기(1:1, 넘치면 스크롤) */
  fit: boolean;
  onNatural: (size: { w: number; h: number }) => void;
  /** 그림을 눌렀을 때 — 주석 팝업을 연다. */
  onOpen: () => void;
}

export const IDEImagePreview = memo(function IDEImagePreview({
  url,
  status,
  fit,
  onNatural,
  onOpen,
}: IDEImagePreviewProps): React.JSX.Element {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [zoomSize, setZoomSize] = useState<{ width: number; height: number } | null>(null);
  const zoomAnchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const fitted = fit && zoomSize === null;

  // A new image or a fit/actual-size command starts from that view's default size.
  useLayoutEffect(() => {
    zoomAnchor.current = null;
    setZoomSize(null);
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
  }, [url, fit]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const image = imageRef.current;
      if (!image || !image.naturalWidth || !image.naturalHeight) return;
      const rect = image.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      zoomAnchor.current = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      const factor = Math.exp(-Math.max(-600, Math.min(600, event.deltaY * unit)) * 0.002);
      setZoomSize((current) => {
        const scale = (current?.width ?? rect.width) / image.naturalWidth;
        // Avoid jumping up to 1% when a very large image starts below that limit.
        const next = Math.max(Math.min(0.01, scale), Math.min(32, scale * factor));
        return { width: image.naturalWidth * next, height: image.naturalHeight * next };
      });
    };
    // React's delegated wheel listener is passive: a native listener also prevents browser zoom.
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [url, status, fit]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    const anchor = zoomAnchor.current;
    if (!viewport || !image || !anchor || !zoomSize) return;
    const rect = image.getBoundingClientRect();
    viewport.scrollLeft += rect.left + anchor.x * rect.width - anchor.clientX;
    viewport.scrollTop += rect.top + anchor.y * rect.height - anchor.clientY;
    zoomAnchor.current = null;
  }, [zoomSize]);

  if (status === 'error') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-950 px-3 py-4">
        <p className="text-center text-[12px] text-gray-600">{t('ide.editor.imageReadError')}</p>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-950 px-3 py-4">
        <p className="text-center text-[12px] text-gray-600">{t('ide.explorer.loading')}</p>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={`bg-alpha-checker flex min-h-0 flex-1 overflow-auto p-3 ${
        fitted ? 'items-center justify-center' : ''
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        title={t('ide.editor.imageEditHint')}
        aria-label={t('ide.editor.imageEdit')}
        className={`m-auto block cursor-zoom-in ${fitted ? 'max-h-full max-w-full' : 'flex-shrink-0'}`}
      >
        <img
          ref={imageRef}
          src={url}
          alt=""
          style={zoomSize ?? undefined}
          onLoad={(e) => onNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className={
            fitted
              ? 'max-h-full max-w-full object-contain shadow-lg'
              : 'max-w-none shadow-lg'
          }
        />
      </button>
    </div>
  );
});

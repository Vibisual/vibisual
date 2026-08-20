import React, { memo } from 'react';
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
      className={`bg-alpha-checker flex min-h-0 flex-1 overflow-auto p-3 ${
        fit ? 'items-center justify-center' : ''
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        title={t('ide.editor.imageEditHint')}
        aria-label={t('ide.editor.imageEdit')}
        className={`m-auto block cursor-zoom-in ${fit ? 'max-h-full max-w-full' : 'flex-shrink-0'}`}
      >
        <img
          src={url}
          alt=""
          onLoad={(e) => onNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className={
            fit
              ? 'max-h-full max-w-full object-contain shadow-lg'
              : 'max-w-none shadow-lg'
          }
        />
      </button>
    </div>
  );
});

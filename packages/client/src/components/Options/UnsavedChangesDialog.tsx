import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';

/**
 * §4 — 옵션창을 **저장하지 않고 나가려 할 때** 뜨는 확인 팝업(우리 디자인).
 *
 * 종전에는 `window.confirm` 이었다. 그 창은 OS 가 그리므로 우리 톤과 무관한 모양·버튼 순서·
 * 시스템 소리로 뜨고, Electron 에서는 앱 전체를 얼리는 모달이라 "우리 앱이 아닌 무언가가 튀어나온"
 * 인상을 준다. 그래서 `TrashPurgeDialog`·`WorktreeDeleteDialog` 와 같은 문법(백드롭 + 카드)으로 그린다.
 *
 * 닫기 경로는 호출부(`OptionsWindow`)가 한 곳으로 모은다 — 여기서는 배경 클릭 = "계속 편집"만 안다
 * (Esc 는 옵션창이 이미 잡고 있어 여기서 또 달면 두 벌이 된다).
 */

interface UnsavedChangesDialogProps {
  open: boolean;
  /** 창을 닫지 않고 편집으로 되돌아간다(배경 클릭·Esc 포함). */
  onKeepEditing: () => void;
  /** 편집분을 버리고 옵션창을 닫는다. */
  onDiscard: () => void;
}

export function UnsavedChangesDialog({ open, onKeepEditing, onDiscard }: UnsavedChangesDialogProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const keepRef = useRef<HTMLButtonElement>(null);
  const backdrop = useBackdropDismiss(onKeepEditing);

  // 뜨자마자 안전한 쪽(계속 편집)에 초점 — Enter 를 눌러도 편집분이 날아가지 않는다.
  useEffect(() => {
    if (open) keepRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" {...backdrop}>
      <div className="w-[clamp(20rem,32vw,26rem)] overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl shadow-black/40">
        <div className="flex items-center gap-2 border-b border-gray-800 px-5 py-3">
          <svg className="h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-sm font-semibold text-gray-100">
            {t('panel.options.discardTitle', { defaultValue: 'Unsaved changes' })}
          </span>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-gray-200">
            {t('panel.options.discardConfirm', { defaultValue: 'Discard unsaved changes?' })}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-gray-500">
            {t('panel.options.discardDesc', {
              defaultValue: 'Your changes have not been applied yet. If you leave now, they will be lost.',
            })}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              ref={keepRef}
              type="button"
              onClick={onKeepEditing}
              className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-700"
            >
              {t('panel.options.discardKeep', { defaultValue: 'Keep editing' })}
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="rounded border border-red-700 bg-red-800 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700"
            >
              {t('panel.options.discardLeave', { defaultValue: 'Discard & close' })}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';

interface Props {
  contiId: string;
  frameId: string;
  elementId: string;
  screenX: number;
  screenY: number;
  onClose: () => void;
}

/** §7.13 v1.47 — frame element 클릭 시 옆에 떠서 한 줄 프롬프트 + 재가동 */
export function InlinePromptPopup({
  contiId,
  frameId,
  elementId,
  screenX,
  screenY,
  onClose,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const patchElement = useGraphStore((s) => s.patchContiElement);
  const patchingKey = `${contiId}::${frameId}::${elementId}`;
  const patching = useGraphStore((s) => s.contiElementPatching[patchingKey]);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!text.trim() || patching) return;
    const ok = await patchElement(contiId, frameId, elementId, text.trim());
    if (ok) {
      setText('');
      onClose();
    }
  }, [text, patching, patchElement, contiId, frameId, elementId, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSubmit, onClose],
  );

  // 화면 우측 잘림 방지
  const left = Math.min(screenX + 12, window.innerWidth - 320);
  const top = Math.min(Math.max(screenY, 60), window.innerHeight - 180);

  return (
    <div
      data-popup="conti-prompt"
      className="fixed z-[60] w-[300px] rounded-lg border border-blue-700/60 bg-gray-900 p-3 shadow-2xl shadow-blue-500/30"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-blue-300">
          {t('panel.contiPrompt.title', { defaultValue: '프롬프트로 element 패치' })}
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
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        placeholder={t('panel.contiPrompt.placeholder', { defaultValue: '예: 동그라미로 변경, 색을 빨강으로, 라벨 수정...' })}
        disabled={patching}
        className="w-full resize-none rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-blue-500 disabled:opacity-50"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="mr-auto text-[10px] text-gray-500">
          {t('panel.contiPrompt.hint', { defaultValue: 'Enter 로 재가동, Esc 로 취소' })}
        </span>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!text.trim() || patching}
          className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {patching ? (
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : null}
          <span>{t('panel.contiPrompt.run', { defaultValue: '재가동' })}</span>
        </button>
      </div>
    </div>
  );
}

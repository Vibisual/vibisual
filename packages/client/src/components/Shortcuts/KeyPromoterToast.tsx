import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { COMMANDS } from '@vibisual/shared';
import { useKeymapStore } from '../../stores/keymap.js';
import { useKeyPromoterStore, isPromotable, PROMOTE_TOAST_MS } from '../../stores/keyPromoter.js';
import { KeyHint } from './KeyHint.js';
import { COMMAND_LABEL_EN } from './commandLabels.js';

/**
 * KeyPromoterToast.tsx — **"이건 키로도 됩니다."**
 *
 * 같은 동작을 마우스로 몇 번 반복하면 그 자리에 잠깐 뜬다(§ `stores/keyPromoter.ts` 규율).
 * 화면을 가리지 않도록 우하단 구석에 작게 놓고, 스스로 사라진다.
 *
 * 토스트 안의 키캡도 `KeyHint` 라 **그 자리에서 바꿀 수 있다** — "그 키가 손에 안 맞는다"가
 * 곧 다음 행동으로 이어지게.
 */
export function KeyPromoterToast(): React.JSX.Element | null {
  const { t } = useTranslation();
  const current = useKeyPromoterStore((s) => s.current);
  const dismiss = useKeyPromoterStore((s) => s.dismiss);
  const resolved = useKeymapStore((s) => s.resolved);

  const binding = current ? resolved[current] : null;
  const show = !!current && isPromotable(current, binding);

  useEffect(() => {
    if (!show) return;
    const timer = window.setTimeout(dismiss, PROMOTE_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [show, current, dismiss]);

  if (!show || !current) return null;

  return createPortal(
    <div className="pointer-events-auto fixed bottom-4 right-4 z-[160] flex max-w-sm items-center gap-3 rounded-lg border border-gray-700 bg-gray-900/95 px-3 py-2 shadow-2xl">
      <svg className="h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-gray-200">
          {t('common.shortcuts.promoter.title', {
            name: t(COMMANDS[current].labelKey, { defaultValue: COMMAND_LABEL_EN[current] }),
            defaultValue: '{{name}} also works from the keyboard',
          })}
        </div>
      </div>
      <KeyHint cmd={current} tone="strong" />
      <button
        type="button"
        onClick={dismiss}
        title={t('common.close', { defaultValue: 'Close' })}
        aria-label={t('common.close', { defaultValue: 'Close' })}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-800 hover:text-gray-200"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>,
    document.body,
  );
}

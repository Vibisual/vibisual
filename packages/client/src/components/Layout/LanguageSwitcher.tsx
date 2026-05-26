import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_UI_LOCALES, LOCALE_META } from '@vibisual/shared';
import type { UiLocale } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

export function LanguageSwitcher(): React.JSX.Element {
  const { t } = useTranslation();
  const uiLocale = useGraphStore((s) => s.uiLocale);
  const setUiLocale = useGraphStore((s) => s.setUiLocale);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: Event): void {
      const target = e.target as Node | null;
      if (ref.current && target && !ref.current.contains(target)) setOpen(false);
    }
    function onBlur(): void {
      // iframe 이 포커스를 가져가면 window blur 가 발생 → 드롭다운 닫기.
      setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = LOCALE_META[uiLocale]?.nativeName ?? uiLocale;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md bg-white/[0.08] px-2 py-1 text-[11px] text-white/80 transition-colors hover:bg-white/[0.14]"
        aria-label={t('layout.languageSwitcher.changeLanguage')}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z" />
        </svg>
        {current}
      </button>
      {open && (
        <div className="scrollbar-thin absolute right-0 mt-1 max-h-[60vh] min-w-[200px] overflow-y-auto rounded-md border border-white/[0.08] bg-gray-900/95 shadow-xl backdrop-blur-xl">
          {SUPPORTED_UI_LOCALES.map((loc: UiLocale) => {
            const isActive = loc === uiLocale;
            return (
              <button
                key={loc}
                type="button"
                onClick={() => {
                  void setUiLocale(loc);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12px] transition-colors ${
                  isActive ? 'bg-blue-500/10 text-blue-300' : 'text-white/80 hover:bg-white/[0.04]'
                }`}
              >
                <span>{LOCALE_META[loc].nativeName}</span>
                {isActive && <span className="text-[10px] text-blue-400">●</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useCallback, useLayoutEffect, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_UI_LOCALES, LOCALE_META } from '@vibisual/shared';
import type { UiLocale } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';

/**
 * 목록을 **띄우는 창 위로** 올려야 하는 자리를 위한 문(§4 첫 실행 온보딩).
 *
 * 온보딩 팝업(설치·로그인·폴더)은 화면 전체를 덮는 백드롭을 깔아 헤더의 이 전환기를 가린다 —
 * 처음 켠 한국어 사용자에게는 **언어를 바꿀 길이 하나도 없는 화면**이 된다(폰에서는 헤더
 * 전환기 자체가 접혀 있어 더 그렇다). 그래서 그 창들은 이 컴포넌트를 자기 머리에 얹는데,
 * 창 카드가 `overflow-hidden` 이라 종전의 `absolute` 목록은 카드 밖으로 못 나가 잘린다.
 * `portalMenu` 를 켜면 목록만 `document.body` 로 빼서 버튼 아래에 띄운다 —
 * **헤더의 기본 동작(absolute)은 손대지 않는다**(그 자리는 잘릴 일이 없다).
 */
interface LanguageSwitcherProps {
  /** 목록을 body 로 빼고 `zIndex` 위에 띄운다. 기본값 false = 종전 그대로. */
  portalMenu?: boolean;
  /** `portalMenu` 일 때 목록의 z-index. 얹는 창보다 위여야 한다. */
  menuZIndex?: number;
}

export function LanguageSwitcher({ portalMenu = false, menuZIndex = 100_800 }: LanguageSwitcherProps = {}): React.JSX.Element {
  const { t } = useTranslation();
  const uiLocale = useGraphStore((s) => s.uiLocale);
  const setUiLocale = useGraphStore((s) => s.setUiLocale);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** portal 목록의 화면 좌표 — 버튼 rect 에서 잰다(열릴 때 + 창 크기 변화 때). */
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const measure = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 오른쪽 정렬은 absolute 판본(`right-0`)과 같게 — 버튼의 오른쪽 끝에 목록 오른쪽을 맞춘다.
    setMenuPos({ top: r.bottom + 4, right: Math.max(0, window.innerWidth - r.right) });
  }, []);

  useLayoutEffect(() => {
    if (!portalMenu || !open) return;
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [portalMenu, open, measure]);

  // 바깥 press → 닫기(공통 규약). iframe 위 클릭은 mousedown 이 안 오는 경우가 있어 pointerdown 도 함께 듣는다.
  useOutsidePressDismiss({
    enabled: open,
    onDismiss: () => setOpen(false),
    refs: [ref, menuRef],
    events: ['mousedown', 'pointerdown'],
  });

  useEffect(() => {
    if (!open) return;
    function onBlur(): void {
      // iframe 이 포커스를 가져가면 window blur 가 발생 → 드롭다운 닫기.
      setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('blur', onBlur);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = LOCALE_META[uiLocale]?.nativeName ?? uiLocale;

  const items = (
    <>
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
            {/* 지금 언어 표시 — 글리프 문자(●)는 OS·폰트마다 크기가 달라 stroke SVG 로. */}
            {isActive && (
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </button>
        );
      })}
    </>
  );

  const listClass = 'scrollbar-thin max-h-[60vh] min-w-[200px] overflow-y-auto rounded-md border border-white/[0.08] bg-gray-900/95 shadow-xl backdrop-blur-xl';

  // portal 판본은 body 로 빠지므로 `ref` 의 바깥 판정(useOutsidePressDismiss)에서 벗어난다 →
  //   목록 자체도 `refs` 에 넣어야 "목록을 눌렀는데 닫히는" 일이 없다.
  const menu = portalMenu
    ? createPortal(
        <div ref={menuRef} className={`fixed ${listClass}`} style={{ top: menuPos?.top ?? -9999, right: menuPos?.right ?? 0, zIndex: menuZIndex }}>
          {items}
        </div>,
        document.body,
      )
    : <div className={`absolute right-0 mt-1 ${listClass}`}>{items}</div>;

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md bg-white/[0.08] px-2 py-1 text-[12px] text-white/80 transition-colors hover:bg-white/[0.14]"
        aria-label={t('layout.languageSwitcher.changeLanguage')}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z" />
        </svg>
        {current}
      </button>
      {open && menu}
    </div>
  );
}

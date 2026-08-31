import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { OptionsWindow } from '../Options/OptionsWindow.js';
import { PluginsWindow } from '../Plugins/PluginsWindow.js';
import { MobileAccessWindow } from './MobileAccessWindow.js';
import { RemoteControlWindow } from './RemoteControlWindow.js';
import { isPackagedDesktop } from '../../transport/index.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';


export function FileMenu(): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  /** §5.10 — 가이드는 스토어 문 하나로 연다(메모리 라이브러리 [사용법] 과 같은 문). */
  const openGuide = useGraphStore((st) => st.openGuide);
  const [loading, setLoading] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 외부 press → 닫기(공통 규약 — 메뉴 안에서 시작한 드래그로는 안 닫힌다).
  // 캡처 단계: React Flow pane 이 mousedown 에 stopPropagation 을 걸어
  // 버블 단계에선 document 까지 안 올라온다(캔버스 클릭 시 메뉴가 안 닫히는 원인).
  useOutsidePressDismiss({ enabled: open, onDismiss: () => setOpen(false), refs: [menuRef] });

  // ESC → 닫기
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // §4 (첫 실행 온보딩) ③ — 폴더 선택의 창구는 스토어 하나다(`openProjectFolder`). 여기와
  //   폴더 게이트가 각자 fetch 를 들면 "고른 뒤에 무엇을 하는가"(탭 활성화·게이트 닫기)가
  //   두 벌로 갈라진다.
  const handleOpenFolder = useCallback(async () => {
    setLoading(true);
    setOpen(false);
    try {
      await useGraphStore.getState().openProjectFolder();
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition-all duration-150 ${
          open
            ? 'bg-white/10 text-white'
            : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
        } ${loading ? 'opacity-50' : ''}`}
      >
        {t('panel.fileMenu.file')}
      </button>

      {open && (
        <div className="menu-dropdown absolute left-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-white/[0.08] bg-gray-900/95 p-1 shadow-2xl backdrop-blur-xl">
          <button
            type="button"
            onClick={handleOpenFolder}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <svg className="h-4 w-4 shrink-0 text-gray-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 4.5V12a1.5 1.5 0 001.5 1.5h9A1.5 1.5 0 0014 12V6.5A1.5 1.5 0 0012.5 5H8L6.5 3H3.5A1.5 1.5 0 002 4.5z" />
            </svg>
            {t('panel.fileMenu.openFolder')}
          </button>
          {/* §4 v2.42 — Options */}
          <div className="my-1 border-t border-white/[0.05]" />
          <button
            type="button"
            onClick={() => { setOpen(false); setOptionsOpen(true); }}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <svg className="h-4 w-4 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>
            </svg>
            {t('panel.fileMenu.options', { defaultValue: 'Options…' })}
          </button>
          {/* §5.11 v3.88 — Plugins (개별 기능 활성화). Options 와 같은 묶음에 둔다 — 둘 다 "앱을 어떻게 쓸지"의 설정. */}
          <button
            type="button"
            onClick={() => { setOpen(false); setPluginsOpen(true); }}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <svg className="h-4 w-4 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h4v3a2 2 0 1 0 4 0V3h4a1 1 0 0 1 1 1v4h-3a2 2 0 1 0 0 4h3v4a1 1 0 0 1-1 1h-4v-3a2 2 0 1 0-4 0v3H6a1 1 0 0 1-1-1v-4H2a2 2 0 1 0 0-4h3V4a1 1 0 0 1 1-1z" />
            </svg>
            {t('panel.fileMenu.plugins')}
          </button>
          {/* §4 v3.16 — Mobile Access (packaged Electron 한정 — 모바일 브라우저에선 window.api 부재) */}
          {isPackagedDesktop() && (
            <button
              type="button"
              onClick={() => { setOpen(false); setMobileOpen(true); }}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <svg className="h-4 w-4 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                <path d="M12 18h.01" />
              </svg>
              {t('panel.fileMenu.mobileAccess', { defaultValue: 'Mobile Access…' })}
            </button>
          )}
          {/* §4 — Remote Control(메신저 브리지). 모바일 웹과 나란히 두되 방향이 반대다:
              저쪽은 우리가 포트를 열고, 이쪽은 우리가 나가서 붙는다. packaged Electron 한정. */}
          {isPackagedDesktop() && (
            <button
              type="button"
              onClick={() => { setOpen(false); setRemoteOpen(true); }}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <svg className="h-4 w-4 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 12h.01" /><path d="M12 12h.01" /><path d="M16 12h.01" />
                <path d="M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 0 1-4.2-.9L3 21l1.9-4.8A7.6 7.6 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {t('panel.fileMenu.remoteControl', { defaultValue: 'Remote Control…' })}
            </button>
          )}
          {/* Guide — 기능 안내 / 만든 기능 인벤토리 */}
          <div className="my-1 border-t border-white/[0.05]" />
          <button
            type="button"
            onClick={() => { setOpen(false); openGuide('start'); }}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <svg className="h-4 w-4 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            {t('panel.fileMenu.guide', { defaultValue: 'Guide' })}
          </button>
        </div>
      )}
      <OptionsWindow open={optionsOpen} onClose={() => setOptionsOpen(false)} />
      <PluginsWindow open={pluginsOpen} onClose={() => setPluginsOpen(false)} />
      <MobileAccessWindow open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <RemoteControlWindow open={remoteOpen} onClose={() => setRemoteOpen(false)} />
    </div>
  );
}

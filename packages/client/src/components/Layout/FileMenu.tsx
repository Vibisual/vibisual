import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { PluginsWindow } from '../Plugins/PluginsWindow.js';
import { RemoteAccessWindow } from '../Remote/RemoteAccessWindow.js';
import { isPackagedDesktop } from '../../transport/index.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';


export function FileMenu(): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  /** §5.10 — 가이드는 스토어 문 하나로 연다(메모리 라이브러리 [사용법] 과 같은 문). */
  const openGuide = useGraphStore((st) => st.openGuide);
  const [loading, setLoading] = useState(false);
  /** §5.10 (O) — 옵션 창도 가이드처럼 스토어 문 하나로 연다(기억 정리 칸의 「활성화 하러 가기」가 같은 문을 쓴다). */
  const openOptions = useGraphStore((st) => st.openOptions);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  /** §4 — 폰 브라우저·텔레그램·디스코드 세 길을 한 창에서(종전 두 항목 병합). */
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
            onClick={() => { setOpen(false); openOptions(); }}
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
          {/* §4 — 원격 접속. 종전에는 "Mobile Access"(웹) 와 "Remote Control"(메신저) 두 항목이
              나란히 있었는데, 둘 다 "폰으로 이 PC 를 만진다"는 같은 일이라 이름만으로는 무엇이
              무엇인지 알 수 없었다. 한 창 안의 세 칸(폰 브라우저·텔레그램·디스코드)으로 합쳤다.
              packaged Electron 한정 — 모바일 브라우저에선 window.api 자체가 없다. */}
          {isPackagedDesktop() && (
            <button
              type="button"
              onClick={() => { setOpen(false); setRemoteOpen(true); }}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <svg className="h-4 w-4 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h.01" />
                <path d="M8.5 16.4a5 5 0 0 1 7 0" />
                <path d="M5 12.9a10 10 0 0 1 14 0" />
                <path d="M1.5 9.4a15 15 0 0 1 21 0" />
              </svg>
              {t('panel.fileMenu.remoteAccess')}
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
      <PluginsWindow open={pluginsOpen} onClose={() => setPluginsOpen(false)} />
      <RemoteAccessWindow open={remoteOpen} onClose={() => setRemoteOpen(false)} />
    </div>
  );
}

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';

const API_BASE = '';

export function FileMenu(): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 → 닫기
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    // 캡처 단계: React Flow pane 이 mousedown 에 stopPropagation 을 걸어
    // 버블 단계에선 document 까지 안 올라온다(캔버스 클릭 시 메뉴가 안 닫히는 원인).
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [open]);

  // ESC → 닫기
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const handleOpenFolder = useCallback(async () => {
    setLoading(true);
    setOpen(false);
    try {
      const res = await fetch(`${API_BASE}/api/projects/open-folder`, { method: 'POST' });
      const data = await res.json() as { ok: boolean; cancelled?: boolean; project?: { name: string } };
      if (data.ok && data.project) {
        // 스냅샷 broadcast로 프로젝트 등록됨 → 해당 탭 활성화
        useGraphStore.getState().setActiveProject(data.project.name);
      }
    } catch {
      // 서버 연결 실패 시 무시
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
        </div>
      )}
    </div>
  );
}

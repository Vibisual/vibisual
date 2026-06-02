import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PipelineType } from '@vibisual/shared';
import { PIPELINE_TYPE_INFO } from '@vibisual/shared';

interface CanvasContextMenuProps {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  onCreateCustomAgent: (canvasX: number, canvasY: number) => void;
  /** §4 v2.63 — CMD(인터랙티브 터미널) 에이전트 생성 */
  onCreateCmdAgent: (canvasX: number, canvasY: number) => void;
  /** §5.3 #10-2 v2.37 — Auto Agent 메타 버블 생성 */
  onCreateAutoAgent: (canvasX: number, canvasY: number) => void;
  onCreatePipeline: (type: PipelineType, canvasX: number, canvasY: number) => void;
  onCreateWorktree: (canvasX: number, canvasY: number) => void;
  onClose: () => void;
}

const PIPELINE_TYPES: PipelineType[] = ['pipeline-subagent', 'pipeline-teams', 'pipeline-hybrid'];

export const CanvasContextMenu = memo(function CanvasContextMenu({
  x,
  y,
  canvasX,
  canvasY,
  onCreateCustomAgent,
  onCreateCmdAgent,
  onCreateAutoAgent,
  onCreatePipeline,
  onCreateWorktree,
  onClose,
}: CanvasContextMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [hoveredType, setHoveredType] = useState<PipelineType | null>(null);

  useEffect(() => {
    function handleDown(e: MouseEvent): void {
      // 좌클릭(0) / 중간 휠(1) 눌리는 순간 닫기 — 우클릭(2)은 메뉴 재오픈용으로 무시
      // capture 단계로 등록하여 React Flow가 이벤트를 선점하기 전에 처리 (버블 클릭·팬 드래그 시작 포함)
      if (e.button !== 0 && e.button !== 1) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleDown, true);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const handleCreateAgent = useCallback(() => {
    onCreateCustomAgent(canvasX, canvasY);
    onClose();
  }, [onCreateCustomAgent, onClose, canvasX, canvasY]);

  const handleCreateCmdAgent = useCallback(() => {
    onCreateCmdAgent(canvasX, canvasY);
    onClose();
  }, [onCreateCmdAgent, onClose, canvasX, canvasY]);

  const handleCreateAutoAgent = useCallback(() => {
    onCreateAutoAgent(canvasX, canvasY);
    onClose();
  }, [onCreateAutoAgent, onClose, canvasX, canvasY]);

  const handleCreateWorktree = useCallback(() => {
    onCreateWorktree(canvasX, canvasY);
    onClose();
  }, [onCreateWorktree, onClose, canvasX, canvasY]);

  const handleCreatePipeline = useCallback((type: PipelineType) => {
    onCreatePipeline(type, canvasX, canvasY);
    onClose();
  }, [onCreatePipeline, onClose, canvasX, canvasY]);

  const info = hoveredType ? PIPELINE_TYPE_INFO[hoveredType] : null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 메뉴 목록 */}
      <div className="min-w-48 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl shadow-black/40">
        {/* 단일 커스텀 에이전트 */}
        <button
          type="button"
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800 transition-colors"
          onClick={handleCreateAgent}
        >
          <svg className="h-4 w-4 shrink-0 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          <span>{t('canvas.contextMenu.createCustomAgent')}</span>
        </button>

        {/* §4 v2.63 — CMD 에이전트 (인터랙티브 임베디드 터미널, teal 톤). 우리는 시각화·보조만,
            실행/오케스트레이션 권한은 Claude Code 안에 있음(힌트로 명시). */}
        <button
          type="button"
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800 transition-colors"
          onClick={handleCreateCmdAgent}
        >
          <svg className="h-4 w-4 shrink-0 text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2.5" y="4" width="19" height="16" rx="2" />
            <path d="M6 9l3 3-3 3" />
            <line x1="12" y1="15" x2="16" y2="15" />
          </svg>
          <div className="flex flex-col">
            <span>{t('canvas.contextMenu.createCmdAgent')}</span>
            <span className="text-xs text-gray-500">{t('canvas.contextMenu.createCmdAgentHint')}</span>
          </div>
        </button>

        {/* §5.3 #10-2 v2.37 — Auto Agent (메타 에이전트, 다크 톤) */}
        <button
          type="button"
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800 transition-colors"
          onClick={handleCreateAutoAgent}
        >
          <svg className="h-4 w-4 shrink-0 text-blue-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M8 9.5a4 4 0 0 1 8 0" />
            <circle cx="12" cy="13.5" r="2.2" />
            <path d="M9.5 17.5h5" />
          </svg>
          <div className="flex flex-col">
            <span>{t('canvas.contextMenu.createAutoAgent')}</span>
            <span className="text-xs text-gray-500">{t('canvas.contextMenu.createAutoAgentHint')}</span>
          </div>
        </button>

        {/* Worktree 생성 — master 최신 기준 새 git worktree */}
        <button
          type="button"
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800 transition-colors"
          onClick={handleCreateWorktree}
        >
          <svg className="h-4 w-4 shrink-0 text-lime-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="18" cy="6" r="2.5" />
            <circle cx="12" cy="18" r="2.5" />
            <path d="M6 8.5v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-2" />
            <line x1="12" y1="13.5" x2="12" y2="15.5" />
          </svg>
          <div className="flex flex-col">
            <span>{t('canvas.contextMenu.createWorktree')}</span>
            <span className="text-xs text-gray-500">{t('canvas.contextMenu.createWorktreeHint')}</span>
          </div>
        </button>

        {/* 파이프라인 옵션 3개 — 나중에 다시 쓸 예정이라 주석으로 비활성화 (구분선·버튼·호버 툴팁 한 묶음) */}
        {/*
        <div className="mx-2 my-1 border-t border-gray-700" />
        {PIPELINE_TYPES.map((type) => {
          const typeInfo = PIPELINE_TYPE_INFO[type];
          return (
            <button
              key={type}
              type="button"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800 transition-colors"
              onClick={() => handleCreatePipeline(type)}
              onMouseEnter={() => setHoveredType(type)}
              onMouseLeave={() => setHoveredType(null)}
            >
              <svg className="h-4 w-4 shrink-0 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="7" cy="12" r="3" />
                <circle cx="17" cy="7" r="3" />
                <circle cx="17" cy="17" r="3" />
                <line x1="10" y1="11" x2="14" y2="8" />
                <line x1="10" y1="13" x2="14" y2="16" />
              </svg>
              <div className="flex flex-col">
                <span>{typeInfo.label}</span>
                <span className="text-xs text-gray-500">{typeInfo.description}</span>
              </div>
            </button>
          );
        })}
        */}
      </div>

      {/* 호버 툴팁 (장단점) — 파이프라인 메뉴와 함께 비활성화 */}
      {/*
      {info && (
        <div className="absolute right-full top-0 mr-1 w-[clamp(12rem,20vw,16rem)] rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-xl shadow-black/40">
          <div className="mb-2 text-xs font-semibold text-green-400">Pros</div>
          <ul className="mb-3 space-y-0.5">
            {info.pros.map((p, i) => (
              <li key={i} className="text-xs text-gray-300">+ {p}</li>
            ))}
          </ul>
          <div className="mb-2 text-xs font-semibold text-red-400">Cons</div>
          <ul className="space-y-0.5">
            {info.cons.map((c, i) => (
              <li key={i} className="text-xs text-gray-400">- {c}</li>
            ))}
          </ul>
        </div>
      )}
      */}
    </div>
  );
});

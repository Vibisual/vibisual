import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PipelineType } from '@vibisual/shared';
import { PIPELINE_TYPE_INFO } from '@vibisual/shared';
import { INTERNAL_APPS } from '../../apps/registry.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { POPUP_DISMISS } from '../../hooks/popupDismiss.js';
import { isMainCanvasView } from './canvasScope.js';
import {
  SUBMENU_CLOSED,
  hoverPlainItem,
  hoverSubmenu,
  isSubmenuOpen,
  leaveSubmenu,
  toggleSubmenuPin,
  type SubmenuKey,
  type SubmenuState,
} from './contextMenuSubmenu.js';
import { EngineIcon } from '../Engine/engineIcons.js';
import { useCanvasMenuPlacement } from './useCanvasMenuPlacement.js';

interface CanvasContextMenuProps {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  onCreateCustomAgent: (canvasX: number, canvasY: number) => void;
  /** §4 — CMD(인터랙티브 터미널) 에이전트 생성. */
  onCreateCmdAgent: (canvasX: number, canvasY: number) => void;
  /** §5.3 #10-2 — Auto Agent 메타 버블 생성. */
  onCreateAutoAgent: (canvasX: number, canvasY: number) => void;
  onCreatePipeline: (type: PipelineType, canvasX: number, canvasY: number) => void;
  onCreateWorktree: (canvasX: number, canvasY: number) => void;
  /** §5.9 — 화면/프로그램 캡처 버블 생성(소스 picker 를 연다). */
  onCreateCapture: (canvasX: number, canvasY: number) => void;
  /** §5.13 — 내부 앱 버블 생성. 어떤 앱인지는 레지스트리 id 로 받는다. */
  onCreateAppBubble: (appId: string, canvasX: number, canvasY: number) => void;
  /** §5.14 — 플레이 버블(이 프로젝트를 켜는 버튼) 생성. */
  onCreatePlay: (canvasX: number, canvasY: number) => void;
  /** §5.15 — 스펙 보드(요구사항 → 수용 기준 → 작업 카드) 생성. */
  onCreateSpec: (canvasX: number, canvasY: number) => void;
  /** §5.18 — 에이전트 랩(같은 과제를 설정만 바꿔 N벌) 생성. */
  onCreateLab: (canvasX: number, canvasY: number) => void;
  /** §5.20 — 스크립트 선반(자주 쓰는 명령·프롬프트 한 장) 생성. */
  onCreateShelf: (canvasX: number, canvasY: number) => void;
  onClose: () => void;
}

const PIPELINE_TYPES: PipelineType[] = ['pipeline-subagent', 'pipeline-teams', 'pipeline-hybrid'];

/** 메뉴 한 줄의 공통 모양. 옆으로 펼쳐지는 칸의 머리 줄과 평범한 항목이 같은 줄로 보여야 한다. */
const MENU_ROW_CLASS =
  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-800';
/**
 * 펼쳐진 칸의 머리 줄은 **손이 떠나도 배경을 유지**한다 — 고정(클릭)으로 열어 두면 호버 배경이
 * 사라져 "지금 열린 칸이 어느 줄의 것인지"를 화면이 말해 주지 않는다(§5.25 (B-1)).
 */
const MENU_ROW_OPEN_CLASS = `${MENU_ROW_CLASS} bg-gray-800`;

// Reserve the scrollbar before measuring so height limits cannot widen the popup afterward.
const SUBMENU_CLASS = 'fixed z-10 w-max overflow-y-auto overscroll-contain [scrollbar-gutter:stable] rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl shadow-black/40 [&_button>div]:min-w-0';
const SUBMENU_ARROW_PATH = {
  right: 'm9 18 6-6-6-6',
  left: 'm15 18-6-6 6-6',
  above: 'm6 15 6-6 6 6',
  below: 'm6 9 6 6 6-6',
};

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
  onCreateCapture,
  onCreateAppBubble,
  onCreatePlay,
  onCreateSpec,
  onCreateLab,
  onCreateShelf,
  onClose,
}: CanvasContextMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [hoveredType, setHoveredType] = useState<PipelineType | null>(null);
  /**
   * §5.25 (B)·(B-1) · §5.13 — 옆으로 펼쳐지는 칸(엔진·앱) 한 벌. 엔진 전용 항목은 엔진 칸 아래로 접는다.
   * 상태는 한 칸 — 열린 칸은 하나뿐이어야 한다(겹쳐 뜨면 어느 쪽인지 모른다). 전이(호버 열기 · 클릭 고정 · 다른 항목 호버로 풀기)는 `contextMenuSubmenu.ts`(단위 테스트).
   */
  const [submenu, setSubmenu] = useState<SubmenuState>(SUBMENU_CLOSED);
  const submenuSide = useCanvasMenuPlacement(x, y, submenu.open, menuRef, listRef, triggerRef, submenuRef);
  /** 칸 위로 마우스가 들어왔다 — 그 칸이 펼쳐지고, 다른 칸의 고정은 풀린다. */
  const enterSubmenu = useCallback((key: SubmenuKey) => setSubmenu((s) => hoverSubmenu(s, key)), []);
  /** 칸에서 마우스가 빠져나갔다 — 고정된 칸은 그대로 남는다. */
  const exitSubmenu = useCallback((key: SubmenuKey) => setSubmenu((s) => leaveSubmenu(s, key)), []);
  /** 칸의 머리 줄을 클릭했다 = 고정 토글(고정된 칸을 다시 누르면 닫힌다). */
  const pinSubmenu = useCallback((key: SubmenuKey) => setSubmenu((s) => toggleSubmenuPin(s, key)), []);
  /** 서브메뉴가 없는 항목 위로 마우스가 왔다 — 고정도 푼다(고정된 칸은 `mouseleave` 로 안 닫힌다). */
  const releaseSubmenu = useCallback(() => setSubmenu(hoverPlainItem), []);
  // §5.13 (N) — 설치도 여기서 한다(별도 창 ❌ — 이 메뉴와 캔버스 버블이 유일한 관리 지점이라 무엇이 깔렸는지 캔버스에서 보인다).
  const createLocalAgent = useGraphStore((st) => st.createLocalAgent);
  const createCodexAgent = useGraphStore((st) => st.createCodexAgent);
  const createCodexCmdAgent = useGraphStore((st) => st.createCodexCmdAgent);
  // 노출 게이트 — 아래 네 항목(플레이·스펙·랩·선반)은 디버그 모드에서만 낸다(§7.7).
  const debugMode = useGraphStore((st) => st.debugMode);
  /**
   * §5.7 #26 — 그릴 수 없는 자리에선 메뉴에도 안 낸다(캡처·플레이·스펙·랩·선반·앱은 메인 뷰 전용 — 폴더 안에서 만들면 부모 캔버스에 유령이 앉는다).
   * 판정은 `canvasScope` 한 곳(감추기와 막기가 같은 답).
   */
  const mainView = useGraphStore((st) => isMainCanvasView(st));

  // 바깥 press 로 닫기(메뉴 안에서 시작한 드래그 ❌). 좌클릭·휠만(우클릭은 재오픈용), capture 단계(React Flow 보다 먼저).
  // 터치 롱프레스로 열면 손 뗄 때 합성 mousedown 이 오므로 `touchOpenGraceMs` 동안 넘긴다(§4).
  useOutsidePressDismiss({
    onDismiss: onClose,
    refs: [menuRef],
    graceMs: POPUP_DISMISS.touchOpenGraceMs,
    shouldConsider: (e) => e.button === 0 || e.button === 1,
  });

  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
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

  const handleCreateCapture = useCallback(() => {
    onCreateCapture(canvasX, canvasY);
    onClose();
  }, [onCreateCapture, onClose, canvasX, canvasY]);

  // §5.19 (B) — All Model. **고르는 순간 버블이 생긴다** — 커스텀·CMD 와 같다.
  //   엔진·모델 준비는 그 버블을 눌렀을 때 판정한다(설치 창이 캔버스 앞을 막지 않는다).
  const handleCreateLocalAgent = useCallback(() => {
    createLocalAgent(canvasX, canvasY);
    onClose();
  }, [createLocalAgent, onClose, canvasX, canvasY]);

  // §5.25 (B) — 코덱스. All Model 과 같은 규약 — 누르면 버블이 먼저 생기고, 설치·로그인·모델은
  //   그 버블을 눌렀을 때 판정한다(준비 창이 캔버스 앞을 막지 않는다).
  const handleCreateCodexAgent = useCallback(() => {
    createCodexAgent(canvasX, canvasY);
    onClose();
  }, [createCodexAgent, onClose, canvasX, canvasY]);

  // §5.25 (B-1) — 코덱스 칸의 CMD. 클로드 칸의 CMD 와 같은 버블이고 셸이 채울 CLI 만 `codex` 다.
  const handleCreateCodexCmdAgent = useCallback(() => {
    createCodexCmdAgent(canvasX, canvasY);
    onClose();
  }, [createCodexCmdAgent, onClose, canvasX, canvasY]);

  const handleCreateApp = useCallback((appId: string) => {
    onCreateAppBubble(appId, canvasX, canvasY);
    onClose();
  }, [onCreateAppBubble, onClose, canvasX, canvasY]);

  const handleCreatePlay = useCallback(() => {
    onCreatePlay(canvasX, canvasY);
    onClose();
  }, [onCreatePlay, onClose, canvasX, canvasY]);

  const handleCreateSpec = useCallback(() => {
    onCreateSpec(canvasX, canvasY);
    onClose();
  }, [onCreateSpec, onClose, canvasX, canvasY]);

  const handleCreateLab = useCallback(() => {
    onCreateLab(canvasX, canvasY);
    onClose();
  }, [onCreateLab, onClose, canvasX, canvasY]);

  const handleCreateShelf = useCallback(() => {
    onCreateShelf(canvasX, canvasY);
    onClose();
  }, [onCreateShelf, onClose, canvasX, canvasY]);

  const handleCreatePipeline = useCallback((type: PipelineType) => {
    onCreatePipeline(type, canvasX, canvasY);
    onClose();
  }, [onCreatePipeline, onClose, canvasX, canvasY]);

  const info = hoveredType ? PIPELINE_TYPE_INFO[hoveredType] : null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-max [overflow-wrap:anywhere] [&_button>div]:min-w-0"
      style={{ left: x, top: y, maxWidth: 'calc(100vw - 16px)' }}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 메뉴 목록 */}
      <div ref={listRef} className="overflow-y-auto overscroll-contain rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl shadow-black/40" style={{ maxHeight: 'calc(100dvh - 16px)' }}>
        {/* §5.25 (B) — 클로드 칸: 클로드 에이전트 · 워크트리(둘 다 `claude` 실행본 전제). 호버로 펼치고 클릭하면 고정, 다른 항목에 올리면 풀린다((B-1)). */}
        <div
          className="relative"
          onMouseEnter={() => enterSubmenu('claude')}
          onMouseLeave={() => exitSubmenu('claude')}
        >
          <button
            type="button"
            ref={isSubmenuOpen(submenu, 'claude') ? triggerRef : undefined}
            className={isSubmenuOpen(submenu, 'claude') ? MENU_ROW_OPEN_CLASS : MENU_ROW_CLASS}
            onClick={() => pinSubmenu('claude')}
            aria-haspopup="menu"
            aria-expanded={isSubmenuOpen(submenu, 'claude')}
          >
            <span className="shrink-0 text-blue-400">
              <EngineIcon kind="claude" className="h-4 w-4" />
            </span>
            <div className="flex flex-1 flex-col">
              <span>{t('canvas.contextMenu.engineClaude', { defaultValue: 'Claude' })}</span>
              <span className="text-xs text-gray-500">
                {t('canvas.contextMenu.engineClaudeHint', { defaultValue: 'Claude Code 로 도는 버블' })}
              </span>
            </div>
            <svg className="h-3.5 w-3.5 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={SUBMENU_ARROW_PATH[isSubmenuOpen(submenu, 'claude') ? submenuSide : 'right']} />
            </svg>
          </button>

          {isSubmenuOpen(submenu, 'claude') && (
            <div ref={submenuRef} className={SUBMENU_CLASS}>
              {/* 클로드 에이전트 — 종전 "Custom Agent 만들기". 이름만 엔진 기준으로 고쳤고
                  만드는 경로(`onCreateCustomAgent`)는 그대로다. */}
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
                <div className="flex flex-col">
                  <span>{t('canvas.contextMenu.createClaudeAgent', { defaultValue: 'Claude Agent 만들기' })}</span>
                  <span className="text-xs text-gray-500">
                    {t('canvas.contextMenu.createClaudeAgentHint', { defaultValue: 'Claude Code 로 도는 에이전트를 놓습니다' })}
                  </span>
                </div>
              </button>

              {/* Worktree 생성 — master 최신 기준 새 git worktree. 그 안에서 도는 것이 클로드
                  세션이라 이 칸에 든다. */}
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

              {/* §5.25 (B-1) — CMD 에이전트(임베디드 터미널, teal). 엔진 칸 안에 둔다 — 이 칸의 CMD 는 `claude` 를, 코덱스 칸의 CMD 는 같은 버블에 `codex` 를 채운다. */}
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
            </div>
          )}
        </div>

        {/* §5.25 (B) — **코덱스 칸.** 클로드 칸과 같은 규약 — 헤드리스 에이전트와 CMD 가 함께 든다.
            엔진 축이 늘 때 이 자리가 그대로 받는다(최상위에 항목을 다시 쌓지 않는다). */}
        <div
          className="relative"
          onMouseEnter={() => enterSubmenu('codex')}
          onMouseLeave={() => exitSubmenu('codex')}
        >
          <button
            type="button"
            ref={isSubmenuOpen(submenu, 'codex') ? triggerRef : undefined}
            className={isSubmenuOpen(submenu, 'codex') ? MENU_ROW_OPEN_CLASS : MENU_ROW_CLASS}
            onClick={() => pinSubmenu('codex')}
            aria-haspopup="menu"
            aria-expanded={isSubmenuOpen(submenu, 'codex')}
          >
            <span className="shrink-0 text-emerald-400">
              <EngineIcon kind="codex" className="h-4 w-4" />
            </span>
            <div className="flex flex-1 flex-col">
              <span>{t('canvas.contextMenu.engineCodex', { defaultValue: 'Codex' })}</span>
              <span className="text-xs text-gray-500">
                {t('canvas.contextMenu.engineCodexHint', { defaultValue: 'OpenAI Codex CLI 로 도는 버블' })}
              </span>
            </div>
            <svg className="h-3.5 w-3.5 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={SUBMENU_ARROW_PATH[isSubmenuOpen(submenu, 'codex') ? submenuSide : 'right']} />
            </svg>
          </button>

          {isSubmenuOpen(submenu, 'codex') && (
            <div ref={submenuRef} className={SUBMENU_CLASS}>
              {/* §5.25 (B) — 코덱스 에이전트. 누르면 버블이 먼저 생기고, 설치·로그인·모델은
                  그 버블을 눌렀을 때 판정한다(준비 창이 캔버스 앞을 막지 않는다). */}
              <button
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800 transition-colors"
                onClick={handleCreateCodexAgent}
              >
                <EngineIcon kind="codex" className="h-4 w-4 shrink-0 text-emerald-400" />
                <div className="flex flex-col">
                  <span>{t('canvas.contextMenu.createCodexAgent', { defaultValue: 'Codex Agent 만들기' })}</span>
                  <span className="text-xs text-gray-500">
                    {t('canvas.contextMenu.createCodexAgentHint', { defaultValue: 'OpenAI Codex CLI 로 도는 에이전트를 놓습니다' })}
                  </span>
                </div>
              </button>

              {/* §5.25 (B-1) — 코덱스 CMD. 클로드 칸의 CMD 와 같은 버블·같은 teal 톤이고,
                  임베디드 터미널이 `claude` 대신 `codex` 를 채운다(`cliKind:'codex'`). */}
              <button
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800 transition-colors"
                onClick={handleCreateCodexCmdAgent}
              >
                <svg className="h-4 w-4 shrink-0 text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2.5" y="4" width="19" height="16" rx="2" />
                  <path d="M6 9l3 3-3 3" />
                  <line x1="12" y1="15" x2="16" y2="15" />
                </svg>
                <div className="flex flex-col">
                  <span>{t('canvas.contextMenu.createCodexCmdAgent', { defaultValue: 'Codex CMD 만들기' })}</span>
                  <span className="text-xs text-gray-500">
                    {t('canvas.contextMenu.createCodexCmdAgentHint', { defaultValue: 'Codex CLI 를 직접 모는 인터랙티브 터미널' })}
                  </span>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* §5.19 (B) — All Model(로컬 LLM). 누르면 버블이 바로 생긴다(엔진·모델이 없으면 그 버블을 누를 때 설치 창). 항목이 하나뿐이라 엔진 칸으로 접지 않는다. */}
        <button
          type="button"
          className={MENU_ROW_CLASS}
          onClick={handleCreateLocalAgent}
          onMouseEnter={releaseSubmenu}
        >
          <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8" />
            <path d="M12 16v4" />
            <path d="M7.5 10h3l1.5-2.5L13.5 13l1-3h2" />
          </svg>
          <div className="flex flex-col">
            <span>{t('canvas.contextMenu.createLocalAgent', { defaultValue: 'All Model' })}</span>
            <span className="text-xs text-gray-500">
              {t('canvas.contextMenu.createLocalAgentHint', { defaultValue: '내 PC 에서 도는 모델을 골라 씁니다' })}
            </span>
          </div>
        </button>

        {/* §5.3 #10-2 — Auto Agent 는 당분간 메뉴에서 내린다(서버·스토어·놓인 버블은 그대로라 이 게이트만 되돌리면 된다). 디버그 모드(§7.7)에선 보인다. */}
        {debugMode && (
        <button
          type="button"
          className={MENU_ROW_CLASS}
          onClick={handleCreateAutoAgent}
          onMouseEnter={releaseSubmenu}
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
        )}

        {/* §5.9 — 화면/프로그램 캡처 버블 (라이브 스트림, rose 톤). 메인 뷰 전용(§5.7 #26). */}
        {mainView && (
        <button
          type="button"
          className={MENU_ROW_CLASS}
          onClick={handleCreateCapture}
          onMouseEnter={releaseSubmenu}
        >
          <svg className="h-4 w-4 shrink-0 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
          </svg>
          <div className="flex flex-col">
            <span>{t('canvas.contextMenu.createCapture', { defaultValue: '화면·프로그램 캡처 버블' })}</span>
            <span className="text-xs text-gray-500">{t('canvas.contextMenu.createCaptureHint', { defaultValue: '화면이나 프로그램 창을 라이브로 버블에 띄우기' })}</span>
          </div>
        </button>
        )}

        {/* 노출 게이트 — 아래 넷(플레이 버블·스펙 보드·에이전트 랩·스크립트 선반)은 §7.7 디버그
            모드를 켰을 때만 나온다. 일반 사용에서는 우클릭해도 보이지 않고, 이미 놓인 버블도
            캔버스에서 함께 숨는다 — 레코드·서버·영속은 그대로라 다시 켜면 있던 자리로 돌아온다. */}
        {debugMode && mainView && (
          <>
          {/* §5.14 — 플레이 버블(이 프로젝트를 켜는 버튼, emerald 톤). */}
          <button
            type="button"
            className={MENU_ROW_CLASS}
            onClick={handleCreatePlay}
            onMouseEnter={releaseSubmenu}
          >
            <svg className="h-4 w-4 shrink-0 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M10 8.5v7l6-3.5-6-3.5z" />
            </svg>
            <div className="flex flex-col">
              <span>{t('canvas.contextMenu.createPlay', { defaultValue: '플레이 버블' })}</span>
              <span className="text-xs text-gray-500">{t('canvas.contextMenu.createPlayHint', { defaultValue: '이 프로젝트를 켜고 끄고 바로 미리보기' })}</span>
            </div>
          </button>

          {/* §5.15 — 스펙 보드 (요구사항 → 수용 기준 → 작업 카드, teal 톤). */}
          <button
            type="button"
            className={MENU_ROW_CLASS}
            onClick={handleCreateSpec}
            onMouseEnter={releaseSubmenu}
          >
            <svg className="h-4 w-4 shrink-0 text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="m8.5 13.5 1.5 1.5 3-3" />
              <path d="M8.5 18h7" />
            </svg>
            <div className="flex flex-col">
              <span>{t('canvas.contextMenu.createSpec', { defaultValue: '스펙 보드' })}</span>
              <span className="text-xs text-gray-500">{t('canvas.contextMenu.createSpecHint', { defaultValue: '요구사항을 적고 수용 기준마다 작업 카드 만들기' })}</span>
            </div>
          </button>

          {/* §5.18 — 에이전트 랩 (같은 과제를 설정만 바꿔 N벌 → 비교 표 → 승격, orange 톤). */}
          <button
            type="button"
            className={MENU_ROW_CLASS}
            onClick={handleCreateLab}
            onMouseEnter={releaseSubmenu}
          >
            <svg className="h-4 w-4 shrink-0 text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 2v6.5L4.8 17.4A2 2 0 0 0 6.5 20.5h11a2 2 0 0 0 1.7-3.1L14 8.5V2" />
              <path d="M9 2h6" />
              <path d="M7.5 14h9" />
            </svg>
            <div className="flex flex-col">
              <span>{t('canvas.contextMenu.createLab', { defaultValue: '에이전트 랩' })}</span>
              <span className="text-xs text-gray-500">{t('canvas.contextMenu.createLabHint', { defaultValue: '같은 과제를 설정만 바꿔 여러 벌 돌리고 표로 비교하기' })}</span>
            </div>
          </button>

          {/* §5.20 — 스크립트 선반 (자주 쓰는 명령·프롬프트를 캔버스에 고정, cyan 톤). */}
          <button
            type="button"
            className={MENU_ROW_CLASS}
            onClick={handleCreateShelf}
            onMouseEnter={releaseSubmenu}
          >
            <svg className="h-4 w-4 shrink-0 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4h18M3 12h18M3 20h18" />
              <path d="M6 4v8M18 12v8" />
            </svg>
            <div className="flex flex-col">
              <span>{t('canvas.contextMenu.createShelf', { defaultValue: '스크립트 선반' })}</span>
              <span className="text-xs text-gray-500">{t('canvas.contextMenu.createShelfHint', { defaultValue: '자주 쓰는 명령·프롬프트를 올려 두고 클릭 한 번으로 실행하기' })}</span>
            </div>
          </button>

          </>
        )}

        {/* §5.13 — 앱 카테고리(호버로 등록 앱이 펼쳐진다 — 앱이 늘어도 한 칸). §5.7 #26 — 메인 뷰에서만 그려지므로 폴더·워크트리 안에선 내지 않는다. */}
        {mainView && (
        <>
        <div className="mx-2 my-1 border-t border-gray-700" />
        <div
          className="relative"
          onMouseEnter={() => enterSubmenu('apps')}
          onMouseLeave={() => exitSubmenu('apps')}
        >
          <button
            type="button"
            ref={isSubmenuOpen(submenu, 'apps') ? triggerRef : undefined}
            className={isSubmenuOpen(submenu, 'apps') ? MENU_ROW_OPEN_CLASS : MENU_ROW_CLASS}
            onClick={() => pinSubmenu('apps')}
            aria-haspopup="menu"
            aria-expanded={isSubmenuOpen(submenu, 'apps')}
          >
            {/* 앱 카테고리는 중립 톤 — 색은 각 앱 행이 자기 것으로 낸다. */}
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            <div className="flex flex-1 flex-col">
              <span>{t('canvas.contextMenu.apps', { defaultValue: '앱' })}</span>
              <span className="text-xs text-gray-500">{t('canvas.contextMenu.appsHint', { defaultValue: '앱 버블을 놓고 더블클릭해 엽니다' })}</span>
            </div>
            <svg className="h-3.5 w-3.5 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={SUBMENU_ARROW_PATH[isSubmenuOpen(submenu, 'apps') ? submenuSide : 'right']} />
            </svg>
          </button>

          {isSubmenuOpen(submenu, 'apps') && (
            <div ref={submenuRef} className={SUBMENU_CLASS}>
              {INTERNAL_APPS.map((app) => {
                const Icon = app.icon;
                return (
                  <div key={app.id} className="flex items-center gap-1 pr-1.5">
                    {/* 행을 누르면 캔버스에 버블로 놓인다. 그 버블을 더블클릭하면 앱 창이 뜬다
                        (§5.13 (H) 개정 — 설치라는 단계는 없다). */}
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-800"
                      onClick={() => handleCreateApp(app.id)}
                    >
                      <span style={{ color: app.color }}>
                        <Icon />
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{t(app.nameKey, { defaultValue: app.name })}</span>
                        <span className="truncate text-xs text-gray-500">
                          {t(app.descKey, { defaultValue: '' })}
                        </span>
                      </div>
                    </button>
                  </div>
                );
              })}
              <div className="mx-2 my-1 border-t border-gray-700" />
              <p className="px-3 py-1 text-[12px] leading-relaxed text-gray-500">
                {t('canvas.contextMenu.appsHelp', {
                  defaultValue: '행을 누르면 캔버스에 버블로 놓입니다. 버블을 더블클릭하면 열리고, 우클릭하면 관리합니다.',
                })}
              </p>
            </div>
          )}
        </div>
        </>
        )}

        {/* §5.10 — 프로젝트 메모리 켜기/끄기 줄은 두지 않는다. 자동 목표 켜기/끄기는 IDE `목표` 뷰 하나뿐(캔버스에 한 벌 더 두면 두 곳이 답한다 — #17-44 ⑧(d)). */}

        {/* §5.10 — "지난 커스텀 에이전트 복구" 메뉴 제거됨(휴지통 버블이 그 경로의 후신). */}

        {/* 파이프라인 옵션 3개(구분선·버튼)는 꺼 두었다 — 되살릴 땐 `git log -S "PIPELINE_TYPES.map"` 으로 이 자리의 JSX 를 찾는다. */}
      </div>

      {/* 장단점 호버 툴팁도 파이프라인 메뉴와 함께 꺼 두었다(`git log -S "info.pros.map"`). */}
    </div>
  );
});

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import { IDEActivityBar } from './IDEActivityBar.js';
import { IDETabBar } from './IDETabBar.js';
import { IDESidebar } from './IDESidebar.js';
import { IDEMainArea } from './IDEMainArea.js';
import { IDEStatusBar } from './IDEStatusBar.js';

const EMPTY_SUBS: SubAgent[] = [];

type OverlayMode = 'modal' | 'floating' | 'docked-right';
const HEADER_H = 36; // §3.7 v2.13 통합 타이틀바 h-9
const DOCK_SNAP_RATIO = 0.12; // 도킹 인식 임계치 — 화면 폭의 12% (v2.20 또 2배 확대)
const DOCK_SNAP_MIN_PX = 120; // 작은 창에서도 최소 120px 보장
function getDockSnapPx(): number {
  return Math.max(DOCK_SNAP_MIN_PX, Math.round(window.innerWidth * DOCK_SNAP_RATIO));
}
const DRAG_THRESHOLD = 6;
const MIN_DOCK_WIDTH = 320;
const DEFAULT_DOCK_WIDTH = 480;
const MIN_FLOAT_W = 480;
const MIN_FLOAT_H = 320;

export const AgentIDEOverlay = memo(function AgentIDEOverlay(): React.JSX.Element | null {
  const { t } = useTranslation();
  const agentId = useGraphStore((s) => selectIDEOverlay(s).agentId);
  const overlayProjectId = useGraphStore((s) => selectIDEOverlay(s).projectId);
  const activeSessionId = useGraphStore((s) => selectIDEOverlay(s).activeSessionId);
  const closeOverlay = useGraphStore((s) => s.closeIDEOverlay);
  const setSession = useGraphStore((s) => s.setIDEActiveSession);
  const setIDEDocked = useGraphStore((s) => s.setIDEDocked);
  const storeDockedRight = useGraphStore((s) => selectIDEOverlay(s).dockedRight);
  const storeDockWidth = useGraphStore((s) => selectIDEOverlay(s).dockWidth);
  const agent = useGraphStore((s) => agentId ? s.nodeMap[agentId] : undefined);
  // 낙관적 인텐트(닫기/복원)를 권위 스냅샷 위에 덮어 IDE 탭 즉시성 보장. 스냅샷이 반영하면 아래 useEffect 가 정리.
  const rawSubAgents = useGraphStore((s) => (agentId ? s.subAgents[agentId] : undefined) ?? EMPTY_SUBS);
  const pendingSubRemovals = useGraphStore((s) => s.pendingSubAgentRemovals);
  const pendingSubRestores = useGraphStore((s) => s.pendingSubAgentRestores);
  const subAgents = useMemo(() => {
    if (!agentId) return EMPTY_SUBS;
    let list = rawSubAgents;
    if (list.some((sa) => pendingSubRemovals[sa.id] === agentId)) {
      list = list.filter((sa) => pendingSubRemovals[sa.id] !== agentId);
    }
    const adds = Object.values(pendingSubRestores).filter(
      (stub) => stub.parentAgentId === agentId && !list.some((sa) => sa.id === stub.id),
    );
    return adds.length > 0 ? [...list, ...adds] : list;
  }, [agentId, rawSubAgents, pendingSubRemovals, pendingSubRestores]);
  // 권위 스냅샷이 인텐트를 반영했으면 정리(제거: 목록에서 사라짐 / 복원: 목록에 등장).
  useEffect(() => {
    if (!agentId) return;
    const clear = useGraphStore.getState().clearPendingSubAgentIntent;
    for (const [subId, aid] of Object.entries(pendingSubRemovals)) {
      if (aid === agentId && !rawSubAgents.some((sa) => sa.id === subId)) clear(subId);
    }
    for (const [subId, stub] of Object.entries(pendingSubRestores)) {
      if (stub.parentAgentId === agentId && rawSubAgents.some((sa) => sa.id === subId)) clear(subId);
    }
  }, [agentId, rawSubAgents, pendingSubRemovals, pendingSubRestores]);

  const isCustom = agent?.customCreated ?? false;
  // §4 v2.63 — CMD(인터랙티브 터미널) 에이전트: 라벨/자동 세션 분기. customCreated 기반이라 isCustom 도 true.
  const executionMode = useGraphStore((s) => (agentId ? s.agentConfigs[agentId]?.executionMode : undefined));
  const isCmdAgent = isCustom && executionMode === 'interactive-terminal';

  const [maximized, setMaximized] = useState(false);
  const toggleMaximized = useCallback(() => setMaximized((v) => !v), []);

  // 타이틀바 더블클릭 — 최대화 버튼과 동일 효과 (버튼 자손에서 시작된 더블클릭은 제외)
  const handleTitleBarDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    toggleMaximized();
  }, [toggleMaximized]);

  // §5.5 #17-1 윈도우 모드 — 닫고 다시 열 때 modal 리셋 (휘발)
  const [mode, setMode] = useState<OverlayMode>('modal');
  const [floatPos, setFloatPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [floatSize, setFloatSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [dockWidth, setDockWidth] = useState<number>(DEFAULT_DOCK_WIDTH);
  const [snapPreview, setSnapPreview] = useState<boolean>(false);
  const [flashKey, setFlashKey] = useState<number>(0);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const prevRef = useRef<{ agentId: string | null; projectId: string | null }>({ agentId: null, projectId: null });
  // modal 백드롭(여백) 클릭으로 닫기 — 단, "누르기 시작한 지점"이 백드롭일 때만.
  // IDE 윈도우 안에서 시작한 드래그(텍스트 선택 등)가 백드롭에서 끝나면 click 의 공통 조상이
  // 백드롭이 되어 닫혀버리던 버그 차단. mousedown 타깃을 기록해 그때만 닫는다.
  const pressOnBackdropRef = useRef(false);

  // §5.5 #17-1 (v2.17) — agentId/projectId 전이 처리:
  //   (a) null → truthy : 새로 열림 — store.dockedRight 가 true 면 docked-right 복원, 아니면 modal
  //   (b) 프로젝트 전환 (overlayProjectId 변경) : 새 프로젝트 슬롯의 dockedRight 기준으로 mode 재초기화. flash 없음.
  //   (c) 같은 프로젝트에서 agentId 만 교체 : 모드 유지 + flash
  //   (d) truthy → null : 닫힘 — 로컬 mode 도 'modal' 리셋
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { agentId: agentId ?? null, projectId: overlayProjectId };
    const projectChanged = prev.projectId !== overlayProjectId;
    if (agentId && (!prev.agentId || projectChanged)) {
      // 새 열림 또는 프로젝트 전환 — 해당 프로젝트의 dockedRight 기준으로 mode 결정
      if (storeDockedRight) {
        setMode('docked-right');
        setDockWidth(storeDockWidth);
      } else {
        setMode('modal');
      }
      setMaximized(false);
    } else if (agentId && prev.agentId && prev.agentId !== agentId && !projectChanged) {
      setFlashKey((k) => k + 1);
    } else if (!agentId && prev.agentId) {
      // 닫힘 — 로컬 상태 리셋
      setMode('modal');
      setMaximized(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, overlayProjectId]);

  // §5.5 #17-1 (v2.18) — mode/dockWidth 를 store 에 sync. DetailPanel 이 좌/우 위치 판단에 사용.
  // (v2.20) 닫힌 상태(agentId null) 에서는 sync 금지 — closeIDEOverlay 가 이미 dockedRight=false 로 리셋했는데
  //         로컬 mode 가 stale 'docked-right' 라 다시 켜버리는 회귀 차단. 다음 open 에서 (a) 분기가 mode 를 재설정.
  useEffect(() => {
    if (!agentId) return;
    const dockedNow = mode === 'docked-right';
    if (dockedNow !== storeDockedRight || (dockedNow && dockWidth !== storeDockWidth)) {
      setIDEDocked(dockedNow, dockedNow ? dockWidth : undefined);
    }
  }, [agentId, mode, dockWidth, storeDockedRight, storeDockWidth, setIDEDocked]);

  // Escape to close
  useEffect(() => {
    if (!agentId) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') closeOverlay();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [agentId, closeOverlay]);

  // 타이틀바 mousedown — 드래그 시작 / 임계치 초과 시 modal→floating 전이 + floating/docked 이동
  const handleTitleBarMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // 버튼·인터랙티브 자손에서 시작된 mousedown 은 드래그 ❌
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    if (e.button !== 0) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const win = windowRef.current;
    if (!win) return;
    const rect = win.getBoundingClientRect();
    // 클릭 지점이 윈도우 좌상단에서 얼마나 떨어졌는지 — 분리 후에도 그 비율을 유지
    const grabRatioX = (startX - rect.left) / rect.width;
    const grabRatioY = (startY - rect.top) / rect.height;

    let dragging = false;
    let currentMode = mode;
    let currentMaximized = maximized;
    let nextW = rect.width;
    let nextH = rect.height;

    function handleMove(ev: MouseEvent): void {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        dragging = true;
        if (currentMaximized) {
          // 최대화 상태에서 끌면 자동 복원 → floating 으로 전이 후 이동 (Windows 스냅 해제와 동일)
          const w = floatSize.w > 0 ? floatSize.w : Math.max(MIN_FLOAT_W, Math.round(window.innerWidth * 0.56));
          const h = floatSize.h > 0 ? floatSize.h : Math.max(MIN_FLOAT_H, Math.round(window.innerHeight * 0.56));
          nextW = w;
          nextH = h;
          setFloatSize({ w, h });
          setMaximized(false);
          setMode('floating');
          currentMode = 'floating';
          currentMaximized = false;
        } else if (currentMode === 'modal') {
          nextW = Math.max(MIN_FLOAT_W, Math.round(window.innerWidth * 0.56)); // 56vw (80vw * 0.7)
          nextH = Math.max(MIN_FLOAT_H, Math.round(window.innerHeight * 0.56));
          setFloatSize({ w: nextW, h: nextH });
          setMode('floating');
          currentMode = 'floating';
        } else if (currentMode === 'docked-right') {
          // 도킹 → 플로팅. 마지막 floatSize 가 없으면 56vw×56vh 기본
          const w = floatSize.w > 0 ? floatSize.w : Math.max(MIN_FLOAT_W, Math.round(window.innerWidth * 0.56));
          const h = floatSize.h > 0 ? floatSize.h : Math.max(MIN_FLOAT_H, Math.round(window.innerHeight * 0.56));
          nextW = w;
          nextH = h;
          setFloatSize({ w, h });
          setMode('floating');
          currentMode = 'floating';
        }
      }
      // 클릭 비율을 유지하며 좌상단 좌표 계산
      const x = ev.clientX - grabRatioX * nextW;
      const y = ev.clientY - grabRatioY * nextH;
      const clampedX = Math.min(Math.max(x, -nextW + 80), window.innerWidth - 80);
      const clampedY = Math.min(Math.max(y, HEADER_H), window.innerHeight - 40);
      setFloatPos({ x: clampedX, y: clampedY });
      // 도킹 미리보기 — 마우스가 우측 가장자리 임계치 안에 있으면 표시
      setSnapPreview(ev.clientX >= window.innerWidth - getDockSnapPx());
    }

    function handleUp(ev: MouseEvent): void {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      setSnapPreview(false);
      if (!dragging) return;
      // 우측 가장자리 임계치 안에서 놓으면 도킹
      if (ev.clientX >= window.innerWidth - getDockSnapPx()) {
        setMode('docked-right');
      }
    }

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [mode, maximized, floatSize.w, floatSize.h]);

  // 도킹 좌측 리사이즈 핸들
  const handleDockResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = dockWidth;
    const maxW = window.innerWidth - 120;

    function handleMove(ev: MouseEvent): void {
      const dx = startX - ev.clientX; // 좌로 끌면 +
      const next = Math.min(Math.max(startWidth + dx, MIN_DOCK_WIDTH), maxW);
      setDockWidth(next);
    }
    function handleUp(): void {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [dockWidth]);

  // Custom 에이전트: 열릴 때 첫 번째 Sub 세션 자동 선택
  useEffect(() => {
    if (!isCustom || !agentId || activeSessionId !== null) return;
    const first = subAgents[0];
    if (first) setSession(first.id);
  }, [isCustom, agentId, activeSessionId, subAgents, setSession]);

  // IDE 열릴 때 서버에서 버퍼된 스트림 이벤트 로드
  useEffect(() => {
    if (!agentId) return;
    fetch(`/api/subagent-streams/${agentId}`)
      .then((r) => r.json())
      .then((data: { streams?: Record<string, SubAgentStreamEvent[]> }) => {
        if (data.streams) useGraphStore.getState().loadStreamBuffers(data.streams);
      })
      .catch(() => {});
  }, [agentId]);

  // + 탭 클릭 — 브라우저 새 탭 처럼 클릭 즉시 새 탭 생성 + 포커스 (서버 응답 대기 X).
  //   1) 클라이언트가 sub id 미리 생성
  //   2) **복원 인텐트(optimisticRestoreSubAgent)로 등록** — setSession(id) 와 함께. 단순 raw push 로
  //      subAgents 에 직접 넣으면, 등록 POST 왕복 중 도착한 full-snapshot 이 subAgents 를 통째로
  //      덮어써 낙관적 탭이 사라진다(= "+ 눌러도 안 뜨고, 다시 누르면 2개가 동시에" 버그). 닫기/복원과
  //      동일하게 pending 인텐트에 올려두면, loadSnapshot 이 그 sub 를 반영할 때까지 useMemo 가 다시
  //      얹어주고, 반영되면 정리 effect 가 인텐트를 비운다.
  //   3) 같은 id 를 body 로 POST → 서버가 그 id 로 등록 (snapshot 이 도착해도 같은 sub 라 no-op)
  const handleNewSession = useCallback(() => {
    if (!agentId) return;
    const id = `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticSub: SubAgent = {
      id,
      sessionId: '',
      label: '...',
      parentAgentId: agentId,
      status: 'idle',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    useGraphStore.getState().optimisticRestoreSubAgent(agentId, optimisticSub);
    setSession(id);
    fetch(`/api/subagents/${agentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subAgentId: id }),
    }).catch(() => {});
  }, [agentId, setSession]);

  // §4 v2.63 — 커스텀 에이전트(CMD 포함)는 항상 ≥1 세션 탭. IDE 가 열렸는데 세션이 0개면 자동으로
  //   하나 연다 ("+"=새 세션 모델과 동일 경로). 새 커스텀 에이전트를 더블클릭해 IDE 를 처음 열면
  //   세션이 0개라 빈 화면이던 버그(처음부터 세션 1개가 있어야 함) + 마지막 탭을 닫아도 새로 하나
  //   생겨 빈 커스텀/cmd 에이전트가 되는 것을 함께 방지. CMD 든 일반 커스텀이든 interactive 라
  //   세션이 0개면 할 수 있는 게 없으므로 동일 정책.
  useEffect(() => {
    if (!isCustom || !agentId) return;
    if (subAgents.length === 0 && activeSessionId === null) handleNewSession();
  }, [isCustom, agentId, subAgents.length, activeSessionId, handleNewSession]);

  // Active session SubAgent data
  const activeSession = useMemo(() => {
    if (!activeSessionId) return null;
    return subAgents.find((s) => s.id === activeSessionId) ?? null;
  }, [activeSessionId, subAgents]);

  if (!agentId || !agent) return null;

  // §5.5 #17-1 윈도우 모드 — mode 에 따라 컨테이너/윈도우 스타일 분기
  const isModal = mode === 'modal';
  const isFloating = mode === 'floating';
  const isDocked = mode === 'docked-right';

  let windowClass = 'flex flex-col overflow-hidden border-gray-700 bg-gray-900 shadow-2xl shadow-black/60';
  let windowStyle: React.CSSProperties = {};
  if (maximized) {
    // 모드와 무관 — 풀스크린 (Header h-9 = 36px 아래)
    windowClass += ' fixed left-0 right-0 top-9 bottom-0';
  } else if (isModal) {
    windowClass += ' h-[80vh] w-[80vw] rounded-lg border';
  } else if (isFloating) {
    windowClass += ' fixed rounded-lg border';
    windowStyle = {
      left: floatPos.x,
      top: floatPos.y,
      width: floatSize.w,
      height: floatSize.h,
    };
  } else if (isDocked) {
    windowClass += ' fixed border-l';
    windowStyle = {
      right: 0,
      top: HEADER_H,
      bottom: 0,
      width: dockWidth,
    };
  }

  const outerClass = isModal
    ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm'
    : 'fixed inset-0 z-50 pointer-events-none';

  return (
    <div
      className={outerClass}
      onMouseDown={isModal ? (e) => { pressOnBackdropRef.current = e.target === e.currentTarget; } : undefined}
      onClick={isModal ? (e) => { if (e.target === e.currentTarget && pressOnBackdropRef.current) closeOverlay(); } : undefined}
    >
      {/* §5.5 #17-1 — 드래그 중 우측 도킹 미리보기 (Windows Snap Assist 풍).
          파란 반투명 영역이 도킹될 자리를 미리 보여준다. pointer-events 없음. */}
      {snapPreview && (
        <div
          className="fixed border-2 border-blue-400/70 bg-blue-400/15 rounded-l-lg transition-opacity duration-100"
          style={{
            right: 0,
            top: HEADER_H,
            bottom: 0,
            width: dockWidth,
            pointerEvents: 'none',
            zIndex: 49,
          }}
          aria-hidden="true"
        />
      )}
      {/* IDE Window — modal / floating / docked-right 3-state (§5.5 #17-1).
          §3.7 v2.14 — maximized 시 Header(h-9=36px) 아래에서 시작. 그래야 maximized 의
          자체 타이틀바(restore/close 버튼)가 통합 타이틀바·Windows 네이티브 컨트롤에 가리지 않음. */}
      <div
        ref={windowRef}
        data-ide-overlay=""
        className={windowClass}
        style={{ ...windowStyle, pointerEvents: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* §5.5 #17-1 (v2.21) 에이전트 전환 sheen — iOS 풍 유리 표면 라이트 패스.
            wrapper 는 overflow-hidden 으로 윈도우 경계 밖 그라데이션 띠를 잘라낸다.
            안쪽 띠가 좌 → 우로 비스듬히 한 번 통과한 뒤 onAnimationEnd 로 언마운트. */}
        {flashKey > 0 && (
          <div
            className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
            aria-hidden="true"
          >
            <div
              key={flashKey}
              onAnimationEnd={() => setFlashKey(0)}
              className="absolute inset-y-0 -left-full w-[150%] animate-ide-switch-sheen"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 30%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.06) 70%, transparent 100%)',
              }}
            />
          </div>
        )}
        {/* 도킹 시 좌측 리사이즈 핸들 (4px) */}
        {isDocked && (
          <div
            onMouseDown={handleDockResize}
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400/60"
            style={{ zIndex: 10 }}
            aria-label={t('ide.overlay.resizeDock')}
            role="separator"
          />
        )}
        {/* Title bar — §3.7 v2.14 명도 ramp 중간 톤 (v2.15: 상단 액센트 라인 제거 — 사용자 요청).
            §5.5 #17-1 — 타이틀바 드래그로 modal↔floating↔docked 전이. */}
        <div
          onMouseDown={handleTitleBarMouseDown}
          onDoubleClick={handleTitleBarDoubleClick}
          className="flex h-10 flex-shrink-0 items-center justify-between border-b border-gray-700 bg-[#1a2236] px-4 select-none cursor-grab active:cursor-grabbing"
        >
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 2v4m0 12v4M2 12h4m12 0h4" />
            </svg>
            <span className="text-sm font-semibold text-gray-200">{agent.label}</span>
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
              isCmdAgent ? 'bg-teal-500/15 text-teal-300' : isCustom ? 'bg-blue-500/15 text-blue-400' : 'bg-gray-600/30 text-gray-500'
            }`}>
              {isCmdAgent ? t('ide.overlay.cmdLabel') : isCustom ? t('ide.overlay.customLabel') : t('ide.overlay.hookLabel')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleMaximized}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
              aria-label={maximized ? t('ide.overlay.restoreLabel') : t('ide.overlay.maximizeLabel')}
              title={maximized ? t('ide.overlay.restoreLabel') : t('ide.overlay.maximizeLabel')}
            >
              {maximized ? (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                  <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                  <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                  <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                  <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                  <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                  <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={closeOverlay}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
              aria-label={t('ide.overlay.closeLabel')}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <IDETabBar
          subAgents={subAgents}
          isCustom={isCustom}
          onNewSession={handleNewSession}
        />

        {/* Body: Activity bar + Sidebar + Main area */}
        <div className="flex min-h-0 flex-1">
          <IDEActivityBar />
          <IDESidebar agentId={agentId} />
          <IDEMainArea agentId={agentId} isCustom={isCustom} />
        </div>

        {/* Status bar */}
        <IDEStatusBar
          agent={agent}
          activeSession={activeSession}
          isCustom={isCustom}
          sessionCount={subAgents.length}
        />
      </div>
    </div>
  );
});

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent, SubAgentHistoryItem } from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import { TabContextMenu } from '../Layout/TabContextMenu.js';

interface IDETabBarProps {
  subAgents: SubAgent[];
  isCustom: boolean;
  onNewSession: () => void;
}

const STATUS_DOT: Record<string, string> = {
  // idle = "완료, 미확인" → 녹색. 사용자가 확인(탭 클릭/메인영역 클릭/타이핑)하면 회색으로 전환.
  idle: 'bg-emerald-400',
  active: 'bg-blue-400 animate-pulse',
  completed: 'bg-gray-400',
  error: 'bg-red-400',
};
const ACK_DOT = 'bg-gray-500';

export const IDETabBar = memo(function IDETabBar({
  subAgents,
  isCustom,
  onNewSession,
}: IDETabBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const activeSessionId = useGraphStore((s) => selectIDEOverlay(s).activeSessionId);
  const agentId = useGraphStore((s) => selectIDEOverlay(s).agentId);
  const setSession = useGraphStore((s) => s.setIDEActiveSession);
  const tabPins = useGraphStore((s) => s.tabPins);
  const acknowledgedSubAgents = useGraphStore((s) => s.acknowledgedSubAgents);
  const defaultSubAgents = useGraphStore((s) => s.defaultSubAgents);
  const defaultSubId = agentId ? defaultSubAgents[agentId] ?? null : null;
  const subAgentLabels = useGraphStore((s) => s.subAgentLabels);
  const setSubAgentLabel = useGraphStore((s) => s.setSubAgentLabel);

  // 탭 이름 인라인 편집 — 편집 중인 탭 id와 입력값.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // 표시용 라벨 — 사용자 지정(subAgentLabels) 우선, 없으면 서버 기본 라벨.
  const displayLabel = useCallback(
    (sub: SubAgent): string => subAgentLabels[sub.id] ?? sub.label,
    [subAgentLabels],
  );

  const startRename = useCallback((subId: string) => {
    const sub = subAgents.find((s) => s.id === subId);
    setEditValue(subAgentLabels[subId] ?? sub?.label ?? '');
    setEditingId(subId);
  }, [subAgents, subAgentLabels]);

  const commitRename = useCallback((subId: string) => {
    setSubAgentLabel(subId, editValue);
    setEditingId(null);
    setEditValue('');
  }, [editValue, setSubAgentLabel]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  // 드래그 재정렬 — 드래그 중인 탭 id와 커서가 올라가 있는 대상 id
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, subId: string) => {
    setDraggingId(subId);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox 호환 — data 없으면 드래그 취소됨
    e.dataTransfer.setData('text/plain', subId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, subId: string) => {
    if (!draggingId || draggingId === subId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(subId);
  }, [draggingId]);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = draggingId;
    setDraggingId(null);
    setDragOverId(null);
    if (!sourceId || !agentId || sourceId === targetId) return;

    const ids = subAgents.map((s) => s.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);

    fetch(`/api/subagents/${agentId}/order`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ids }),
    }).catch(() => { /* snapshot이 권위 — 실패 시 원복됨 */ });
  }, [draggingId, agentId, subAgents]);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  const deleteSubAgent = useCallback((subId: string) => {
    if (!agentId) return;
    // 활성 탭을 닫으면 직전/다음 탭으로 이동, 없으면 null
    if (activeSessionId === subId) {
      const idx = subAgents.findIndex((s) => s.id === subId);
      const next = subAgents[idx + 1] ?? subAgents[idx - 1] ?? null;
      setSession(next ? next.id : null);
    }
    const store = useGraphStore.getState();
    // §4 v2.63 — CMD 에이전트의 세션 탭은 임베디드 PTY 핸들이기도 하다. 탭을 명시적으로 닫으면
    //   그 세션의 PTY 도 종료(좀비 셸 방지). 비-CMD 에이전트엔 해당 termId 가 없어 no-op.
    void window.api?.terminal?.kill(`term:${agentId}:${subId}`);
    // 낙관적 제거 — 서버 DELETE 왕복/브로드캐스트(혹은 stale full-snapshot)를 기다리지 않고 즉시 탭 제거.
    store.optimisticRemoveSubAgent(agentId, subId);
    fetch(`/api/subagents/${agentId}/${subId}`, { method: 'DELETE' })
      .catch(() => { /* snapshot이 권위 — 인텐트가 정리될 때까지 유지 */ });
    store.setTabPin(`subagent:${subId}`, false);
    // 닫힌 서브에이전트가 Default였으면 Default도 해제
    if (store.defaultSubAgents[agentId] === subId) {
      store.setDefaultSubAgent(agentId, null);
    }
  }, [agentId, activeSessionId, subAgents, setSession]);

  const handleClose = useCallback((e: React.MouseEvent, subId: string) => {
    e.stopPropagation();
    deleteSubAgent(subId);
  }, [deleteSubAgent]);

  // --- 가로 스크롤 (탭이 많아지면 좌/우 페이드 + wheel 가로 스크롤 + 오버레이 썸) ---
  // 네이티브 스크롤바는 레이아웃 점유로 탭을 줄이기 때문에 hide 하고, 오버레이 썸을 별도 DOM 으로 그린다(VS Code 식).
  // 페이드/썸 갱신은 imperative ref 조작 — 스크롤·리사이즈마다 React 리렌더 없이 즉시 반영.
  const scrollRef = useRef<HTMLDivElement>(null);
  const fadeLeftRef = useRef<HTMLDivElement>(null);
  const fadeRightRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    const fL = fadeLeftRef.current;
    const fR = fadeRightRef.current;
    const th = thumbRef.current;
    if (!el || !fL || !fR || !th) return;
    const overflow = el.scrollWidth - el.clientWidth;
    fL.classList.toggle('visible', el.scrollLeft > 4);
    fR.classList.toggle('visible', overflow - el.scrollLeft > 4);
    if (overflow <= 0 || el.clientWidth <= 0) {
      th.style.opacity = '0';
      th.style.width = '0px';
      return;
    }
    const ratio = el.clientWidth / el.scrollWidth;
    const width = Math.max(24, el.clientWidth * ratio);
    const left = (el.scrollLeft / overflow) * (el.clientWidth - width);
    th.style.opacity = '1';
    th.style.width = `${width}px`;
    th.style.transform = `translateX(${left}px)`;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    // 다중 ResizeObserver — 부모 트리 사이즈 변화도 잡는다(Electron maximize/restore 가
    // 자식 ResizeObserver 를 누락하는 케이스 대응).
    if (el.parentElement) ro.observe(el.parentElement);
    ro.observe(document.documentElement);
    const onWinResize = (): void => {
      updateScrollState();
      requestAnimationFrame(updateScrollState);
    };
    window.addEventListener('resize', onWinResize);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
      window.removeEventListener('resize', onWinResize);
    };
  }, [updateScrollState]);

  // 탭 수/이름/핀 변동 시 재계산.
  useEffect(() => { updateScrollState(); }, [subAgents, tabPins, updateScrollState]);

  // 휠은 기본적으로 세로지만 가로 스크롤 영역에서는 가로로 변환 — VS Code 동일 동작.
  // shiftKey 휠이나 trackpad 가로 휠(deltaX)도 자연스럽게 처리.
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) return;
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (delta === 0) return;
    el.scrollLeft += delta;
    e.preventDefault();
  }, []);

  // 활성 탭이 뷰포트 밖이면 자동 가시화.
  useEffect(() => {
    if (!activeSessionId) return;
    const el = scrollRef.current;
    if (!el) return;
    const tab = el.querySelector<HTMLElement>(`[data-tab-id="${activeSessionId}"]`);
    if (!tab) return;
    const tl = tab.offsetLeft;
    const tr = tl + tab.offsetWidth;
    const vl = el.scrollLeft;
    const vr = vl + el.clientWidth;
    if (tl < vl) el.scrollLeft = tl - 8;
    else if (tr > vr) el.scrollLeft = tr - el.clientWidth + 8;
  }, [activeSessionId, subAgents.length]);

  // --- Context menu ---
  const [ctx, setCtx] = useState<{ subId: string; index: number; x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, subId: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ subId, index, x: e.clientX, y: e.clientY });
  }, []);

  const ctxIsPinned = ctx ? !!tabPins[`subagent:${ctx.subId}`] : false;
  const ctxIsDefault = ctx ? defaultSubId === ctx.subId : false;
  const ctxHasOthers = useMemo(() => {
    if (!ctx) return false;
    return subAgents.some((s, i) => i !== ctx.index && !tabPins[`subagent:${s.id}`]);
  }, [ctx, subAgents, tabPins]);
  const ctxHasRight = useMemo(() => {
    if (!ctx) return false;
    return subAgents.some((s, i) => i > ctx.index && !tabPins[`subagent:${s.id}`]);
  }, [ctx, subAgents, tabPins]);

  const handleCtxAction = useCallback((action: 'close' | 'closeOthers' | 'closeRight' | 'closeAll' | 'togglePin' | 'toggleDefault') => {
    if (!ctx) return;
    const store = useGraphStore.getState();

    if (action === 'togglePin') {
      store.setTabPin(`subagent:${ctx.subId}`, !ctxIsPinned);
      return;
    }
    if (action === 'toggleDefault') {
      if (!agentId) return;
      store.setDefaultSubAgent(agentId, ctxIsDefault ? null : ctx.subId);
      return;
    }

    let targets: SubAgent[] = [];
    if (action === 'close') {
      const target = subAgents[ctx.index];
      if (target) targets = [target];
    } else if (action === 'closeOthers') {
      targets = subAgents.filter((s, i) => i !== ctx.index && !tabPins[`subagent:${s.id}`]);
    } else if (action === 'closeRight') {
      targets = subAgents.filter((_, i) => i > ctx.index).filter((s) => !tabPins[`subagent:${s.id}`]);
    } else if (action === 'closeAll') {
      targets = subAgents.filter((s) => !tabPins[`subagent:${s.id}`]);
    }

    for (const target of targets) {
      deleteSubAgent(target.id);
    }
  }, [ctx, ctxIsPinned, ctxIsDefault, agentId, subAgents, tabPins, deleteSubAgent]);

  return (
    <div className="flex h-9 flex-shrink-0 items-end gap-0 border-b border-gray-700 bg-[#15192a]">
      {/* Hook 에이전트: 메인 세션 탭 (프롬프트+결과 read-only) */}
      {!isCustom && (
        <button
          type="button"
          onClick={() => setSession(null)}
          className={`flex h-8 flex-shrink-0 items-center gap-1.5 border-r border-gray-700 px-3 text-xs transition-colors ${
            activeSessionId === null
              ? 'border-b-2 border-b-blue-400 bg-gray-800 text-white'
              : 'bg-gray-900/40 text-gray-400 hover:bg-gray-800/60 hover:text-gray-300'
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          <span className="max-w-[100px] truncate">{t('ide.tabbar.agentTabLabel')}</span>
        </button>
      )}

      {/* SubAgent session tabs — 가로 스크롤 컨테이너 (overflow 시 좌/우 페이드 + hover 오버레이 썸) */}
      <div className="group/tabscroll relative flex min-w-0 flex-1 items-end">
        <div
          ref={scrollRef}
          onWheel={handleWheel}
          className="scrollbar-overlay flex h-9 min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden"
        >
          {subAgents.map((sub, index) => {
        const isActive = activeSessionId === sub.id;
        // 도트 색 우선순위: error/active 는 status 그대로,
        // idle 은 ack 여부로 분기 (미확인=녹색, 확인=회색).
        const isAcked = !!acknowledgedSubAgents[sub.id];
        const dot = sub.status === 'idle' && isAcked
          ? ACK_DOT
          : STATUS_DOT[sub.status] ?? STATUS_DOT['idle'];
        const isDragging = draggingId === sub.id;
        const isDragOver = dragOverId === sub.id && draggingId !== sub.id;
        const isPinned = !!tabPins[`subagent:${sub.id}`];
        const isDefault = defaultSubId === sub.id;
        return (
          <div
            key={sub.id}
            data-tab-id={sub.id}
            draggable
            onDragStart={(e) => handleDragStart(e, sub.id)}
            onDragOver={(e) => handleDragOver(e, sub.id)}
            onDrop={(e) => handleDrop(e, sub.id)}
            onDragEnd={handleDragEnd}
            onClick={() => setSession(sub.id)}
            onContextMenu={(e) => handleContextMenu(e, sub.id, index)}
            className={`group relative flex h-8 flex-shrink-0 cursor-pointer items-center gap-1.5 border-r border-gray-700 pl-3 pr-1.5 text-xs transition-colors ${
              isActive
                ? 'border-b-2 border-b-blue-400 bg-gray-800 text-white'
                : 'bg-gray-900/40 text-gray-400 hover:bg-gray-800/60 hover:text-gray-300'
            } ${isDragging ? 'opacity-40' : ''} ${isDragOver ? 'border-l-2 border-l-blue-400' : ''}`}
          >
            {isPinned && (
              <span className="flex-shrink-0 cursor-help" title={t('tabMenu.pinTooltip')}>
                <svg className="h-2.5 w-2.5 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 3l-1 1 1 1-4 4-3-1-4 4 5 5-5 5 1 1 5-5 5 5 1-1-5-5 4-4-1-3 4-4 1 1 1-1-5-5z" />
                </svg>
              </span>
            )}
            {isDefault && (
              <span className="flex-shrink-0 cursor-help" title={t('tabMenu.defaultTooltip')}>
                <svg className="h-2.5 w-2.5 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l2.39 7.36H22l-6.19 4.5L18.2 21 12 16.5 5.8 21l2.39-7.14L2 9.36h7.61z" />
                </svg>
              </span>
            )}
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            {editingId === sub.id ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitRename(sub.id);
                  else if (e.key === 'Escape') cancelRename();
                }}
                onBlur={() => commitRename(sub.id)}
                className="w-[120px] rounded border border-blue-400/60 bg-gray-900 px-1 py-0.5 text-xs text-gray-100 outline-none"
              />
            ) : (
              // 탭 크기 고정 — 이름이 길면 ...(truncate).
              <span className="w-[120px] truncate">{displayLabel(sub)}</span>
            )}
            <button
              type="button"
              onClick={(e) => handleClose(e, sub.id)}
              className="flex h-4 w-4 items-center justify-center rounded text-gray-500 opacity-0 transition-all hover:bg-gray-600/50 hover:text-gray-200 group-hover:opacity-100"
              aria-label={`Close ${sub.label}`}
              title={t('ide.tabbar.closeTab')}
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        );
          })}
          {/* 세션 탭 바로 옆 인라인 New 버튼 — 우측 끝 + 버튼이 멀어서, 마지막 탭 옆에 바로 붙는다(크롬식). */}
          <button
            type="button"
            onClick={onNewSession}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center self-end text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
            title={t('ide.tabbar.newSession')}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
        {/* 좌/우 에지 페이드 — 가려진 방향에만 표시 (imperative class toggle) */}
        <div ref={fadeLeftRef} className="scroll-fade-left" />
        <div ref={fadeRightRef} className="scroll-fade-right" />
        {/* 오버레이 스크롤바 썸 — 탭 위로 떠서 hover 시 표시. 레이아웃 점유 X. style 은 ref 로 직접 갱신. */}
        <div
          ref={thumbRef}
          className="pointer-events-none absolute bottom-0 left-0 h-[3px] rounded-full bg-slate-400/0 transition-[background-color] duration-200 group-hover/tabscroll:bg-slate-400/50"
          style={{ opacity: 0, width: 0 }}
        />
      </div>

      {/* New tab button — Hook/Custom 모두 서브에이전트 생성 가능 */}
      {(
        <button
          type="button"
          onClick={onNewSession}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title={t('ide.tabbar.newSession')}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      )}

      {/* History(폴더) button — 이 cwd에서 쓰였던 과거 세션을 다시 열기 */}
      <HistoryButton />

      {ctx && (
        <TabContextMenu
          x={ctx.x}
          y={ctx.y}
          isPinned={ctxIsPinned}
          isDefault={ctxIsDefault}
          hasOthers={ctxHasOthers}
          hasRight={ctxHasRight}
          showDetach={false}
          showRename
          onAction={(action) => {
            // §5.4 #14-1 — IDE 서브에이전트 탭은 detach 미지원. showDetach=false 라 도달하지 않지만
            // 타입 좁힘을 위해 가드.
            if (action === 'detach') return;
            if (action === 'rename') { startRename(ctx.subId); return; }
            handleCtxAction(action);
          }}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  );
});

// ─── History 팝업 ───

function HistoryButton(): React.JSX.Element | null {
  const { t } = useTranslation();
  const agentId = useGraphStore((s) => selectIDEOverlay(s).agentId);
  const setSession = useGraphStore((s) => s.setIDEActiveSession);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SubAgentHistoryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/subagents/${agentId}/history`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { ok: boolean; items?: SubAgentHistoryItem[] };
      })
      .then((data) => setItems(data.items ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // 통합 앱 — restore 도 optimistic. 히스토리 항목에 stub 데이터가 다 있으므로
  // store 에 즉시 추가 + setSession 동기 호출. fetch 는 fire-and-forget (서버가 같은 id 로 archive→registry 이동).
  const handleRestore = useCallback((item: SubAgentHistoryItem) => {
    if (!agentId) return;
    const stub: SubAgent = {
      id: item.subAgentId,
      sessionId: item.sessionId,
      label: item.label,
      parentAgentId: agentId,
      status: 'idle',
      lastCommand: item.lastCommand,
      createdAt: item.lastActivityAt,
      lastActivityAt: item.lastActivityAt,
    };
    // 낙관적 복원 — 서버 restore 왕복 전에 즉시 탭 추가. full-snapshot race 에도 유지되도록
    // 복원 인텐트로 등록(loadSnapshot 이 스냅샷에 반영될 때까지 다시 채워 넣음).
    useGraphStore.getState().optimisticRestoreSubAgent(agentId, stub);
    setSession(stub.id);
    setOpen(false);
    fetch(`/api/subagents/${agentId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subAgentId: item.subAgentId }),
    }).catch(() => {});
  }, [agentId, setSession]);

  if (!agentId) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
        title={t('ide.tabbar.pastSessions')}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M3 7v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-8l-2-2H5a2 2 0 0 0-2 2z" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="mx-4 flex max-h-[70vh] w-full max-w-xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
              <span className="text-sm font-semibold text-gray-100">{t('ide.tabbar.pastSessions')}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                aria-label={t('ide.tabbar.pastSessionsClose')}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="scrollbar-thin flex-1 overflow-y-auto p-3">
              {loading && <p className="p-4 text-center text-xs text-gray-500">{t('ide.tabbar.loading')}</p>}
              {error && <p className="p-4 text-center text-xs text-red-400">{error}</p>}
              {!loading && !error && items && items.length === 0 && (
                <p className="p-4 text-center text-xs text-gray-500">{t('ide.tabbar.noClosedSessions')}</p>
              )}
              {!loading && items && items.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {items.map((it) => (
                    <li key={it.subAgentId}>
                      <button
                        type="button"
                        onClick={() => handleRestore(it)}
                        className="flex w-full items-center gap-3 rounded border border-gray-700/50 bg-gray-800/40 px-3 py-2 text-left transition-colors hover:border-blue-500/50 hover:bg-gray-700/60"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-gray-200">{it.label}</span>
                          {it.lastCommand && (
                            <span className="block truncate text-[10px] text-gray-500">{it.lastCommand}</span>
                          )}
                        </div>
                        <span className="flex-shrink-0 text-[10px] text-gray-500">
                          {new Date(it.lastActivityAt).toLocaleString('en-US', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

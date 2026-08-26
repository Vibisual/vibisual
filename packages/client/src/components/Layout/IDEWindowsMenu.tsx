import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BubbleData } from '@vibisual/shared';
import { BUBBLE_COLORS } from '@vibisual/shared';
import {
  useGraphStore,
  selectCanvasAgentBubbles,
  selectOrphanIDEPanes,
  selectProjectIDEPanes,
  selectRenderedIDEPanes,
  type IDEOverlayState,
  type IDEWindowLayoutKind,
} from '../../stores/graphStore.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { AgentConfigPopup } from '../Panel/AgentConfigPopup.js';
import type { IDEDockSide } from '../IDE/ideDockLayout.js';
import { useViewportSize } from '../IDE/useIDEDockLayout.js';
import { shortcutLabel } from '../../utils/platform.js';

// §5.5 #17-1 (판올림 번호 발급 대기) — **도크가 화면을 채워도 늘 닿는 자리**.
//
// 창을 네 변에 붙이면 캔버스가 그만큼 줄어든다. 그런데 "새 창을 연다"와 "에이전트 설정을 연다"의
// 진입로가 **캔버스에서 버블을 누르는 것 하나뿐**이라, 창 두엇만 붙여도 그 두 가지에 손이 닿지
// 않는 상태가 생긴다(사용자 지적: "커스텀 화면이 가득 찬 경우 새 버블을 어떻게 뜨게 하지?").
//
// 헤더는 `z-[100]` 이라 어떤 도크도 가리지 못한다 — 그래서 그 두 진입로를 여기 하나로 모은다.
// 목록은 캔버스와 **같은 산식**(`selectCanvasAgentBubbles`)을 읽는다(두 곳이 갈라지면 안 된다).
//
// (판올림 번호 발급 대기) **헤더의 입구는 하나다.** 종전에는 같은 것을 가리키는 버튼이 헤더에 둘
// 서 있었다 — 이 메뉴의 창 아이콘 트리거와, 그 옆의 에이전트 상태 배지(`0/36`, 좌클릭 = 지휘통제실).
// 이제 **배지가 이 메뉴의 트리거**이고(창 아이콘 버튼 폐지), 지휘통제실은 메뉴 맨 아래 항목으로
// 들어온다(§5.12 (A) 트리거 ②). 에이전트가 없어 배지가 안 뜨는 프로젝트에서도 **버블이 사라진 창**은
// 남을 수 있으므로, 그때만 트리거가 종전 창 아이콘 모양으로 되돌아간다 — 그 창을 닫을 자리가 여기뿐이다.

const EMPTY_AGENTS: BubbleData[] = [];
const EMPTY_PANES: IDEOverlayState[] = [];
const EMPTY_NODE_MAP: Record<string, BubbleData> = {};

/**
 * 배지 색 신호 — 좌측 dot 한 점이 전담하고 글자는 항상 같은 중성 톤(§3.7 v2.15 규약 그대로,
 * 배지가 이 메뉴의 트리거가 되면서 자리만 `Header` 에서 옮겨 왔다).
 */
export type AgentDotState = 'idle' | 'completed' | 'active';

const BADGE_DOT: Record<AgentDotState, string> = {
  idle: 'bg-gray-400',
  completed: 'bg-emerald-400 animate-pulse',
  active: 'bg-blue-400 animate-pulse',
};

interface IDEWindowsMenuProps {
  /**
   * 에이전트 배지 상태 — `null` 이면 이 프로젝트에 셀 에이전트가 없다는 뜻이라 트리거가 종전
   * 창 아이콘으로 되돌아간다(버블이 사라진 창을 닫을 자리는 남아 있어야 한다).
   *
   * ⚠ 배지 재료는 **원시값으로만** 받는다. 객체나 ReactNode 로 받으면 `Header` 가 스냅샷마다
   *   새 참조를 만들어 아래 `memo` 가 통째로 무력해진다(닫힌 메뉴가 매 스냅샷 다시 그려진다).
   */
  badgeState: AgentDotState | null;
  /** 지금 돌고 있는 세션 수 — 배지의 분자. */
  badgeRunning: number;
  /** 이 프로젝트의 세션 수 — 배지의 분모. */
  badgeSessions: number;
  /** 배지 툴팁 — 집계 문장 + "누르면 목록이 열린다" 안내. */
  badgeTitle: string;
  /** §5.12 (A) — 지휘통제실은 desktop IPC 전용이라 채널이 없는 창에서는 항목을 그리지 않는다. */
  canOpenCommandCenter: boolean;
  onOpenCommandCenter: () => void;
}

/** 창 하나 + 그 창이 붙은 에이전트 — 목록 한 줄의 재료. */
interface WindowRow {
  agent: BubbleData;
  pane: IDEOverlayState | null;
}

function sideLabelKey(side: IDEDockSide): string {
  return `header.ideWindows.side.${side}`;
}

/**
 * (판올림 번호 발급 대기) **레이아웃 프리셋**(언리얼 Window ▸ 레이아웃 관용).
 *
 * 창을 서넛 띄우면 겹쳐 쌓여 아래 것을 찾을 수 없고, 하나씩 끌어 맞추는 데 시간이 든다.
 * 여기서 한 번에 늘어놓거나(바둑판·계단식) 한 칸에 모은다(탭·좌우). 실행은 스토어 액션 하나
 * (`applyIDEWindowLayout`)가 맡고 이 표는 **무엇을 보여 줄지**만 정한다.
 */
const LAYOUT_ITEMS: ReadonlyArray<{ kind: IDEWindowLayoutKind; icon: React.JSX.Element }> = [
  {
    kind: 'tile',
    icon: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="1" />
        <rect x="13" y="3" width="8" height="8" rx="1" />
        <rect x="3" y="13" width="8" height="8" rx="1" />
        <rect x="13" y="13" width="8" height="8" rx="1" />
      </>
    ),
  },
  {
    kind: 'cascade',
    icon: (
      <>
        <rect x="3" y="3" width="13" height="13" rx="2" />
        <path d="M8 20h11a1 1 0 0 0 1-1V8" />
      </>
    ),
  },
  {
    kind: 'tabRight',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M13 4v16M16 8h5" />
      </>
    ),
  },
  {
    kind: 'splitLeftRight',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16M15 4v16" />
      </>
    ),
  },
  {
    kind: 'undockAll',
    icon: (
      <>
        <rect x="3" y="8" width="13" height="13" rx="2" />
        <path d="M8 3h13v13" />
      </>
    ),
  },
];

export const IDEWindowsMenu = memo(function IDEWindowsMenu({
  badgeState,
  badgeRunning,
  badgeSessions,
  badgeTitle,
  canOpenCommandCenter,
  onOpenCommandCenter,
}: IDEWindowsMenuProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [configAgentId, setConfigAgentId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // 정렬 계산은 **지금 화면 크기**를 알아야 한다 — 자리를 비우는 쪽과 같은 훅에서 받는다.
  const viewport = useViewportSize();

  // 닫혀 있는 동안에는 스냅샷마다 새로 오는 `agents` 배열을 구독하지 않는다 — 헤더가 매 스냅샷
  //   다시 그려질 이유가 없다. 열 때만 실제 목록을 구독한다.
  const agents = useGraphStore((s) => (open ? s.agents : EMPTY_AGENTS));
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const currentFolderId = useGraphStore((s) => s.currentFolderId);
  const worktreeProjects = useGraphStore((s) => s.worktreeProjects);
  const activeProject = useGraphStore((s) => s.activeProject);
  const ideOverlays = useGraphStore((s) => s.ideOverlays);
  const agentConfigs = useGraphStore((s) => s.agentConfigs);

  // 배지 숫자는 늘 필요하다 — 원시값이라 싸다. **실제로 그려지는 창**만 앞 숫자로 센다
  //   (접힌 창·버블이 사라진 유령 창까지 세면 화면에 없는 것이 숫자로만 남아 헷갈린다).
  const visibleCount = useGraphStore((s) => selectRenderedIDEPanes(s)
    .filter((o) => o.agentId && s.nodeMap[o.agentId]).length);
  const collapsedCount = useGraphStore((s) => selectProjectIDEPanes(s).filter((o) => o.collapsed).length);
  const orphanCount = useGraphStore((s) => selectOrphanIDEPanes(s).length);
  const openCount = visibleCount + collapsedCount + orphanCount;
  // 이 탭에 에이전트 버블이 있는가 — **닫혀 있을 때도** 알아야 버튼을 그릴지 정할 수 있다.
  //   숫자 하나라 배열 신원과 무관하게 값이 달라질 때만 다시 그린다.
  const agentCount = useGraphStore((s) => selectCanvasAgentBubbles(s).length);
  // 설정창이 가리키는 버블은 **스토어에서** 읽는다 — 목록(rows)은 메뉴가 닫히면 비므로,
  //   거기서 꺼내 쓰면 설정창을 여는 순간(= 바깥 누름으로 메뉴가 닫히며) 창도 같이 사라진다.
  const configAgent = useGraphStore((s) => (configAgentId ? s.nodeMap[configAgentId] : undefined));

  useOutsidePressDismiss({
    onDismiss: () => setOpen(false),
    enabled: open,
    refs: [menuRef],
    capture: false,
  });

  const rows = useMemo<WindowRow[]>(() => {
    if (!open) return [];
    const panes = selectProjectIDEPanes({ ideOverlays, activeProject });
    const paneByAgent = new Map<string, IDEOverlayState>();
    for (const p of panes) if (p.agentId) paneByAgent.set(p.agentId, p);
    const list = selectCanvasAgentBubbles({ agents, agentProjects, currentFolderId, worktreeProjects, activeProject })
      .map<WindowRow>((agent) => ({ agent, pane: paneByAgent.get(agent.id) ?? null }));
    // 창이 있는 것부터(맨 앞 창이 위) — 지금 보고 있는 것이 목록에서도 위에 있어야 한다.
    return list.sort((a, b) => (b.pane?.z ?? -1) - (a.pane?.z ?? -1));
  }, [open, agents, agentProjects, currentFolderId, worktreeProjects, activeProject, ideOverlays]);

  // 슬롯은 살아 있는데 버블이 사라진 창 — 화면에는 아무것도 안 뜨는데 슬롯만 남아, 종전에는
  //   목록에도 안 나와 **닫을 방법이 없었다**(배지 숫자만 올랐다). 여기서 직접 닫게 한다.
  //
  // ⚠ 이 목록을 셀렉터로 **직접 구독하면 안 된다.** zustand v5 의 `useStore` 는 고른 값을 메모하지
  //   않고 `selector(getState())` 를 그대로 `useSyncExternalStore` 의 스냅샷으로 넘긴다. 그런데
  //   `selectOrphanIDEPanes` 는 호출마다 **새 배열**을 만든다(빈 배열도 새 리터럴이다) — React 는
  //   매 커밋 뒤 스냅샷을 다시 읽어 이전 값과 `Object.is` 로 견주므로 "스토어가 또 바뀌었다"가
  //   영원히 참이 되고, 강제 리렌더가 중첩 갱신 한도를 넘겨 예외가 난다. 전역 에러 경계가 없어
  //   그 예외는 루트를 통째로 내린다 — 메뉴를 여는 순간 화면 전체가 사라졌다.
  //   그래서 구독은 참조가 안정적인 스토어 필드만 하고, 배열은 위 `rows` 와 같이 `useMemo` 로 만든다.
  const nodeMap = useGraphStore((s) => (open ? s.nodeMap : EMPTY_NODE_MAP));
  const orphans = useMemo<IDEOverlayState[]>(
    () => (open ? selectOrphanIDEPanes({ ideOverlays, activeProject, nodeMap }) : EMPTY_PANES),
    [open, ideOverlays, activeProject, nodeMap],
  );

  /**
   * (판올림 번호 발급 대기) 레이아웃 프리셋 — 실행은 스토어 액션 하나가 맡는다.
   * 메뉴는 **닫지 않는다**: 바둑판으로 봤다가 계단식으로 바꾸는 식으로 이어 눌러 보게 된다.
   */
  const applyLayout = useCallback((kind: IDEWindowLayoutKind) => {
    useGraphStore.getState().applyIDEWindowLayout(kind, viewport);
  }, [viewport]);

  const openWindow = useCallback((agentId: string) => {
    // 이미 창이 있으면 스토어가 새로 만들지 않고 펴서 앞으로 올린다(중복 창 ❌).
    useGraphStore.getState().openIDEOverlay(agentId, { pane: 'new' });
    setOpen(false);
  }, []);

  const stateLabel = useCallback((pane: IDEOverlayState): string => {
    if (pane.collapsed) return t('header.ideWindows.state.collapsed');
    if (pane.dockSide) return t(sideLabelKey(pane.dockSide));
    return t('header.ideWindows.state.floating');
  }, [t]);

  // 배지도 에이전트 버블도 열린 창도 없으면 헤더에 자리만 차지한다 — 그때는 아무것도 그리지 않는다.
  if (badgeState === null && agentCount === 0 && openCount === 0) return null;

  return (
    <div className="app-nodrag relative max-md:hidden" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={badgeState ? badgeTitle : t('header.ideWindows.tooltip')}
        aria-label={t('header.ideWindows.label')}
        className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-150 ${
          open ? 'bg-white/[0.12]' : 'hover:bg-white/[0.08]'
        }`}
      >
        {badgeState ? (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${BADGE_DOT[badgeState]}`} />
            <span className="text-[12px] font-medium tabular-nums tracking-tight text-gray-300">
              {badgeRunning}/{badgeSessions}
            </span>
          </>
        ) : (
          <>
            <svg className="h-3.5 w-3.5 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M14 4v16" />
            </svg>
            <span className="text-[12px] tabular-nums text-gray-300">
              {visibleCount}
              {collapsedCount > 0 ? ` +${collapsedCount}` : ''}
            </span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-white/[0.08] bg-gray-900/95 p-1 shadow-2xl backdrop-blur-xl scrollbar-thin">
          <div className="px-2 py-1 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
            {t('header.ideWindows.sectionTitle')}
          </div>
          {/* (판올림 번호 발급 대기) 레이아웃 — 창이 둘 이상일 때만 뜻이 있다(하나면 정리할 것이 없다). */}
          {visibleCount + collapsedCount > 1 && (
            <div className="mb-1 flex items-center gap-0.5 border-b border-white/[0.06] px-1 pb-1.5">
              {LAYOUT_ITEMS.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => applyLayout(item.kind)}
                  title={t(`header.ideWindows.layout.${item.kind}`)}
                  aria-label={t(`header.ideWindows.layout.${item.kind}`)}
                  className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                    {item.icon}
                  </svg>
                </button>
              ))}
              <span className="flex-1" />
              {/* 접힌 창이 하나라도 있으면 **펴기**가 먼저다 — 안 보이는 창을 되찾는 것이 더 급하다. */}
              <button
                type="button"
                onClick={() => applyLayout(collapsedCount > 0 ? 'expandAll' : 'collapseAll')}
                title={t(collapsedCount > 0 ? 'header.ideWindows.layout.expandAll' : 'header.ideWindows.layout.collapseAll')}
                aria-label={t(collapsedCount > 0 ? 'header.ideWindows.layout.expandAll' : 'header.ideWindows.layout.collapseAll')}
                className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  {collapsedCount > 0 ? <path d="M7 14l5-5 5 5" /> : <path d="M5 12h14" />}
                </svg>
              </button>
            </div>
          )}
          {rows.length === 0 && (
            <div className="px-2 py-2 text-[12px] text-gray-500">{t('header.ideWindows.empty')}</div>
          )}
          {rows.map(({ agent, pane }) => (
            <div
              key={agent.id}
              className="group flex items-center gap-1 rounded px-1 transition-colors hover:bg-white/[0.06]"
            >
              <button
                type="button"
                onClick={() => openWindow(agent.id)}
                title={pane ? t('header.ideWindows.bringToFront') : t('header.ideWindows.openNew')}
                className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1 text-left"
              >
                <span
                  className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                    pane ? (pane.collapsed ? 'bg-gray-500' : 'bg-blue-400') : 'bg-gray-700'
                  }`}
                />
                <span className="min-w-0 flex-1 truncate text-[12px] text-gray-200">{agent.label}</span>
                {pane && (
                  <span className="flex-shrink-0 text-[12px] text-gray-500">{stateLabel(pane)}</span>
                )}
              </button>

              {/* 설정 — 창이 있든 없든 여기서 연다(캔버스를 거치지 않는 유일한 길). */}
              <button
                type="button"
                onClick={() => setConfigAgentId(agent.id)}
                title={t('header.ideWindows.settings')}
                aria-label={t('header.ideWindows.settings')}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 opacity-0 transition-colors hover:bg-white/[0.08] hover:text-gray-200 group-hover:opacity-100"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 7h-9" />
                  <path d="M14 17H5" />
                  <circle cx="17" cy="17" r="3" />
                  <circle cx="7" cy="7" r="3" />
                </svg>
              </button>

              {pane && (
                <>
                  <button
                    type="button"
                    onClick={() => useGraphStore.getState().setIDEPaneCollapsed(pane.paneKey, !pane.collapsed)}
                    title={pane.collapsed ? t('header.ideWindows.expand') : t('header.ideWindows.collapse')}
                    aria-label={pane.collapsed ? t('header.ideWindows.expand') : t('header.ideWindows.collapse')}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      {pane.collapsed ? <path d="M7 14l5-5 5 5" /> : <path d="M5 12h14" />}
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => useGraphStore.getState().closeIDEOverlay(pane.paneKey)}
                    title={t('header.ideWindows.close')}
                    aria-label={t('header.ideWindows.close')}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          ))}
          {orphans.length > 0 && (
            <div className="mt-1 border-t border-white/[0.06] pt-1">
              {orphans.map((pane) => (
                <div key={pane.paneKey} className="flex items-center gap-1 rounded px-1 hover:bg-white/[0.06]">
                  <span className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1">
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500/70" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-gray-400">
                      {t('header.ideWindows.orphan')}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => useGraphStore.getState().closeIDEOverlay(pane.paneKey)}
                    title={t('header.ideWindows.close')}
                    aria-label={t('header.ideWindows.close')}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* §5.12 (A) 트리거 ② — 지휘통제실 입구가 이 자리로 들어왔다. 부르는 것은 root 버블
              좌더블클릭과 **같은 호출**이라 창 정체성(앱 전체 1창 · focus + show-project)이 그대로다. */}
          {canOpenCommandCenter && (
            <div className="mt-1 border-t border-white/[0.06] pt-1">
              <button
                type="button"
                onClick={() => { onOpenCommandCenter(); setOpen(false); }}
                title={t('header.ideWindows.commandCenterHint')}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
              >
                {/* 통제실 타이틀바와 같은 글리프 — 같은 창을 가리키는 두 자리가 다른 모양이면 안 된다. */}
                <svg className="h-3.5 w-3.5 flex-shrink-0 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
                <span className="min-w-0 flex-1 truncate text-[12px] text-gray-200">{t('commandCenter.title')}</span>
              </button>
            </div>
          )}
          <div className="mt-1 border-t border-white/[0.06] px-2 py-1.5 text-[12px] leading-snug text-gray-500">
            {t('header.ideWindows.hint')}
            {visibleCount > 1 && (
              <span className="mt-1 block text-gray-600">
                {t('header.ideWindows.shortcutHint', {
                  dock: shortcutLabel('Ctrl+Alt+←→↑↓'),
                  max: shortcutLabel('Ctrl+Alt+Enter'),
                  next: shortcutLabel('Ctrl+Alt+W'),
                })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 설정창 — 스스로 body 로 포털하므로 헤더 층에 갇히지 않는다(상세 패널에서 여는 것과 같은 컴포넌트). */}
      {configAgent && (
        <AgentConfigPopup
          agentId={configAgent.id}
          config={agentConfigs[configAgent.id] ?? null}
          currentColor={BUBBLE_COLORS[configAgent.bubbleType]}
          onClose={() => setConfigAgentId(null)}
        />
      )}
    </div>
  );
});

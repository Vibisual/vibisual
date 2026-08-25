import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import { createPortal } from 'react-dom';
import { BUBBLE_COLORS } from '@vibisual/shared';
import { useGraphStore, resolvePaneKey, selectIDEPane, selectRenderedIDEPanes, selectVisibleDockedPanes } from '../../stores/graphStore.js';
import { AgentConfigPopup } from '../Panel/AgentConfigPopup.js';
import { useIDEPaneScope, useIDEPaneValue } from './idePane.js';
import {
  IDE_DOCK,
  IDE_DOCK_SIDES,
  IDE_PANE_Z_BASE,
  IDE_FLOAT,
  clampDockSize,
  clampFloatGeom,
  defaultDockSize,
  initialFloatGeom,
  isHorizontalSide,
  dockSizeFromDrag,
  orderForInsert,
  previewDockRect,
  resolveDockDrop,
  splitSpansFromDrag,
  type DockDropTarget,
  type DockedPane,
  type FloatGeom,
  type IDEDockSide,
  type Rect,
} from './ideDockLayout.js';
import { useIDEDockLayout, useVisibleDockedPanes } from './useIDEDockLayout.js';
import { setCanvasCover } from '../../stores/canvasVisibility.js';
import { useIsNarrowViewport } from '../../hooks/useIsMobile.js';
import { useBackdropDismiss, useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { IDEActivityBar } from './IDEActivityBar.js';
import { IDETabBar } from './IDETabBar.js';
import { IDESidebar } from './IDESidebar.js';
import { IDESplitView } from './IDESplitView.js';
import { IDEEditorPane } from './IDEEditorPane.js';
import { useEditorFollow } from './useEditorFollow.js';
import { IDEStatusBar } from './IDEStatusBar.js';
import { IDERunOutputPanel } from './IDERunOutputPanel.js';
import { useRunSessions } from '../../stores/runSessions.js';
import { useReadingSettings } from './reading/useReadingSettings.js';
import { ReadingSettingsPopover } from './reading/ReadingSettingsPopover.js';

const EMPTY_SUBS: SubAgent[] = [];

/**
 * 창의 모양. 'docked' 는 **네 변 중 어디에 붙었는가**를 스토어의 `dockSide` 가 쥔다
 * (종전 'docked-right' 는 우측 하나뿐이라 모양 이름에 방향이 박혀 있었다).
 */
type OverlayMode = 'modal' | 'floating' | 'docked';
const HEADER_H = IDE_DOCK.HEADER_H; // §3.7 v2.13 통합 타이틀바 h-9
const DRAG_THRESHOLD = 6;
/** §4 v3.71 — 캔버스 덮개 등록 키(canvasVisibility). 창마다 따로 등록해야 서로의 덮개를 지우지 않는다. */
const CANVAS_COVER_PREFIX = 'ide-overlay';
const MIN_FLOAT_W = IDE_FLOAT.MIN_W;
const MIN_FLOAT_H = IDE_FLOAT.MIN_H;

/**
 * 이 창이 앉을 자리 — **사용자가 옮겨 둔 자리가 있으면 그것**, 없으면 계단식 초기 자리.
 * 첫 렌더의 상태 초기값으로도 쓰이므로 훅 밖(모듈 함수)에 둔다 — 0 크기로 한 프레임 깜빡이지 않게.
 */
function floatGeomFor(paneKey: string | null, paneIndex: number): FloatGeom {
  const vp = { w: window.innerWidth, h: window.innerHeight };
  const saved = selectIDEPane(useGraphStore.getState(), paneKey).float;
  return saved ? clampFloatGeom(saved, vp) : initialFloatGeom(vp, paneIndex);
}

/** 도크 손잡이가 붙는 **안쪽** 모서리 — 오른쪽 도크는 왼쪽 모서리에 손잡이가 선다. */
const DOCK_HANDLE_CLASS: Record<IDEDockSide, string> = {
  left: 'right-0 top-0 bottom-0 w-1 cursor-col-resize',
  right: 'left-0 top-0 bottom-0 w-1 cursor-col-resize',
  top: 'bottom-0 left-0 right-0 h-1 cursor-row-resize',
  bottom: 'top-0 left-0 right-0 h-1 cursor-row-resize',
};

/** 도크가 캔버스와 맞닿는 쪽만 테두리를 준다. */
const DOCK_BORDER_CLASS: Record<IDEDockSide, string> = {
  left: 'border-r',
  right: 'border-l',
  top: 'border-b',
  bottom: 'border-t',
};

/** 붙이기 메뉴 글리프 — 네모 안의 칸막이가 붙을 변을 가리킨다(이모지 ❌ · lucide 톤 stroke SVG). */
const DOCK_GLYPH_PATH: Record<IDEDockSide, string> = {
  left: 'M9 3v18',
  right: 'M15 3v18',
  top: 'M3 9h18',
  bottom: 'M3 15h18',
};

/**
 * 레이아웃이 아직 그 창을 모르는 **한 프레임**(방금 붙인 직후) 버티는 자리 — 붙은 변 전체.
 * 변마다 기준 모서리가 다르므로 우측 모양 하나로 때우면 좌·상·하 도크가 그 프레임에 튄다.
 */
function dockFallbackStyle(side: IDEDockSide, size: number): React.CSSProperties {
  switch (side) {
    case 'left': return { left: 0, top: IDE_DOCK.HEADER_H, bottom: 0, width: size };
    case 'right': return { right: 0, top: IDE_DOCK.HEADER_H, bottom: 0, width: size };
    case 'top': return { left: 0, right: 0, top: IDE_DOCK.HEADER_H, height: size };
    case 'bottom': return { left: 0, right: 0, bottom: 0, height: size };
  }
}

const DOCK_SIDE_LABEL_KEY: Record<IDEDockSide, string> = {
  left: 'ide.overlay.dockLeft',
  right: 'ide.overlay.dockRight',
  top: 'ide.overlay.dockTop',
  bottom: 'ide.overlay.dockBottom',
};

export const AgentIDEOverlay = memo(function AgentIDEOverlay({
  // §5.5 #17-6 v2.73 — 오버레이 위젯 창에서 IDE 를 열 땐 우측 도킹(스냅) 기능을 끈다(사용자 요청).
  disableDock = false,
  // §5.5 #17-6 v2.80 — 오버레이 위젯 창: IDE 가 OS 창 전체를 가득 채운다(창=IDE 1:1).
  // 백드롭·in-window floating/maximize 분기 없이, 이동은 타이틀바 app-drag(OS 창 이동),
  // 크기 조절은 OS 창 엣지 리사이즈. 모달이 80vw/80vh 로 떠 주변이 검은 띠로 보이던 문제 제거.
  fullWindow = false,
}: { disableDock?: boolean; fullWindow?: boolean }): React.JSX.Element | null {
  const { t } = useTranslation();
  // §5.5 #17-1 — 이 컴포넌트는 이제 **창 하나**다. 어느 슬롯을 보는지는 컨텍스트가 말해 준다
  //   (컨텍스트 밖 = 오버레이 위젯 창이면 종전대로 활성 프로젝트의 주 창).
  const { paneKey, index: paneIndex } = useIDEPaneScope();
  const agentId = useIDEPaneValue((o) => o.agentId);
  const overlayProjectId = useIDEPaneValue((o) => o.projectId);
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const closeOverlay = useCallback(() => {
    useGraphStore.getState().closeIDEOverlay(paneKey);
  }, [paneKey]);
  const setSession = useCallback((sessionId: string | null) => {
    useGraphStore.getState().setIDEActiveSession(sessionId, paneKey);
  }, [paneKey]);
  // §5.5 #17-20 ④ v4.74 — 실행 출력 패널(런타임 스토어 — PTY 수명과 같은 축).
  const runOutputRunId = useRunSessions((s) => s.outputRunId);
  const openRunOutput = useRunSessions((s) => s.openOutput);

  // §5.5 #17-9 ③ v4.95 — 실행 중 서브에이전트도 사이드바 뷰('subagents')가 되어 덮개가 사라졌다.
  //   이제 IDE 에 남은 덮개는 #17-20 ④ 실행 출력 하나뿐이다.
  const setPaneDock = useGraphStore((s) => s.setIDEPaneDock);
  const setPaneDockSize = useGraphStore((s) => s.setIDEDockSize);
  const focusPane = useGraphStore((s) => s.focusIDEPane);
  const selfPaneKey = useIDEPaneValue((o) => o.paneKey);
  const storeDockSide = useIDEPaneValue((o) => o.dockSide);
  const storeDockSize = useIDEPaneValue((o) => o.dockSize);
  const storeDockOrder = useIDEPaneValue((o) => o.dockOrder);
  const storeDockSpan = useIDEPaneValue((o) => o.dockSpan);
  const openModeHint = useIDEPaneValue((o) => o.openMode);
  // 이 프로젝트에 열려 있는 창 수와 이 창의 앞뒤 순위 — 겹침 순서·Escape 주인·모달 강등 판정에 쓴다.
  const paneCount = useGraphStore((s) => selectRenderedIDEPanes(s).length);
  const zRank = useGraphStore((s) => {
    const list = selectRenderedIDEPanes(s);
    const key = resolvePaneKey(s, paneKey);
    const i = list.findIndex((o) => o.paneKey === key);
    return i < 0 ? 0 : i;
  });
  /** 맨 앞 창인가 — Escape 는 **맨 앞 한 창만** 먹는다(여러 창이 한 번에 닫히면 안 된다). */
  const isFrontPane = paneCount === 0 || zRank === paneCount - 1;
  // 네 변 도크의 자리 — 자리를 비우는 쪽(App·DetailPanel)과 **같은 함수**를 읽는다.
  const dockLayout = useIDEDockLayout();
  const dockedPanes = useVisibleDockedPanes();
  const setDockSpans = useGraphStore((s) => s.setIDEDockSpans);
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
  // §5.19 (G) — All Model(로컬 LLM) 버블: 정체가 다르면 창의 얼굴도 달라야 한다.
  //   이 창은 클로드 CLI 의 것이 아니라 지금 문 로컬 모델의 것이다.
  const agentConfig = useGraphStore((s) => (agentId ? s.agentConfigs[agentId] : undefined));
  const localProvider = useGraphStore((s) => (agentId ? s.agentConfigs[agentId]?.provider : undefined));
  const isLocalAgent = !!localProvider;

  const [maximized, setMaximized] = useState(false);
  const toggleMaximized = useCallback(() => setMaximized((v) => !v), []);

  // §4 v3.24 — 폰(max-md)에선 좌측 내비(활동바+사이드바)를 기본 숨기고, 타이틀바 토글 버튼으로만 연다
  //   (좁은 화면에서 활동바 48px 가 본문을 상시 짓누르지 않게). 데스크톱은 isNarrow=false 라 항상 표시.
  const isNarrow = useIsNarrowViewport();
  // §5.5 #17-27 ⑪ — [추종] 이 켜져 있으면 그 **세션**이 고치는 파일을 편집창이 따라 연다.
  //   편집창은 열린 파일이 없으면 렌더되지 않으므로, 여는 판단은 그 밖(여기)에 있어야 한다.
  useEditorFollow(agentId ?? '', activeSessionId, isNarrow);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // 사이드바에서 세션을 고르면(activeSessionId 변경) 내비를 닫아 목적지 화면이 바로 보이게 한다.
  //   v4.93 — 북마크·세션 요약은 여기서 빠졌다: 이제 목적지가 **사이드바 자신**이라 내비를 닫으면
  //   방금 연 목록까지 함께 사라진다(폰에서 사이드바는 내비와 한 몸으로 뜬다).
  //   v4.95 — 실행 중 서브에이전트도 같은 이유로 빠졌다(사이드바 뷰가 됐다).
  useEffect(() => {
    if (isNarrow) setMobileNavOpen(false);
  }, [isNarrow, activeSessionId]);
  // §4 v3.25 — 폰에선 하단 상태바(IDEStatusBar)도 기본 숨김 — 타이틀바 우측 토글 버튼으로만 연다
  //   (h-6 한 줄이지만 폰에선 본문 세로 공간이 더 귀하다). 데스크톱은 isNarrow=false 라 항상 표시.
  const [mobileStatusOpen, setMobileStatusOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // §5.5 읽기 설정 — 훅이 <html> 에 CSS 변수를 실어 IDE 본문 폭·타이포그래피를 결정한다.
  //   패널 열림 여부는 이 컴포넌트만 아는 UI 상태(전역 store 금지 규칙).
  const { mobileAdapted, fontAvailability } = useReadingSettings();
  const [readingOpen, setReadingOpen] = useState(false);
  const closeReading = useCallback(() => setReadingOpen(false), []);
  // 열 때 사이드바가 접혀 있으면 함께 펼친다 — 활동바 48px 만 덜렁 뜨면 "버튼 눌렀는데 안 나온다"로 보인다.
  const handleToggleMobileNav = useCallback(() => {
    const next = !mobileNavOpen;
    if (next && selectIDEPane(useGraphStore.getState(), paneKey).sidebarCollapsed) {
      useGraphStore.getState().toggleIDESidebar(paneKey);
    }
    setMobileNavOpen(next);
  }, [mobileNavOpen, paneKey]);

  // 폰 내비 스크림 — 스크림 자체를 눌렀다 뗐을 때만 닫는다(사이드바에서 시작한 드래그로는 ❌).
  const mobileNavBackdrop = useBackdropDismiss(() => setMobileNavOpen(false));

  // §5.5 v3.39 — 타이틀바 에이전트 이름 인라인 편집. DetailPanel 의 클릭 리네임과 같은 경로
  //   (PATCH /api/bubble/:id/label) 를 써서 캔버스 버블 이름이 함께 바뀐다. 진입은 이름 더블클릭
  //   또는 **마우스 포인터가 타이틀바 위에 있을 때** F2 — 포인터 위치로 단축키 대상을 가른다
  //   (포인터가 탭바 등 다른 곳이면 IDETabBar 의 세션 탭 리네임이 그대로 F2 를 가져간다).
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  // 포인터가 타이틀바 위인지 — F2 라우팅 판정에만 쓴다(리렌더 불필요하므로 ref).
  const titleBarHoveredRef = useRef(false);

  const startNameEdit = useCallback(() => {
    const label = agentId ? useGraphStore.getState().nodeMap[agentId]?.label : undefined;
    if (label === undefined) return;
    setNameValue(label);
    setEditingName(true);
  }, [agentId]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.select();
  }, [editingName]);

  // 에이전트가 바뀌면(같은 IDE 창에서 다른 버블로 전환) 편집 중이던 입력은 버린다 — 옛 이름을
  //   새 에이전트에 저장해버리는 사고 방지.
  useEffect(() => { setEditingName(false); }, [agentId]);

  // F2 — 포인터가 타이틀바 위면 에이전트(버블) 이름 편집. **capture 단계**로 잡아 stopPropagation
  //   해야 window bubble 단계에 붙은 IDETabBar 의 F2(세션 탭 리네임)가 같은 키에 함께 반응하지 않는다.
  //   포인터가 타이틀바 밖이면 여기선 아무것도 안 해 탭 리네임이 예전대로 동작한다.
  useEffect(() => {
    if (!agentId) return;
    function onKeyDownCapture(e: KeyboardEvent): void {
      if (e.key !== 'F2') return;
      if (!titleBarHoveredRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (editingName) return;
      startNameEdit();
    }
    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => window.removeEventListener('keydown', onKeyDownCapture, true);
  }, [agentId, editingName, startNameEdit]);

  const commitNameEdit = useCallback(() => {
    setEditingName(false);
    const trimmed = nameValue.trim();
    if (!agentId || !trimmed) return;
    const current = useGraphStore.getState().nodeMap[agentId]?.label;
    if (trimmed === current) return;
    fetch(`/api/bubble/${agentId}/label`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: trimmed }),
    }).catch(() => {});
  }, [agentId, nameValue]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Esc 가 window 리스너까지 올라가면 IDE 자체가 닫힌다 — 편집 취소로만 소비.
    e.stopPropagation();
    if (e.key === 'Enter') commitNameEdit();
    else if (e.key === 'Escape') setEditingName(false);
  }, [commitNameEdit]);

  // 타이틀바 더블클릭 — 최대화 버튼과 동일 효과 (버튼 자손에서 시작된 더블클릭은 제외)
  // fullWindow 에선 in-window maximize 미사용(창=IDE 1:1, OS 가 드래그 영역 더블클릭을 처리).
  const handleTitleBarDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // 이름 더블클릭은 리네임 진입 — 최대화 토글과 겹치지 않게 여기서 가로챈다(fullWindow 에서도 동작).
    if (target.closest('[data-ide-agent-name]')) { startNameEdit(); return; }
    if (fullWindow) return;
    if (target.closest('button')) return;
    toggleMaximized();
  }, [fullWindow, toggleMaximized, startNameEdit]);

  // §5.5 #17-1 윈도우 모드 — 닫고 다시 열 때 슬롯의 `openMode` 로 되돌아간다(휘발).
  //
  // ⚠ 초기값을 **스토어에서 바로** 잡는다. 종전처럼 항상 'modal' 로 시작하면, 붙어 있던 창이
  //   (프로젝트 탭을 옮겼다 돌아와) 다시 마운트될 때 아래 sync 효과가 그 첫 프레임의 stale 한
  //   mode 를 보고 **스스로 도크를 떼어 버린다**(붙여 둔 창이 저절로 떠다니는 회귀).
  const [mode, setMode] = useState<OverlayMode>(() => {
    if (fullWindow) return 'modal';
    if (storeDockSide && !disableDock) return 'docked';
    return openModeHint === 'floating' ? 'floating' : 'modal';
  });
  const [floatPos, setFloatPos] = useState<{ x: number; y: number }>(() => floatGeomFor(paneKey, paneIndex));
  const [floatSize, setFloatSize] = useState<{ w: number; h: number }>(() => floatGeomFor(paneKey, paneIndex));
  /**
   * 드래그 중 미리보기가 그릴 **실제로 앉을 칸**(없으면 미리보기 ❌). 종전 불리언 한 비트를 대신한다.
   * 좌표까지 여기 담아 두는 까닭은 그리는 쪽이 같은 계산을 두 번 하지 않게 하기 위함이다.
   */
  const [snapRect, setSnapRect] = useState<Rect | null>(null);
  const [flashKey, setFlashKey] = useState<number>(0);
  /** 타이틀바 [붙이기] 메뉴 열림 — 이 창만의 UI 상태(전역 store 금지 규칙). */
  const [dockMenuOpen, setDockMenuOpen] = useState(false);
  /**
   * 타이틀바 [설정] — 그 창의 **에이전트 설정창**을 캔버스를 거치지 않고 연다.
   * 종전 진입로는 "캔버스에서 버블 클릭 → 상세 패널 → 톱니" 하나뿐이라, 창을 붙여 캔버스가
   * 좁아지면 설정에 손이 닿지 않았다(사용자 지적).
   */
  const [configOpen, setConfigOpen] = useState(false);
  const dockMenuRef = useRef<HTMLDivElement | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const prevRef = useRef<{ agentId: string | null; projectId: string | null }>({ agentId: null, projectId: null });
  // modal 백드롭(여백) 클릭으로 닫기 — 판정은 모든 팝업이 공유하는 규약(useBackdropDismiss)에 위임한다.
  // IDE 윈도우 안에서 시작한 드래그(텍스트 선택 등)가 백드롭에서 끝나면 click 의 공통 조상이
  // 백드롭이 되어 닫혀버리던 버그가 그 규약의 출발점이다.
  const backdrop = useBackdropDismiss(closeOverlay);

  /** 지금 뷰포트 — 드래그 중에는 실측값을 그때그때 읽는다(구독 ❌). */
  const viewportNow = useCallback(() => ({ w: window.innerWidth, h: window.innerHeight }), []);

  /** **나를 뺀** 다른 창들의 도크 — 스냅 자리·두께 상한을 그것들 기준으로 잰다. */
  const otherDockedPanes = useCallback((): DockedPane[] => {
    const st = useGraphStore.getState();
    const key = resolvePaneKey(st, paneKey);
    return selectVisibleDockedPanes(st).filter((d) => d.paneKey !== key);
  }, [paneKey]);

  const setPaneFloat = useGraphStore((s) => s.setIDEPaneFloat);
  // 지금 자리를 리스너가 읽을 수 있게 거울로 둔다(리스너를 매 이동마다 다시 달지 않기 위함).
  const floatRef = useRef<FloatGeom>({ ...floatPos, ...floatSize });
  floatRef.current = { ...floatPos, ...floatSize };

  /** 지금 자리를 슬롯에 적어 둔다 — 접었다 펴거나 탭을 옮겼다 와도 그 자리로 돌아오게. */
  const commitFloat = useCallback((geom: FloatGeom) => {
    setPaneFloat(paneKey, geom);
  }, [paneKey, setPaneFloat]);

  const goFloating = useCallback(() => {
    const g = floatGeomFor(paneKey, paneIndex);
    setFloatSize({ w: g.w, h: g.h });
    setFloatPos({ x: g.x, y: g.y });
    setMode('floating');
    commitFloat(g);
  }, [paneKey, paneIndex, commitFloat]);

  // 뷰포트가 줄면(앱 창 축소·회전) 떠 있는 창을 화면 안으로 되돌린다.
  //   ⚠ 이게 없으면 오른쪽 끝에 놓아 둔 창이 화면 밖으로 나가고, 타이틀바가 안 보이니 끌어올 수도
  //   없어 **닫는 것 말고는 되찾을 길이 없다**(창이 여럿이 되며 훨씬 쉽게 만나는 상태가 됐다).
  useEffect(() => {
    const onResize = (): void => {
      if (mode === 'docked' || fullWindow) return;
      const vp = { w: window.innerWidth, h: window.innerHeight };
      const cur = floatRef.current;
      const next = clampFloatGeom(cur, vp);
      if (next.x === cur.x && next.y === cur.y && next.w === cur.w && next.h === cur.h) return;
      setFloatPos({ x: next.x, y: next.y });
      setFloatSize({ w: next.w, h: next.h });
      commitFloat(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mode, fullWindow, commitFloat]);

  // §5.5 #17-1 (v2.17) — agentId/projectId 전이 처리:
  //   (a) null → truthy : 새로 열림 — 붙어 있던 변이 있으면 도킹 복원, 새로 선 둘째 창이면 플로팅,
  //       그 밖(프로젝트의 첫 창)은 종전대로 모달.
  //   (b) 프로젝트 전환 (overlayProjectId 변경) : 같은 규칙으로 mode 재초기화. flash 없음.
  //   (c) 같은 프로젝트에서 agentId 만 교체 : 모드 유지 + flash
  //   (d) truthy → null : 닫힘 — 로컬 mode 도 'modal' 리셋
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { agentId: agentId ?? null, projectId: overlayProjectId };
    const projectChanged = prev.projectId !== overlayProjectId;
    if (agentId && (!prev.agentId || projectChanged)) {
      // (오버레이 창에선 disableDock 이라 항상 modal 로 연다 — 도킹 없음)
      if (storeDockSide && !disableDock) {
        setMode('docked');
      } else if (openModeHint === 'floating' && !fullWindow) {
        goFloating();
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

  // §5.5 #17-1 — 창이 둘 이상이면 **모달로 남지 않는다**. 모달은 백드롭으로 화면 전체를 덮어
  //   옆 창을 통째로 가리므로, "여러 창을 나란히 본다"는 목적과 정면으로 어긋난다.
  useEffect(() => {
    if (fullWindow || !agentId || mode !== 'modal' || paneCount <= 1) return;
    goFloating();
  }, [fullWindow, agentId, mode, paneCount, goFloating]);

  // §5.5 #17-1 (v2.18) — 로컬 mode 와 스토어의 붙은 변을 맞춘다. 자리를 비우는 쪽(App 캔버스 여백·
  //   DetailPanel 미러링)이 스토어를 읽으므로 둘이 어긋나면 "IDE 없는 빈 도크"가 남는다.
  //   (v2.20) 닫힌 상태(agentId null)에서는 sync 금지 — 다음 open 이 mode 를 다시 정한다.
  useEffect(() => {
    if (!agentId) return;
    const dockedNow = mode === 'docked';
    if (dockedNow && !storeDockSide) {
      // 붙을 변이 사라졌다(다른 경로로 뗌) — 창을 잃지 않게 플로팅으로 되돌린다.
      goFloating();
    } else if (!dockedNow && storeDockSide) {
      setPaneDock(paneKey, null);
    }
  }, [agentId, mode, storeDockSide, paneKey, setPaneDock, goFloating]);

  // Escape to close — **맨 앞 창 하나만** 먹는다(창이 여럿일 때 한 번에 다 닫히면 안 된다).
  useEffect(() => {
    if (!agentId || !isFrontPane) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') closeOverlay();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [agentId, isFrontPane, closeOverlay]);

  // 누수 방지: 드래그 중(mousemove/mouseup 부착 상태)에 컴포넌트가 언마운트되면 handleUp 이 안 불려
  //   window 리스너가 영구 부착된다. 활성 드래그의 정리 함수를 ref 에 보관해 언마운트 시 강제 해제.
  const activeDragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { activeDragCleanupRef.current?.(); activeDragCleanupRef.current = null; }, []);

  // 붙이기 메뉴 — 바깥을 누르면 닫는다. 문서 리스너를 직접 달지 않고 팝업 닫기 규약을 쓴다
  //   (메뉴 안에서 시작한 제스처는 그 훅이 "안"으로 판정해 살려 준다).
  useOutsidePressDismiss({
    onDismiss: () => setDockMenuOpen(false),
    enabled: dockMenuOpen,
    refs: [dockMenuRef],
    capture: false,
  });

  /** 이 창을 맨 앞으로 — 누르는 순간 겹침 순서가 바뀐다(창이 여럿일 때만 뜻이 있다). */
  const bringToFront = useCallback(() => {
    if (paneKey) focusPane(paneKey);
  }, [paneKey, focusPane]);

  // 타이틀바 mousedown — 드래그 시작 / 임계치 초과 시 modal→floating 전이 + floating/docked 이동
  const handleTitleBarMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // fullWindow(오버레이 창)에선 in-window 이동 ❌ — 타이틀바 app-drag 가 OS 창째로 옮긴다.
    if (fullWindow) return;
    // 버튼·인터랙티브 자손(이름 리네임 포함)에서 시작된 mousedown 은 드래그 ❌
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-ide-agent-name]')) return;
    if (e.button !== 0) return;
    bringToFront();

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
    /** 지금 커서가 가리키는 도킹 자리 — mouseup 이 이 값 하나로 붙일지 말지를 정한다. */
    let dropTarget: DockDropTarget | null = null;
    /** 이동이 끝났을 때 슬롯에 적어 둘 자리 — 상태가 아니라 여기서 들고 있어야 mouseup 이 읽는다. */
    let lastGeom: FloatGeom | null = null;

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
        } else if (currentMode === 'docked') {
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
      const moved = clampFloatGeom({ x, y, w: nextW, h: nextH }, viewportNow());
      lastGeom = moved;
      setFloatPos({ x: moved.x, y: moved.y });
      // 도킹 미리보기 — 네 변 + **이미 붙어 있는 변의 스택에 끼울 자리**까지 커서로 갈린다.
      const vp = viewportNow();
      const others = otherDockedPanes();
      dropTarget = disableDock ? null : resolveDockDrop({ x: ev.clientX, y: ev.clientY }, vp, others);
      if (!dropTarget) {
        setSnapRect(null);
        return;
      }
      const onSide = others.filter((d) => d.side === dropTarget!.side);
      const wanted = onSide[0]?.size
        ?? (storeDockSide === dropTarget.side ? storeDockSize : defaultDockSize(dropTarget.side));
      setSnapRect(previewDockRect(dropTarget, vp, others, clampDockSize(dropTarget.side, wanted, vp, others)));
    }

    function handleUp(): void {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      activeDragCleanupRef.current = null;
      setSnapRect(null);
      if (!dragging) return;
      if (!dropTarget) {
        // 붙이지 않고 놓았다 = 사용자가 정한 자리다. 접었다 펴거나 탭을 옮겨도 그대로여야 한다.
        if (lastGeom) commitFloat(lastGeom);
        return;
      }
      const side = dropTarget.side;
      const others = otherDockedPanes();
      const onSide = others.filter((d) => d.side === side);
      // 그 변에 이미 창이 있으면 **그 변의 두께를 그대로 물려받는다** — 한 칸을 나눠 쓰기 때문이다.
      const wanted = onSide[0]?.size ?? (storeDockSide === side ? storeDockSize : defaultDockSize(side));
      setPaneDock(paneKey, {
        side,
        size: clampDockSize(side, wanted, viewportNow(), others),
        order: orderForInsert(onSide.map((d) => d.order), dropTarget.index),
      });
      setMode('docked');
    }

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    activeDragCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [fullWindow, mode, maximized, floatSize.w, floatSize.h, disableDock, bringToFront, viewportNow, otherDockedPanes, paneKey, setPaneDock, storeDockSide, storeDockSize]);

  /**
   * 떠 있는 창의 우하단 리사이즈. 종전에는 플로팅 창의 크기를 바꿀 방법이 **아예 없어**
   * (최대화/복원뿐) 두 창을 나란히 놓고 비율을 맞출 수가 없었다.
   */
  const handleFloatResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    bringToFront();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...floatRef.current };

    function handleMove(ev: MouseEvent): void {
      const next = clampFloatGeom({
        x: start.x,
        y: start.y,
        w: start.w + (ev.clientX - startX),
        h: start.h + (ev.clientY - startY),
      }, viewportNow());
      setFloatSize({ w: next.w, h: next.h });
      setFloatPos({ x: next.x, y: next.y });
    }
    function handleUp(): void {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      activeDragCleanupRef.current = null;
      commitFloat(floatRef.current);
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    activeDragCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [bringToFront, viewportNow, commitFloat]);

  /**
   * 같은 변에서 **내 바로 뒤에 붙은 창** — 그 창과 나 사이에 분할 손잡이가 선다.
   * 종전에는 같은 변의 창들이 무조건 균등 분할이라 "위는 길게, 아래 로그는 짧게"를 만들 수 없었다.
   */
  const stackNext = useMemo(() => {
    if (!storeDockSide || !selfPaneKey) return null;
    const onSide = dockedPanes.filter((d) => d.side === storeDockSide).sort((a, b) => a.order - b.order);
    const i = onSide.findIndex((d) => d.paneKey === selfPaneKey);
    return i >= 0 ? onSide[i + 1] ?? null : null;
  }, [dockedPanes, storeDockSide, selfPaneKey]);

  const handleStackSplit = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const side = storeDockSide;
    const next = stackNext;
    if (!side || !next) return;
    const selfRect = dockLayout.rects[selfPaneKey];
    const nextRect = dockLayout.rects[next.paneKey];
    if (!selfRect || !nextRect) return;

    // 좌/우 도크는 세로로 쌓이고(긴 축 = y), 상/하 도크는 가로로 쌓인다(긴 축 = x).
    const vertical = isHorizontalSide(side);
    const startPos = vertical ? e.clientY : e.clientX;
    const lenA = vertical ? selfRect.h : selfRect.w;
    const lenB = vertical ? nextRect.h : nextRect.w;
    const spanA = storeDockSpan;
    const spanB = next.span;

    function handleMove(ev: MouseEvent): void {
      const delta = (vertical ? ev.clientY : ev.clientX) - startPos;
      const out = splitSpansFromDrag(spanA, spanB, lenA, lenB, delta, IDE_DOCK.MIN_SLOT);
      setDockSpans({ [selfPaneKey]: out.a, [next!.paneKey]: out.b });
    }
    function handleUp(): void {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      activeDragCleanupRef.current = null;
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    activeDragCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [storeDockSide, stackNext, dockLayout, selfPaneKey, storeDockSpan, setDockSpans]);

  /** 타이틀바 도킹 버튼 — 끌지 않고도 원하는 변에 붙인다(끌어 붙이기와 **같은 계산**을 쓴다). */
  const dockToSide = useCallback((side: IDEDockSide) => {
    const others = otherDockedPanes();
    const onSide = others.filter((d) => d.side === side);
    const wanted = onSide[0]?.size ?? (storeDockSide === side ? storeDockSize : defaultDockSize(side));
    setPaneDock(paneKey, {
      side,
      size: clampDockSize(side, wanted, viewportNow(), others),
      // 버튼으로 붙일 때는 그 변의 **맨 뒤**에 선다(끼울 자리를 커서로 말할 수 없으므로).
      order: orderForInsert(onSide.map((d) => d.order), onSide.length),
    });
    setMaximized(false);
    setMode('docked');
  }, [otherDockedPanes, storeDockSide, storeDockSize, paneKey, setPaneDock, viewportNow]);

  /** 이 창을 접는다 — 닫지 않고 화면에서만 내린다(붙어 있던 변·열어 둔 파일 그대로). */
  const collapsePane = useCallback(() => {
    const st = useGraphStore.getState();
    const key = resolvePaneKey(st, paneKey);
    if (key) st.setIDEPaneCollapsed(key, true);
  }, [paneKey]);

  /** 도크에서 떼어 플로팅으로. */
  const undock = useCallback(() => {
    setPaneDock(paneKey, null);
    goFloating();
  }, [paneKey, setPaneDock, goFloating]);

  // 도크 안쪽 모서리 리사이즈 핸들 — 붙은 변마다 방향이 반대다(우측 도크는 왼쪽으로 끌어야 넓어진다).
  const handleDockResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const side = storeDockSide;
    if (!side) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startSize = storeDockSize;

    function handleMove(ev: MouseEvent): void {
      const raw = dockSizeFromDrag(side!, startSize, ev.clientX - startX, ev.clientY - startY);
      setPaneDockSize(paneKey, clampDockSize(side!, raw, viewportNow(), otherDockedPanes()));
    }
    function handleUp(): void {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      activeDragCleanupRef.current = null;
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    activeDragCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [storeDockSide, storeDockSize, paneKey, setPaneDockSize, viewportNow, otherDockedPanes]);

  // Custom 에이전트: 열릴 때 첫 번째 Sub 세션 자동 선택
  useEffect(() => {
    if (!isCustom || !agentId || activeSessionId !== null) return;
    const first = subAgents[0];
    if (first) setSession(first.id);
  }, [isCustom, agentId, activeSessionId, subAgents, setSession]);

  // 서버(디스크)에서 버퍼된 스트림 이벤트를 다시 불러온다. IDE 열릴 때 자동 + 새로고침 버튼 수동.
  // 크래시/미hydrate 로 화면엔 "No activity" 인데 sub-streams/*.jsonl 은 디스크에 온전한 경우,
  // 앱 재시작 없이 이 재요청으로 되살린다(loadStreamBuffers 가 세션 스트림을 디스크 버퍼로 재적재).
  const refreshStreams = useCallback(() => {
    if (!agentId) return;
    setRefreshing(true);
    // 캔버스 버블/에이전트 상태도 함께 최신화 — 소속 프로젝트 스냅샷 재요청.
    const proj = useGraphStore.getState().activeProject;
    if (proj) useGraphStore.getState().hydrateProject(proj);
    fetch(`/api/subagent-streams/${agentId}`)
      .then((r) => r.json())
      .then((data: { streams?: Record<string, SubAgentStreamEvent[]> }) => {
        // 'shallow' — 세션당 얕은 꼬리(`MAX_STREAM_BUFFER_BULK`)라, 이미 깊은 복원분을 들고 있는
        // 세션은 스토어가 줄이지 않고 겹치지 않는 꼬리만 이어 붙인다(늦게 도착한 얕은 응답이
        // 깊은 창을 덮어 되돌리던 것을 막는다).
        if (data.streams) useGraphStore.getState().loadStreamBuffers(data.streams, 'shallow');
      })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [agentId]);

  // IDE 열릴 때(agentId 변경 시) 자동 로드.
  useEffect(() => { refreshStreams(); }, [refreshStreams]);

  // §5.5 v4.92 — 보고 있는 세션만 **깊은 복원분**을 따로 받는다.
  //   위 전체 조회는 에이전트의 모든 세션을 담느라 세션당 얕게 주고(안 보는 세션은 클라가 어차피
  //   비활성 상한으로 깎는다), 사용자가 실제로 연 세션은 여기서 상한 전체를 받아 오래된 대화가
  //   "말풍선과 카드만 남고" 비지 않게 한다. 세션 탭을 옮길 때마다 그 세션 것 하나만 오간다.
  //
  //   ⚠ 이 요청은 **한 번 성공할 때까지, 그리고 깎일 때마다 다시** 나가야 한다. 종전에는
  //   `[agentId, activeSessionId]` 가 바뀔 때만 한 번 나가서 — ① 응답이 비어 오거나(복원 직후
  //   서버가 그 세션을 아직 들고 있지 않은 찰나) ② 그 사이 얕은 응답이 덮거나 ③ 비활성 컷(300)이
  //   창을 깎아도 재요청이 없었다. 그러면 그 세션은 얕은 창인 채로 굳고, 화면은 말풍선·카드만
  //   남는다. 이제 스토어의 깊은 복원 표식(`deepRestoredSessions`)이 없으면 다시 받아 온다 —
  //   표식은 비활성 컷·세션 제거가 지우므로, **세션이 다시 활성화될 때마다 자동으로 재요청**된다.
  const deepRestored = useGraphStore((s) => (activeSessionId ? s.deepRestoredSessions[activeSessionId] === true : true));
  useEffect(() => {
    if (!agentId || !activeSessionId || deepRestored) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // 빈 응답은 "없다"가 아니라 대개 "아직"이다 — 복원 직후엔 서버가 그 세션을 등록하기 전이라
    // 빈 배열이 온다. 종전처럼 조용히 포기하면 영영 얕은 채로 남으므로 짧게 물러났다 다시 묻는다.
    const RETRY_DELAYS = [400, 1200, 3000];
    const run = (attempt: number): void => {
      fetch(`/api/subagent-streams/${agentId}/${activeSessionId}`)
        .then((r) => r.json())
        .then((data: { events?: SubAgentStreamEvent[] }) => {
          if (cancelled) return;
          const server = data.events;
          if (!server || server.length === 0) {
            const delay = RETRY_DELAYS[attempt];
            if (delay !== undefined) retryTimer = setTimeout(() => run(attempt + 1), delay);
            return;
          }
          // ⚠ 이 적재는 그 세션의 버퍼를 **교체**한다. 요청이 오가는 사이 WS 로 도착한 라이브
          //   이벤트가 응답에는 없으므로, 그대로 덮으면 방금 흘러온 몇 줄이 화면에서 사라진다
          //   (에이전트가 말하는 중에 탭을 옮기면 바로 보이는 증상). 서버 응답의 마지막 시각
          //   이후분만 id 로 걸러 뒤에 이어 붙여 순서를 지킨다.
          const lastTs = server[server.length - 1]!.timestamp;
          const seen = new Set(server.map((e) => e.id));
          const prev = useGraphStore.getState().subAgentStreams[activeSessionId] ?? [];
          const tail = prev.filter((e) => e.timestamp >= lastTs && !seen.has(e.id));
          useGraphStore.getState().loadStreamBuffers({
            [activeSessionId]: tail.length > 0 ? [...server, ...tail] : server,
          }, 'deep');
        })
        .catch(() => {
          if (cancelled) return;
          const delay = RETRY_DELAYS[attempt];
          if (delay !== undefined) retryTimer = setTimeout(() => run(attempt + 1), delay);
        });
    };
    run(0);
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [agentId, activeSessionId, deepRestored]);

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
    // §5.5 #17-29 — 훅 버블은 읽기 전용. 손잡이(탭 `+`)는 이미 숨겼지만, 낙관적 탭을 먼저 그려 두고
    //   POST 가 403 으로 튕기면 유령 탭이 남으므로 여기서도 끊는다(서버가 권위, 화면은 앞서가지 않는다).
    if (!isCustom) return;
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
  }, [agentId, isCustom, setSession]);

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

  // §4 v3.71 가시성 LOD — 이 IDE 가 캔버스를 완전히 덮는 모드일 때만 덮개로 등록한다.
  //   fullWindow(오버레이 창=IDE 1:1) / maximized(풀스크린) / modal(전면 백드롭) 3종만 해당.
  //   floating 은 일부만 가리고, docked-right 는 캔버스가 옆으로 줄어들 뿐이라 계속 보인다.
  //   등록되면 BubbleMap 이 React Flow 페인트·물리 루프·주기 flush 를 통째로 멈춘다.
  const coverKey = `${CANVAS_COVER_PREFIX}:${selfPaneKey || 'primary'}`;
  const coversCanvas = !!agentId && !!agent && (fullWindow || maximized || mode === 'modal');
  useEffect(() => {
    setCanvasCover(coverKey, coversCanvas);
    return () => setCanvasCover(coverKey, false);
  }, [coverKey, coversCanvas]);

  if (!agentId || !agent) return null;

  // §5.5 #17-1 윈도우 모드 — mode 에 따라 컨테이너/윈도우 스타일 분기
  const isModal = mode === 'modal';
  // 붙을 변이 없으면 도킹이 아니다 — 모드만 남고 변이 사라진 찰나에 창을 잃지 않게 한다.
  const isDocked = mode === 'docked' && !!storeDockSide;
  const dockRect = isDocked ? dockLayout.rects[selfPaneKey] ?? null : null;

  let windowClass = 'flex flex-col overflow-hidden border-gray-700 bg-gray-900 shadow-2xl shadow-black/60';
  let windowStyle: React.CSSProperties = {};
  if (fullWindow) {
    // §17-6 v2.80 — 오버레이 창: IDE 가 투명 OS 창 전체를 가득 채운다(둥근 모서리+테두리만,
    // 백드롭/검은 여백 ❌). 이동·리사이즈는 OS 창 몫이라 modal/floating/maximized 분기 불필요.
    windowClass += ' fixed inset-0 rounded-xl border';
  } else if (maximized) {
    // 모드와 무관 — 풀스크린 (Header h-9 = 36px 아래)
    windowClass += ' fixed left-0 right-0 top-9 bottom-0';
  } else if (isModal) {
    // §4 v3.16 — 좁은 화면(폰)에선 80vw/80vh 모달이 너무 작다 — 풀스크린으로 전환.
    // 단 Header(h-9, z-[100])가 IDE(z-50)보다 위라, inset-0 풀스크린이면 IDE 타이틀바(닫기 버튼)가
    // 헤더 밑에 깔려 터치가 안 먹는다 — maximized 분기처럼 top-9(헤더 아래)부터 시작한다.
    windowClass += ' h-[80vh] w-[80vw] rounded-lg border max-md:fixed max-md:left-0 max-md:right-0 max-md:top-9 max-md:bottom-0 max-md:h-auto max-md:w-auto max-md:rounded-none max-md:border-0';
  } else if (isDocked && storeDockSide) {
    windowClass += ` fixed ${DOCK_BORDER_CLASS[storeDockSide]}`;
    windowStyle = dockRect
      // 자리를 비우는 쪽(App 캔버스 여백)과 **같은 함수**가 낸 칸에 그대로 앉는다.
      ? { left: dockRect.x, top: dockRect.y, width: dockRect.w, height: dockRect.h }
      : dockFallbackStyle(storeDockSide, storeDockSize);
  } else {
    // floating — 그리고 "모드는 도킹인데 붙을 변이 사라진" 찰나도 여기로 온다. 어느 갈래에도
    //   안 걸리면 창이 자리 없이 문서 흐름에 떨어져 화면이 무너지므로 **마지막 갈래**로 둔다.
    windowClass += ' fixed rounded-lg border';
    windowStyle = {
      left: floatPos.x,
      top: floatPos.y,
      width: floatSize.w,
      height: floatSize.h,
    };
  }

  // fullWindow 는 백드롭 없음(창 전체가 IDE) — 백드롭 클릭 닫기도 자연 소멸(닫기=Esc/X).
  const useBackdrop = isModal && !fullWindow;
  const outerClass = fullWindow
    ? 'fixed inset-0 z-50'
    : isModal
      // §4 v3.71 — backdrop-blur 제거. modal 은 캔버스를 완전히 덮는 모드라 아래 React Flow 가
      //   visibility:hidden 으로 이미 안 그려진다 → 블러할 대상이 없는데 전면 재합성 비용(매 프레임
      //   최고 비용 항목)만 남는다. 대신 거의 불투명한 스크림으로 종전의 시각 무게를 유지한다.
      ? 'fixed inset-0 z-50 flex items-center justify-center bg-gray-950/95'
      : 'fixed inset-0 z-50 pointer-events-none';

  return (
    <div
      className={outerClass}
      // 겹침 순서 — 스토어의 앞뒤 도장으로 매긴 **순위**를 쓴다(도장 자체를 z-index 로 쓰면
      //   세션이 길어질수록 자라 헤더(z-100)까지 덮는다). 바닥은 **모달 층(z-50) 아래**다 —
      //   그러지 않으면 설정창·확인 대화상자가 창 뒤로 깔린다.
      style={{ zIndex: IDE_PANE_Z_BASE + zRank }}
      onMouseDown={useBackdrop ? backdrop.onMouseDown : undefined}
      onClick={useBackdrop ? backdrop.onClick : undefined}
      // modal(백드롭 블러) 모드에선 뒤쪽 캔버스가 가려진 상태다 — 백드롭 우클릭이 rfContainer 까지
      // 올라가 캔버스 생성 메뉴가 블러 뒤에서 열리던 것을 차단한다(보이지도 않는 메뉴가 뜨는 문제).
      // floating/docked 는 백드롭이 없고(outer 가 pointer-events-none) 캔버스가 그대로 살아 있어야
      // 하므로 여기서만 막는다.
      onContextMenu={useBackdrop ? (e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
      } : undefined}
    >
      {/* §5.5 #17-1 — 드래그 중 우측 도킹 미리보기 (Windows Snap Assist 풍).
          파란 반투명 영역이 도킹될 자리를 미리 보여준다. pointer-events 없음. */}
      {snapRect && (
        <div
          className="fixed rounded-lg border-2 border-blue-400/70 bg-blue-400/15 transition-opacity duration-100"
          style={{
            left: snapRect.x,
            top: snapRect.y,
            width: snapRect.w,
            height: snapRect.h,
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
        // 창 아무 데나 누르면 맨 앞으로 — 뒤에 깔린 창을 꺼내는 유일한 손잡이다.
        onMouseDownCapture={bringToFront}
        onClick={(e) => e.stopPropagation()}
        // IDE 오버레이는 BubbleMap 의 rfContainer(우클릭=캔버스 생성메뉴) 안에 렌더된다.
        // IDE 내부 우클릭 이벤트가 그 컨테이너까지 버블링되면 캔버스 메뉴(Create Worktree 등)가
        // IDE 메뉴 뒤에 함께 뜬다("뒤에 있는 우클릭도 같이 먹는" 버그) → 여기서 전파를 끊는다.
        // (preventDefault 는 하지 않아 textarea 네이티브 메뉴 등 자식 동작은 그대로 유지)
        onContextMenu={(e) => e.stopPropagation()}
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
        {/* 도킹 시 안쪽 모서리 리사이즈 핸들 (4px) — 좌/우는 세로 손잡이, 상/하는 가로 손잡이. */}
        {isDocked && storeDockSide && (
          <div
            onMouseDown={handleDockResize}
            className={`absolute ${DOCK_HANDLE_CLASS[storeDockSide]} hover:bg-blue-400/60`}
            style={{ zIndex: 10 }}
            aria-label={t('ide.overlay.resizeDock')}
            role="separator"
          />
        )}
        {/* 같은 변에 쌓인 이웃과의 분할 손잡이 — 마지막 칸에는 뜨지 않는다(뒤에 나눌 상대가 없다). */}
        {isDocked && storeDockSide && stackNext && (
          <div
            onMouseDown={handleStackSplit}
            className={`absolute ${
              isHorizontalSide(storeDockSide)
                ? 'bottom-0 left-0 right-0 h-1 cursor-row-resize'
                : 'right-0 top-0 bottom-0 w-1 cursor-col-resize'
            } hover:bg-blue-400/60`}
            style={{ zIndex: 11 }}
            aria-label={t('ide.overlay.resizeStack')}
            role="separator"
          />
        )}
        {/* 떠 있는 창의 우하단 리사이즈 손잡이 — 붙어 있거나 최대화 중에는 뜻이 없다. */}
        {!fullWindow && !maximized && !isDocked && mode !== 'modal' && (
          <div
            onMouseDown={handleFloatResize}
            className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize"
            style={{ zIndex: 10 }}
            aria-label={t('ide.overlay.resizeWindow')}
            role="separator"
          >
            <svg className="h-full w-full text-gray-500" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
              <path d="M13 5L5 13M13 9l-4 4" />
            </svg>
          </div>
        )}
        {/* Title bar — §3.7 v2.14 명도 ramp 중간 톤 (v2.15: 상단 액센트 라인 제거 — 사용자 요청).
            §5.5 #17-1 — 타이틀바 드래그로 modal↔floating↔docked 전이.
            §5.5 #17-6 v2.80 — fullWindow(오버레이 창)에선 app-drag 로 OS 창째 이동(버튼은 app-nodrag). */}
        <div
          onMouseDown={handleTitleBarMouseDown}
          onDoubleClick={handleTitleBarDoubleClick}
          onMouseEnter={() => { titleBarHoveredRef.current = true; }}
          onMouseLeave={() => { titleBarHoveredRef.current = false; }}
          className={`flex h-10 flex-shrink-0 items-center justify-between border-b border-gray-700 bg-[#1a2236] px-4 select-none ${
            fullWindow ? 'app-drag cursor-default' : 'cursor-grab active:cursor-grabbing'
          }`}
        >
          <div className="flex items-center gap-2">
            {/* §4 v3.24 — 폰 전용 좌측 내비 토글(md:hidden). 활동바+사이드바 오버레이 열기/닫기. */}
            <button
              type="button"
              onClick={handleToggleMobileNav}
              className={`app-nodrag hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors max-md:flex ${
                mobileNavOpen ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
              aria-label={t('ide.overlay.toggleNav', { defaultValue: 'Toggle navigation' })}
              title={t('ide.overlay.toggleNav', { defaultValue: 'Toggle navigation' })}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
            <svg className="h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 2v4m0 12v4M2 12h4m12 0h4" />
            </svg>
            {editingName ? (
              <input
                ref={nameInputRef}
                data-ide-agent-name=""
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={commitNameEdit}
                onKeyDown={handleNameKeyDown}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={t('ide.overlay.renameInputLabel')}
                className="app-nodrag w-40 min-w-0 rounded border border-blue-500 bg-gray-800 px-1.5 py-0.5 text-sm font-semibold text-gray-100 outline-none"
              />
            ) : (
              <span
                data-ide-agent-name=""
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  // 키보드 접근성 — 이름에 포커스를 두고 Enter. F2 는 포인터 위치로 갈리므로(위 capture
                  //   리스너) 여기서 다루지 않는다.
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  e.stopPropagation();
                  startNameEdit();
                }}
                title={t('ide.overlay.renameHint')}
                className="app-nodrag cursor-pointer rounded text-sm font-semibold text-gray-200 outline-none hover:text-blue-400 focus-visible:ring-1 focus-visible:ring-blue-500"
              >
                {agent.label}
              </span>
            )}
            {isLocalAgent ? (
              /* §5.19 (G) — 로컬 버블의 정체 뱃지(All Model + 지금 문 모델명)는 이 자리를 떠나
                 **하단 상태바의 밀도 토글 옆**(`StreamLocalModelButton`)으로 내려갔다(사용자 지시).
                 여기에 `커스텀` 뱃지를 대신 달지는 않는다 — 정체를 거짓으로 말하게 된다. */
              null
            ) : (
              <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${
                isCmdAgent ? 'bg-teal-500/15 text-teal-300' : isCustom ? 'bg-blue-500/15 text-blue-400' : 'bg-gray-600/30 text-gray-500'
              }`}>
                {isCmdAgent ? t('ide.overlay.cmdLabel') : isCustom ? t('ide.overlay.customLabel') : t('ide.overlay.hookLabel')}
              </span>
            )}
          </div>
          <div className={`flex items-center gap-1 ${fullWindow ? 'app-nodrag' : ''}`}>
            {/* §4 v3.25 — 폰 전용 하단 상태바 토글(md:hidden). 기본 숨김인 IDEStatusBar 표시/숨김. */}
            <button
              type="button"
              onClick={() => setMobileStatusOpen((v) => !v)}
              className={`app-nodrag hidden h-8 w-8 items-center justify-center rounded transition-colors max-md:flex ${
                mobileStatusOpen ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
              aria-label={t('ide.overlay.toggleStatusBar', { defaultValue: 'Toggle status bar' })}
              title={t('ide.overlay.toggleStatusBar', { defaultValue: 'Toggle status bar' })}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 15h18" />
              </svg>
            </button>
            {/* §5.5 읽기 설정 — 폭 안(A~D)·읽기 폭·행간/자간/어간·글꼴·모바일 자동 변형.
                초광폭 창에서 한 줄이 길어져 읽기 어려운 문제를 사용자가 직접 조절하는 자리. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setReadingOpen((v) => !v)}
                aria-expanded={readingOpen}
                className={`app-nodrag flex h-6 w-6 items-center justify-center rounded transition-colors pointer-coarse:h-9 pointer-coarse:w-9 ${
                  readingOpen ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
                aria-label={t('ide.reading.buttonLabel')}
                title={t('ide.reading.buttonLabel')}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7V4h16v3" />
                  <path d="M9 20h6" />
                  <path d="M12 4v16" />
                </svg>
              </button>
              {readingOpen && (
                <ReadingSettingsPopover
                  onClose={closeReading}
                  mobileAdapted={mobileAdapted}
                  fontAvailability={fontAvailability}
                />
              )}
            </div>
            {/* 새로고침 — 디스크의 세션 스트림(sub-streams/*.jsonl) + 캔버스 스냅샷을 재요청.
                크래시/미hydrate 로 "No activity" 인데 데이터는 살아있는 경우 앱 재시작 없이 복구. */}
            <button
              type="button"
              onClick={refreshStreams}
              disabled={refreshing}
              className="app-nodrag flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors pointer-coarse:h-9 pointer-coarse:w-9 hover:bg-gray-700 hover:text-gray-200 disabled:opacity-50"
              aria-label={t('ide.overlay.refreshLabel', { defaultValue: 'Reload session' })}
              title={t('ide.overlay.refreshLabel', { defaultValue: 'Reload session' })}
            >
              <svg className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            </button>
            {/* §5.5 #17-1 — 이 창의 **에이전트 설정**. 종전 진입로는 "캔버스에서 버블 클릭 →
                상세 패널 → 톱니" 하나뿐이라, 창을 붙여 캔버스가 좁아지면 손이 닿지 않았다. */}
            <button
              type="button"
              onClick={() => setConfigOpen(true)}
              className="app-nodrag flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors pointer-coarse:h-9 pointer-coarse:w-9 hover:bg-gray-700 hover:text-gray-200"
              aria-label={t('ide.overlay.agentSettings')}
              title={t('ide.overlay.agentSettings')}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 7h-9" />
                <path d="M14 17H5" />
                <circle cx="17" cy="17" r="3" />
                <circle cx="7" cy="7" r="3" />
              </svg>
            </button>
            {/* §5.5 #17-1 — 붙이기/떼기. 끌어서 가장자리에 놓는 길과 **같은 계산**을 쓰되,
                정확히 끌기 어려운 화면(트랙패드·터치)에서도 한 번에 붙일 수 있게 손잡이를 둔다. */}
            {!fullWindow && !disableDock && (
              <div className="relative" ref={dockMenuRef}>
                <button
                  type="button"
                  onClick={() => setDockMenuOpen((v) => !v)}
                  aria-expanded={dockMenuOpen}
                  className={`app-nodrag flex h-6 w-6 items-center justify-center rounded transition-colors pointer-coarse:h-9 pointer-coarse:w-9 ${
                    dockMenuOpen || isDocked ? 'bg-gray-700 text-blue-300' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                  }`}
                  aria-label={t('ide.overlay.dockMenuLabel')}
                  title={t('ide.overlay.dockMenuLabel')}
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M15 3v18" />
                  </svg>
                </button>
                {dockMenuOpen && (
                  <div className="absolute right-0 top-7 z-30 w-36 rounded-md border border-gray-700 bg-gray-900 p-1 shadow-xl shadow-black/50">
                    {IDE_DOCK_SIDES.map((side) => (
                      <button
                        key={side}
                        type="button"
                        onClick={() => { dockToSide(side); setDockMenuOpen(false); }}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                          storeDockSide === side && isDocked ? 'bg-blue-500/15 text-blue-300' : 'text-gray-300 hover:bg-gray-800'
                        }`}
                      >
                        <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <path d={DOCK_GLYPH_PATH[side]} />
                        </svg>
                        {t(DOCK_SIDE_LABEL_KEY[side])}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { undock(); setDockMenuOpen(false); }}
                      disabled={!isDocked}
                      className="mt-0.5 flex w-full items-center gap-2 rounded border-t border-gray-800 px-2 py-1 pt-1.5 text-left text-xs text-gray-300 transition-colors hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="8" width="13" height="13" rx="2" />
                        <path d="M8 3h13v13" />
                      </svg>
                      {t('ide.overlay.undockLabel')}
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* §5.5 #17-1 — 접기. **닫기가 아니다** — 붙어 있던 변·열어 둔 파일을 그대로 둔 채
                화면에서만 내려 캔버스를 그만큼 돌려준다(헤더 [창] 메뉴에서 다시 편다). */}
            {!fullWindow && (
            <button
              type="button"
              onClick={collapsePane}
              className="app-nodrag flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors pointer-coarse:h-9 pointer-coarse:w-9 hover:bg-gray-700 hover:text-gray-200"
              aria-label={t('ide.overlay.collapseLabel')}
              title={t('ide.overlay.collapseHint')}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
              </svg>
            </button>
            )}
            {/* fullWindow 는 창=IDE 1:1 — 확대축소는 OS 창 엣지 리사이즈로, in-window maximize 버튼 숨김. */}
            {!fullWindow && (
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
            )}
            <button
              type="button"
              onClick={closeOverlay}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors pointer-coarse:h-9 pointer-coarse:w-9 hover:bg-gray-700 hover:text-gray-200"
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

        {/* Body: Activity bar + Sidebar + Main area.
            §5.5 #17-20 ④ — 활동바 우측 영역 전체를 덮는 별도 "세션창"은 이제 실행 출력 하나뿐이다
            (북마크·세션 요약은 v4.93, 실행 중 서브에이전트는 #17-9 ③ v4.95 부터 사이드바 뷰). */}
        <div className="relative flex min-h-0 flex-1">
          {/* §4 v3.24 — 폰에선 좌측 내비(활동바+사이드바)를 타이틀바 토글로만 연다. 열리면 본문 위
              오버레이(활동바 max-md:absolute + 사이드바 v3.18 오버레이)로 뜨고, backdrop 탭으로 닫는다. */}
          {isNarrow && mobileNavOpen && (
            <div
              className="absolute inset-0 z-20 bg-black/40"
              {...mobileNavBackdrop}
              aria-hidden="true"
            />
          )}
          {(!isNarrow || mobileNavOpen) && (
            <>
              <IDEActivityBar />
              <IDESidebar agentId={agentId} />
            </>
          )}
          {/* §5.5 #17-34 — 창 안 화면 분할. 안 나눴으면 종전처럼 `IDEMainArea` 한 벌만 그린다. */}
          <IDESplitView agentId={agentId} isCustom={isCustom} />
          {/* §5.5 #17-27 v4.87 — 내장 편집창. 대화를 덮지 않고 그 오른쪽에 선다(열린 파일이 없으면 렌더 ❌).
              폰 폭에서는 나란히 둘 자리가 없어 대화 위 오버레이로 뜬다. */}
          <IDEEditorPane narrow={isNarrow} />
          {/* §5.5 #17-20 ④ v4.74 — 실행 출력. 디버그 뷰에서 [출력]을 누르면 열린다(같은 덮개 자리). */}
          {runOutputRunId && (
            <div className="absolute inset-y-0 left-12 right-0 z-20 max-md:left-0">
              <IDERunOutputPanel onClose={() => openRunOutput(null)} />
            </div>
          )}
        </div>

        {/* §5.5 #17-1 — 이 창의 에이전트 설정창. 여는 자리만 다를 뿐 상세 패널에서 여는 것과
            **같은 컴포넌트·같은 저장 경로**다(설정이 두 벌이 되면 안 된다). */}
        {configOpen && (
          <AgentConfigPopup
            agentId={agentId}
            config={agentConfig ?? null}
            currentColor={BUBBLE_COLORS[agent.bubbleType]}
            onClose={() => setConfigOpen(false)}
          />
        )}

        {/* Status bar — §4 v3.25: 폰에선 기본 숨김, 타이틀바 토글 버튼으로만 표시. */}
        {(!isNarrow || mobileStatusOpen) && (
          <IDEStatusBar
            agent={agent}
            activeSession={activeSession}
            isCustom={isCustom}
            sessionCount={subAgents.length}
          />
        )}
      </div>
    </div>
  );
});

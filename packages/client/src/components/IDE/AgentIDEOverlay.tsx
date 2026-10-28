import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isComposingKeyEvent } from '../../utils/inputComposition.js';
import type { SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import { createPortal } from 'react-dom';
import { BUBBLE_COLORS, growSpanRight, shrinkSpanBack } from '@vibisual/shared';
import {
  useGraphStore,
  resolvePaneKey,
  selectDockSlotFrontKey,
  selectDockSlotSignature,
  selectIDEPane,
  selectRenderedIDEPanes,
  selectVisibleDockedPanes,
  type IDEEditorRoomGrowth,
} from '../../stores/graphStore.js';
import { AgentConfigPopup } from '../Panel/AgentConfigPopup.js';
import { captureIDEPaneHandoff, type IDEPaneHandoff } from '../../stores/idePaneHandoff.js';
import { peekPaneDragResume, takePaneDragResume } from '../../stores/idePaneDragResume.js';
import { readIDEPane, useIDEPaneScope, useIDEPaneValue } from './idePane.js';
import { scheduleGhostHide } from './ghostHandoff.js';
import { watchDetachedFollowRelease } from './detachedFollowRelease.js';
import { createPopOutWarmLatch } from './popOutWarmLatch.js';
import {
  IDE_DOCK,
  IDE_DOCK_SIDES,
  IDE_PANE_Z_BASE,
  IDE_FLOAT,
  FLOAT_RESIZE_EDGES,
  applyDockEntryLock,
  beginDockEntryLock,
  canAddDockSlot,
  clampDockSize,
  clampFloatGeom,
  computeDockLayout,
  defaultDockSize,
  dockOrderForDrop,
  dockSizeForDrop,
  dockSlotsOf,
  dockZoneButtons,
  initialFloatGeom,
  isHorizontalSide,
  isPinnedToViewportEdge,
  dockSizeFromDrag,
  dragFloatGeom,
  magnetFloatGeom,
  easeFloatPushOffset,
  pushFloatGeoms,
  pushDockSize,
  popOutGhostDecision,
  previewDockRect,
  resizeFloatGeom,
  resolveDockDrop,
  resumedFloatGeom,
  sameDockTarget,
  splitSpansFromDrag,
  stepDockEntryLock,
  type DockDropTarget,
  type DockEntryLock,
  type DockZoneButton,
  type DockedPane,
  type FloatGeom,
  type FloatPushDir,
  type FloatResizeEdge,
  type IDEDockSide,
  type Rect,
  type Viewport,
} from './ideDockLayout.js';
import {
  listFloatPushPanes,
  moveFloatPushPane,
  registerFloatPushPane,
  settleFloatPushPane,
} from './ideFloatPush.js';
import { useIDEDockLayout, useVisibleDockedPanes } from './useIDEDockLayout.js';
import { useIDEImmersiveMaximize } from './useIDEImmersiveMaximize.js';
import { setCanvasCover } from '../../stores/canvasVisibility.js';
import { WINDOW_PULL_OUT } from '../../hooks/floatingWindowGeom.js';
import { useCoarsePointer, useIsNarrowViewport } from '../../hooks/useIsMobile.js';
import { useElementWidth } from '../../hooks/useElementWidth.js';
import { editorGrowth, ideSidebarWidth, resolveIDEBodyLayout } from './ideResponsive.js';
import { IDEBodyLayoutContext, type IDEBodyLayoutValue } from './ideBodyLayoutContext.js';
import { IDEWindowFocusEnabledContext } from './splitCellContext.js';
import { autoFloatOnMultiPane, resolveTitleBarChrome, touchWindowMode } from './titleBarChrome.js';
import { titleBarDoubleClickAction, titleBarPressStartsDrag } from './titleBarGesture.js';
import { useBackdropDismiss, useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { IDEActivityBar } from './IDEActivityBar.js';
import { IDETabBar } from './IDETabBar.js';
import { IDESidebar } from './IDESidebar.js';
import { IDESplitView } from './IDESplitView.js';
import { IDEEditorPane } from './IDEEditorPane.js';
import { useWorkspaceEntryDrop } from './useWorkspaceEntryDrop.js';
import { useEditorFollow } from './useEditorFollow.js';
import { IDEStatusBar } from './IDEStatusBar.js';
import { IDERunOutputPanel } from './IDERunOutputPanel.js';
import { restoreStreamWindow } from './streamRestore.js';
import { useRunSessions } from '../../stores/runSessions.js';
import { useReadingSettings } from './reading/useReadingSettings.js';
// §6 — 창 배치 키는 레지스트리가 정한다(여기 조합을 적지 않는다).
import { useCommand } from '../../hooks/useCommand.js';
import { useBindingLabel, useBindingRaw } from '../Shortcuts/useBindingLabel.js';
import { groupBindingLabel } from '../Shortcuts/bindingLabel.js';
import { ReadingSettingsPopover } from './reading/ReadingSettingsPopover.js';

const EMPTY_SUBS: SubAgent[] = [];

/**
 * §5.5 #17-27 ①-1 — 창들이 판을 두고 넓힐지 따진 차례(`editorRoom.seq`, 휘발). 같은 변의 창은 두께를 나눠 쓰므로,
 * 먼저 넓힌 창이 닫힐 때 되돌려도 되는지를 이 차례로 가른다(`dockGrowthOnClose`).
 */
let editorRoomSeq = 0;

/** 창의 모양. 'docked' 의 변은 스토어 `dockSide` 가 쥔다. */
type OverlayMode = 'modal' | 'floating' | 'docked';
const HEADER_H = IDE_DOCK.HEADER_H; // §3.7 통합 타이틀바 h-9
const DRAG_THRESHOLD = 6;
/** §4 — 캔버스 덮개 등록 키(canvasVisibility). 창마다 따로 등록해야 서로의 덮개를 지우지 않는다. */
const CANVAS_COVER_PREFIX = 'ide-overlay';
const MIN_FLOAT_W = IDE_FLOAT.MIN_W;
const MIN_FLOAT_H = IDE_FLOAT.MIN_H;

/**
 * §5.5 #17-6 (H-6) — 가장자리에 막힌 채 버티는 타임라인(ms). 단일 모니터+최대화면 밀기가 시간으로만 표현되므로
 * 먼저 가상 창 선을 보여 주고(`EDGE_GHOST_MS`) 그다음 무장한다 — 안 보이게 기다리면 고장으로 읽힌다. §5.13 (S-10) 내부 앱 창과 공용(`WINDOW_PULL_OUT`).
 */
const EDGE_GHOST_MS = WINDOW_PULL_OUT.EDGE_GHOST_MS;
/** 그 타임라인을 재는 시계의 결 — 윤곽선이 밖으로 밀려 나가는 것이 끊겨 보이지 않을 만큼만 잦게. */
const EDGE_TICK_MS = WINDOW_PULL_OUT.EDGE_TICK_MS;
/** (H-6) 버티는 동안 윤곽선이 변 밖으로 밀려 나가는 거리(px). 다 밀지 않는다 — 단일 모니터+최대화면 선이 화면에서 사라진다. */
const EDGE_NUDGE_PX = WINDOW_PULL_OUT.EDGE_NUDGE_PX;
/** (H-7) 팝아웃이 윤곽선이 서기를 기다리는 상한(ms). 보통 한 프레임이지만 대답이 안 오면 창이 굳으므로 선 없이 넘어간다. */
const POP_OUT_GHOST_WAIT_MS = 160;
/**
 * §5.5 #17-6 (H-22) main 의 선에 살아 있다고 알리는 주기(ms). main 은 클릭통과 선을 수명 그물(`GHOST_MAX_LIFE_MS`=20초)로 걷는데,
 * 판 내내 선이 서면 끄는 손 아래서 걷혀 커서 아래가 빈다. 그물을 늘리지 않고(렌더러가 죽으면 오래 남는다) 판 동안 다시 재게 한다.
 */
const GHOST_KEEPALIVE_MS = WINDOW_PULL_OUT.GHOST_KEEPALIVE_MS;

/** 이 창이 앉을 자리 — 옮겨 둔 자리, 없으면 계단식 초기 자리. 첫 렌더 상태 초기값이라 훅 밖에 둔다(0 크기 깜빡임 ❌). */
function floatGeomFor(paneKey: string | null, paneIndex: number): FloatGeom {
  const vp = { w: window.innerWidth, h: window.innerHeight };
  const saved = selectIDEPane(useGraphStore.getState(), paneKey).float;
  return saved ? clampFloatGeom(saved, vp) : initialFloatGeom(vp, paneIndex);
}

/**
 * §5.5 #17-6 (H-14) — 밖에서 끌려 들어오는 창의 첫 자리는 손 아래다. 짐의 `float` 는 나가기 전 자리라 마운트 뒤에 옮기면 한 프레임 튄다.
 * **꺼내지 않고 `peek` 만** — 꺼내면 드래그를 잇는 아래 레이아웃 효과가 빈손이 된다.
 */
function resumeGeomFor(agentId: string | null, fullWindow: boolean): FloatGeom | null {
  if (!agentId || fullWindow) return null;
  const resume = peekPaneDragResume(agentId);
  if (!resume) return null;
  return resumedFloatGeom(
    resume,
    { x: window.screenX, y: window.screenY },
    { w: window.innerWidth, h: window.innerHeight },
  );
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

const FLOAT_RESIZE_CLASS: Record<FloatResizeEdge, string> = {
  n: 'left-2 right-2 top-0 h-1.5 cursor-ns-resize',
  s: 'left-2 right-2 bottom-0 h-1.5 cursor-ns-resize',
  w: 'top-2 bottom-2 left-0 w-1.5 cursor-ew-resize',
  e: 'top-2 bottom-2 right-0 w-1.5 cursor-ew-resize',
  nw: 'left-0 top-0 h-3 w-3 cursor-nwse-resize',
  ne: 'right-0 top-0 h-3 w-3 cursor-nesw-resize',
  sw: 'left-0 bottom-0 h-3 w-3 cursor-nesw-resize',
  se: 'right-0 bottom-0 h-3 w-3 cursor-nwse-resize',
};

/** 도킹 십자 버튼 글리프 — 탭 합류는 겹친 두 장, 새 칸은 그 방향으로 갈린 네모(그림만 보고 결과를 알게). */
function dockZoneGlyph(zone: DockZoneButton): React.JSX.Element {
  if (zone.kind === 'tab') {
    return (
      <>
        <rect x="3" y="7" width="14" height="14" rx="2" />
        <path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2" />
      </>
    );
  }
  if (zone.kind === 'edge') {
    // 빈 변에 처음 붙이는 자리 — 붙이기 메뉴와 **같은 글리프**를 쓴다(같은 일을 두 모양으로 그리지 않는다).
    return (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d={DOCK_GLYPH_PATH[zone.target.side]} />
      </>
    );
  }
  // 새 칸이 생기는 자리를 칸막이로 가리킨다(좌/우 도크는 위아래로, 상/하 도크는 좌우로 갈린다).
  const vertical = isHorizontalSide(zone.target.side);
  const before = zone.kind === 'before';
  return (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d={vertical ? (before ? 'M3 9h18' : 'M3 15h18') : (before ? 'M9 3v18' : 'M15 3v18')} />
    </>
  );
}

const DOCK_SIDE_LABEL_KEY: Record<IDEDockSide, string> = {
  left: 'ide.overlay.dockLeft',
  right: 'ide.overlay.dockRight',
  top: 'ide.overlay.dockTop',
  bottom: 'ide.overlay.dockBottom',
};

export const AgentIDEOverlay = memo(function AgentIDEOverlay({
  // §5.5 #17-6 — 오버레이 위젯 창에서 IDE 를 열 땐 도킹(스냅)을 끈다.
  disableDock = false,
  // §5.5 #17-6 — 오버레이 위젯 창: IDE 가 OS 창 전체를 채운다(창=IDE 1:1, 백드롭·in-window floating/maximize 분기 없음).
  fullWindow = false,
  // §5.5 #17-6 (H-18) — 밖에 선 이 창을 오버레이 버블로 바꾼다. "이번 접힘은 버블로"는 `OverlayShell` 이 쥐므로(H-20, `overlayCloseIntent.ts`)
  // IPC(`overlay.collapseSelf`)를 직접 부르지 않고 셸이 준 길로 간다. 앱 안 창에는 없다.
  onCollapseToBubble,
}: {
  disableDock?: boolean;
  fullWindow?: boolean;
  onCollapseToBubble?: () => void;
}): React.JSX.Element | null {
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
  // §5.5 #17-20 ④ — 실행 출력 패널(런타임 스토어 — PTY 수명 축).
  const runOutputRunId = useRunSessions((s) =>
    s.outputRunId && s.sessions[s.outputRunId]?.agentId === agentId ? s.outputRunId : null,
  );
  const openRunOutput = useRunSessions((s) => s.openOutput);

  const setPaneDock = useGraphStore((s) => s.setIDEPaneDock);
  const setPaneDockSize = useGraphStore((s) => s.setIDEDockSize);
  const focusPane = useGraphStore((s) => s.focusIDEPane);
  const selfPaneKey = useIDEPaneValue((o) => o.paneKey);
  const storeDockSide = useIDEPaneValue((o) => o.dockSide);
  const storeDockSize = useIDEPaneValue((o) => o.dockSize);
  const storeDockOrder = useIDEPaneValue((o) => o.dockOrder);
  const openModeHint = useIDEPaneValue((o) => o.openMode);
  // 이 프로젝트에 열려 있는 창 수와 이 창의 앞뒤 순위 — 겹침 순서·Escape 주인·모달 강등 판정에 쓴다.
  const paneCount = useGraphStore((s) => selectRenderedIDEPanes(s).length);
  const zRank = useGraphStore((s) => {
    const list = selectRenderedIDEPanes(s);
    const key = resolvePaneKey(s, paneKey);
    const i = list.findIndex((o) => o.paneKey === key);
    return i < 0 ? 0 : i;
  });
  // 네 변 도크의 자리 — 자리를 비우는 쪽(App·DetailPanel)과 **같은 함수**를 읽는다.
  const dockLayout = useIDEDockLayout();
  const dockedPanes = useVisibleDockedPanes();
  const setDockSpans = useGraphStore((s) => s.setIDEDockSpans);
  // (판올림 번호 발급 대기) 언리얼식 **탭 도킹** — 한 칸을 여럿이 나눠 쓰면 앞에 선 하나만 그린다.
  //   구독은 **원시 문자열**로만 한다(선택자가 매번 새 배열을 돌려주면 zustand v5 는 "캐시되지 않은
  //   스냅샷"으로 보고 무한 리렌더로 간다 — IDEPaneHost 가 배운 것과 같은 규약).
  const slotFrontKey = useGraphStore((s) => selectDockSlotFrontKey(s, resolvePaneKey(s, paneKey) ?? ''));
  const slotSignature = useGraphStore((s) => selectDockSlotSignature(s, resolvePaneKey(s, paneKey) ?? ''));
  const slotTabs = useMemo<Array<{ paneKey: string; label: string; front: boolean }>>(() => {
    if (!slotSignature) return [];
    return slotSignature.split(';').map((raw) => {
      const [key, label, front] = raw.split('|');
      return { paneKey: decodeURIComponent(key ?? ''), label: decodeURIComponent(label ?? ''), front: front === '1' };
    });
  }, [slotSignature]);
  // (판올림 번호 발급 대기) 헤더 [창] 메뉴의 레이아웃 프리셋이 **밖에서** 배치를 바꾼 세대.
  //   창의 모양(모달/플로팅/도킹)은 컴포넌트 로컬 상태라, 이 신호 없이는 스토어만 바뀌고 화면이 그대로 남는다.
  const layoutEpoch = useGraphStore((s) => s.ideLayoutEpoch);
  const cyclePaneFocus = useGraphStore((s) => s.cycleIDEPaneFocus);
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
  // §4 — CMD(인터랙티브 터미널) 에이전트: 라벨/자동 세션 분기. customCreated 기반이라 isCustom 도 true.
  const executionMode = useGraphStore((s) => (agentId ? s.agentConfigs[agentId]?.executionMode : undefined));
  const isCmdAgent = isCustom && executionMode === 'interactive-terminal';
  // §5.19 (G) · §5.25 (B) — 프로바이더 버블(All Model · 코덱스)인가. 엔진은 가리지 않는다 —
  // 정하는 것은 "타이틀바 뱃지를 비우고 정체를 하단 상태바에 맡기나" 하나다(이름은 뱃지가 `kind` 로 가른다).
  const agentConfig = useGraphStore((s) => (agentId ? s.agentConfigs[agentId] : undefined));
  const provider = useGraphStore((s) => (agentId ? s.agentConfigs[agentId]?.provider : undefined));
  const isProviderAgent = !!provider;

  /** §5.5 #17-1 — 최대화는 슬롯이 든다(`float`·`dockSide` 와 같은 자리). 창은 프로젝트 탭마다 다시 마운트되므로 로컬 상태면 탭을 오갈 때 풀린다. */
  const maximized = useIDEPaneValue((o) => o.maximized);
  const setPaneMaximized = useGraphStore((s) => s.setIDEPaneMaximized);
  const setMaximized = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    const cur = selectIDEPane(useGraphStore.getState(), paneKey).maximized;
    setPaneMaximized(paneKey, typeof next === 'function' ? next(cur) : next);
  }, [paneKey, setPaneMaximized]);
  const { immersive, hidden, fillsWindow, nextAction, cycle } = useIDEImmersiveMaximize({
    project: overlayProjectId,
    paneKey: selfPaneKey,
    maximized,
    onMaximized: setMaximized,
    enabled: !fullWindow && !!agentId && !!agent,
  });
  /** 몰입 창이 있으면 그 창만, 아니면 맨 앞 창만 Escape와 배치 명령을 받는다. */
  const isFrontPane = !hidden && (immersive || paneCount === 0 || zRank === paneCount - 1);
  /**
   * §5.5 #17-6 (H-5) — 독립 창의 OS 최대화 상태(앱 안 `maximized` 와 다른 대상). main 이 밀어 준 값만 믿는다 —
   * 낙관적으로 뒤집으면 다른 경로로 최대화를 잃었을 때 아이콘이 어긋난다.
   */
  const [osMaximized, setOsMaximized] = useState(false);
  useEffect(() => {
    if (!fullWindow) return;
    const ov = window.api?.overlay;
    if (!ov?.onMaximizeState) return;
    const off = ov.onMaximizeState(({ maximized: m }) => setOsMaximized(m));
    return () => { off(); };
  }, [fullWindow]);
  const toggleMaximized = useCallback(() => {
    if (fullWindow) {
      // 이 창은 `frame:false + transparent` 라 OS 타이틀바도 시스템 최대화도 없다 — main 이
      //   작업영역으로 bounds 를 옮겨 대신 해 준다(상태는 그쪽이 밀어 준다).
      void window.api?.overlay?.toggleMaximizeSelf?.();
      return;
    }
    cycle();
  }, [fullWindow, cycle]);
  /**
   * §5.5 #17-6 (H-28) — 독립 창을 다른 앱 위에 고정. 기억은 main 이 창마다 든다 — 설 때 묻고, 누르면 먼저 칠한 뒤 돌려받은 값으로 맞춘다
   * (바꾸는 손이 이 버튼뿐이라 안전). 구버전 preload 면 버튼을 안 그린다.
   */
  const canPinOnTop = !!window.api?.overlay?.setPinnedSelf;
  const [pinnedOnTop, setPinnedOnTop] = useState(false);
  useEffect(() => {
    if (!fullWindow) return;
    const getPinned = window.api?.overlay?.getPinnedSelf;
    if (!getPinned) return;
    let alive = true;
    void getPinned().then((v) => { if (alive) setPinnedOnTop(v === true); }).catch(() => {});
    return () => { alive = false; };
  }, [fullWindow]);
  const togglePinnedOnTop = useCallback(() => {
    const setPinned = window.api?.overlay?.setPinnedSelf;
    if (!setPinned) return;
    const next = !pinnedOnTop;
    setPinnedOnTop(next);
    void setPinned(next).then((v) => setPinnedOnTop(v === true)).catch(() => setPinnedOnTop(!next));
  }, [pinnedOnTop]);

  // §4 — 폰(max-md)이면 좌측 내비를 기본 숨기고 타이틀바 토글로만 연다. 판정의 입력 하나일 뿐 — 접힘은 `bodyLayout` 이 창 폭까지 보고 정한다.
  const isNarrow = useIsNarrowViewport();
  // 터치 기기(굵은 포인터) — 제목줄 끌기·변 끌기·도킹 두께 손잡이가 전부 마우스 이벤트라 손가락으로는 창을 옮기거나
  //   늘릴 수 없다. 그래서 폭이 넓은 태블릿이어도 떠 있는 창을 세우지 않고 모달로 둔다(`touchWindowMode`).
  const coarse = useCoarsePointer();

  // 창 안 반응형 — 기준은 뷰포트가 아니라 이 창의 폭이다(넓은 화면에서 창만 줄이면 대화만 0 까지 찌부러진다).
  // 본문 폭을 재 `resolveIDEBodyLayout` 에 넘기고 접힘은 컨텍스트로 흘린다.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bodyWidth = useElementWidth(bodyRef);
  /**
   * §5.5 #17-19 ⑧ — 탐색기에서 끌어온 파일을 받는 자리(대화 + 편집창). 활동바·사이드바는 일부러
   * 빼 둔다 — 트리 위에서 끌고 다니는 동안 "입력창에 넣기" 띠가 뜨면 어디에 놓는 중인지 알 수 없다.
   */
  const dropContentRef = useRef<HTMLDivElement | null>(null);
  const { state: entryDrop, handlers: entryDropHandlers } = useWorkspaceEntryDrop(agentId ?? '', dropContentRef, bodyRef);
  const sidebarCollapsed = useIDEPaneValue((o) => o.sidebarCollapsed);
  const sidebarView = useIDEPaneValue((o) => o.activeView);
  const editorOpenCount = useIDEPaneValue((o) => o.editorFiles.length);
  /** §5.5 #17-17 ㉔ — 무대도 같은 판이라 반응형 판정에 싣는다(빼면 대화가 `MIN_STREAM_W` 아래로 눌려도 안 접힌다). */
  const stageOpen = useIDEPaneValue((o) => o.stageOpen);
  const paneOpen = editorOpenCount > 0 || stageOpen || runOutputRunId !== null;
  const storedEditorWidth = useGraphStore((s) => s.ideEditorWidth);
  const bodyLayout = useMemo(() => resolveIDEBodyLayout({
    width: bodyWidth,
    viewportNarrow: isNarrow,
    sidebarCollapsed,
    sidebarWidth: ideSidebarWidth(sidebarView),
    editorOpen: paneOpen,
    editorWidth: storedEditorWidth,
  }), [bodyWidth, isNarrow, sidebarCollapsed, sidebarView, paneOpen, storedEditorWidth]);

  // §5.5 #17-27 ⑪ — [추종] 이 켜져 있으면 그 세션이 고치는 파일을 편집창이 따라 연다(편집창은 파일이 없으면 렌더 ❌ — 판단은 여기).
  // 물을 것은 **열었을 때** 덮개가 되는가다 — 지금 기준이면 열자마자 보던 대화를 덮는다.
  const editorWouldCover = useMemo(() => resolveIDEBodyLayout({
    width: bodyWidth,
    viewportNarrow: isNarrow,
    sidebarCollapsed,
    sidebarWidth: ideSidebarWidth(sidebarView),
    editorOpen: true,
    editorWidth: storedEditorWidth,
  }).editorDrawer, [bodyWidth, isNarrow, sidebarCollapsed, sidebarView, storedEditorWidth]);
  /**
   * 같은 물음의 다른 반쪽 — 열었을 때 **창이 자라야** 하는가(①-1). 판이 이미 서 있으면(무대·실행 출력) 파일을 더 열어도
   * 자라지 않는다. 추종 호출은 창의 모양(`mode`)을 안 뒤로 간다(①-1 절 바로 앞).
   */
  const editorWouldGrow = useMemo(() => !paneOpen && editorGrowth({
    width: bodyWidth,
    viewportNarrow: isNarrow,
    sidebarCollapsed,
    sidebarWidth: ideSidebarWidth(sidebarView),
    editorWidth: storedEditorWidth,
  }) > 0, [paneOpen, bodyWidth, isNarrow, sidebarCollapsed, sidebarView, storedEditorWidth]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /** 좌측 내비(활동바·사이드바) 중 하나라도 서랍인가 — 타이틀바 토글이 그 손잡이가 된다. */
  const navDrawerMode = bodyLayout.navDrawer || bodyLayout.sidebarDrawer;
  /** 하단 상태바도 서랍인가 — 활동바까지 접히는 폭(≈370px 이하)에선 줄바꿈으로 서너 줄이 되어 세로를 먹으므로 폰처럼 감추고 토글로만 부른다(§4). */
  const statusDrawerMode = isNarrow || bodyLayout.navDrawer;
  // 세션을 고르면 내비를 닫아 목적지가 보이게 한다. 북마크·세션 요약·실행 중 서브에이전트는 닫지 않는다(목적지가 사이드바 자신이다).
  useEffect(() => {
    if (navDrawerMode) setMobileNavOpen(false);
  }, [navDrawerMode, activeSessionId]);
  // §4 — 서랍 폭에선 하단 상태바도 기본 숨김, 타이틀바 토글로만 연다(`statusDrawerMode`).
  const [mobileStatusOpen, setMobileStatusOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // §5.5 읽기 설정 — 훅이 <html> 에 CSS 변수를 실어 IDE 본문 폭·타이포그래피를 결정한다.
  //   패널 열림 여부는 이 컴포넌트만 아는 UI 상태(전역 store 금지 규칙).
  const { mobileAdapted, fontAvailability } = useReadingSettings();
  const [readingOpen, setReadingOpen] = useState(false);
  const closeReading = useCallback(() => setReadingOpen(false), []);
  // §4 (CMD) — 버튼을 감추는 것만으로는 모자라다. 일반 버블에서 패널을 **열어 둔 채** CMD 버블로
  //   옮겨 오면 버튼만 사라지고 팝오버는 그대로 떠서, 닫을 손잡이가 없는 창이 화면에 남는다.
  useEffect(() => {
    if (isCmdAgent) setReadingOpen(false);
  }, [isCmdAgent]);
  // 열 때 사이드바가 접혀 있으면 함께 펼친다 — 활동바 48px 만 덜렁 뜨면 "버튼 눌렀는데 안 나온다"로 보인다.
  const handleToggleMobileNav = useCallback(() => {
    const next = !mobileNavOpen;
    if (next && selectIDEPane(useGraphStore.getState(), paneKey).sidebarCollapsed) {
      useGraphStore.getState().toggleIDESidebar(paneKey);
    }
    setMobileNavOpen(next);
  }, [mobileNavOpen, paneKey]);

  // 접힘 판정 + 서랍 손잡이를 자식들(활동바·사이드바·편집창·본문)에게 흘린다. 각자 자기 폭을
  //   재게 두면 같은 창을 두고 서로 다른 답을 내 층이 어긋난다 — 재는 곳은 이 창 하나다.
  const bodyLayoutValue = useMemo<IDEBodyLayoutValue>(() => ({
    ...bodyLayout,
    navOpen: mobileNavOpen,
    setNavOpen: setMobileNavOpen,
  }), [bodyLayout, mobileNavOpen]);

  // 폰 내비 스크림 — 스크림 자체를 눌렀다 뗐을 때만 닫는다(사이드바에서 시작한 드래그로는 ❌).
  const mobileNavBackdrop = useBackdropDismiss(() => setMobileNavOpen(false));

  // §5.5 — 타이틀바 이름 인라인 편집(PATCH /api/bubble/:id/label — 캔버스 버블 이름도 바뀐다).
  // 진입은 더블클릭 또는 포인터가 타이틀바 위일 때 F2(아니면 IDETabBar 세션 탭 리네임이 가져간다).
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

  // F2 — capture 단계에서 잡아 stopPropagation 해야 window 단계의 IDETabBar F2(세션 탭 리네임)가 함께 반응하지 않는다. 포인터가 타이틀바 밖이면 무동작.
  useEffect(() => {
    if (!agentId || hidden) return;
    function onKeyDownCapture(e: KeyboardEvent): void {
      if (isComposingKeyEvent(e)) return;
      if (e.key !== 'F2') return;
      if (!titleBarHoveredRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (editingName) return;
      startNameEdit();
    }
    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => window.removeEventListener('keydown', onKeyDownCapture, true);
  }, [agentId, editingName, startNameEdit, hidden]);

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

  // 타이틀바 더블클릭 = 최대화(버튼 자손 제외). (H-5) 독립 창도 여기서 처리한다 — 투명 창이라 OS 가 해 주지 않는다.
  // 이름 입력칸·제목 줄 팝업 안의 더블클릭은 그 자리의 것(`titleBarGesture.ts`, 끌기 판정과 한 벌).
  const handleTitleBarDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const action = titleBarDoubleClickAction(e.target as Element);
    // 이름 더블클릭은 리네임 진입 — 최대화 토글과 겹치지 않게 여기서 가로챈다(fullWindow 에서도 동작).
    if (action === 'rename') startNameEdit();
    else if (action === 'maximize') toggleMaximized();
  }, [toggleMaximized, startNameEdit]);

  // §5.5 #17-1 — 다시 열면 슬롯의 `openMode` 로 돌아간다(휘발). ⚠ 초기값은 스토어에서 바로 — 'modal' 로 시작하면 재마운트 때 아래 sync 가 stale mode 로 도크를 뗀다.
  // (H-14) 밖에서 끌려 들어오는 창이 먼저다 — 짐의 `dockSide`·`openMode` 로 서면 들어오는 순간 깜빡인다(앉을 자리는 뗄 때 — H-11).
  const resumeGeomRef = useRef<FloatGeom | null | undefined>(undefined);
  if (resumeGeomRef.current === undefined) resumeGeomRef.current = resumeGeomFor(agentId, fullWindow);
  const resumeGeom = resumeGeomRef.current;
  const [mode, setMode] = useState<OverlayMode>(() => {
    if (fullWindow) return 'modal';
    if (resumeGeom) return 'floating';
    if (storeDockSide && !disableDock) return 'docked';
    // 터치 기기는 떠 있는 창으로 열지 않는다 — 아래 되돌림 효과보다 먼저 막아 첫 프레임이 튀지 않게.
    return touchWindowMode(openModeHint === 'floating' ? 'floating' : 'modal', coarse, fullWindow);
  });
  const [floatPos, setFloatPos] = useState<{ x: number; y: number }>(
    () => resumeGeom ?? floatGeomFor(paneKey, paneIndex),
  );
  const [floatSize, setFloatSize] = useState<{ w: number; h: number }>(
    () => resumeGeom ?? floatGeomFor(paneKey, paneIndex),
  );
  /** 드래그 중 미리보기가 그릴 실제로 앉을 칸(null = 미리보기 ❌). 좌표째 담아 같은 계산을 두 번 하지 않는다. */
  const [snapRect, setSnapRect] = useState<Rect | null>(null);
  /** 드래그 중 뜨는 도킹 십자(언리얼 방향 위젯)와 지금 겨눈 자리. */
  const [zoneButtons, setZoneButtons] = useState<DockZoneButton[]>([]);
  const [dropTarget, setDropTarget] = useState<DockDropTarget | null>(null);
  /** §5.5 #17-6 (H-11) 돌아온 판이 잠근 벽 — 그 변의 십자 버튼을 흐리게 그린다(안 그러면 겨눠도 안 밝아지는 까닭 없는 무반응). */
  const [dockLockSide, setDockLockSide] = useState<IDEDockSide | null>(null);
  /** 자석이 붙은 선 — 왜 창이 살짝 튀었는지 눈으로 보이게 한다. */
  const [magnetGuides, setMagnetGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  /**
   * §5.5 #17-6 (H-6) — 밖으로 빼는 중: 커서를 따라가는 것은 창 크기 그대로의 윤곽선. `kind` — `os` 는 main 의 클릭통과 창(앱 밖까지),
   * `inapp` 은 폴백(앱 경계에서 잘린다). `armed` 면 지금 떼도 나간다. 모드가 바뀔 때만 바뀐다 — 자리는 `ghostRectRef` 를 rAF 가 DOM 에 쓴다(리렌더 ❌).
   */
  const [popOutGhost, setPopOutGhost] = useState<{ kind: 'os' | 'inapp'; armed: boolean } | null>(null);
  /** 윤곽선이 지금 있어야 할 자리 — rAF 가 읽어 DOM 에 쓴다(`inapp` 일 때만 그린다). */
  const ghostRectRef = useRef<Rect | null>(null);
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  /**
   * (H-6) 끄는 동안의 이동 — 상태가 아니다(mousemove 마다 상태면 창 전체가 다시 그려져 버벅인다).
   * rAF 가 `transform` 으로 쓰고 렌더도 같은 ref 를 읽어 리렌더에 안 튄다.
   */
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  /** §5.5 #17-1 — 다른 창이 나를 민 만큼(px). `dragOffsetRef` 와 같은 `transform` 한 줄에 합쳐 쓴다(따로 쓰면 하나가 지워진다). 상태가 아니다. */
  const pushOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  /** 지금 남이 나를 밀 수 있는 상태인가 — 떠 있는 창일 때만(렌더마다 갱신되는 거울). */
  const pushableRef = useRef(false);
  const dragRafRef = useRef<number | null>(null);
  const [flashKey, setFlashKey] = useState<number>(0);
  /** 타이틀바 [붙이기] 메뉴 열림 — 이 창만의 UI 상태(전역 store 금지 규칙). */
  const [dockMenuOpen, setDockMenuOpen] = useState(false);
  /** 타이틀바 [설정] — 캔버스를 거치지 않고 그 에이전트 설정창을 연다(붙여 캔버스가 좁아져도 닿게). */
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
  /**
   * §5.5 #17-6 (H-6) — 가상 창 윤곽선에 적을 이름. 드래그 리스너가 `agent` 를 직접 물면 이름이
   * 바뀔 때마다 리스너가 다시 만들어져 **끄는 도중에 판이 갈린다** — 거울로 둔다.
   */
  const agentLabelRef = useRef<string>('');
  agentLabelRef.current = agent?.label ?? '';

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

  // §5.5 #17-27 ⑪ (e) — [추종] 은 열면 덮개가 되거나 창이 자라는 폭에서는 스스로 판을 열지 않는다(AI 활동이 창 크기를 바꾸지 않는다).
  // 넓힐 가로가 없는 창(모달·최대화·상/하 도크)은 덮개만 본다.
  const paneCanGrow = fullWindow
    ? !osMaximized && !!window.api?.overlay?.growEditorRoomSelf
    : !maximized && (mode === 'floating' || (mode === 'docked' && (storeDockSide === 'left' || storeDockSide === 'right')));
  useEditorFollow(agentId ?? '', activeSessionId, editorWouldCover || (paneCanGrow && editorWouldGrow));

  // §5.5 #17-27 ①-1 — 판이 열릴 때 창이 좁으면 덮지 않고 자란다(양은 `editorGrowth`; 떠 있는 창=오른쪽 변, 좌/우 도크=두께, 독립 창=OS 창).
  // 모달·최대화·상/하 도크는 줄이기→서랍→덮개. 닫히면 되돌린다. 기억은 슬롯(`editorRoom`) — ref 면 언마운트에 사라져 못 되돌리고 또 넓힌다.
  const setEditorRoom = useGraphStore((s) => s.setIDEEditorRoom);
  const settleDockGrowth = useGraphStore((s) => s.settleIDEDockGrowth);
  useLayoutEffect(() => {
    const memo = selectIDEPane(useGraphStore.getState(), paneKey).editorRoom ?? null;
    if (!paneOpen) {
      if (!memo) return;
      setEditorRoom(paneKey, null);
      const rec = memo.growth;
      if (!rec) return;
      if (rec.kind === 'os') {
        if (fullWindow) void window.api?.overlay?.restoreEditorRoomSelf?.();
        return;
      }
      if (fullWindow || maximized) return;
      if (rec.kind === 'float') {
        if (mode !== 'floating') return;
        const cur = floatRef.current;
        const back = shrinkSpanBack({ x: cur.x, w: cur.w }, rec.growth);
        if (!back) return;
        const next = clampFloatGeom({ x: back.x, y: cur.y, w: back.w, h: cur.h }, viewportNow());
        setFloatPos({ x: next.x, y: next.y });
        setFloatSize({ w: next.w, h: next.h });
        commitFloat(next);
        return;
      }
      if (mode !== 'docked' || storeDockSide !== rec.side) return;
      // 두께는 그 변 전체의 것이다 — 이 넓힘에 기대 판을 연 옆 창이 남아 있으면 되돌리지 않고 기록을 넘긴다.
      settleDockGrowth(paneKey, rec);
      return;
    }
    // 넓히는 것은 **판이 열리는 순간 한 번**뿐이다(연 뒤 줄이면 다시 안 키운다) — 따진 사실을 먼저 적는다.
    if (memo?.checked || !bodyLayout.measured) return;
    const seq = ++editorRoomSeq;
    const growth = ((): IDEEditorRoomGrowth | null => {
      const dx = editorGrowth({
        width: bodyWidth,
        viewportNarrow: isNarrow,
        sidebarCollapsed,
        sidebarWidth: ideSidebarWidth(sidebarView),
        editorWidth: storedEditorWidth,
      });
      if (dx <= 0) return null;
      if (fullWindow) {
        if (osMaximized) return null;
        const grow = window.api?.overlay?.growEditorRoomSelf;
        if (!grow) return null;
        void grow(dx);
        return { kind: 'os' };
      }
      if (maximized) return null;
      if (mode === 'floating') {
        const cur = floatRef.current;
        const vp = viewportNow();
        const span = growSpanRight({ x: cur.x, w: cur.w }, dx, { x: 0, w: vp.w });
        if (span.w <= cur.w) return null;
        const next = { x: span.x, y: cur.y, w: span.w, h: cur.h };
        setFloatPos({ x: next.x, y: next.y });
        setFloatSize({ w: next.w, h: next.h });
        commitFloat(next);
        return { kind: 'float', growth: { before: { x: cur.x, w: cur.w }, after: span } };
      }
      if (mode === 'docked' && (storeDockSide === 'left' || storeDockSide === 'right')) {
        // 스스로 자라는 길은 **남의 도크를 밀지 않는다**(`pushDockSize` ❌) — 손으로 끌 때만 민다.
        const before = storeDockSize;
        const after = clampDockSize(storeDockSide, before + dx, viewportNow(), otherDockedPanes());
        if (after <= before) return null;
        setPaneDockSize(paneKey, after);
        return { kind: 'dock', side: storeDockSide, before, after, seq };
      }
      return null;
    })();
    setEditorRoom(paneKey, { checked: true, seq, growth });
  }, [
    paneOpen, bodyWidth, bodyLayout.measured, isNarrow, sidebarCollapsed, sidebarView, storedEditorWidth,
    fullWindow, osMaximized, maximized, mode, storeDockSide, storeDockSize, paneKey,
    viewportNow, otherDockedPanes, commitFloat, setPaneDockSize, setEditorRoom, settleDockGrowth,
  ]);

  // §5.5 #17-1 — agentId/projectId 전이: (a) null→truthy 새로 열림 — 붙던 변이 있으면 도킹, 둘째 창이면 플로팅, 첫 창은 모달
  // (b) 프로젝트 전환 — 같은 규칙으로 재초기화, flash ❌ (c) 같은 프로젝트 agentId 교체 — 모드 유지 + flash (d) truthy→null 닫힘 — mode 'modal'.
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { agentId: agentId ?? null, projectId: overlayProjectId };
    const projectChanged = prev.projectId !== overlayProjectId;
    if (agentId && (!prev.agentId || projectChanged)) {
      // §5.5 #17-6 (H-26) — 밖에서 들어온 판은 여기서 다시 정하지 않는다(첫 렌더 `resumeGeomFor` 가 정했다 — 아래 갈래는 모두 그 크기를 잃는다).
      // 표식은 한 판만 쓰고 여기서 소모한다 — 남기면 나중 프로젝트 전환 때 모드를 못 정한다.
      if (resumeGeomRef.current) {
        resumeGeomRef.current = null;
        return;
      }
      // (오버레이 창에선 disableDock 이라 항상 modal 로 연다 — 도킹 없음)
      if (storeDockSide && !disableDock) {
        setMode('docked');
      } else if (openModeHint === 'floating' && !fullWindow && touchWindowMode('floating', coarse, fullWindow) === 'floating') {
        goFloating();
      } else {
        setMode('modal');
      }
      // ⚠ 여기서 최대화를 풀지 않는다 — 이 갈래는 마운트마다(탭을 오갈 때도) 지나간다. 초기화는 슬롯을 세우는 `openIDEOverlay` 몫.
    } else if (agentId && prev.agentId && prev.agentId !== agentId && !projectChanged) {
      setFlashKey((k) => k + 1);
    } else if (!agentId && prev.agentId) {
      // 닫힘 — 로컬 상태 리셋(최대화는 슬롯째 사라진다 — `closeIDEOverlay` 가 슬롯을 지운다).
      setMode('modal');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, overlayProjectId]);

  // §5.5 #17-1 — 창이 둘 이상이면 **모달로 남지 않는다**. 모달은 백드롭으로 화면 전체를 덮어
  //   옆 창을 통째로 가리므로, "여러 창을 나란히 본다"는 목적과 정면으로 어긋난다.
  //   터치 기기는 예외다(`autoFloatOnMultiPane`) — 풀면 손으로 못 옮기는 창이 되고, 아래 되돌림이 곧바로 모달로 감는다.
  useEffect(() => {
    if (fullWindow || !agentId || mode !== 'modal' || !autoFloatOnMultiPane(paneCount, coarse)) return;
    goFloating();
  }, [fullWindow, agentId, mode, paneCount, coarse, goFloating]);

  // 터치 기기 — 어느 길로(레이아웃 프리셋·[떼기]·마우스를 뗀 태블릿) 떠 있는 창이 되든 여기 한 곳에서 모달로
  //   되돌린다(`touchWindowMode`). 떠 있는 창은 제목줄·변 끌기로만 옮기고 늘리는데 그 손잡이가 마우스 전용이다.
  useEffect(() => {
    if (!agentId) return;
    const next = touchWindowMode(mode, coarse, fullWindow);
    if (next !== mode) setMode(next);
  }, [agentId, mode, coarse, fullWindow]);

  /**
   * 레이아웃 프리셋(헤더 [창과 버블])이 밖에서 바꾼 배치를 로컬 mode 에 반영한다. ⚠ 아래 도크 sync 효과보다 **먼저** 선언한다 —
   * sync 가 먼저 돌면 "floating 인데 변이 생겼다"로 읽고 방금 적힌 변을 지워 프리셋이 죽는다. sync 는 미반영 세대면 비켜선다(`layoutEpochRef`).
   */
  const layoutEpochRef = useRef(0);
  /** 아래 sync 가 **이미 비켜선** 세대 — 같은 세대를 두 번 삼키지 않게 한다. */
  const syncedEpochRef = useRef(0);
  useEffect(() => {
    if (layoutEpoch === 0 || fullWindow || !agentId) return;
    layoutEpochRef.current = layoutEpoch;
    const slot = selectIDEPane(useGraphStore.getState(), paneKey);
    // 최대화는 프리셋 쪽(`applyIDEWindowLayout`)이 이미 풀었다 — 자리를 다시 정하는 프리셋만
    //   푼다(전부 접기/펴기는 배치를 안 건드리므로 최대화도 그대로 둔다).
    if (slot.dockSide && !disableDock) {
      setMode('docked');
      return;
    }
    // 떼는 프리셋([전부 떼어 내기]·바둑판·계단식)은 **모달도 함께 푼다** — 모달은 백드롭으로 화면을
    //   덮어 "떼어 늘어놓았다"가 눈에 보이지 않는다(창이 하나뿐이면 아래 paneCount 갈래도 안 돈다).
    const g = floatGeomFor(paneKey, paneIndex);
    setFloatSize({ w: g.w, h: g.h });
    setFloatPos({ x: g.x, y: g.y });
    setMode('floating');
    commitFloat(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutEpoch]);

  // §5.5 #17-1 — 로컬 mode 와 스토어의 붙은 변을 맞춘다(어긋나면 "IDE 없는 빈 도크"). 닫힌 상태(agentId null)에선 sync ❌ — 다음 open 이 정한다.
  useEffect(() => {
    if (!agentId) return;
    // §5.5 #17-6 (H) — 도킹 없는 창(독립·오버레이)은 붙은 변을 지우지 않는다 — 앱 안으로 돌아갈 때 복귀할 자리다.
    if (fullWindow || disableDock) return;
    // ⚠ 프리셋이 방금 적은 변을 지우지 않는다 — 위 효과의 `setMode` 는 다음 커밋에야 보여 이 커밋 `mode` 는 옛것이다. 그 세대의 커밋은 비켜선다.
    // 플래그가 아니라 **세대 번호**로 견준다(플래그는 mode 가 안 바뀌는 프리셋에서 남아 다음 sync 를 삼킨다).
    if (layoutEpochRef.current === layoutEpoch && syncedEpochRef.current !== layoutEpoch) {
      syncedEpochRef.current = layoutEpoch;
      return;
    }
    const dockedNow = mode === 'docked';
    if (dockedNow && !storeDockSide) {
      // 붙을 변이 사라졌다(다른 경로로 뗌) — 창을 잃지 않게 플로팅으로 되돌린다.
      goFloating();
    } else if (!dockedNow && storeDockSide) {
      setPaneDock(paneKey, null);
    }
  }, [agentId, mode, storeDockSide, paneKey, setPaneDock, goFloating, fullWindow, disableDock, layoutEpoch]);

  // Escape to close — 맨 앞 창 하나만. (H-20)/(H-21) Esc 는 ✕ 와 같은 길 — 판 안의 것(실행 출력·무대·편집창)을 한 겹씩 벗기지 않는다
  // (실행 출력은 창을 닫아도 남아 첫 Esc 가 매번 창을 못 닫게 된다). 출력은 패널의 ✕ 로 내린다.
  useEffect(() => {
    if (!agentId || !isFrontPane) return;
    function handleKey(e: KeyboardEvent): void {
      if (isComposingKeyEvent(e)) return;
      // §5.5 #17-25 — 라이트박스가 떠 있으면 Esc 는 그쪽 것이다(portal 이지만 이쪽 window 리스너가 먼저 돌아, 안 거르면 안 보낸 표시째 IDE 창이 닫힌다).
      // 판정은 store `imageLightbox` 가 아니라 화면 DOM — 호스트 없이 store 에 남은 것이 Esc 를 영영 삼키지 않게.
      if (e.key === 'Escape' && document.querySelector('.vibi-image-lightbox')) return;
      if (e.key === 'Escape') closeOverlay();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [agentId, isFrontPane, closeOverlay]);

  // 누수 방지: 드래그 중(mousemove/mouseup 부착 상태)에 컴포넌트가 언마운트되면 handleUp 이 안 불려
  //   window 리스너가 영구 부착된다. 활성 드래그의 정리 함수를 ref 에 보관해 언마운트 시 강제 해제.
  const activeDragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { activeDragCleanupRef.current?.(); activeDragCleanupRef.current = null; }, []);

  /**
   * §5.5 #17-6 (H-6) — 끄는 동안의 **한 프레임**. 창은 `transform` 으로(레이아웃 없는 합성),
   * 윤곽선은 자기 자리로. 값은 전부 ref 에서 읽으므로 이 함수는 리렌더를 일으키지 않는다.
   */
  const flushDragFrame = useCallback(() => {
    dragRafRef.current = null;
    const win = windowRef.current;
    if (win) {
      // 내가 끄는 이동과 **남이 나를 민 이동**은 한 줄로 합친다 — 따로 쓰면 뒤엣것이 앞엣것을 지운다.
      const dx = dragOffsetRef.current.dx + pushOffsetRef.current.dx;
      const dy = dragOffsetRef.current.dy + pushOffsetRef.current.dy;
      win.style.transform = dx === 0 && dy === 0 ? '' : `translate3d(${dx}px, ${dy}px, 0)`;
      win.style.willChange = dx === 0 && dy === 0 ? '' : 'transform';
    }
    const el = ghostElRef.current;
    const r = ghostRectRef.current;
    if (el && r) {
      el.style.transform = `translate3d(${Math.round(r.x)}px, ${Math.round(r.y)}px, 0)`;
      el.style.width = `${Math.round(r.w)}px`;
      el.style.height = `${Math.round(r.h)}px`;
    }
  }, []);
  /** 한 프레임에 한 번만 쓴다 — `mousemove` 는 프레임보다 자주 온다(같은 프레임에 여러 번 쓰면 헛일). */
  const scheduleDragFrame = useCallback(() => {
    if (dragRafRef.current !== null) return;
    dragRafRef.current = window.requestAnimationFrame(flushDragFrame);
  }, [flushDragFrame]);
  useEffect(() => () => {
    if (dragRafRef.current !== null) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
  }, []);
  /**
   * (H-6) 폴백 윤곽선이 **막 붙은 프레임**에는 아직 자리가 없다(ref 가 그때 채워진다).
   * 페인트 전에 한 번 맞춰 준다 — 아니면 좌상단에 한 프레임 번쩍인다.
   */
  useLayoutEffect(() => {
    if (popOutGhost?.kind === 'inapp') flushDragFrame();
  }, [popOutGhost, flushDragFrame]);

  /**
   * §5.5 #17-1 — 자석 밀기를 받는 쪽: 등록소에 건다. store 에 매 프레임 쓰면 그 프로젝트 창 전원이 다시 그려지므로
   * 끄는 동안은 `transform` 만, 뗄 때만 상태·슬롯에 적는다. `rect()` 가 null 이면 셈에서 빠진다.
   */
  useEffect(() => {
    if (!paneKey) return;
    return registerFloatPushPane(paneKey, {
      rect: () => (pushableRef.current ? { ...floatRef.current } : null),
      move: (dx, dy) => {
        const cur = pushOffsetRef.current;
        if (cur.dx === dx && cur.dy === dy) return;
        pushOffsetRef.current = { dx, dy };
        scheduleDragFrame();
      },
      settle: (dx, dy) => {
        pushOffsetRef.current = { dx: 0, dy: 0 };
        // 밀림을 **먼저 지우고** 같은 일감에서 자리를 옮긴다 — 순서가 바뀌면 한 프레임 옛 자리로 튄다.
        const win = windowRef.current;
        if (win && dragOffsetRef.current.dx === 0 && dragOffsetRef.current.dy === 0) {
          win.style.transform = '';
          win.style.willChange = '';
        }
        if (dx === 0 && dy === 0) return;
        const cur = floatRef.current;
        // 안전망은 여기서 한 번 — 밀려 나간 창도 `KEEP_VISIBLE` 만큼은 화면에 남는다(되찾을 자락).
        const landed = clampFloatGeom({ ...cur, x: cur.x + dx, y: cur.y + dy }, viewportNow());
        setFloatPos({ x: landed.x, y: landed.y });
        commitFloat(landed);
      },
    });
  }, [paneKey, viewportNow, commitFloat, scheduleDragFrame]);

  // 붙이기 메뉴 — 바깥을 누르면 닫는다. 문서 리스너를 직접 달지 않고 팝업 닫기 규약을 쓴다
  //   (메뉴 안에서 시작한 제스처는 그 훅이 "안"으로 판정해 살려 준다).
  useOutsidePressDismiss({
    onDismiss: () => setDockMenuOpen(false),
    enabled: dockMenuOpen,
    refs: [dockMenuRef],
    capture: false,
  });

  // 붙이기 메뉴가 열려 있으면 Esc 는 메뉴만 닫는다(document 에서 멈춰 창 닫기 Esc 까지 안 간다 — 읽기 설정 팝업과 같은 규약).
  // 일회성 팝업이라 (H-20)/(H-21) 과 다른 일이다.
  useEffect(() => {
    if (!dockMenuOpen) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || isComposingKeyEvent(e)) return;
      e.stopPropagation();
      setDockMenuOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dockMenuOpen]);

  /** 앱 밖 독립 창으로 꺼낼 수 있는가 — 오버레이 IPC 가 있는 데스크톱 앱만(이미 독립인 창 ❌). */
  const canPopOut = typeof window !== 'undefined' && !!window.api?.overlay && !fullWindow;

  /** 이 창이 보고 있는 프로젝트 — 꺼내기/되돌리기가 창을 찾을 때 쓰는 키. */
  const resolveProjectId = useCallback((): string | null => {
    const st = useGraphStore.getState();
    return overlayProjectId ?? (agentId ? st.agentProjects[agentId] : null) ?? st.activeProject;
  }, [overlayProjectId, agentId]);

  /** §5.5 #17-6 (H) — 자리를 옮길 때 들고 갈 짐. 없으면 받는 쪽이 새 창을 만들어 편집 탭이 닫히고 뷰가 첫 화면으로 돌아간다. */
  const captureHandoff = useCallback((): IDEPaneHandoff | null => {
    return captureIDEPaneHandoff(readIDEPane(paneKey));
  }, [paneKey]);

  /**
   * §5.5 #17-6 (H-25) — 선이 무장되면 창을 미리 짓는다(번들 파싱→WS→스냅샷→IDE 마운트는 초 단위라 뗌에 몰리면 무겁다).
   * 지어 둔 창은 숨긴다(main `warming` — 선과 겹치면 무엇이 진짜인지 모른다). 짐도 지금 맡긴다(눌린 동안 상태가 안 바뀐다). 실패하면 뗌에 짓는다.
   */
  const warmPopOutWindow = useCallback((size: { width: number; height: number }) => {
    const ov = window.api?.overlay;
    if (!ov?.warm || !agentId) return;
    const projectId = resolveProjectId();
    if (!projectId) return;
    void ov.warm({ agentId, projectId, size, handoff: captureHandoff() })
      .catch(() => { /* (H-25) ⑥ 빨라지지 않을 뿐 못 나가지는 않는다 */ });
  }, [agentId, resolveProjectId, captureHandoff]);

  /** §5.5 #17-6 (H-25) ⑤ — 안 나가고 끝난 판의 예열 창을 거둔다(남으면 다음 꺼내기가 그 빈 창을 재사용한다). main 은 예열 중인 창만 닫는다. */
  const cancelWarmPopOut = useCallback(() => {
    if (!agentId) return;
    void window.api?.overlay?.warmCancel?.(agentId).catch(() => { /* noop */ });
  }, [agentId]);

  /**
   * 앱 밖 **독립 창**으로 꺼낸다(§5.5 #17-6 오버레이 창을 IDE 크기로 바로 띄운다).
   * 앱 안 창은 함께 닫는다 — 같은 IDE 가 두 곳에 뜨면 어느 쪽이 진짜인지 알 수 없다.
   */
  const popOutToWindow = useCallback((opts?: {
    size?: { width: number; height: number };
    /**
     * §5.5 #17-6 (H-4) — 끄는 도중 꺼내면 새 창이 잡은 지점(`grab` = 좌상단→커서) 그대로 커서에 매달린다.
     * (H-17) `settled` 면 서기만 한다(손을 뗀 뒤라 매달면 커서를 따라다닌다).
     */
    follow?: { grabX: number; grabY: number; settled?: boolean };
  }) => {
    const ov = window.api?.overlay;
    if (!ov || !agentId) return;
    const projectId = resolveProjectId();
    if (!projectId) return;
    // 짐은 **닫기 전에** 뜬다 — 닫고 나면 읽을 슬롯이 없다.
    const handoff = captureHandoff();
    // §5.5 #17-6 (H-12) 이 창이 **되돌아올 때** 그릴 윤곽선에 적을 말을 지금 함께 맡긴다.
    //   main 에는 번역이 없고, 되돌아오는 판단은 main 이 커서를 폴링해 스스로 내리므로 그때
    //   렌더러에 물을 수가 없다(물어도 그 창은 닫히는 중이다).
    const follow = opts?.follow
      ? {
        ...opts.follow,
        label: agentLabelRef.current,
        hint: t('ide.overlay.redockDwellHint'),
      }
      : undefined;
    void ov.open({ agentId, projectId, expanded: true, size: opts?.size, handoff, follow })
      .catch(() => {
        // §5.5 #17-6 (H-10) **창이 서지 못한 판.** 앱 안 창은 바로 아래에서 이미 닫혔으므로,
        //   여기서 아무것도 하지 않으면 IDE 가 밖에도 안에도 없다(사용자에게는 통째로 사라진
        //   것이다). 매달릴 창이 없으니 선과 매달림을 먼저 걷고, 보던 그대로 앱 안에 다시 세운다.
        void window.api?.overlay?.ghostHide?.();
        void window.api?.overlay?.dragEndFor?.(agentId);
        //   `redock` — 이 길도 "밖 대신 앱 안에 세운다"는 뜻이다. 밖의 창은 서지 못했지만 그
        //   판정이 보는 목록은 아직 옛것일 수 있어, 표시가 없으면 세우지 않고 앞으로만 세운다.
        useGraphStore.getState().openIDEOverlay(agentId, { pane: 'new', handoff, handoffTarget: 'app', redock: true });
      });
    // 매달린 채 뜬 창은 손을 뗄 때 풀어 줘야 한다. 이 컴포넌트는 곧 닫히므로(아래) 리스너는
    //   모듈에 단다 — 컴포넌트에 달면 언마운트와 함께 사라져 창이 커서를 계속 따라다닌다.
    //   (H-17) 놓고 나서 태어난 창은 애초에 매달리지 않으므로 풀어 줄 것도 없다.
    if (opts?.follow && !opts.follow.settled) watchDetachedFollowRelease(agentId);
    // 이동한 뒤에는 밖의 창이 탭을 소유한다 — 앱에 옛 목록을 남기면 밖에서 닫은 탭이 되살아난다.
    useGraphStore.getState().closeIDEOverlay(paneKey, { rememberEditorTabs: false });
  }, [agentId, resolveProjectId, paneKey, captureHandoff, t]);

  // §5.5 #17-6 (H-21) — 종전의 [앱 안으로 되돌리기(↩)] 손잡이(클릭 되돌리기 + 칩 합치기 드래그)는
  //   **없앴다.** (H-20) 부터 닫기(✕/Esc)가 앱을 앞으로 세우고 이 창을 닫으므로 같은 결과로 가는
  //   손잡이가 둘이었다. IDE 를 열린 채 앱 안으로 옮기는 길은 타이틀바를 앱 안으로 끌어 넣는 (H-4) 하나다.

  /** 이 창을 맨 앞으로 — 누르는 순간 겹침 순서가 바뀐다(창이 여럿일 때만 뜻이 있다). */
  const bringToFront = useCallback(() => {
    if (paneKey) focusPane(paneKey);
  }, [paneKey, focusPane]);

  /**
   * 그 자리에 앉을 때 쓸 도크 두께 — **미리보기와 실제 커밋이 같은 계산을 읽는다**.
   * 그 변에 이미 칸이 있으면 그 두께를 물려받는다(한 칸을 나눠 쓰므로 두께는 변의 성질이다).
   */
  const dockSizeAtDrop = useCallback((target: DockDropTarget, others: DockedPane[], vp: Viewport): number => {
    const fallback = storeDockSide === target.side ? storeDockSize : defaultDockSize(target.side);
    return clampDockSize(target.side, dockSizeForDrop(target, others, fallback), vp, others);
  }, [storeDockSide, storeDockSize]);

  /**
   * 타이틀바 드래그 한 판 — 마우스로 시작하거나, (H-4) ③ 밖에서 끌던 드래그를 이어받는다(손이 눌린 채 돌아오므로 안 이으면 창이 안 움직인다).
   * ⚠ 본문 Alt 끌기는 두지 않는다 — Alt `pointerdown` 은 전역 인스펙터가 capture 에서 삼킨다.
   */
  const beginTitleDrag = useCallback((init: {
    /** 임계 판정의 기준점(마우스로 시작할 때). 이어받기에는 뜻이 없다. */
    startX: number;
    startY: number;
    /** 잡은 지점이 창 좌상단에서 얼마나 떨어졌는지 — 창 크기가 바뀌어도 그 비율을 유지한다. */
    grabRatioX: number;
    grabRatioY: number;
    /** 지금 창 크기(px). */
    width: number;
    height: number;
    /** 이미 손이 눌린 채 시작하는가 — 임계 6px 을 기다리지 않고 곧바로 커서를 따라간다. */
    resumed?: boolean;
    /**
     * 이어받는 순간의 커서 자리(창 안 좌표). 첫 `mousemove` 를 기다리면 그 한 프레임 동안 창이
     * **옛 자리**에 떴다가 손 아래로 튄다 — 깜빡인 것처럼 보인다.
     */
    cursor?: { x: number; y: number } | undefined;
  }) => {
    // §5.5 #17-6 (H-10) **앞 판이 남아 있으면 먼저 걷는다.** 앱 안 ↔ 밖을 빠르게 오가면 앞 판의
    //   뗌(mouseup)이 이미 닫힌 창으로 가 이 창에는 도착하지 않는다 — 그 판의 리스너가 살아 있는
    //   채로 새 판이 시작되면 한 번의 `mousemove` 를 둘이 듣고 창을 두 번 꺼내려 든다.
    activeDragCleanupRef.current?.();
    activeDragCleanupRef.current = null;
    // 붙을 수 있는 자리는 다른 창이 드래그 중 움직이지 않으므로 **여기서 한 번만** 잰다 —
    //   십자 위젯·미리보기·커밋이 모두 이 한 스냅샷을 읽어야 셋이 갈라지지 않는다.
    const dragVp = viewportNow();
    const others = otherDockedPanes();
    const st = useGraphStore.getState();
    const selfKey = resolvePaneKey(st, paneKey);
    // 자석이 붙을 선 중 **끄는 동안 안 움직이는** 것 — 붙어 있는 창의 칸. 화면 가장자리는
    //   `magnetFloatGeom` 이 스스로 넣는다. 떠 있는 창은 이제 밀리므로 그 선은 매 프레임 다시 잰다.
    const dockMagnetRects: Rect[] = Object.values(computeDockLayout(others, dragVp).rects);

    // ── (판올림 번호 발급 대기) §5.5 #17-1 자석 밀기 ──
    //   창끼리 부딪히면 선에 붙어 멎는 것이 아니라(종전) 상대가 밀려난다. 미는 창은 안 멎는다.
    /** 이 판이 시작될 때 그 창들이 있던 자리 — 밀림 offset 의 기준점. */
    const pushBase = new Map<string, FloatGeom>();
    /** 그 창들이 **지금 있어야 할** 자리(목표). 화면은 여기로 한 박자 늦게 따라붙는다. */
    const pushGoal = new Map<string, FloatGeom>();
    /** 화면에 실제로 반영된 밀림(px). 목표와 다르면 rAF 가 계속 따라간다. */
    const pushShown = new Map<string, { dx: number; dy: number }>();
    /** 지난 프레임에 정한 밀림 방향 — 되먹여 축이 도중에 뒤집히지 않게 한다. */
    let pushDirs: Record<string, FloatPushDir> = {};
    let pushRaf: number | null = null;
    for (const p of listFloatPushPanes(selfKey)) {
      pushBase.set(p.key, p.geom);
      pushGoal.set(p.key, p.geom);
    }

    /** 그 창이 아직 가야 할 거리 — 이 값이 곧 그 창에 걸린 밀림 offset 이다. */
    function pushWant(key: string): { dx: number; dy: number } {
      const base = pushBase.get(key);
      if (!base) return { dx: 0, dy: 0 };
      const goal = pushGoal.get(key) ?? base;
      return { dx: goal.x - base.x, dy: goal.y - base.y };
    }

    /** 한 프레임 — 밀린 창들을 목표 쪽으로 `PUSH_EASE` 만큼 옮긴다(즉시 이동은 순간이동으로 읽힌다). */
    function pushFrame(): void {
      pushRaf = null;
      let busy = false;
      for (const key of pushBase.keys()) {
        const want = pushWant(key);
        const now = pushShown.get(key) ?? { dx: 0, dy: 0 };
        const step = easeFloatPushOffset(now, want);
        if (step.dx !== now.dx || step.dy !== now.dy) {
          pushShown.set(key, { dx: step.dx, dy: step.dy });
          moveFloatPushPane(key, step.dx, step.dy);
        }
        if (!step.done) busy = true;
      }
      if (busy) pushRaf = window.requestAnimationFrame(pushFrame);
    }

    /** 이 자리로 끌면 어느 창이 밀리는가 — 목표만 갱신하고 화면은 rAF 가 따라간다. */
    function applyPush(geom: FloatGeom, vp: Viewport): Set<string> {
      if (pushGoal.size === 0) return new Set();
      const res = pushFloatGeoms(geom, [...pushGoal].map(([key, g]) => ({ key, geom: g })), vp, pushDirs);
      pushDirs = res.dirs;
      const hit = new Set<string>();
      for (const [key, next] of Object.entries(res.geoms)) {
        pushGoal.set(key, next);
        hit.add(key);
      }
      if (hit.size > 0 && pushRaf === null) pushRaf = window.requestAnimationFrame(pushFrame);
      return hit;
    }

    /** 지금 자석이 붙을 선 — **밀고 있는 창은 뺀다**(밀면서 동시에 그 창에 붙을 수는 없다). */
    function magnetRectsNow(pushing: Set<string>): Rect[] {
      const out: Rect[] = [...dockMagnetRects];
      for (const [key, g] of pushGoal) {
        if (pushing.has(key)) continue;
        out.push({ x: g.x, y: g.y, w: g.w, h: g.h });
      }
      return out;
    }

    /** 판이 끝났다 — 밀어 둔 만큼을 그 창들의 **제 자리**로 굳힌다(밀린 배치도 사용자가 만든 배치다). */
    function settlePush(): void {
      if (pushRaf !== null) { window.cancelAnimationFrame(pushRaf); pushRaf = null; }
      for (const key of pushBase.keys()) {
        const want = pushWant(key);
        settleFloatPushPane(key, want.dx, want.dy);
      }
      pushBase.clear();
      pushGoal.clear();
      pushShown.clear();
      pushDirs = {};
    }

    let dragging = false;
    let currentMode = mode;
    let currentMaximized = maximized;
    let nextW = init.width;
    let nextH = init.height;
    /** 지금 커서가 가리키는 도킹 자리 — mouseup 이 이 값 하나로 붙일지 말지를 정한다. */
    let dropAt: DockDropTarget | null = null;
    /**
     * §5.5 #17-6 (H-11) 들어온 벽 잠금 — 이어받은 판에서만. 되돌아오는 문턱(48px)이 스냅 폭(≥120px) 안이라
     * 들여놓자마자 떼면 그 벽에 붙는다 — 그 벽 하나만 잠근다.
     */
    let entryLock: DockEntryLock | null = null;
    /**
     * 잠금은 **첫 이동에서** 건다. 이어받는 순간의 커서를 모를 수도 있고(창 밖이면 안 넘어온다),
     * 붙일지 말지는 어차피 이동이 한 번은 와야 정해진다(`dropAt` 은 `handleMove` 가 쓴다).
     */
    let entryLockPending = init.resumed === true;
    /** 지금 화면(십자 버튼)에 알려 둔 잠긴 변 — 바뀔 때만 상태를 건드리려고 들고 있는다. */
    let lockSideShown: IDEDockSide | null = null;
    /** 이동이 끝났을 때 슬롯에 적어 둘 자리 — 상태가 아니라 여기서 들고 있어야 mouseup 이 읽는다. */
    let lastGeom: FloatGeom | null = null;
    let lastGuides: { x: number | null; y: number | null } = { x: null, y: null };
    /** 이 판이 이미 앱 밖으로 나갔는가 — 나가면 이 창은 닫히므로 뒤따르는 신호를 전부 무시한다. */
    let poppedOut = false;
    /** (H-6) 밖으로 빼는 중인가 · `ghostKind` 는 선을 누가 그리나(`os` = main 의 클릭통과 창, `inapp` = 앱 경계에서 잘리는 폴백). */
    let ghostOn = false;
    let ghostKind: 'os' | 'inapp' = 'inapp';
    let ghostArmed = false;
    /**
     * §5.5 #17-6 (H-22) 이 판이 앱 밖을 밟았는가 — 밟았으면 도로 들어와도 손을 뗄 때까지 선이다(아니면 숨은 본체가 나타나 한 손짓에 그림이 두 번 바뀐다).
     * 걸쇠는 선만 세우고 무장하지 않는다 — 도로 들어와 놓으면 `armed` 는 거짓(선이 흐려진다).
     */
    let ghostEscaped = false;
    /**
     * (H-25) ⑤ 이 판의 예열 걸쇠 — 짓기·거두기를 한 곳이 쥔다(무장은 켜졌다 꺼졌다 하고, 판이 끝나는 자리 넷이 각자 정하면 한쪽만 고쳐진다).
     * 크기는 `build` 가 불리는 순간 값.
     */
    const warmLatch = createPopOutWarmLatch({
      build: () => warmPopOutWindow({ width: Math.round(nextW), height: Math.round(nextH) }),
      discard: cancelWarmPopOut,
    });
    /** 윤곽선을 그 변 밖으로 밀어 낸 여분(px) — 가장자리 버팀 동안 자란다(H-6 ④). */
    let ghostPush = { dx: 0, dy: 0 };
    /** (H-7) main 에 부탁한 OS 윤곽선이 섰는지 기다리는 손잡이 — 팝아웃은 그 뒤에 앱 안 창을 닫는다(바로 닫으면 손 아래가 빈다). */
    let ghostShowPending: Promise<boolean> | null = null;

    /** 윤곽선을 세워 달라는 부탁 한 번 — 크기·잡은 지점은 이 판의 값 그대로. */
    function requestOsGhost(armed: boolean): Promise<boolean> | null {
      const ov = window.api?.overlay;
      if (!ov?.ghostShow) return null;
      return ov.ghostShow({
        width: Math.round(nextW),
        height: Math.round(nextH),
        grabX: Math.round(init.grabRatioX * nextW),
        grabY: Math.round(init.grabRatioY * nextH),
        label: agentLabelRef.current,
        armed,
        // (H-19) 나가는 길의 말도 선이 한다 — 본체가 숨으므로 앱 안 안내 띠는 이제 없다.
        //   앱 안 윤곽선과 같은 문구라, 선이 앱 밖으로 이어질 때 말이 바뀌지 않는다.
        hint: armed ? t('ide.overlay.popOutGhostArmedHint') : t('ide.overlay.popOutGhostHint'),
      });
    }

    /** main 이 그리는 윤곽선의 크기·잡은 지점·무장 여부를 갈아 끼운다(여러 번 불러도 안전). */
    function syncOsGhost(): void {
      if (ghostKind !== 'os') return;
      void requestOsGhost(ghostArmed);
    }

    /** (H-22) 선이 서 있는 동안 main 에 끄는 중이라 알려 수명 그물을 다시 재게 한다(같은 부탁의 반복 — 창은 다시 안 만든다). `inapp` 에는 그물이 없다. */
    let ghostKeepAlive: number | null = null;
    function startGhostKeepAlive(): void {
      if (ghostKeepAlive !== null) return;
      ghostKeepAlive = window.setInterval(() => {
        if (!ghostOn || ghostKind !== 'os') return;
        void requestOsGhost(ghostArmed);
      }, GHOST_KEEPALIVE_MS);
    }
    function stopGhostKeepAlive(): void {
      if (ghostKeepAlive === null) return;
      window.clearInterval(ghostKeepAlive);
      ghostKeepAlive = null;
    }

    function showGhost(rect: FloatGeom, armed: boolean): void {
      ghostRectRef.current = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
      const armChanged = ghostOn && armed !== ghostArmed;
      ghostArmed = armed;
      if (!ghostOn) {
        ghostOn = true;
        // (H-22) 이 판이 사는 동안 main 의 수명 그물을 다시 재게 한다(손 아래에서 걷히지 않게).
        startGhostKeepAlive();
        // 선은 이 프레임에 떠야 한다 — OS 창(백 밀리초 남짓)을 기다리면 손 아래가 빈다. 앱 안 윤곽선으로 먼저 그리고 OS 창이 서면 넘긴다(같은 자리라 안 보인다).
        ghostKind = 'inapp';
        setPopOutGhost({ kind: 'inapp', armed });
        const pending = requestOsGhost(armed);
        if (pending) {
          // (H-7) 팝아웃이 이 부탁을 기다릴 수 있게 손잡이를 남긴다(같은 부탁을 두 번 하지 않게).
          ghostShowPending = pending;
          void pending.then((ok) => {
            // 못 만들었거나(컴포지터 없는 환경 등) 그 사이 판이 끝났으면 앱 안 윤곽선 그대로 둔다.
            if (!ok || !ghostOn) return;
            ghostKind = 'os';
            setPopOutGhost({ kind: 'os', armed: ghostArmed });
          }).catch(() => { /* 앱 안 윤곽선으로 계속 간다 */ });
        }
      } else if (armChanged) {
        setPopOutGhost({ kind: ghostKind, armed });
        syncOsGhost();
      }
      if (ghostKind === 'inapp') scheduleDragFrame();
      // (H-25) ① **무장된 순간이 미리 지을 자리다** — `armed` 는 (H-17) 이 정한 "지금 놓으면
      //   여기"라 나갈 뜻이 가장 분명하다. 선이 처음 뜨는 순간은 이르다(클램프를 조금 넘겼을
      //   뿐 도로 앉을 판이 섞여 있다).
      if (armed && canPopOut) warmLatch.arm();
    }

    /** 선을 걷는다(밖으로 나간 경우는 main 이). (H-22) 도로 들어온 것은 이유가 아니다 — 남은 이유는 뗌·판 정리, 밖을 밟지 않고 켜진 선이 이유를 잃은 때뿐. */
    function hideGhost(): void {
      if (!ghostOn) return;
      ghostOn = false;
      ghostArmed = false;
      stopGhostKeepAlive();
      ghostPush = { dx: 0, dy: 0 };
      ghostShowPending = null;
      ghostRectRef.current = null;
      setPopOutGhost(null);
      void window.api?.overlay?.ghostHide?.();
    }

    /**
     * §5.5 #17-6 (H-3)+(H-6) 화면 끝에 막힌 손의 버팀 시계. 가장자리를 떠나면 되돌린다(스쳐 간 손이 창을 던지면 안 된다).
     * 먼저 선을 보여 주고(`EDGE_GHOST_MS`) 남은 동안 변 밖으로 밀다가 끝나면 무장한다.
     */
    let edgeTimer: number | null = null;
    let edgeStartedAt = 0;
    /** 이 판의 버팀 길이 — 선이 **이미** 떠 있었다면 처음부터 다시 기다리지 않는다. */
    let edgeSpan: number = IDE_FLOAT.POP_OUT_EDGE_DWELL_MS;
    /** 그 변 밖으로 완전히 나가려면 얼마나 밀어야 하는가(px). */
    let edgeTarget = { dx: 0, dy: 0 };
    /** (H-17) 버팀을 다 채웠다 — 선이 밝아질 뿐, 나가는 것은 뗄 때다. 가장자리를 떠나면 풀린다. */
    let edgeArmed = false;

    /** @param opts.keepPush 밀어 낸 만큼을 그대로 둔다(판이 끝날 때만) — 무장한 채 떼면 그 자리가 창이 설 자리라, 0 으로 되돌리면 선이 튀고 창이 엉뚱한 곳에 선다. */
    function clearEdgeWatch(opts?: { keepPush?: boolean }): void {
      if (edgeTimer !== null) { window.clearInterval(edgeTimer); edgeTimer = null; }
      edgeStartedAt = 0;
      edgeArmed = false;
      if (opts?.keepPush) return;
      // 가장자리를 떠났으면 밀어 냈던 만큼도 되돌린다 — 안 되돌리면 선이 그 자리에 어긋난 채 남는다.
      if (ghostPush.dx !== 0 || ghostPush.dy !== 0) {
        ghostPush = { dx: 0, dy: 0 };
        if (ghostKind === 'os') void window.api?.overlay?.ghostNudge?.({ dx: 0, dy: 0 });
      }
    }
    /**
     * (H-8) 밖으로 나갔다는 소식을 main 에게서 듣는 귀. 이어받은 판(H-4 ③)은 마우스 캡처가 없어 창 밖 커서를 모른다 — main 이 대신 본다
     * (캡처가 언제 사라지는지는 OS 마다 달라 늘 단다). (H-17) 선을 세우고 밝히기만 한다 — 여기서 꺼내면 눌린 채 창이 바뀐다.
     */
    let offEscape: (() => void) | null = null;
    function stopEscapeWatch(): void {
      if (offEscape) { offEscape(); offEscape = null; }
      void window.api?.overlay?.paneDragWatch?.(false);
    }
    function startEscapeWatch(): void {
      const ov = window.api?.overlay;
      if (!ov?.paneDragWatch || !ov.onPaneDragEscape || offEscape) return;
      offEscape = ov.onPaneDragEscape(({ cursor }) => {
        if (poppedOut || !dragging) return;
        // 화면 좌표를 창 안 좌표로 옮긴다(`window.screenX/Y` = 이 창의 콘텐츠 좌상단) — 그래야
        //   새 창이 손 아래 그대로 앉고, 윤곽선도 같은 자리를 그린다.
        const client = { x: cursor.x - window.screenX, y: cursor.y - window.screenY };
        lastCursor = client;
        lastRaw = dragFloatGeom({
          x: client.x - init.grabRatioX * nextW,
          y: client.y - init.grabRatioY * nextH,
          w: nextW,
          h: nextH,
        }, viewportNow());
        // (H-17) 여기서도 나가지 않는다 — 선을 세우고 무장까지만 한다(확정은 뗌 한 곳).
        //   이 귀가 있는 까닭은 커서가 창 밖으로 나가면 `mousemove` 가 끊기는 판이 있기
        //   때문이고, 그런 판에서도 선은 손을 따라가야 하기 때문이다.
        refreshGhost();
      });
      void ov.paneDragWatch(true);
    }

    function detach(opts?: { keepGhostPush?: boolean }): void {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      clearEdgeWatch({ keepPush: opts?.keepGhostPush });
      stopEscapeWatch();
      // (H-22) 나가는 길이면 선은 남지만(인계는 main 이 한다) 이 판의 알림은 여기서 멎는다.
      stopGhostKeepAlive();
      // 밀어 둔 창들을 여기서 굳힌다 — 손을 떼든 밖으로 빠져나가든 이 자리는 반드시 지난다.
      settlePush();
      activeDragCleanupRef.current = null;
    }
    /** 끌면서 띄웠던 안내(도킹 십자·미리보기·자석선)를 한꺼번에 걷는다. */
    function clearDragVisuals(): void {
      setSnapRect(null);
      setZoneButtons([]);
      setDropTarget(null);
      setMagnetGuides({ x: null, y: null });
      // (H-11) 잠금은 **한 판짜리**다 — 판이 끝나면 함께 걷는다(다음 판은 잠기지 않은 채 시작한다).
      entryLock = null;
      entryLockPending = false;
      if (lockSideShown !== null) {
        lockSideShown = null;
        setDockLockSide(null);
      }
    }

    /**
     * §5.5 #17-6 (H-17) — 경계를 넘을 때가 아니라 **손을 뗄 때** 독립 창으로 바꾼다(넘을 때면 한 손짓에 나갔다 들어왔다 한다).
     * 그동안 화면엔 선 하나, 앱 안 창은 함께 닫는다. `settled` = 손이 떠났다 — 커서에 매달지 않고 선 자리에 세운다.
     * (H-6) ⑤ 윤곽선은 끄지 않는다(새 창이 보일 때 main 이 걷는다) · 밀어 낸 만큼을 빼 넘긴다.
     * (H-7) 선이 없으면(손이 빠른 판) 여기서 세우고 선 뒤에 앱 안 창을 닫는다 — 아니면 손 아래가 빈다.
     */
    function popOutNow(opts?: { settled?: boolean }): void {
      if (poppedOut) return;
      poppedOut = true;
      // (H-25) ⑤ 미리 지어 둔 창을 **쓰는** 판이다 — 거두지 않는다(그 창이 곧 사용자가 볼 창이다).
      //   걸쇠를 여기서 내려 두면 아래 `detach` 뒤의 정리 경로들이 그것을 닫지 않는다.
      warmLatch.settle(true);
      const settled = !!opts?.settled;
      // 밀어 냈던 만큼을 **먼저** 뜬다 — `detach()` 안의 시계 정리가 그 값을 0 으로 되돌린다.
      const push = { dx: ghostPush.dx, dy: ghostPush.dy };
      detach({ keepGhostPush: true });
      clearDragVisuals();
      // (H-7) 선이 아직 안 섰으면 지금 세운다 — 이미 부탁해 둔 것이 있으면 그것을 기다린다
      //   (같은 부탁을 두 번 하면 main 이 창을 만들었다 지웠다 한다).
      const standing: Promise<unknown> | null = ghostKind === 'os' && ghostOn
        ? null
        : (ghostShowPending ?? requestOsGhost(true));
      let handedOff = false;
      /** 선이 서기를 기다리는 사이에 손을 뗐는가 — 그 뗌은 아직 아무도 듣고 있지 않다. */
      let releasedWhileWaiting = false;
      // 뗌을 듣는 리스너는 `popOutToWindow` 가 창을 넘긴 **뒤에** 달린다. 그 사이의 뗌을 여기서
      //   받아 두었다가 넘긴 직후에 풀어 주지 않으면, 새 창이 손을 뗀 뒤에도 커서를 따라다닌다.
      function onEarlyRelease(): void {
        releasedWhileWaiting = true;
        handOff();
      }
      const handOff = (): void => {
        if (handedOff) return;
        handedOff = true;
        window.removeEventListener('mouseup', onEarlyRelease, true);
        // 선은 main 이 걷는다 — 여기서 ghostHide 를 부르면 빈 화면이 생긴다. (H-19) `popOutGhost` 도 내리지 않는다(숨긴 본체가 새 창이 서기까지 번쩍인다) —
        // 본체는 `closeOverlay` 까지 숨긴다.
        ghostOn = false;
        popOutToWindow({
          size: { width: Math.round(nextW), height: Math.round(nextH) },
          // 잡은 지점에서 밀어 낸 만큼을 빼 넘기므로, 새 창은 **선이 서 있던 바로 그 자리**에 선다.
          //   (H-17) `settled` 면 그 자리에 서기만 하고 커서를 따라가지는 않는다(손이 이미 떠났다).
          follow: {
            grabX: Math.round(init.grabRatioX * nextW - push.dx),
            grabY: Math.round(init.grabRatioY * nextH - push.dy),
            settled,
          },
        });
        if (releasedWhileWaiting && agentId) void window.api?.overlay?.dragEndFor?.(agentId);
      };
      if (!standing) { handOff(); return; }
      window.addEventListener('mouseup', onEarlyRelease, true);
      // 대답이 영영 안 와도 창이 멎은 채 갇히지는 않게 — 짧은 그물 하나(왕복은 보통 한 프레임).
      window.setTimeout(handOff, POP_OUT_GHOST_WAIT_MS);
      void standing.then(handOff, handOff);
    }

    /** 끌기 시작(또는 이어받기)에 딱 한 번 — 붙어 있거나 최대화·모달이던 창을 떠 있는 창으로. */
    function enterFloating(): void {
      // 붙을 수 있는 자리를 **실제로 끌기 시작한 뒤**에 띄운다 — 그냥 눌렀다 뗀 클릭에 번쩍이지 않게.
      if (!disableDock) setZoneButtons(dockZoneButtons(dragVp, others));
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

    /** 가두지 않은 **지금** 자리 — 윤곽선 판정과 버팀 시계가 함께 읽는다(둘이 갈리면 말이 달라진다). */
    let lastRaw: FloatGeom | null = null;
    /**
     * (H-7) 마지막으로 본 커서 자리(앱 창 안 좌표). 윤곽선 판정이 **창 자리만으로는 모자라**
     * 함께 읽는다 — 잡은 지점 때문에 창은 아직 안쪽인데 손은 이미 밖인 순간이 있다.
     */
    let lastCursor: { x: number; y: number } | null = null;
    /**
     * (H-6) ② 이 판의 **기준점**. 상태(`floatPos`)는 여기 한 번만 쓰고, 그 뒤의 이동은 전부
     * `dragOffsetRef` + `transform` 이다 — `mousemove` 마다 상태를 바꾸면 창 전체가 다시 그려진다.
     */
    let dragBase: { x: number; y: number } | null = null;

    /** 가장자리 버팀 동안 윤곽선을 그 변 밖으로 밀어 낼 방향(px) — 어디로 빠지는지만 말하면 된다. */
    function edgeNudgeTarget(cursor: { x: number; y: number }, vp: Viewport): { dx: number; dy: number } {
      const e = IDE_FLOAT.POP_OUT_EDGE_PX;
      if (cursor.x >= vp.w - 1 - e) return { dx: EDGE_NUDGE_PX, dy: 0 };
      if (cursor.x <= e) return { dx: -EDGE_NUDGE_PX, dy: 0 };
      if (cursor.y >= vp.h - 1 - e) return { dx: 0, dy: EDGE_NUDGE_PX };
      if (cursor.y <= e) return { dx: 0, dy: -EDGE_NUDGE_PX };
      return { dx: 0, dy: 0 };
    }

    /** (H-6) ③ 지금 선을 그리나 — 한 곳에서만 정한다(켜는 이유 셋의 판정이 흩어지면 켜고 끄기가 엇갈려 깜빡인다). 문턱은 순수 함수 `popOutGhostDecision`. */
    function refreshGhost(): void {
      if (poppedOut || !lastRaw) return;
      const vp = viewportNow();
      const byEdge = edgeTimer !== null && Date.now() - edgeStartedAt >= EDGE_GHOST_MS;
      const want = popOutGhostDecision({
        geom: lastRaw,
        cursor: lastCursor ?? { x: lastRaw.x, y: lastRaw.y },
        vp,
        edgeDwell: byEdge,
        // (H-17) 버팀을 다 채웠으면 선을 밝힌다 — 나가는 것은 손을 뗄 때다.
        edgeArmed,
        // (H-22) 이미 앱 밖을 밟은 판이면 도로 들어와도 선을 세워 둔다.
        escaped: ghostEscaped,
      });
      // 걸쇠는 판정 **뒤에** 문다 — 이번 프레임의 답은 지금 자리가 정한다(걸쇠가 앞지르지 않게).
      if (canPopOut && want.outside) ghostEscaped = true;
      if (canPopOut && want.show) showGhost(lastRaw, want.armed);
      else hideGhost();
    }

    function startEdgeWatch(cursor: { x: number; y: number }, vp: Viewport): void {
      edgeStartedAt = Date.now();
      // 선이 **이미** 떠 있으면 처음부터 다시 기다리지 않는다 — 밖으로 밀어냈다는 신호가 화면에 있다.
      edgeSpan = ghostOn ? IDE_FLOAT.POP_OUT_EDGE_DWELL_ARMED_MS : IDE_FLOAT.POP_OUT_EDGE_DWELL_MS;
      edgeTarget = edgeNudgeTarget(cursor, vp);
      edgeTimer = window.setInterval(() => {
        if (poppedOut) { clearEdgeWatch(); return; }
        const elapsed = Date.now() - edgeStartedAt;
        refreshGhost();
        if (ghostOn) {
          // 버팀이 진행된 만큼 선을 그 변 밖으로 밀어 낸다 — 커서가 화면 끝에 막힌 사람에게도
          //   "지금 밖으로 빠지고 있다"가 눈에 보인다(기다리는 동안 보이는 것이 약속뿐이면 안 된다).
          const from = Math.min(EDGE_GHOST_MS, edgeSpan);
          const p = Math.max(0, Math.min(1, (elapsed - from) / Math.max(1, edgeSpan - from)));
          ghostPush = { dx: edgeTarget.dx * p, dy: edgeTarget.dy * p };
          if (ghostKind === 'os') {
            void window.api?.overlay?.ghostNudge?.({
              dx: Math.round(ghostPush.dx),
              dy: Math.round(ghostPush.dy),
            });
          } else if (lastRaw) {
            ghostRectRef.current = {
              x: lastRaw.x + ghostPush.dx,
              y: lastRaw.y + ghostPush.dy,
              w: lastRaw.w,
              h: lastRaw.h,
            };
            scheduleDragFrame();
          }
        }
        if (elapsed >= edgeSpan && !edgeArmed) {
          // (H-17) 버팀 끝 = 무장. 시계는 계속 돌린다 — 멈추면 `!pinned` 갈래가 버팀을 다시 재 무장이 깜빡인다.
          edgeArmed = true;
          refreshGhost();
        }
      }, EDGE_TICK_MS);
    }

    function handleMove(ev: MouseEvent): void {
      if (poppedOut) return;
      // 이어받은 판은 **손이 이미 눌린 채** 시작한다 — 창이 바뀌는 그 찰나에 손을 놓았다면 뗌
      //   신호는 사라진 창으로 갔다. 눌리지 않은 채 움직이면 이미 놓은 것이다(유령 드래그 ❌).
      if (init.resumed && ev.buttons === 0) { handleUp(); return; }
      const dx = ev.clientX - init.startX;
      const dy = ev.clientY - init.startY;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        dragging = true;
        enterFloating();
        if (canPopOut) startEscapeWatch();
      }
      const vp = viewportNow();
      // (H-6) ① **끄는 동안에는 가두지 않는다.** `clampFloatGeom` 은 결과를 위한 안전망이라
      //   손을 뗄 때만 건다 — 과정에 걸면 창이 `KEEP_VISIBLE` 선에서 멎어 손과 어긋난다.
      const raw = dragFloatGeom({
        x: ev.clientX - init.grabRatioX * nextW,
        y: ev.clientY - init.grabRatioY * nextH,
        w: nextW,
        h: nextH,
      }, vp);
      lastRaw = raw;
      lastCursor = { x: ev.clientX, y: ev.clientY };
      if (!dragBase) {
        // 이 판의 기준점 — 상태 쓰기는 여기 한 번뿐이다(모달에서 막 떠 온 창의 옛 좌표도 여기서 맞는다).
        dragBase = { x: raw.x, y: raw.y };
        dragOffsetRef.current = { dx: 0, dy: 0 };
        lastGeom = raw;
        setFloatPos({ x: raw.x, y: raw.y });
      }

      // §5.5 #17-6 (H-4)+(H-6) ④ 완전히 나갔다(커서가 앱 밖이거나 창이 앱과 안 겹친다). (H-17) 이것은 무장일 뿐 나가는 것은 뗄 때다 —
      // 여기서는 도킹·자석만 쉰다(`ghostOn` 갈래).
      const cursorNow = { x: ev.clientX, y: ev.clientY };
      // 단일 모니터에 앱이 최대화돼 있으면 커서는 한 픽셀도 밖으로 못 나간다 — 그 사람에게는 위 판정이
      //   영영 참이 되지 않아 끌어내기가 **없는 기능**이었다(H-3). 화면 끝에 막힌 채 잠깐 버티는 것을
      //   같은 뜻으로 읽어, 화면 수와 창 상태에 관계없이 같은 손짓이 닿게 한다.
      const pinned = canPopOut && isPinnedToViewportEdge(cursorNow, vp);
      if (!pinned) clearEdgeWatch();
      else if (edgeTimer === null) startEdgeWatch(cursorNow, vp);

      refreshGhost();
      if (ghostOn) {
        // (H-6) ③ 밖으로 빼는 중 — 선이 따라간다. 도킹·자석은 쉰다(그때 정해진 것은
        //   "밖으로 나간다" 하나다 — 파란 도킹 미리보기와 함께 뜨면 무엇이 일어날지 말이 갈린다).
        if (dropAt) { dropAt = null; setDropTarget(null); setSnapRect(null); }
        if (lastGuides.x !== null || lastGuides.y !== null) {
          lastGuides = { x: null, y: null };
          setMagnetGuides(lastGuides);
        }
        // (H-19) 본체는 숨은 채 손을 따라온다(멎으면 잔상) — 선이 꺼질 때 옛 자리가 아니라 손 아래에 다시 나타나야 한다.
        lastGeom = raw;
        dragOffsetRef.current = { dx: raw.x - dragBase.x, dy: raw.y - dragBase.y };
        scheduleDragFrame();
        return;
      }

      let moved = raw;
      // (H-11) **들어온 벽의 잠금**을 한 프레임 진행시킨다 — 첫 이동에서 걸고, 안으로 들어오거나
      //   그 자리에서 버티면 풀린다. 잠긴 동안 그 변의 판정만 없던 것이 된다(나머지 셋은 그대로).
      if (entryLockPending) {
        entryLockPending = false;
        entryLock = beginDockEntryLock(cursorNow, vp, Date.now());
      } else if (entryLock) {
        entryLock = stepDockEntryLock(entryLock, cursorNow, vp, Date.now());
      }
      // 화면에 알리는 것은 **바뀔 때 한 번** — 버팀을 다시 잴 때마다 새 객체가 나오므로,
      //   그대로 상태에 쓰면 끄는 내내 리렌더가 붙는다(이 판이 ref+transform 을 쓰는 이유가 그것이다).
      if ((entryLock?.side ?? null) !== lockSideShown) {
        lockSideShown = entryLock?.side ?? null;
        setDockLockSide(lockSideShown);
      }
      // 도킹 자리 — 네 변 + **붙어 있는 칸 위**(가운데는 탭 합류, 앞뒤 띠는 새 칸).
      //   자리가 바뀔 때만 미리보기를 다시 잰다(매 프레임 새 객체를 넣으면 드래그 내내 리렌더가 붙는다).
      const nextTarget = disableDock
        ? null
        : applyDockEntryLock(resolveDockDrop({ x: ev.clientX, y: ev.clientY }, vp, others), entryLock);
      if (!sameDockTarget(nextTarget, dropAt)) {
        dropAt = nextTarget;
        setDropTarget(nextTarget);
        setSnapRect(nextTarget
          ? previewDockRect(nextTarget, vp, others, dockSizeAtDrop(nextTarget, others, vp))
          : null);
      }
      // 붙을 자리를 겨누는 동안에는 밀기·자석을 함께 끈다 — 미리보기가 이미 자리를 말한다.
      if (!dropAt) {
        // 밀기가 자석보다 먼저 — `PUSH_GAP`(12px) 안의 창은 밀려나고 미는 창은 멎지 않는다. `PUSH_GAP` > `MAGNET_PX` 라 떠 있는 창끼리는 자석이 안 걸린다.
        const pushing = applyPush(moved, vp);
        const magnet = magnetFloatGeom(moved, magnetRectsNow(pushing), vp);
        moved = magnet.geom;
        // 자석이 마지막 몇 px 을 옮겼으면 그만큼 더 민다 — 한 프레임 늦게 따라오면 창이 겹쳐 보인다.
        if (moved.x !== raw.x || moved.y !== raw.y) applyPush(moved, vp);
        if (magnet.guideX !== lastGuides.x || magnet.guideY !== lastGuides.y) {
          lastGuides = { x: magnet.guideX, y: magnet.guideY };
          setMagnetGuides(lastGuides);
        }
      } else if (lastGuides.x !== null || lastGuides.y !== null) {
        lastGuides = { x: null, y: null };
        setMagnetGuides(lastGuides);
      }
      lastGeom = moved;
      // (H-6) ② 자리는 상태가 아니라 ref 에 적고 rAF 가 `transform` 으로 DOM 에 직접 쓴다.
      dragOffsetRef.current = { dx: moved.x - dragBase.x, dy: moved.y - dragBase.y };
      scheduleDragFrame();
    }

    function handleUp(): void {
      if (poppedOut) return; // 이미 밖으로 나갔다 — 이 창은 닫히는 중이다.
      const wasArmed = ghostOn && ghostArmed;
      const goingOut = wasArmed && canPopOut;
      // (H-17) 나가는 판이면 밀어 낸 만큼을 **살려 둔 채** 정리한다 — 그 자리가 곧 창이 설 자리다.
      detach({ keepGhostPush: goingOut });
      clearDragVisuals();
      if (!dragging) { hideGhost(); warmLatch.settle(false); return; }
      // (H-6) ④ 선이 **무장한 채** 손을 뗐다 = 여기까지 끌었으면 밖으로 뺀다는 뜻 말고 없다.
      // (H-17) 이제 이 자리가 나가는 **유일한** 자리다(끄는 도중에는 어떤 이유로도 나가지 않는다).
      if (goingOut) { popOutNow({ settled: true }); return; }
      hideGhost();
      // (H-25) ⑤ 나가지 않기로 끝난 판이다 — 미리 지어 둔 창을 거둔다. 안 거두면 쓰지도 않을
      //   창이 남아, 이 IDE 를 다음에 꺼낼 때 재사용 갈래가 그 빈 창을 집는다.
      warmLatch.settle(false);
      // (H-6) ① 안전망은 **여기서** 한 번 건다 — 끄는 동안 가두지 않았으므로 놓인 자리를 되돌린다.
      if (lastGeom) {
        const landed = clampFloatGeom(lastGeom, viewportNow());
        lastGeom = landed;
        dragOffsetRef.current = { dx: 0, dy: 0 };
        setFloatPos({ x: landed.x, y: landed.y });
      }
      if (!dropAt) {
        // 붙이지 않고 놓았다 = 사용자가 정한 자리다. 접었다 펴거나 탭을 옮겨도 그대로여야 한다.
        if (lastGeom) commitFloat(lastGeom);
        return;
      }
      setPaneDock(paneKey, {
        side: dropAt.side,
        size: dockSizeAtDrop(dropAt, others, viewportNow()),
        // 탭 합류면 그 칸의 번호를 **그대로** 물려받는다(같은 값 = 한 칸을 나눠 쓴다는 뜻).
        order: dockOrderForDrop(dropAt, others),
      });
      setMode('docked');
    }

    if (init.resumed) {
      // 이어받기 — 손은 이미 눌린 채다. 임계 6px 을 기다리면 그동안 창이 커서에서 떨어져 있다.
      dragging = true;
      enterFloating();
      // (H-8) **이 판이 감시가 꼭 필요한 판이다.** 눌린 곳이 이미 닫힌 창이라 이 창에는 마우스
      //   캡처가 없다 — 커서가 밖으로 나가면 아래 `mousemove` 가 더는 오지 않는다.
      if (canPopOut) startEscapeWatch();
      // 알고 있으면 **지금** 손 아래에 앉힌다(화면 밖 좌표면 손대지 않는다 — 첫 이동이 잡아 준다).
      const vp = viewportNow();
      if (init.cursor && init.cursor.x >= 0 && init.cursor.y >= 0
        && init.cursor.x <= vp.w && init.cursor.y <= vp.h) {
        const geom = clampFloatGeom({
          x: init.cursor.x - init.grabRatioX * nextW,
          y: init.cursor.y - init.grabRatioY * nextH,
          w: nextW,
          h: nextH,
        }, vp);
        lastGeom = geom;
        lastRaw = geom;
        // (H-6) ② 이어받은 판의 기준점도 여기서 정해진다 — 그 뒤 이동은 전부 `transform` 이다.
        dragBase = { x: geom.x, y: geom.y };
        dragOffsetRef.current = { dx: 0, dy: 0 };
        setFloatPos({ x: geom.x, y: geom.y });
      }
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    activeDragCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      clearEdgeWatch();
      // (H-8) 언마운트로 판이 끊겨도 main 의 감시가 남지 않게(고아 타이머 ❌).
      stopEscapeWatch();
      stopGhostKeepAlive();
      // (H-6) 언마운트로 판이 끊겨도 선은 남지 않는다 — 클릭통과 창이라 사용자가 없앨 수 없다.
      if (!poppedOut) hideGhost();
      // (H-25) ⑤ 같은 이유로 **미리 지어 둔 창도 남지 않는다.** 나간 판(`poppedOut`)에서는 그
      //   창이 곧 사용자가 보는 창이므로 거두지 않는다.
      warmLatch.settle(poppedOut);
      // (H-11) 이 판의 잠금 표시도 함께 걷는다 — 다음 판이 시작될 때 남아 있으면 잠기지도 않은
      //   벽이 흐린 채로 뜬다(새 판의 첫 이동은 "안 바뀜"으로 읽어 지우지 않는다).
      entryLock = null;
      entryLockPending = false;
      if (lockSideShown !== null) {
        lockSideShown = null;
        setDockLockSide(null);
      }
      // 밀어 둔 창들도 여기서 굳힌다 — 안 그러면 남의 창에 transform 만 남아 영영 어긋난다.
      settlePush();
      dragOffsetRef.current = { dx: 0, dy: 0 };
    };
  }, [mode, maximized, setMaximized, floatSize.w, floatSize.h, disableDock, viewportNow, otherDockedPanes, paneKey, setPaneDock, dockSizeAtDrop, commitFloat, canPopOut, popOutToWindow, warmPopOutWindow, cancelWarmPopOut, scheduleDragFrame, t]);

  /**
   * 타이틀바 mousedown — 앱 안 창은 `beginTitleDrag`, 독립 창은 main 이 커서를 폴링해 OS 창째 끈다(앱 안에 들어오면 앱 안 IDE 로 — H-4 ②).
   * ⚠ 독립 창에 `app-drag` ❌ — OS 가 끄는 동안 렌더러에 신호가 없다.
   */
  const handleTitleBarMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // 버튼·이름 입력칸·제목 줄 팝업 안의 mousedown 은 드래그 ❌(`titleBarGesture.ts`).
    if (!titleBarPressStartsDrag(e.target as Element)) return;

    if (fullWindow) {
      const ov = window.api?.overlay;
      if (!ov?.dragStart) return;
      // 짐은 **시작할 때** 맡긴다 — 손이 눌린 동안에는 이 창의 상태가 바뀌지 않으므로 그 값이 곧
      //   마지막 값이고, 돌아가는 순간에 뜨려 하면 창이 이미 닫히는 중일 수 있다.
      // (H-12) 되돌아오는 구간의 윤곽선에 적을 말도 **시작할 때** 함께 맡긴다(짐과 같은 이유).
      void ov.dragStart({
        redockOnEnter: true,
        handoff: captureHandoff(),
        label: agentLabelRef.current,
        hint: t('ide.overlay.redockDwellHint'),
      });
      const end = (): void => {
        window.removeEventListener('mouseup', end);
        void ov.dragEnd();
      };
      window.addEventListener('mouseup', end);
      return;
    }

    bringToFront();
    const win = windowRef.current;
    if (!win) return;
    const rect = win.getBoundingClientRect();
    beginTitleDrag({
      startX: e.clientX,
      startY: e.clientY,
      // 클릭 지점이 윈도우 좌상단에서 얼마나 떨어졌는지 — 분리 후에도 그 비율을 유지
      grabRatioX: (e.clientX - rect.left) / rect.width,
      grabRatioY: (e.clientY - rect.top) / rect.height,
      width: rect.width,
      height: rect.height,
    });
  }, [fullWindow, captureHandoff, bringToFront, beginTitleDrag, t]);

  /**
   * §5.5 #17-6 (H-4) ③ — 밖에서 끌던 창이 앱 안으로 돌아왔다: 그 드래그를 이어받는다. 짐은 한 번 꺼내면 사라지므로 `windowRef` 가 없으면 다음 렌더를 기다린다.
   * (H-14) `useLayoutEffect` 여야 한다 — `useEffect` 면 옛 자리를 한 번 그린 뒤 튄다.
   */
  useLayoutEffect(() => {
    if (!agentId || fullWindow) return;
    if (!windowRef.current) return;
    const resume = takePaneDragResume(agentId);
    if (!resume) return;
    const rect = windowRef.current.getBoundingClientRect();
    // §5.5 #17-6 (H-17) — **손이 이미 떠난 판**(밖의 창을 끌어다 놓아 합쳐진 길)에서는 이어받을
    //   드래그가 없다. 자리·크기는 첫 렌더가 `resumeGeomFor` 로 이미 잡아 두었으므로 여기서는
    //   그 자리를 **굳히기만** 한다 — 이어받으면 놓은 뒤에도 창이 커서를 따라다닌다.
    if (!resume.dragging) {
      const landed = resumedFloatGeom(
        resume,
        { x: window.screenX, y: window.screenY },
        { w: window.innerWidth, h: window.innerHeight },
      );
      if (landed) {
        setFloatPos({ x: landed.x, y: landed.y });
        setFloatSize({ w: landed.w, h: landed.h });
        commitFloat(landed);
      }
      // 선을 걷는 부탁은 이 길에서도 똑같이 한다 — 아래 이어받는 길과 같은 이유다.
      scheduleGhostHide();
      return;
    }
    beginTitleDrag({
      startX: 0,
      startY: 0,
      grabRatioX: resume.grabRatioX,
      grabRatioY: resume.grabRatioY,
      // 크기는 **밖의 창 것**이 먼저다 — 그것이 방금까지 화면에 떠 있던 윤곽선의 크기다.
      //   그려진 rect 를 먼저 보면, 짐에 실려 온 옛 크기로 선 첫 프레임을 그대로 물려받아
      //   선과 창이 다른 크기가 된다(선이 창이 되는 것이 아니라 다른 창이 나타난 것이 된다).
      width: resume.width > 0 ? resume.width : rect.width,
      height: resume.height > 0 ? resume.height : rect.height,
      resumed: true,
      // 커서의 화면 좌표를 창 안 좌표로 옮긴다(`window.screenX/Y` = 이 창의 콘텐츠 좌상단).
      //   없거나 화면 밖으로 나오면 넘기지 않는다 — 첫 mousemove 가 곧 자리를 잡아 준다.
      cursor: resume.cursor
        ? { x: resume.cursor.x - window.screenX, y: resume.cursor.y - window.screenY }
        : undefined,
    });
    // §5.5 #17-6 (H-12) — 들어온 창이 다 그린 이 자리에서 선을 걷는다(main 이 여기까지 살려 둔다).
    // (H-15) 예약을 효과 정리에 매지 않는다 — 효과가 다시 돌면(`agent` 는 스냅샷마다 새 객체) 예약이 취소돼 선이 커서에 붙은 채 남는다. 늦게 걷는 건 안전하다.
    scheduleGhostHide();
  }, [agentId, agent, fullWindow, beginTitleDrag, commitFloat]);

  const handleFloatResize = useCallback((edge: FloatResizeEdge, e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    bringToFront();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...floatRef.current };

    function handleMove(ev: MouseEvent): void {
      const next = clampFloatGeom(
        resizeFloatGeom(start, edge, ev.clientX - startX, ev.clientY - startY),
        viewportNow(),
      );
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

  /** 같은 변에서 내 칸 바로 뒤의 칸(그 사이에 분할 손잡이). ⚠ 단위는 창이 아니라 **칸** — 탭으로 겹친 창을 잡으면 자기와 비율을 나눠 손잡이가 무동작이 된다. */
  const stackSlots = useMemo(
    () => (storeDockSide ? dockSlotsOf(dockedPanes, storeDockSide) : []),
    [dockedPanes, storeDockSide],
  );
  const stackIndex = useMemo(
    () => (selfPaneKey ? stackSlots.findIndex((slot) => slot.paneKeys.includes(selfPaneKey)) : -1),
    [stackSlots, selfPaneKey],
  );
  const stackNext = stackIndex >= 0 ? stackSlots[stackIndex + 1] ?? null : null;

  const handleStackSplit = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const side = storeDockSide;
    const next = stackNext;
    const selfSlot = stackIndex >= 0 ? stackSlots[stackIndex] : null;
    if (!side || !next || !selfSlot) return;
    const selfRect = dockLayout.rects[selfPaneKey];
    const nextRect = dockLayout.rects[next.paneKeys[0]!];
    if (!selfRect || !nextRect) return;

    // 좌/우 도크는 세로로 쌓이고(긴 축 = y), 상/하 도크는 가로로 쌓인다(긴 축 = x).
    const vertical = isHorizontalSide(side);
    const startPos = vertical ? e.clientY : e.clientX;
    const lenA = vertical ? selfRect.h : selfRect.w;
    const lenB = vertical ? nextRect.h : nextRect.w;
    const spanA = selfSlot.span;
    const spanB = next.span;

    function handleMove(ev: MouseEvent): void {
      const delta = (vertical ? ev.clientY : ev.clientX) - startPos;
      const out = splitSpansFromDrag(spanA, spanB, lenA, lenB, delta, IDE_DOCK.MIN_SLOT);
      // 몫은 **칸 전체**에 적는다 — 한 칸에 탭으로 겹친 창이 저마다 다른 몫을 들면
      //   레이아웃이 그중 가장 큰 값을 집어, 탭을 갈아탈 때마다 칸 크기가 들썩인다.
      const spans: Record<string, number> = {};
      for (const key of selfSlot!.paneKeys) spans[key] = out.a;
      for (const key of next!.paneKeys) spans[key] = out.b;
      setDockSpans(spans);
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
  }, [storeDockSide, stackNext, stackSlots, stackIndex, dockLayout, selfPaneKey, setDockSpans]);

  /** 타이틀바 도킹 버튼 — 끌지 않고도 원하는 변에 붙인다(끌어 붙이기와 **같은 계산**을 쓴다). */
  const dockToSide = useCallback((side: IDEDockSide) => {
    const others = otherDockedPanes();
    const vp = viewportNow();
    const slots = dockSlotsOf(others, side);
    // 버튼으로 붙일 때는 그 변의 **맨 뒤**에 선다(끼울 자리를 커서로 말할 수 없으므로).
    //   그 변이 이미 꽉 찼으면 마지막 칸에 **탭으로 합류**한다 — 눌러도 아무 일 없는 버튼 ❌.
    const target: DockDropTarget = canAddDockSlot(side, vp, others)
      ? { side, index: slots.length, mode: 'insert' }
      : { side, index: Math.max(0, slots.length - 1), mode: 'tab' };
    setPaneDock(paneKey, {
      side,
      size: dockSizeAtDrop(target, others, vp),
      order: dockOrderForDrop(target, others),
    });
    setMaximized(false);
    setMode('docked');
  }, [otherDockedPanes, paneKey, setPaneDock, viewportNow, dockSizeAtDrop, setMaximized]);

  /**
   * 이 창을 접는다 — 닫지 않고 화면에서만 내린다(붙어 있던 변·열어 둔 파일 그대로).
   * 내려가는 것과 **한 동작**으로 캔버스 카메라가 이 창의 버블로 간다(스토어 setIDEPaneCollapsed).
   */
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
      const wanted = dockSizeFromDrag(side!, startSize, ev.clientX - startX, ev.clientY - startY);
      const others = otherDockedPanes();
      // §5.5 #17-1 — "반대편 도크 + 캔버스 최소치"를 넘기면 마주 보는 도크를 밀어낸다(창끼리 밀기와 같은 규칙). 캔버스 여유는 지킨다.
      const push = pushDockSize(side!, wanted, viewportNow(), others);
      if (push.opposite) {
        // 같은 변의 창들은 두께를 함께 쓴다 — 그 변의 창 하나에만 적어도 스토어가 변 전체에 편다.
        const victim = others.find((p) => p.side === push.opposite!.side);
        if (victim) setPaneDockSize(victim.paneKey, push.opposite.size);
      }
      setPaneDockSize(paneKey, push.size);
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

  /**
   * 창 배치 단축키 — 맨 앞 창 하나만. `Ctrl+Alt+화살표`(mac ⌥⌘) 붙이기 · `+Enter` 최대화 · `+D` 떼기 · `+W` 다음 창.
   * `e.code` 로 판정하고 입력 중엔 비켜선다(유럽 자판 AltGr = Ctrl+Alt).
   */
  // §5.5 #17-6 (H-5) — 독립 창은 최대화(+Enter)만 받는다. 배정은 §6 레지스트리(재매핑을 따른다), 맨 앞 창 조건은 `enabled`.
  // 안내 문구도 레지스트리에서 — 모디파이어가 같을 때만 `Ctrl+Alt+←→↑↓` 로 묶는다.
  const dockKeysLabel = groupBindingLabel([
    useBindingRaw('ide.dockLeft'), useBindingRaw('ide.dockRight'),
    useBindingRaw('ide.dockTop'), useBindingRaw('ide.dockBottom'),
  ]);
  const undockKeyLabel = useBindingLabel('ide.undock');

  const placementEnabled = !!agentId && isFrontPane;
  const dockable = placementEnabled && !fullWindow && !disableDock;

  useCommand('ide.dockLeft', () => { dockToSide('left'); }, { enabled: dockable });
  useCommand('ide.dockRight', () => { dockToSide('right'); }, { enabled: dockable });
  useCommand('ide.dockTop', () => { dockToSide('top'); }, { enabled: dockable });
  useCommand('ide.dockBottom', () => { dockToSide('bottom'); }, { enabled: dockable });
  // §5.5 #17-6 (H-5) — 독립 창에서는 **최대화 하나만** 받는다(붙이기·떼기·다음 창은 뜻이 없다).
  useCommand('ide.toggleMaximize', () => { toggleMaximized(); }, { enabled: placementEnabled });
  useCommand('ide.undock', () => { undock(); }, { enabled: dockable });
  useCommand('ide.nextWindow', () => { cyclePaneFocus(1); }, { enabled: placementEnabled && !fullWindow });

  // Custom 에이전트: 열릴 때 첫 번째 Sub 세션 자동 선택
  useEffect(() => {
    if (!isCustom || !agentId || activeSessionId !== null) return;
    const first = subAgents[0];
    if (first) setSession(first.id);
  }, [isCustom, agentId, activeSessionId, subAgents, setSession]);

  // §5.7 #26 — 그 버블의 소속 프로젝트 스냅샷을 다시 받는다(워크트리는 독립 프로젝트라 활성 탭을 받으면 안 온다). 이미 hydrated 면 서버가 `already-hydrated` 로 돌려보낸다.
  const hydrateOwnerProject = useCallback(() => {
    if (!agentId) return;
    const st = useGraphStore.getState();
    const proj = st.agentProjects[agentId] ?? st.activeProject;
    if (proj) st.hydrateProject(proj);
  }, [agentId]);

  // 서버(디스크)에서 버퍼된 스트림 이벤트를 다시 불러온다 — 이 에이전트의 **모든 세션**을 얕게.
  // 크래시/미hydrate 로 화면엔 "No activity" 인데 sub-streams/*.jsonl 은 디스크에 온전한 경우,
  // 앱 재시작 없이 이 재요청으로 되살린다(loadStreamBuffers 가 세션 스트림을 디스크 버퍼로 재적재).
  const fetchAllStreams = useCallback(() => {
    if (!agentId) return;
    const epoch = useGraphStore.getState().streamRestoreEpoch;
    setRefreshing(true);
    fetch(`/api/subagent-streams/${agentId}`)
      .then((r) => r.json())
      .then(async (data: { streams?: Record<string, SubAgentStreamEvent[]> }) => {
        // 'shallow' — 세션당 얕은 꼬리(`MAX_STREAM_BUFFER_BULK`)라, 이미 깊은 복원분을 들고 있는
        // 세션은 스토어가 줄이지 않고 겹치지 않는 꼬리만 이어 붙인다(늦게 도착한 얕은 응답이
        // 깊은 창을 덮어 되돌리던 것을 막는다).
        await Promise.all(Object.entries(data.streams ?? {}).map(([sid, events]) =>
          restoreStreamWindow(agentId, sid, events, { epoch, depth: 'shallow' })));
      })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [agentId]);

  /** 새로고침 손잡이(타이틀바 ⟳) — 사용자가 **직접** 눌렀을 때는 종전대로 전부 다시 받는다. */
  const refreshStreams = useCallback(() => {
    hydrateOwnerProject();
    fetchAllStreams();
  }, [hydrateOwnerProject, fetchAllStreams]);

  // IDE 열릴 때(agentId 변경 시) 버블 상태만 최신화 — 스트림과 분리돼 있다(아래 참조).
  useEffect(() => { hydrateOwnerProject(); }, [hydrateOwnerProject]);

  // §9 세션 축 — 안 그리는 세션은 전선에 올리지 않는다. 벌크(전 세션)는 **메인 탭을 그릴 때만** — 세션 탭은 아래 깊은 복원이 그 세션만 받는다.
  // 실측(2026-09-10): 세션 44개 버블을 열 때 7.43MB · 11,892 이벤트, Electron 메인에서 tail+파싱 56ms · stringify 22ms(창이 멎는다).
  // 메인 탭은 훅 버블에만 있다(`IDETabBar` `{!isCustom && …}`) — `agent` 를 안 뒤에만 판정한다(`isCustom=false` 기본값에 속지 않게).
  const mainTabDrawn = !!agent && !isCustom && activeSessionId === null;
  useEffect(() => {
    if (!mainTabDrawn) return;
    fetchAllStreams();
  }, [mainTabDrawn, fetchAllStreams]);

  // §5.5 — 보고 있는 세션만 깊은 복원분(상한 전체)을 따로 받는다(메인 탭 조회는 세션당 얕다).
  // ⚠ `computeActiveSessionIds` 는 IDE 를 연 에이전트 세션을 전부 활성으로 쳐 벌크는 깎이지 않는다 — 안 받는 것이 유일한 절약(`streamRestoreDepth.test.ts`).
  // ⚠ 성공할 때까지·깎일 때마다 다시 받는다 — `deepRestoredSessions` 표식이 없으면 재요청(비활성 컷·세션 제거가 지운다).
  const deepRestored = useGraphStore((s) => (activeSessionId ? s.deepRestoredSessions[activeSessionId] === true : true));
  const streamRestoreEpoch = useGraphStore((s) => s.streamRestoreEpoch);
  useEffect(() => {
    if (!agentId || !activeSessionId || deepRestored) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // 빈 응답은 대개 "아직"(복원 직후 서버 등록 전) — 물러났다 다시 묻는다. ⚠ 포기하지 않는다 — 그만두면 의존성이 그대로라 다시 도는 길이 없어 세션이 얕은 채 굳는다.
    // 상한 간격으로 계속 두드리고(비용은 `stat` 몇 번) 탭 이동·창 닫기에서 끊긴다.
    const RETRY_DELAYS = [400, 1200, 3000, 6000];
    /** 위 표를 다 쓰면 이 간격으로 계속 묻는다 — 화면이 빈 채로 굳는 것보다 낫다. */
    const RETRY_DELAY_MAX = 10_000;
    const delayFor = (attempt: number): number => RETRY_DELAYS[attempt] ?? RETRY_DELAY_MAX;
    const run = (attempt: number): void => {
      fetch(`/api/subagent-streams/${agentId}/${activeSessionId}`)
        .then((r) => r.json())
        .then(async (data: { events?: SubAgentStreamEvent[] }) => {
          if (cancelled) return;
          const server = data.events;
          if (!server || server.length === 0) {
            retryTimer = setTimeout(() => run(attempt + 1), delayFor(attempt));
            return;
          }
          // The last server window may start after the disconnected gap. Join it through /older before
          // committing; merge the latest live buffer only after every page arrives.
          const restored = await restoreStreamWindow(agentId, activeSessionId, server, {
            epoch: streamRestoreEpoch, cancelled: () => cancelled,
          });
          if (!restored && !cancelled) retryTimer = setTimeout(() => run(attempt + 1), delayFor(attempt));
        })
        .catch(() => {
          if (cancelled) return;
          retryTimer = setTimeout(() => run(attempt + 1), delayFor(attempt));
        });
    };
    run(0);
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [agentId, activeSessionId, deepRestored, streamRestoreEpoch]);

  // + 탭 — 서버를 기다리지 않고 새 탭 + 포커스: 1) sub id 를 클라가 만든다 2) 복원 인텐트(optimisticRestoreSubAgent)로 등록 —
  // subAgents 에 직접 넣으면 POST 왕복 중 온 full-snapshot 이 덮어써 탭이 사라진다 3) 같은 id 로 POST(서버가 그 id 로 등록 → 스냅샷이 와도 no-op).
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

  // §4 — 커스텀 에이전트(CMD 포함)는 늘 ≥1 세션 탭: 0개면 "+" 경로로 하나 연다(interactive 라 세션 없이는 할 일이 없다).
  useEffect(() => {
    if (!isCustom || !agentId) return;
    if (subAgents.length === 0 && activeSessionId === null) handleNewSession();
  }, [isCustom, agentId, subAgents.length, activeSessionId, handleNewSession]);

  // Active session SubAgent data
  const activeSession = useMemo(() => {
    if (!activeSessionId) return null;
    return subAgents.find((s) => s.id === activeSessionId) ?? null;
  }, [activeSessionId, subAgents]);

  // §4 가시성 LOD — 캔버스를 완전히 덮는 모드(fullWindow · maximized · modal)만 덮개로 등록한다 → BubbleMap 이 페인트·물리 루프·주기 flush 를 멈춘다.
  const coverKey = `${CANVAS_COVER_PREFIX}:${selfPaneKey || 'primary'}`;
  const coversCanvas = !hidden && !!agentId && !!agent && (fullWindow || maximized || mode === 'modal');
  useEffect(() => {
    setCanvasCover(coverKey, coversCanvas);
    return () => setCanvasCover(coverKey, false);
  }, [coverKey, coversCanvas]);

  if (!agentId || !agent) return null;
  // 한 칸을 나눠 쓰는 창들 중 앞 하나만 그린다(언리얼식 탭 도킹 — 뒤 탭도 훅·스트림은 산다).
  // ⚠ 오버레이 위젯 창(fullWindow·disableDock)은 뺀다 — 자기 창 전체가 IDE 라 비면 빈 창이 된다.
  if (!fullWindow && !disableDock && !immersive && storeDockSide && selfPaneKey && slotFrontKey !== selfPaneKey) return null;

  // §5.5 #17-1 윈도우 모드 — mode 에 따라 컨테이너/윈도우 스타일 분기
  const isModal = mode === 'modal';
  // 붙을 변이 없으면 도킹이 아니다 — 모드만 남고 변이 사라진 찰나에 창을 잃지 않게 한다.
  const isDocked = mode === 'docked' && !!storeDockSide;
  // 남이 나를 밀 수 있나 — 떠 있고(store `float` 만 보면 최대화된 창을 옮긴다) 실제로 그려지는 창만(스냅샷에 없는 창의 자리를 슬롯에 적지 않게).
  pushableRef.current = !!agentId && !!agent
    && mode === 'floating' && !maximized && !isModal && !isDocked && !fullWindow;
  const dockRect = isDocked ? dockLayout.rects[selfPaneKey] ?? null : null;

  // 독립 창은 main이 알려 준 OS 상태를 따르고, 앱 안 창은 다음 확대 단계에 맞춰 안내한다.
  const maximizeAction = fullWindow ? (osMaximized ? 'restore' : 'maximize') : nextAction;
  const maximizeLabel = t(maximizeAction === 'restore' ? 'ide.overlay.restoreLabel'
    : maximizeAction === 'immerse' ? 'ide.overlay.immersiveMaximizeLabel' : 'ide.overlay.maximizeLabel');

  // 타이틀바가 넘쳐 [닫기]가 밖으로 밀리지 않게 — 무엇을 접을지는 순수 함수 한 곳(titleBarChrome + 시험; JSX 에 흩으면 [떼기]가 사라져 창에 갇히는 조합이 생긴다).
  // 기준은 창 폭(`bodyLayout.titleBarNarrow`).
  const chrome = resolveTitleBarChrome({
    narrow: bodyLayout.titleBarNarrow, touch: coarse, isModal, isDocked, fullWindow, disableDock,
  });

  let windowClass = 'flex flex-col overflow-hidden border-gray-700 bg-gray-900 shadow-2xl shadow-black/60';
  let windowStyle: React.CSSProperties = {};
  if (fullWindow) {
    // §17-6 — 오버레이 창: IDE 가 투명 OS 창 전체를 채운다(둥근 모서리+테두리, 백드롭 ❌). 이동·리사이즈는 OS 창 몫.
    windowClass += ' fixed inset-0 rounded-xl border';
  } else if (maximized) {
    // 첫 최대화는 헤더 아래, 몰입 상태에서는 헤더가 비운 영역까지 채운다.
    windowClass += fillsWindow ? ' fixed inset-0' : ' fixed left-0 right-0 top-9 bottom-0';
  } else if (isModal) {
    // §4 — 폰에선 모달 대신 풀스크린. inset-0 이면 타이틀바(닫기)가 Header(h-9, z-[100]) 밑에 깔리므로 top-9 부터.
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
    // §5.5 #17-6 (H-6) ② 끄는 동안의 이동은 `transform`(레이아웃 없는 합성) — rAF 가 쓰는 것과 같은 합(끄는 이동 + 밀린 이동)이라 리렌더에도 안 튄다.
    const off = {
      dx: dragOffsetRef.current.dx + pushOffsetRef.current.dx,
      dy: dragOffsetRef.current.dy + pushOffsetRef.current.dy,
    };
    windowStyle = {
      left: floatPos.x,
      top: floatPos.y,
      width: floatSize.w,
      height: floatSize.h,
      transform: off.dx === 0 && off.dy === 0 ? undefined : `translate3d(${off.dx}px, ${off.dy}px, 0)`,
      willChange: off.dx === 0 && off.dy === 0 ? undefined : 'transform',
      // (H-6) ③ → (H-19) 밖으로 빼는 중에는 본체가 **완전히 숨는다** — 지금 손을 따라가는 것은
      //   선 하나다. 종전의 반투명(0.35)으로 멎은 본체는 사용자에게 잔상으로 읽혔다. 자리는 숨은
      //   채로도 계속 맞춰 두므로(`handleMove`), 선이 꺼지면 손 아래에서 그대로 다시 나타난다.
      opacity: popOutGhost ? 0 : undefined,
      pointerEvents: popOutGhost ? 'none' : undefined,
      transition: popOutGhost ? 'opacity 120ms ease-out' : undefined,
    };
  }

  // fullWindow 는 백드롭 없음(창 전체가 IDE) — 백드롭 클릭 닫기도 자연 소멸(닫기=Esc/X).
  const useBackdrop = isModal && !fullWindow;
  const outerClass = fullWindow
    ? 'fixed inset-0 z-50'
    : isModal
      // §4 — backdrop-blur ❌: modal 아래 React Flow 는 이미 hidden 이라 블러할 것이 없고 매 프레임 전면 재합성 비용만 남는다. 불투명에 가까운 스크림으로 대신한다.
      ? 'fixed inset-0 z-50 flex items-center justify-center bg-gray-950/95'
      : 'fixed inset-0 z-50 pointer-events-none';

  return (
    <IDEBodyLayoutContext.Provider value={bodyLayoutValue}>
    <IDEWindowFocusEnabledContext.Provider value={!hidden}>
    <div
      className={outerClass}
      aria-hidden={hidden}
      {...(hidden ? { inert: '' } : {})}
      // 겹침 순서는 스토어 앞뒤 도장의 순위(도장을 그대로 쓰면 자라서 헤더 z-100 을 덮는다). 바닥은 모달 층(z-50) 아래 — 아니면 설정창·확인창이 뒤로 깔린다.
      // Keep layout dimensions and mounted editors while another IDE owns immersion.
      style={{ zIndex: IDE_PANE_Z_BASE + zRank, visibility: hidden ? 'hidden' : undefined }}
      onMouseDown={useBackdrop ? backdrop.onMouseDown : undefined}
      onClick={useBackdrop ? backdrop.onClick : undefined}
      // modal 백드롭 우클릭이 rfContainer 로 올라가 가려진 캔버스 메뉴를 열지 않게 막는다(floating/docked 는 캔버스가 살아 있어야 해 막지 않는다).
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
      {/* (판올림 번호 발급 대기) **도킹 십자**(언리얼 방향 위젯) — 끌기 시작하면 붙을 수 있는 자리가
          버튼으로 뜬다. 겨눈 버튼이 밝아지고, 그 자리가 곧 위 미리보기 박스다(판정은 한 함수). */}
      {zoneButtons.map((zone) => {
        const active = sameDockTarget(zone.target, dropTarget);
        // (H-11) 밖에서 돌아온 판이 잠가 둔 벽 — 겨눠도 안 밝아지는 자리이므로 그렇게 보이게 한다.
        const locked = zone.target.side === dockLockSide;
        return (
          <div
            key={`${zone.target.side}:${zone.target.index}:${zone.target.mode}`}
            className={`fixed flex items-center justify-center rounded-md border transition-all duration-100 ${
              active
                ? 'border-blue-300 bg-blue-500/35 text-blue-50 shadow-lg shadow-blue-500/30'
                : locked
                  ? 'border-blue-400/15 bg-gray-900/50 text-blue-300/25'
                  : 'border-blue-400/40 bg-gray-900/85 text-blue-300/80'
            }`}
            style={{
              left: zone.rect.x,
              top: zone.rect.y,
              width: zone.rect.w,
              height: zone.rect.h,
              transform: active ? 'scale(1.15)' : undefined,
              pointerEvents: 'none',
              zIndex: 49,
            }}
            aria-hidden="true"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              {dockZoneGlyph(zone)}
            </svg>
          </div>
        );
      })}
      {/* §5.5 #17-6 (H-6) ③ 가상 창 선의 앱 안 폴백(정본은 main 의 `ghostFrame.ts` — 이건 앱 경계에서 잘린다). 자리는 rAF 가 DOM 에 쓴다. */}
      {popOutGhost?.kind === 'inapp' && (
        <div
          ref={ghostElRef}
          data-ide-popout-ghost="1"
          className={`fixed left-0 top-0 overflow-hidden rounded-[10px] border-2 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.55),0_10px_30px_rgba(0,0,0,0.35)] ${
            popOutGhost.armed
              ? 'border-violet-300/95 bg-violet-500/[0.14]'
              : 'border-violet-400/75 bg-violet-500/[0.07]'
          }`}
          style={{ pointerEvents: 'none', zIndex: 49, willChange: 'transform' }}
          aria-hidden="true"
        >
          {/* (H-19) main 의 선(`ghostFrame.ts`)과 **같은 그림** — 이름 띠 + 안내 한 줄. 본체가 숨는
              대신 이 선이 무슨 일이 일어나는지 말하고, 앱 경계를 넘어가면 main 의 선이 같은 말을
              이어받는다(두 선이 같은 자리·같은 모양이라 넘어가는 순간이 보이지 않는다). */}
          <div className={`flex h-[34px] items-center gap-1.5 border-b bg-slate-900/55 px-2.5 text-[12px] font-medium text-violet-100/95 ${
            popOutGhost.armed ? 'border-violet-300/80' : 'border-violet-400/55'
          }`}>
            <span className="h-2 w-2 flex-none rounded-full bg-violet-400/95" />
            <span className="truncate">{agent?.label ?? ''}</span>
          </div>
          <div className="truncate border-b border-violet-400/30 bg-slate-900/40 px-[11px] py-[7px] text-[12px] font-medium leading-[1.35] text-violet-200/90">
            {popOutGhost.armed ? t('ide.overlay.popOutGhostArmedHint') : t('ide.overlay.popOutGhostHint')}
          </div>
        </div>
      )}
      {/* 자석 안내선 — 왜 창이 마지막 몇 px 을 알아서 맞췄는지 눈으로 보이게 한다. */}
      {magnetGuides.x !== null && (
        <div className="fixed bottom-0 top-0 w-px bg-sky-400/70" style={{ left: magnetGuides.x, pointerEvents: 'none', zIndex: 49 }} aria-hidden="true" />
      )}
      {magnetGuides.y !== null && (
        <div className="fixed left-0 right-0 h-px bg-sky-400/70" style={{ top: magnetGuides.y, pointerEvents: 'none', zIndex: 49 }} aria-hidden="true" />
      )}
      {/* IDE Window — modal / floating / docked (§5.5 #17-1). §3.7 — maximized 는 Header(h-9) 아래부터(자체 타이틀바가 가리지 않게). */}
      <div
        ref={windowRef}
        data-ide-overlay=""
        className={windowClass}
        style={{ ...windowStyle, pointerEvents: 'auto' }}
        // 창 아무 데나 누르면 맨 앞으로 — 뒤에 깔린 창을 꺼내는 유일한 손잡이다.
        onMouseDownCapture={bringToFront}
        onClick={(e) => e.stopPropagation()}
        // IDE 는 BubbleMap rfContainer 안에 렌더된다 — 우클릭 전파를 끊어 캔버스 메뉴가 함께 뜨지 않게 한다(preventDefault 는 안 한다 — 자식 네이티브 메뉴 유지).
        onContextMenu={(e) => e.stopPropagation()}
      >
        {/* §5.5 #17-1 에이전트 전환 sheen — 띠가 한 번 지나간 뒤 onAnimationEnd 로 언마운트(경계 밖은 overflow-hidden 이 자른다). */}
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
        {/* §5.5 #17-6 (H-19) 밖으로 빼는 중의 안내는 이제 **선(가상 창)** 이 한다 — 본체는 숨어
            있으므로 여기 띄우던 띠는 아무도 못 본다(앱 안 윤곽선의 이름 띠·안내 줄이 말하고,
            앱 밖에서는 main 의 선이 같은 말을 잇는다). */}
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
{/* 떠 있는 창의 **여덟 방향** 리사이즈 손잡이 — 붙어 있거나 최대화 중에는 뜻이 없다.
            모서리는 변보다 위에 둔다(겹치는 자리에서 대각선이 이겨야 손이 예상대로 움직인다). */}
        {!fullWindow && !maximized && !isDocked && mode !== 'modal' && FLOAT_RESIZE_EDGES.map((edge) => (
          <div
            key={edge}
            onMouseDown={(e) => handleFloatResize(edge, e)}
            className={`absolute ${FLOAT_RESIZE_CLASS[edge]}`}
            style={{ zIndex: edge.length === 2 ? 12 : 11 }}
            aria-label={t('ide.overlay.resizeWindow')}
            role="separator"
          >
            {edge === 'se' && (
              <svg className="h-full w-full text-gray-500" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
                <path d="M13 5L5 13M13 9l-4 4" />
              </svg>
            )}
          </div>
        ))}
        {/* Title bar(§3.7 명도 ramp 중간 톤) — §5.5 #17-1 드래그로 modal↔floating↔docked 전이.
           (H-4) fullWindow 도 우리 드래그로 OS 창째 옮긴다(app-drag ❌ — OS 가 끄는 동안 신호가 없다). */}
        <div
          onMouseDown={handleTitleBarMouseDown}
          onDoubleClick={handleTitleBarDoubleClick}
          onMouseEnter={() => { titleBarHoveredRef.current = true; }}
          onMouseLeave={() => { titleBarHoveredRef.current = false; }}
          className="flex h-10 flex-shrink-0 cursor-grab items-center justify-between border-b border-gray-700 bg-vb-ide-titlebar px-4 select-none active:cursor-grabbing"
        >
          {/* 좌측 묶음은 **줄어들 수 있어야** 한다(min-w-0) — 이게 없으면 긴 에이전트 이름이
              우측 버튼 묶음을 통째로 화면 밖으로 밀어 [닫기]가 사라진다(폰 실사용 보고). */}
          <div className="flex min-w-0 items-center gap-2">
            {/* §4 — 좌측 내비 서랍 토글(서랍인 동안만 — 활동바·사이드바를 되부르는 유일한 손잡이). */}
            <button
              type="button"
              onClick={handleToggleMobileNav}
              className={`app-nodrag h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors ${
                navDrawerMode ? 'flex' : 'hidden'
              } ${
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
            {/* 이름은 **자리에 맞춰 스스로 줄어든다**(min-w-0 + truncate) — 폰에서 긴 이름이
                우측 손잡이를 밀어내지 않게. 잘린 전체 이름은 툴팁(title)이 되돌려준다. */}
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
                className="app-nodrag w-40 min-w-0 rounded border border-blue-500 bg-gray-800 px-1.5 py-0.5 text-sm font-semibold text-gray-100 outline-none max-md:w-28"
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
                title={`${agent.label} — ${t('ide.overlay.renameHint')}`}
                className="app-nodrag min-w-0 cursor-pointer truncate rounded text-sm font-semibold text-gray-200 outline-none hover:text-blue-400 focus-visible:ring-1 focus-visible:ring-blue-500"
              >
                {agent.label}
              </span>
            )}
            {/* (판올림 번호 발급 대기) 한 칸을 나눠 쓰는 **다른 창들**(언리얼식 탭 도킹) —
                눌러 앞으로 꺼낸다. 겹쳐 있어도 무엇이 함께 있는지 이 줄로 알 수 있다. */}
            {chrome.showSlotTabs && slotTabs.length > 1 && (
              <div className="ml-1 flex min-w-0 items-center gap-0.5 border-l border-gray-700 pl-2">
                {slotTabs.filter((tab) => !tab.front).map((tab) => (
                  <button
                    key={tab.paneKey}
                    type="button"
                    // 타이틀바 드래그(=이 창 옮기기)로 번지지 않게 여기서 끊는다 — 탭은 고르는 자리다.
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => focusPane(tab.paneKey)}
                    title={t('ide.overlay.slotTabHint', { name: tab.label })}
                    className="app-nodrag max-w-[9rem] truncate rounded px-1.5 py-0.5 text-[12px] text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
            {isProviderAgent || !chrome.showTypeBadge ? (
              /*
               * 폰(chrome.showTypeBadge=false)에서도 비운다(`커스텀/훅/CMD` 는 하단 상태바에 있다). §5.19 (G) · §5.25 (B) 프로바이더 버블의 정체 뱃지는
               * 하단 상태바(`StreamProviderModelButton`)에 있고, 여기에 `커스텀` 을 대신 달지 않는다(정체를 속인다).
               */
              null
            ) : (
              <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[12px] font-semibold ${
                isCmdAgent ? 'bg-teal-500/15 text-teal-300' : isCustom ? 'bg-blue-500/15 text-blue-400' : 'bg-gray-600/30 text-gray-500'
              }`}>
                {isCmdAgent ? t('ide.overlay.cmdLabel') : isCustom ? t('ide.overlay.customLabel') : t('ide.overlay.hookLabel')}
              </span>
            )}
          </div>
          {/* 우측 손잡이 묶음은 **줄어들지 않는다**(flex-shrink-0) — 이름이 아무리 길어도
              [닫기]까지 한 줄 안에 남아야 한다. */}
          <div className={`flex flex-shrink-0 items-center gap-1 ${fullWindow ? 'app-nodrag' : ''}`}>
            {/* §4 — 하단 상태바 토글(기본 숨김). */}
            <button
              type="button"
              onClick={() => setMobileStatusOpen((v) => !v)}
              className={`app-nodrag h-8 w-8 items-center justify-center rounded transition-colors ${
                statusDrawerMode ? 'flex' : 'hidden'
              } ${
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
            {/* §5.5 #17-6 (H-28) — [항상 위에 고정](독립 창만). 꺼짐 = 누운 핀, 켜짐 = 세운 호박색 핀. */}
            {fullWindow && canPinOnTop && (
              <button
                type="button"
                onClick={togglePinnedOnTop}
                aria-pressed={pinnedOnTop}
                className={`app-nodrag flex h-6 w-6 items-center justify-center rounded transition-colors pointer-coarse:h-9 pointer-coarse:w-9 ${
                  pinnedOnTop
                    ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                    : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
                aria-label={t('ide.overlay.pinOnTop')}
                title={pinnedOnTop ? t('ide.overlay.pinnedOnTopHint') : t('ide.overlay.pinOnTopHint')}
              >
                <svg
                  className={`h-3.5 w-3.5 transition-transform ${pinnedOnTop ? '' : 'rotate-45'}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M12 17v5" />
                  <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                </svg>
              </button>
            )}
            {/* §5.5 읽기 설정 — 폭 안·읽기 폭·행간/자간/어간·글꼴·모바일 변형. §4 (CMD) — CMD 버블에선 안 그린다:
               먹는 표면 `.ide-md` 가 없다(전 탭이 PTY — xterm 은 CSS 변수가 안 닿는다). 무동작 버튼은 고장으로 읽힌다. */}
            {!isCmdAgent && (
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
                {/* 팝업 표식(`titleBarGesture.ts`) — 상자 없는 감싸개라 자리·크기 측정은 그대로다. */}
                {readingOpen && (
                  <div className="contents" data-ide-titlebar-popup="">
                    <ReadingSettingsPopover
                      onClose={closeReading}
                      mobileAdapted={mobileAdapted}
                      fontAvailability={fontAvailability}
                    />
                  </div>
                )}
              </div>
            )}
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
            {chrome.showDockMenu && (
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
                  <div
                    data-ide-titlebar-popup=""
                    className="absolute right-0 top-7 z-30 w-36 rounded-md border border-gray-700 bg-gray-900 p-1 shadow-xl shadow-black/50"
                  >
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
                    {/* (판올림 번호 발급 대기) 앱 밖으로 끌어내는 것과 **같은 일**을 누르기로도.
                        앱 창이 최대화돼 모니터가 하나면 커서가 창 밖으로 나갈 수 없어, 이 손잡이가
                        없으면 그 사용자에게는 꺼내기 기능이 아예 없는 것과 같다. */}
                    {canPopOut && (
                      <button
                        type="button"
                        onClick={() => {
                          setDockMenuOpen(false);
                          popOutToWindow({ size: { width: Math.round(floatSize.w), height: Math.round(floatSize.h) } });
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-gray-300 transition-colors hover:bg-gray-800"
                      >
                        <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M15 3h6v6" />
                          <path d="M10 14 21 3" />
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        </svg>
                        {t('ide.overlay.popOutLabel')}
                      </button>
                    )}
                    {/* 같은 일을 키보드로도 할 수 있다는 것을 여기서 알린다 — 단축키는 아무도
                        모르면 없는 것과 같다(§9 한글 가독 하한 12px). */}
                    <div className="mt-1 border-t border-gray-800 px-2 pb-0.5 pt-1 text-[12px] leading-snug text-gray-500">
                      {t('ide.overlay.dockShortcutHint', {
                        dock: dockKeysLabel,
                        undock: undockKeyLabel,
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* §5.5 #17-1 — 접기. **닫기가 아니다** — 붙어 있던 변·열어 둔 파일을 그대로 둔 채
                화면에서만 내려 캔버스를 그만큼 돌려준다(헤더 [창] 메뉴에서 다시 편다). */}
            {chrome.showCollapse && (
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
            {/* §5.5 #17-6 (H-4) ⑤ — 종전의 [독립 창으로 꺼내기] 버튼은 **없앴다.** 타이틀바를 잡고
                앱 밖으로 끌면 경계를 넘는 그 순간 창이 밖으로 나가므로, 같은 일을 하는 두 번째
                손잡이가 됐다(끌기가 어려운 트랙패드·터치를 위해 [붙이기] 메뉴 항목은 남아 있다). */}
            {/* §5.5 #17-6 (H-21) — 종전의 [앱 안으로 되돌리기(↩)] 손잡이도 **없앴다.** 닫기(✕/Esc)가
                앱을 앞으로 세우고 이 창을 닫으므로((H-20)) 같은 결과로 가는 손잡이가 둘이었다. */}
            {/* §5.5 #17-6 (H-18) — 밖에 선 창에만: 이 창을 오버레이 버블로 바꾼다(앱 안 창 ❌). */}
            {fullWindow && !!onCollapseToBubble && (
              <button
                type="button"
                onClick={onCollapseToBubble}
                className="app-nodrag flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors pointer-coarse:h-9 pointer-coarse:w-9 hover:bg-gray-700 hover:text-gray-200"
                aria-label={t('ide.overlay.toBubble')}
                title={t('ide.overlay.toBubbleHint')}
              >
                {/* 안으로 모이는 두 화살표 + 가운데 버블 — "창을 저 동그라미로 줄인다".
                    화살촉은 반지름(3) 밖(중심에서 4.2)에 두어 14px 에서도 원과 붙지 않는다. */}
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M21 9h-6V3" />
                  <path d="M21 3l-6 6" />
                  <path d="M3 15h6v6" />
                  <path d="M3 21l6-6" />
                </svg>
              </button>
            )}
            {/* §5.5 #17-6 (H-5) — 독립 창에서는 이 버튼이 **OS 창**을 최대화한다(앱 안 창은 종전대로
                창 안 레이아웃). 같은 자리·같은 아이콘이라 두 창에서 배울 손버릇이 하나다. */}
            {chrome.showMaximize && (
            <button
              type="button"
              onClick={toggleMaximized}
              className="app-nodrag flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors pointer-coarse:h-9 pointer-coarse:w-9 hover:bg-gray-700 hover:text-gray-200"
              aria-label={maximizeLabel}
              title={maximizeLabel}
            >
              {maximizeAction === 'restore' ? (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                  <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                  <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                  <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
                </svg>
              ) : maximizeAction === 'immerse' ? (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />
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
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-400 transition-colors pointer-coarse:h-9 pointer-coarse:w-9 hover:bg-gray-700 hover:text-gray-200"
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
          isFrontPane={isFrontPane}
        />

        {/* Body: Activity bar + Sidebar + Main area + 오른쪽 미리보기·실행 출력. */}
        <div ref={bodyRef} className="relative flex min-h-0 flex-1">
          {/* §4 — 내비 서랍(조건은 창 폭 — #17-1): 타이틀바 토글로 본문 위 오버레이로 열고 backdrop 탭으로 닫는다. */}
          {navDrawerMode && mobileNavOpen && (
            <div
              className="absolute inset-0 z-30 bg-black/40"
              {...mobileNavBackdrop}
              aria-hidden="true"
            />
          )}
          {/* 활동바는 **마지막에** 접힌다 — 사이드바가 서랍인 동안에도 자리에 남아, 사라진 목록을
              되부르는 손잡이가 된다(항목을 누르면 서랍이 그 뷰로 열린다). */}
          {(!bodyLayout.navDrawer || mobileNavOpen) && <IDEActivityBar />}
          {(!bodyLayout.sidebarDrawer || mobileNavOpen) && <IDESidebar agentId={agentId} />}
          {/* §5.5 #17-34 — 창 안 화면 분할. 안 나눴으면 종전처럼 `IDEMainArea` 한 벌만 그린다. */}
          {/* §5.5 #17-19 ⑧ — 이 겹은 **자리만** 만든다(위치 기준 ❌ — `relative` 를 주면 좁은 폭에서
              덮개로 뜨는 편집창의 `left-12` 가 활동바가 아니라 이 겹을 기준으로 잡혀 어긋난다). */}
          <div
            ref={dropContentRef}
            className="flex min-h-0 min-w-0 flex-1"
            onDragEnter={entryDropHandlers.onDragEnter}
            onDragOver={entryDropHandlers.onDragOver}
            onDragLeave={entryDropHandlers.onDragLeave}
            onDrop={entryDropHandlers.onDrop}
          >
            <IDESplitView agentId={agentId} isCustom={isCustom} />
            {/* §5.5 #17-27 — 내장 편집창: 대화 오른쪽에 선다(좁으면 대화 위 오버레이, 비출 것이 없으면 렌더 ❌). §5.5 #17-17 ㉔ — 우측 판은 이것 하나, 무대는 그 첫 탭. */}
            <IDEEditorPane runOutput={runOutputRunId
              ? <IDERunOutputPanel onClose={() => openRunOutput(null)} />
              : undefined} />
          </div>
          {/* §5.5 #17-19 ⑧ — "지금 손을 떼면 무슨 일이 일어나는가". 폭은 **비율**이라 캔버스를
              확대해도 띠가 어긋나지 않는다. 판정과 같은 값에서 나오므로 둘이 다른 말을 할 수 없다. */}
          {entryDrop.zone && entryDrop.box && (
            <div
              className="pointer-events-none absolute inset-y-0 z-30 p-2"
              style={{ left: `${entryDrop.box.leftPct}%`, width: `${entryDrop.box.widthPct}%` }}
            >
              <div className={`flex h-full w-full items-center justify-center rounded-lg border-2 border-dashed ${
                entryDrop.blocked ? 'border-gray-600 bg-gray-900/40' : 'border-blue-400 bg-blue-500/10'
              }`}>
                <span className={`rounded px-2 py-1 text-[12px] font-medium ${
                  entryDrop.blocked ? 'bg-gray-800 text-gray-400' : 'bg-blue-500/90 text-white'
                }`}>
                  {entryDrop.blocked
                    ? t('ide.explorer.drop.folderBlocked')
                    : t(entryDrop.zone === 'editor' ? 'ide.explorer.drop.editor' : 'ide.explorer.drop.input')}
                </span>
              </div>
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

        {/* Status bar — §4: 서랍 폭에서는 기본 숨김(타이틀바 토글). */}
        {(!statusDrawerMode || mobileStatusOpen) && (
          <IDEStatusBar
            agent={agent}
            activeSession={activeSession}
            isCustom={isCustom}
            sessionCount={subAgents.length}
          />
        )}
      </div>
    </div>
    </IDEWindowFocusEnabledContext.Provider>
    </IDEBodyLayoutContext.Provider>
  );
});

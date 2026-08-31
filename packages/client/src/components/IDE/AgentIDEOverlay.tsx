import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
import { createPortal } from 'react-dom';
import { BUBBLE_COLORS } from '@vibisual/shared';
import {
  useGraphStore,
  resolvePaneKey,
  selectDockSlotFrontKey,
  selectDockSlotSignature,
  selectIDEPane,
  selectRenderedIDEPanes,
  selectVisibleDockedPanes,
} from '../../stores/graphStore.js';
import { AgentConfigPopup } from '../Panel/AgentConfigPopup.js';
import { captureIDEPaneHandoff, type IDEPaneHandoff } from '../../stores/idePaneHandoff.js';
import { takePaneDragResume } from '../../stores/idePaneDragResume.js';
import { readIDEPane, useIDEPaneScope, useIDEPaneValue } from './idePane.js';
import {
  IDE_DOCK,
  IDE_DOCK_SIDES,
  IDE_PANE_Z_BASE,
  IDE_FLOAT,
  FLOAT_RESIZE_EDGES,
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
  isOutsideViewport,
  isPinnedToViewportEdge,
  dockSizeFromDrag,
  dragFloatGeom,
  isPulledFullyOut,
  magnetFloatGeom,
  easeFloatPushOffset,
  pushFloatGeoms,
  pushDockSize,
  overflowPastClamp,
  previewDockRect,
  resizeFloatGeom,
  resolveDockDrop,
  sameDockTarget,
  splitSpansFromDrag,
  type DockDropTarget,
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
import { setCanvasCover } from '../../stores/canvasVisibility.js';
import { useIsNarrowViewport } from '../../hooks/useIsMobile.js';
import { useElementWidth } from '../../hooks/useElementWidth.js';
import { ideSidebarWidth, resolveIDEBodyLayout } from './ideResponsive.js';
import { IDEBodyLayoutContext, type IDEBodyLayoutValue } from './ideBodyLayoutContext.js';
import { resolveTitleBarChrome } from './titleBarChrome.js';
import { useBackdropDismiss, useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { IDEActivityBar } from './IDEActivityBar.js';
import { IDETabBar } from './IDETabBar.js';
import { IDESidebar } from './IDESidebar.js';
import { IDESplitView } from './IDESplitView.js';
import { IDEEditorPane } from './IDEEditorPane.js';
import { useEditorFollow } from './useEditorFollow.js';
import { IDEStatusBar } from './IDEStatusBar.js';
import { VerifyDemoLayer } from './VerifyDemoLayer.js';
import { IDERunOutputPanel } from './IDERunOutputPanel.js';
import { useRunSessions } from '../../stores/runSessions.js';
import { useReadingSettings } from './reading/useReadingSettings.js';
import { shortcutLabel } from '../../utils/platform.js';
import { ReadingSettingsPopover } from './reading/ReadingSettingsPopover.js';

const EMPTY_SUBS: SubAgent[] = [];

/**
 * §5.5 #17-6 (H-4) ⑥ — 앱 밖으로 꺼낸 창이 커서에 매달린 동안, **손을 뗀 순간을 앱 쪽에서도 듣는다.**
 *
 * 꺼내는 순간 이 창(앱 안 IDE)은 닫히므로 컴포넌트는 사라진다 — 그래서 리스너를 컴포넌트가
 * 아니라 **모듈**에 단다. 뗌을 놓쳤을 때의 대가가 "창이 영영 커서를 따라다닌다"라, 매달린 창
 * 쪽에서도 같은 신호를 듣게 해 두었다(둘 중 어느 쪽이 마우스 캡처를 쥐고 있든 한쪽은 듣는다).
 * 두 번 불려도 안전하다 — 이미 끝난 판은 main 이 조용히 지나간다.
 */
function watchDetachedFollowRelease(agentId: string): void {
  const end = (): void => {
    window.removeEventListener('mouseup', end, true);
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('blur', end);
    void window.api?.overlay?.dragEndFor?.(agentId);
  };
  // 뗌 자체를 놓쳤을 때의 그물 — 버튼이 눌리지 않은 채 움직이면 이미 놓은 것이다.
  const onMove = (ev: MouseEvent): void => {
    if (ev.buttons === 0) end();
  };
  window.addEventListener('mouseup', end, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('blur', end);
}

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
 * §5.5 #17-6 (H-6) — 가장자리에 **막힌 채** 버티는 동안의 타임라인(ms).
 *
 * 커서를 앱 밖으로 낼 수 없는 화면(단일 모니터 + 최대화)에서는 "밖으로 밀고 있다"가 시간으로만
 * 표현된다. 그 시간을 **두 마디**로 나눈다 — 먼저 선으로 된 가상 창을 띄워 무슨 일이 일어나는지
 * 보여 주고(`EDGE_GHOST_MS`), 그 다음에 실제로 내보낸다. 아무 것도 안 보이는 채로 기다리게 하면
 * "안 되는 기능"으로 읽힌다(H-3 이 예고 문구를 둔 까닭과 같다 — 이제는 문구가 아니라 그림이다).
 */
const EDGE_GHOST_MS = 120;
/** 그 타임라인을 재는 시계의 결 — 윤곽선이 밖으로 밀려 나가는 것이 끊겨 보이지 않을 만큼만 잦게. */
const EDGE_TICK_MS = 32;
/**
 * (H-6) 버티는 동안 윤곽선이 그 변 밖으로 밀려 나가는 거리(px).
 *
 * **완전히** 밀어내지 않는 까닭: 단일 모니터에 앱이 최대화돼 있으면 앱 밖에 보일 자리가 없어,
 * 다 밀면 선이 화면에서 사라져 버린다(보여 주려던 것을 감추는 셈). 어디로 빠지는지만 말한다.
 */
const EDGE_NUDGE_PX = 72;
/**
 * (H-6) 손을 뗐을 때 **그대로 내보낼** 문턱(px, 놓을 수 있는 자리 기준).
 *
 * 윤곽선이 뜨는 문턱(`POP_OUT_GHOST_ENTER_PX`=24)과 벌려 둔다: 창을 화면 끝에 바짝 붙여 두려다
 * 몇 십 픽셀 더 간 손이 창을 밖으로 던지면 안 된다. 여기까지 끌었다면 "밖으로 뺀다" 말고 달리
 * 읽을 여지가 없다.
 */
const POP_OUT_COMMIT_PX = 120;

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

/**
 * (판올림 번호 발급 대기) 떠 있는 창의 **여덟 방향** 리사이즈 손잡이 자리.
 * 종전에는 우하단 하나뿐이라 창을 왼쪽·위로 넓히려면 옮겼다 늘렸다를 반복해야 했다.
 */
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

/**
 * 도킹 십자 버튼의 글리프 — **탭 합류**는 겹친 두 장, 새 칸은 그 방향으로 갈린 네모.
 * 언리얼의 방향 위젯과 같은 읽기: 그림만 보고 "여기 놓으면 어떻게 되는지" 알 수 있어야 한다.
 */
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
  // §4 v2.63 — CMD(인터랙티브 터미널) 에이전트: 라벨/자동 세션 분기. customCreated 기반이라 isCustom 도 true.
  const executionMode = useGraphStore((s) => (agentId ? s.agentConfigs[agentId]?.executionMode : undefined));
  const isCmdAgent = isCustom && executionMode === 'interactive-terminal';
  // §5.19 (G) — All Model(로컬 LLM) 버블: 정체가 다르면 창의 얼굴도 달라야 한다.
  //   이 창은 클로드 CLI 의 것이 아니라 지금 문 로컬 모델의 것이다.
  const agentConfig = useGraphStore((s) => (agentId ? s.agentConfigs[agentId] : undefined));
  const localProvider = useGraphStore((s) => (agentId ? s.agentConfigs[agentId]?.provider : undefined));
  const isLocalAgent = !!localProvider;

  const [maximized, setMaximized] = useState(false);
  /**
   * §5.5 #17-6 (H-5) — **독립 창의 OS 최대화 상태.** 앱 안 창의 `maximized`(창 안 레이아웃)와는
   * 다루는 대상이 다르다 — 이쪽은 OS 창 자체다.
   *
   * 값은 main 이 밀어 주는 것 **하나만** 믿는다. 누르는 순간 낙관적으로 뒤집어 두면, 실제 창이
   * (버블로 접히는 등 다른 경로로) 최대화를 잃었을 때 아이콘만 최대화로 남아 실제와 어긋난다.
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
    setMaximized((v) => !v);
  }, [fullWindow]);

  // §4 v3.24 — 폰(max-md)에선 좌측 내비(활동바+사이드바)를 기본 숨기고, 타이틀바 토글 버튼으로만 연다
  //   (좁은 화면에서 활동바 48px 가 본문을 상시 짓누르지 않게). 이 값은 이제 **판정의 입력 하나**일 뿐이고,
  //   무엇을 접을지는 아래 `bodyLayout` 이 창 폭까지 함께 보고 정한다.
  const isNarrow = useIsNarrowViewport();

  // ─── 창 안 반응형 — 기준은 뷰포트가 아니라 **이 창 자신의 폭**이다 ────────────────────
  // 종전에는 위 `isNarrow`(뷰포트 max-md) 하나가 창 안 배치까지 결정했다. 그런데 IDE 창은 화면이
  //   아니라 앱 안의 창이라, 1920px 뷰포트에서 창만 700px 로 줄이면 아무것도 접히지 않은 채
  //   활동바·사이드바·편집창이 자리를 다 가져가고 **대화만** 0 까지 찌부러졌다(글자가 세로로 서고
  //   그 안 상태바가 사이드바 위로 넘쳤다 — 사용자 스크린샷). 이제 본문 행의 실제 폭을 재서
  //   순수 판정(`resolveIDEBodyLayout`)에 넘기고, 접힘은 컨텍스트로 자식들에게 흘린다.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bodyWidth = useElementWidth(bodyRef);
  const sidebarCollapsed = useIDEPaneValue((o) => o.sidebarCollapsed);
  const sidebarView = useIDEPaneValue((o) => o.activeView);
  const editorOpenCount = useIDEPaneValue((o) => o.editorFiles.length);
  const storedEditorWidth = useGraphStore((s) => s.ideEditorWidth);
  const bodyLayout = useMemo(() => resolveIDEBodyLayout({
    width: bodyWidth,
    viewportNarrow: isNarrow,
    sidebarCollapsed,
    sidebarWidth: ideSidebarWidth(sidebarView),
    editorOpen: editorOpenCount > 0,
    editorWidth: storedEditorWidth,
  }), [bodyWidth, isNarrow, sidebarCollapsed, sidebarView, editorOpenCount, storedEditorWidth]);

  // §5.5 #17-27 ⑪ — [추종] 이 켜져 있으면 그 **세션**이 고치는 파일을 편집창이 따라 연다.
  //   편집창은 열린 파일이 없으면 렌더되지 않으므로, 여는 판단은 그 밖(여기)에 있어야 한다.
  //   좁아서 편집창이 대화를 덮는 상태도 폰과 같은 "덮개" 라 같은 건너뛰기 규칙을 탄다. 다만
  //   물어야 할 것은 지금이 아니라 **열었을 때** 덮개가 되는가다 — 지금은 닫혀 있어서 안 덮는다는
  //   답을 받아 열고 나면, 사용자가 보고 있던 대화가 그 순간 통째로 가려진다.
  const editorWouldCover = useMemo(() => resolveIDEBodyLayout({
    width: bodyWidth,
    viewportNarrow: isNarrow,
    sidebarCollapsed,
    sidebarWidth: ideSidebarWidth(sidebarView),
    editorOpen: true,
    editorWidth: storedEditorWidth,
  }).editorDrawer, [bodyWidth, isNarrow, sidebarCollapsed, sidebarView, storedEditorWidth]);
  useEditorFollow(agentId ?? '', activeSessionId, editorWouldCover);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /** 좌측 내비(활동바·사이드바) 중 하나라도 서랍인가 — 타이틀바 토글이 그 손잡이가 된다. */
  const navDrawerMode = bodyLayout.navDrawer || bodyLayout.sidebarDrawer;
  /**
   * 하단 상태바도 서랍인가. 이 바는 좁아지면 **줄바꿈으로 접히므로** 밖으로 넘치지는 않지만,
   * 활동바까지 접히는 폭(≈370px 이하)에서는 서너 줄이 되어 안 그래도 없는 세로 자리를 먹는다 —
   * 그 구간에서는 폰과 똑같이 감추고 타이틀바 토글로만 부른다(§4 v3.25 와 같은 손잡이).
   */
  const statusDrawerMode = isNarrow || bodyLayout.navDrawer;
  // 사이드바에서 세션을 고르면(activeSessionId 변경) 내비를 닫아 목적지 화면이 바로 보이게 한다.
  //   v4.93 — 북마크·세션 요약은 여기서 빠졌다: 이제 목적지가 **사이드바 자신**이라 내비를 닫으면
  //   방금 연 목록까지 함께 사라진다(폰에서 사이드바는 내비와 한 몸으로 뜬다).
  //   v4.95 — 실행 중 서브에이전트도 같은 이유로 빠졌다(사이드바 뷰가 됐다).
  useEffect(() => {
    if (navDrawerMode) setMobileNavOpen(false);
  }, [navDrawerMode, activeSessionId]);
  // §4 v3.25 — 서랍 폭에선 하단 상태바(IDEStatusBar)도 기본 숨김 — 타이틀바 우측 토글 버튼으로만 연다
  //   (한 줄이지만 그 폭에선 줄바꿈으로 서너 줄이 되어 세로 자리를 먹는다 — `statusDrawerMode`).
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
  //
  // §5.5 #17-6 (H-5) — **독립 창에서도 같다.** 종전에는 "OS 가 드래그 영역 더블클릭을 처리한다"고
  //   보고 넘겼는데, 그 창은 투명 창이라 Windows 가 시스템 최대화를 막고 (H-4) 가 `app-drag` 마저
  //   걷어냈다 — 아무도 처리하지 않아 더블클릭이 그냥 죽어 있었다.
  const handleTitleBarDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // 이름 더블클릭은 리네임 진입 — 최대화 토글과 겹치지 않게 여기서 가로챈다(fullWindow 에서도 동작).
    if (target.closest('[data-ide-agent-name]')) { startNameEdit(); return; }
    if (target.closest('button')) return;
    toggleMaximized();
  }, [toggleMaximized, startNameEdit]);

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
  /**
   * (판올림 번호 발급 대기) 드래그 중 화면에 뜨는 **도킹 십자**(언리얼 방향 위젯)와, 지금 겨누고 있는 자리.
   * 종전에는 "가장자리 12% 안에 들어가야 스냅"이라 어디까지 밀어야 붙는지 손이 먼저 알아야 했다.
   */
  const [zoneButtons, setZoneButtons] = useState<DockZoneButton[]>([]);
  const [dropTarget, setDropTarget] = useState<DockDropTarget | null>(null);
  /** 자석이 붙은 선 — 왜 창이 살짝 튀었는지 눈으로 보이게 한다. */
  const [magnetGuides, setMagnetGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  /**
   * §5.5 #17-6 (H-3) 커서가 화면 끝에 **막혀** 더 못 나가는 채로 밀고 있다 — 조금만 더 버티면
   * 그 자리에서 독립 창으로 빠진다. 아무 말 없이 기다리게 하면 "안 되는 기능"으로 읽히므로,
   * 넘어가기 **전에** 무엇을 기다리는 중인지 먼저 말한다.
   *
   * (H-4) 나가는 판정이 참이 되는 순간 창은 **곧바로** 밖으로 나간다 — 그래서 "놓으면 꺼냅니다"
   * 쪽 예고는 사라지고, 기다림이 남는 이 하나만 말한다.
   */
  /**
   * §5.5 #17-6 (H-6) — **밖으로 빼는 중**: 본체는 그 자리에 멎고, 커서를 따라가는 것은 창 크기
   * 그대로의 **윤곽선**이다.
   *
   * `kind` 는 그 선을 **누가 그리는가** — `os` 면 main 의 클릭통과 투명 창이라 앱 밖까지 이어지고,
   * `inapp` 은 그것을 만들지 못한 환경의 폴백이라 앱 경계에서 잘린다(기능이 사라지는 것이 아니라
   * 덜 보이게 된다). `armed` 면 지금 손을 떼도 그대로 나간다 — 색과 문구가 그것을 미리 말한다.
   *
   * 이 상태는 **모드가 바뀔 때만** 바뀐다. 자리는 상태가 아니라 `ghostRectRef` 가 쥐고 rAF 가
   * DOM 에 직접 쓴다(끄는 동안 리렌더 ❌ — 그 리렌더가 곧 버벅임이었다).
   */
  const [popOutGhost, setPopOutGhost] = useState<{ kind: 'os' | 'inapp'; armed: boolean } | null>(null);
  /** 윤곽선이 지금 있어야 할 자리 — rAF 가 읽어 DOM 에 쓴다(`inapp` 일 때만 그린다). */
  const ghostRectRef = useRef<Rect | null>(null);
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  /**
   * (H-6) 끄는 동안 창을 옮기는 값 — **상태가 아니다**. 종전에는 `mousemove` 마다 `setFloatPos` 로
   * 상태를 바꿔 그 창 전체(타이틀바·사이드바·편집기·스트림)가 다시 그려졌다(버벅임의 실체).
   * 이제 자리는 여기 있고 `requestAnimationFrame` 이 `transform` 으로 DOM 에 직접 쓴다.
   * 렌더 함수도 **같은 ref 를 읽으므로**, 다른 이유로 리렌더가 나도 창이 옛 자리로 튀지 않는다.
   */
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  /**
   * (판올림 번호 발급 대기) §5.5 #17-1 — **남이 나를 민 만큼**(px). `dragOffsetRef` 와 축이 다르다:
   * 저쪽은 내가 끄는 이동, 이쪽은 다른 창이 부딪혀 와 밀려난 이동이다. 둘은 같은 `transform` 한 줄로
   * 합쳐 쓴다 — 따로 쓰면 나중에 쓴 쪽이 앞의 것을 지운다. 여기도 **상태가 아니다**(리렌더 ❌).
   */
  const pushOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  /** 지금 남이 나를 밀 수 있는 상태인가 — 떠 있는 창일 때만(렌더마다 갱신되는 거울). */
  const pushableRef = useRef(false);
  const dragRafRef = useRef<number | null>(null);
  /**
   * §5.5 #17-6 (H) — **끌어다 앱 안으로 합치는 중**(독립 창 한정). main 이 창을 칩으로 줄여
   * 커서를 따라가게 하고, 그동안 이 창은 IDE 대신 칩 UI 를 그린다(줄어든 창에 IDE 를 그대로
   * 그리면 글자만 잘려 보인다). `hovering` 은 커서가 앱 창 위에 있다 = 놓으면 합쳐진다.
   */
  const [redockDrag, setRedockDrag] = useState<{ dragging: boolean; hovering: boolean }>({
    dragging: false,
    hovering: false,
  });
  /** 손을 뗀 순간의 hover 를 읽는 거울 — 리스너 closure 가 옛 값을 보지 않게. */
  const redockHoverRef = useRef(false);
  /** 이번 누름이 드래그가 됐는가 — 그랬다면 뒤따르는 click(=즉시 되돌리기)을 삼킨다. */
  const redockDraggedRef = useRef(false);
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
    // §5.5 #17-6 (H) — 도킹이 없는 창(독립 창·오버레이 창)은 **붙은 변을 지우지 않는다**.
    //   그 창의 슬롯이 들고 있는 변은 "밖으로 나오기 전 앱 안에서 붙어 있던 자리"이고, 되돌아갈 때
    //   그 자리로 복귀하는 데 쓰인다. 종전에는 이 줄이 그 값을 마운트 즉시 지워, 밖에 나갔다
    //   돌아온 창이 늘 붙지 않은 채로 떠 있었다(어디에 있던 창인지 잊는다).
    //   도킹 자체가 불가능한 창이라 지우지 않아도 화면에는 아무 영향이 없다.
    if (fullWindow || disableDock) return;
    const dockedNow = mode === 'docked';
    if (dockedNow && !storeDockSide) {
      // 붙을 변이 사라졌다(다른 경로로 뗌) — 창을 잃지 않게 플로팅으로 되돌린다.
      goFloating();
    } else if (!dockedNow && storeDockSide) {
      setPaneDock(paneKey, null);
    }
  }, [agentId, mode, storeDockSide, paneKey, setPaneDock, goFloating, fullWindow, disableDock]);

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
   * (판올림 번호 발급 대기) §5.5 #17-1 — **자석 밀기를 받는 쪽.** 이 창을 등록소에 걸어 두면,
   * 다른 창을 끌던 사람이 나를 밀 수 있다.
   *
   * 왜 store 가 아니라 등록소인가: 미는 창이 매 프레임 store 에 쓰면 그 프로젝트의 창 전원이 다시
   * 그려진다(#17-6 (H-6) ② 가 걷어낸 바로 그 버벅임). 끄는 동안은 `transform` 한 줄만 오가고,
   * **손을 뗀 순간에만** 그 자리를 상태·슬롯에 적는다.
   *
   * `rect()` 가 null 을 돌려주면 셈에서 통째로 빠진다 — 밀 수 있는지는 창 자신만 안다(최대화는
   * 로컬 상태라 밖에서는 보이지 않는다).
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

  /**
   * (판올림 번호 발급 대기) 이 창을 **앱 밖 독립 창**으로 꺼낼 수 있는가.
   * 데스크톱 앱(오버레이 IPC 가 있는 창)에서만 — 브라우저·이미 독립인 창에는 뜻이 없다.
   */
  const canPopOut = typeof window !== 'undefined' && !!window.api?.overlay && !fullWindow;

  /** 이 창이 보고 있는 프로젝트 — 꺼내기/되돌리기가 창을 찾을 때 쓰는 키. */
  const resolveProjectId = useCallback((): string | null => {
    const st = useGraphStore.getState();
    return overlayProjectId ?? (agentId ? st.agentProjects[agentId] : null) ?? st.activeProject;
  }, [overlayProjectId, agentId]);

  /**
   * §5.5 #17-6 (H) — 자리를 옮길 때 **들고 갈 짐**을 지금 상태에서 뜬다.
   *
   * 이것이 없으면 받는 쪽이 창을 새로 만들어(`openIDEOverlay` 의 초기값) 열어 둔 편집 탭이
   * 전부 닫히고 뷰가 첫 화면으로 돌아간다 — 같은 창이 자리를 옮긴 것이 아니라 비슷한 창이
   * 새로 뜬 것이 되어, 오갈수록 하던 일을 잃는다.
   */
  const captureHandoff = useCallback((): IDEPaneHandoff | null => {
    return captureIDEPaneHandoff(readIDEPane(paneKey));
  }, [paneKey]);

  /**
   * 앱 밖 **독립 창**으로 꺼낸다(§5.5 #17-6 오버레이 창을 IDE 크기로 바로 띄운다).
   * 앱 안 창은 함께 닫는다 — 같은 IDE 가 두 곳에 뜨면 어느 쪽이 진짜인지 알 수 없다.
   */
  const popOutToWindow = useCallback((opts?: {
    size?: { width: number; height: number };
    /**
     * §5.5 #17-6 (H-4) — 끌던 **도중에** 꺼내는 자리. 새 창이 잡은 지점 그대로 커서에 매달려
     * 뜬다(`grab` = 창 좌상단에서 커서까지의 거리) — 끌던 손 아래에서 창이 이어진다.
     */
    follow?: { grabX: number; grabY: number };
  }) => {
    const ov = window.api?.overlay;
    if (!ov || !agentId) return;
    const projectId = resolveProjectId();
    if (!projectId) return;
    // 짐은 **닫기 전에** 뜬다 — 닫고 나면 읽을 슬롯이 없다.
    const handoff = captureHandoff();
    void ov.open({ agentId, projectId, expanded: true, size: opts?.size, handoff, follow: opts?.follow });
    // 매달린 채 뜬 창은 손을 뗄 때 풀어 줘야 한다. 이 컴포넌트는 곧 닫히므로(아래) 리스너는
    //   모듈에 단다 — 컴포넌트에 달면 언마운트와 함께 사라져 창이 커서를 계속 따라다닌다.
    if (opts?.follow) watchDetachedFollowRelease(agentId);
    closeOverlay();
  }, [agentId, resolveProjectId, closeOverlay, captureHandoff]);

  /**
   * 꺼내 둔 창을 **앱 안으로 되돌린다**(독립 창에서만 뜬다). 메인 창을 앞으로 끌어올려
   * 그 버블 자리에 IDE 창을 다시 열고, 이 창은 닫는다 — 되돌리기가 반쪽이면 되돌린 게 아니다.
   */
  const returnToApp = useCallback(() => {
    const ov = window.api?.overlay;
    if (!ov?.revealInMain || !agentId) return;
    const projectId = resolveProjectId();
    if (!projectId) return;
    void ov.revealInMain({ agentId, projectId, openIde: true, handoff: captureHandoff() });
    void ov.closeSelf?.();
  }, [agentId, resolveProjectId, captureHandoff]);

  /**
   * §5.5 #17-6 (H) — main 의 폴링이 알려 주는 합치기 드래그 상태(칩 모양·놓을 자리 강조).
   * 독립 창에서만 온다 — 앱 안 창은 이 채널을 쓰지 않는다.
   */
  useEffect(() => {
    const ov = window.api?.overlay;
    if (!ov?.onRedockDragState) return;
    const off = ov.onRedockDragState((s) => {
      redockHoverRef.current = s.hovering;
      setRedockDrag({ dragging: s.dragging, hovering: s.hovering });
    });
    return () => { off(); };
  }, []);

  /**
   * 되돌리기 손잡이를 **잡아 끌면** 합치기 드래그가 된다 — 누르고 바로 떼면 종전대로 즉시 되돌리기.
   *
   * 꺼내는 길은 제스처(타이틀바를 앱 밖으로)인데 돌아오는 길만 버튼이면 두 방향이 대칭이 아니다.
   * 임계(`DRAG_THRESHOLD`)를 넘겨야 드래그로 보는 까닭은, 누르는 손이 몇 픽셀 흔들렸다고 창이
   * 칩으로 줄었다 돌아오면 누른 사람에게는 고장으로 읽히기 때문이다.
   *
   * 좌표는 **화면 좌표**(`screenX/Y`)로 잰다 — 드래그가 시작되면 창 자체가 커서를 따라 움직여
   * 창 안 좌표(`clientX/Y`)는 거의 제자리에 머문다(임계를 영영 못 넘는다).
   */
  const handleReturnPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const ov = window.api?.overlay;
    // 드래그를 모르는 판(구버전 preload)에서는 아무 것도 걸지 않는다 — 클릭 되돌리기는 그대로 산다.
    if (!ov?.redockDragStart || !ov.redockDragEnd) return;
    const sx = e.screenX;
    const sy = e.screenY;
    redockDraggedRef.current = false;
    redockHoverRef.current = false;
    let started = false;
    const onMove = (ev: MouseEvent): void => {
      if (started) return;
      if (Math.abs(ev.screenX - sx) < DRAG_THRESHOLD && Math.abs(ev.screenY - sy) < DRAG_THRESHOLD) return;
      started = true;
      redockDraggedRef.current = true;
      void ov.redockDragStart();
    };
    // 종료는 window `mouseup` — 창이 칩으로 줄며 이 버튼이 화면에서 사라지므로 엘리먼트 이벤트에
    //   기대면 신호를 놓친다(칩이 커서를 따라다니므로 mouseup 은 이 창에 온다).
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!started) return; // 안 움직였다 = 클릭 — 뒤따르는 onClick 이 즉시 되돌리기를 한다.
      void ov.redockDragEnd({ commit: redockHoverRef.current, handoff: captureHandoff() });
      // 끌고 놓았을 때 click 이 **오지 않는 경우도 있다**(칩으로 줄며 버튼이 DOM 에서 빠져
      //   mousedown/mouseup 대상이 갈린다). 표식을 그대로 두면 다음 클릭 한 번이 통째로 먹히므로,
      //   click 이 올 자리(같은 틱)를 지나면 스스로 내린다.
      setTimeout(() => { redockDraggedRef.current = false; }, 0);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [captureHandoff]);

  /** 끌어서 놓은 뒤 따라오는 click 은 삼킨다 — 안 그러면 합치기와 즉시 되돌리기가 겹쳐 두 번 일어난다. */
  const handleReturnClick = useCallback(() => {
    if (redockDraggedRef.current) {
      redockDraggedRef.current = false;
      return;
    }
    returnToApp();
  }, [returnToApp]);

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
   * 타이틀바 드래그 **한 판** — 마우스로 시작하기도 하고, 밖에서 끌던 드래그를 **이어받기도** 한다.
   *
   * §5.5 #17-6 (H-4) ③ — 독립 창을 끌다 앱 안으로 들어오면 그 순간 앱 안 IDE 로 돌아오는데, 그때
   * 사용자의 손은 아직 눌려 있다. 돌아온 창이 이 함수로 **끌던 드래그를 그대로 이어받아야** 한
   * 손짓이 두 동강 나지 않는다(이어받지 않으면 창은 돌아왔는데 움직이지 않는다).
   *
   * ⚠ **본문을 Alt 로 끌어 옮기는 길은 두지 않는다.** Alt 는 전역 인스펙터(§5.5 v4.52 — 모든 창)가
   *   `pointerdown` 을 capture 단계에서 `stopImmediatePropagation` 으로 삼키는 키라, 여기서 받으려
   *   해도 오지 않고 받아도 두 기능이 같은 제스처를 두고 다툰다.
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
    /** 이동이 끝났을 때 슬롯에 적어 둘 자리 — 상태가 아니라 여기서 들고 있어야 mouseup 이 읽는다. */
    let lastGeom: FloatGeom | null = null;
    let lastGuides: { x: number | null; y: number | null } = { x: null, y: null };
    /** 이 판이 이미 앱 밖으로 나갔는가 — 나가면 이 창은 닫히므로 뒤따르는 신호를 전부 무시한다. */
    let poppedOut = false;
    /**
     * §5.5 #17-6 (H-6) — **밖으로 빼는 중**: 본체는 그 자리에 멎고, 커서를 따라가는 것은 창 크기
     * 그대로의 윤곽선이다. 움직이는 것이 하나뿐이라 두 그림이 어긋날 수 없다.
     *
     * `ghostKind` 는 그 선을 누가 그리는가 — `os` 면 main 의 클릭통과 투명 창이라 **앱 밖까지**
     * 이어지고, `inapp` 은 그것을 만들지 못한 환경의 폴백이라 앱 경계에서 잘린다.
     */
    let ghostOn = false;
    let ghostKind: 'os' | 'inapp' = 'inapp';
    let ghostArmed = false;
    /** 윤곽선을 그 변 밖으로 밀어 낸 여분(px) — 가장자리 버팀 동안 자란다(H-6 ④). */
    let ghostPush = { dx: 0, dy: 0 };

    /** main 이 그리는 윤곽선의 크기·잡은 지점·무장 여부를 갈아 끼운다(여러 번 불러도 안전). */
    function syncOsGhost(): void {
      if (ghostKind !== 'os') return;
      void window.api?.overlay?.ghostShow?.({
        width: Math.round(nextW),
        height: Math.round(nextH),
        grabX: Math.round(init.grabRatioX * nextW),
        grabY: Math.round(init.grabRatioY * nextH),
        label: agentLabelRef.current,
        armed: ghostArmed,
      });
    }

    function showGhost(rect: FloatGeom, armed: boolean): void {
      ghostRectRef.current = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
      const armChanged = ghostOn && armed !== ghostArmed;
      ghostArmed = armed;
      if (!ghostOn) {
        ghostOn = true;
        // 선은 **지금 이 프레임에** 떠야 한다. 본체는 이미 멎었으므로, OS 창이 서기를 기다리면
        //   (창 하나를 만들고 띄우는 데 백 밀리초 남짓) 그동안 손을 따라오는 것이 아무것도 없다 —
        //   고치려던 바로 그 구간이 다시 생긴다. 그래서 **앱 안 윤곽선으로 먼저 그리고**, main 의
        //   창이 서면 그쪽으로 넘긴다(둘 다 같은 자리를 그리므로 넘어가는 순간이 보이지 않는다).
        ghostKind = 'inapp';
        setPopOutGhost({ kind: 'inapp', armed });
        const ov = window.api?.overlay;
        if (ov?.ghostShow) {
          void ov.ghostShow({
            width: Math.round(nextW),
            height: Math.round(nextH),
            grabX: Math.round(init.grabRatioX * nextW),
            grabY: Math.round(init.grabRatioY * nextH),
            label: agentLabelRef.current,
            armed,
          }).then((ok) => {
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
    }

    /** 도로 앱 안으로 들어왔거나 손을 뗐다 — 선을 걷는다(밖으로 나간 경우는 main 이 스스로 걷는다). */
    function hideGhost(): void {
      if (!ghostOn) return;
      ghostOn = false;
      ghostArmed = false;
      ghostPush = { dx: 0, dy: 0 };
      ghostRectRef.current = null;
      setPopOutGhost(null);
      void window.api?.overlay?.ghostHide?.();
    }

    /**
     * §5.5 #17-6 (H-3)+(H-6) 화면 끝에 **막혀** 밖으로 못 나가는 사람을 위한 버팀 시계.
     *
     * 가장자리를 떠나는 순간 되돌린다 — 스쳐 지나간 손이 창을 밖으로 던지면 안 된다. 시간은 두
     * 마디다: 먼저 선으로 된 가상 창을 띄워 무슨 일이 일어나는지 **보여 주고**(`EDGE_GHOST_MS`),
     * 남은 동안 그 선을 변 밖으로 밀어 내다가, 끝나면 그 자리에서 내보낸다.
     */
    let edgeTimer: number | null = null;
    let edgeStartedAt = 0;
    /** 이 판의 버팀 길이 — 선이 **이미** 떠 있었다면 처음부터 다시 기다리지 않는다. */
    let edgeSpan: number = IDE_FLOAT.POP_OUT_EDGE_DWELL_MS;
    /** 그 변 밖으로 완전히 나가려면 얼마나 밀어야 하는가(px). */
    let edgeTarget = { dx: 0, dy: 0 };

    function clearEdgeWatch(): void {
      if (edgeTimer !== null) { window.clearInterval(edgeTimer); edgeTimer = null; }
      edgeStartedAt = 0;
      // 가장자리를 떠났으면 밀어 냈던 만큼도 되돌린다 — 안 되돌리면 선이 그 자리에 어긋난 채 남는다.
      if (ghostPush.dx !== 0 || ghostPush.dy !== 0) {
        ghostPush = { dx: 0, dy: 0 };
        if (ghostKind === 'os') void window.api?.overlay?.ghostNudge?.({ dx: 0, dy: 0 });
      }
    }
    function detach(): void {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      clearEdgeWatch();
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
    }

    /**
     * §5.5 #17-6 (H-4) ① — **경계를 넘는 그 순간** 독립 창으로 바꾼다(놓을 때가 아니라).
     *
     * 종전에는 밖으로 나가도 창이 앱 안에 남아 뷰포트 경계에서 잘린 채 멈춰 있었다(밖은 그릴
     * 수가 없다) — 끌고 있는 사람 눈에는 "안 나간다"로 읽혔다. 이제 그 자리에서 OS 창이 되어
     * 잡은 지점 그대로 커서를 따라온다(`follow`). 앱 안 창은 함께 닫힌다 — 같은 IDE 가 두 곳에
     * 뜨면 어느 쪽이 진짜인지 알 수 없다.
     *
     * (H-6) ⑤ **윤곽선은 여기서 끄지 않는다.** 창을 만들고 띄우는 동안 커서 아래가 비면 "사라졌다
     * 나타난다"가 된다 — 새 창이 실제로 보이는 순간 main 이 스스로 걷는다(같은 프로세스가 둘 다
     * 쥐고 있으므로 신호를 주고받을 필요가 없다). 잡은 지점에서 **밀어 낸 만큼을 빼** 넘기므로,
     * 새 창은 선이 서 있던 바로 그 자리에 선다.
     */
    function popOutNow(): void {
      if (poppedOut) return;
      poppedOut = true;
      // 밀어 냈던 만큼을 **먼저** 뜬다 — `detach()` 안의 시계 정리가 그 값을 0 으로 되돌린다.
      const push = { dx: ghostPush.dx, dy: ghostPush.dy };
      detach();
      clearDragVisuals();
      // 선은 main 이 걷는다 — 우리 쪽 표시만 내린다(여기서 ghostHide 를 부르면 빈 화면이 생긴다).
      ghostOn = false;
      setPopOutGhost(null);
      popOutToWindow({
        size: { width: Math.round(nextW), height: Math.round(nextH) },
        follow: {
          grabX: Math.round(init.grabRatioX * nextW - push.dx),
          grabY: Math.round(init.grabRatioY * nextH - push.dy),
        },
      });
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

    /**
     * (H-6) ③ 지금 선을 그려야 하는가 — **한 곳에서만** 정한다.
     *
     * 켜는 이유가 둘(놓을 수 있는 자리를 넘어섰다 · 가장자리에 막힌 채 버티고 있다)인데 판정이
     * 두 곳에 있으면 한쪽이 켜고 다른 쪽이 끄는 깜빡임이 생긴다.
     */
    function refreshGhost(): void {
      if (poppedOut || !lastRaw) return;
      const vp = viewportNow();
      const beyond = overflowPastClamp(lastRaw, vp);
      const byEdge = edgeTimer !== null && Date.now() - edgeStartedAt >= EDGE_GHOST_MS;
      if (canPopOut && (beyond > IDE_FLOAT.POP_OUT_GHOST_ENTER_PX || byEdge)) {
        showGhost(lastRaw, beyond >= POP_OUT_COMMIT_PX);
      } else {
        hideGhost();
      }
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
        if (elapsed >= edgeSpan) {
          clearEdgeWatch();
          // 버팀이 끝나는 그 순간 = 나가는 순간. 선이 서 있던 그 자리를 창이 그대로 이어받는다.
          popOutNow();
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
      if (!dragBase) {
        // 이 판의 기준점 — 상태 쓰기는 여기 한 번뿐이다(모달에서 막 떠 온 창의 옛 좌표도 여기서 맞는다).
        dragBase = { x: raw.x, y: raw.y };
        dragOffsetRef.current = { dx: 0, dy: 0 };
        lastGeom = raw;
        setFloatPos({ x: raw.x, y: raw.y });
      }

      // §5.5 #17-6 (H-4)+(H-6) ④ **완전히 나갔다** — 커서가 앱 밖(다중 모니터)이거나, 창이 앱
      //   화면과 더는 겹치지 않는다. 그 자리에서 곧바로 독립 창이 되므로 도킹·자석은 볼 것도 없다.
      const cursorNow = { x: ev.clientX, y: ev.clientY };
      if (canPopOut && (isOutsideViewport(cursorNow, vp) || isPulledFullyOut(raw, vp))) { popOutNow(); return; }
      // 단일 모니터에 앱이 최대화돼 있으면 커서는 한 픽셀도 밖으로 못 나간다 — 그 사람에게는 위 판정이
      //   영영 참이 되지 않아 끌어내기가 **없는 기능**이었다(H-3). 화면 끝에 막힌 채 잠깐 버티는 것을
      //   같은 뜻으로 읽어, 화면 수와 창 상태에 관계없이 같은 손짓이 닿게 한다.
      const pinned = canPopOut && isPinnedToViewportEdge(cursorNow, vp);
      if (!pinned) clearEdgeWatch();
      else if (edgeTimer === null) startEdgeWatch(cursorNow, vp);

      refreshGhost();
      if (ghostOn) {
        // (H-6) ③ 밖으로 빼는 중 — 본체는 멎고 선이 따라간다. 도킹·자석은 쉰다(그때 정해진 것은
        //   "밖으로 나간다" 하나다 — 파란 도킹 미리보기와 함께 뜨면 무엇이 일어날지 말이 갈린다).
        if (dropAt) { dropAt = null; setDropTarget(null); setSnapRect(null); }
        if (lastGuides.x !== null || lastGuides.y !== null) {
          lastGuides = { x: null, y: null };
          setMagnetGuides(lastGuides);
        }
        return;
      }

      let moved = raw;
      // 도킹 자리 — 네 변 + **붙어 있는 칸 위**(가운데는 탭 합류, 앞뒤 띠는 새 칸).
      //   자리가 바뀔 때만 미리보기를 다시 잰다(매 프레임 새 객체를 넣으면 드래그 내내 리렌더가 붙는다).
      const nextTarget = disableDock
        ? null
        : resolveDockDrop({ x: ev.clientX, y: ev.clientY }, vp, others);
      if (!sameDockTarget(nextTarget, dropAt)) {
        dropAt = nextTarget;
        setDropTarget(nextTarget);
        setSnapRect(nextTarget
          ? previewDockRect(nextTarget, vp, others, dockSizeAtDrop(nextTarget, others, vp))
          : null);
      }
      // 붙을 자리를 겨누는 동안에는 밀기·자석을 함께 끈다 — 미리보기가 이미 자리를 말한다.
      if (!dropAt) {
        // (판올림 번호 발급 대기) **밀기가 자석보다 먼저다.** 여유(`PUSH_GAP`=12px) 안에 든 창은
        //   붙잡히는 것이 아니라 밀려나고, 미는 창은 그 뒤로도 멎지 않는다(사용자 지적 — "멈추지 말고").
        //   `PUSH_GAP` > `MAGNET_PX` 라 떠 있는 창끼리는 붙이는 자석이 아예 걸리지 않는다.
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
      detach();
      clearDragVisuals();
      if (!dragging) { hideGhost(); return; }
      // (H-6) ④ 선이 **무장한 채** 손을 뗐다 = 여기까지 끌었으면 밖으로 뺀다는 뜻 말고 없다.
      if (wasArmed && canPopOut) { popOutNow(); return; }
      hideGhost();
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
      // (H-6) 언마운트로 판이 끊겨도 선은 남지 않는다 — 클릭통과 창이라 사용자가 없앨 수 없다.
      if (!poppedOut) hideGhost();
      // 밀어 둔 창들도 여기서 굳힌다 — 안 그러면 남의 창에 transform 만 남아 영영 어긋난다.
      settlePush();
      dragOffsetRef.current = { dx: 0, dy: 0 };
    };
  }, [mode, maximized, floatSize.w, floatSize.h, disableDock, viewportNow, otherDockedPanes, paneKey, setPaneDock, dockSizeAtDrop, commitFloat, canPopOut, popOutToWindow, scheduleDragFrame]);

  /**
   * 타이틀바 mousedown.
   *
   * 앱 안 창은 in-window 이동(위 `beginTitleDrag`)이고, **독립 창은 OS 창째** 움직인다 —
   * 그쪽은 main 이 커서를 폴링해 창을 끌고 다니며(§17-6 v2.81 버블 드래그와 같은 물리),
   * 끌다 앱 안으로 들어오면 그 자리에서 앱 안 IDE 로 돌아간다(H-4 ②).
   *
   * ⚠ 독립 창 타이틀바에 OS `app-drag` 를 쓰지 않는 까닭: OS 가 창을 끄는 동안에는 렌더러에
   *   아무 신호도 오지 않아 "앱 안으로 들어왔다"를 알 길이 없다.
   */
  const handleTitleBarMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // 버튼·인터랙티브 자손(이름 리네임 포함)에서 시작된 mousedown 은 드래그 ❌
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-ide-agent-name]')) return;

    if (fullWindow) {
      const ov = window.api?.overlay;
      if (!ov?.dragStart) return;
      // 짐은 **시작할 때** 맡긴다 — 손이 눌린 동안에는 이 창의 상태가 바뀌지 않으므로 그 값이 곧
      //   마지막 값이고, 돌아가는 순간에 뜨려 하면 창이 이미 닫히는 중일 수 있다.
      void ov.dragStart({ redockOnEnter: true, handoff: captureHandoff() });
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
  }, [fullWindow, captureHandoff, bringToFront, beginTitleDrag]);

  /**
   * §5.5 #17-6 (H-4) ③ — 밖에서 끌던 창이 앱 안으로 돌아왔다: **그 드래그를 이어받는다.**
   *
   * 손은 아직 눌려 있으므로, 이어받지 않으면 창은 돌아왔는데 움직이지 않는다(한 번 놓았다 다시
   * 잡아야 한다 = 한 손짓이 두 동강 난다). 짐은 창이 서기 전에 맡겨져 있고 **한 번 꺼내면
   * 사라진다** — 창이 아직 그려지지 않았으면(`windowRef` 없음) 꺼내지 않고 다음 렌더를 기다린다.
   */
  useEffect(() => {
    if (!agentId || fullWindow) return;
    if (!windowRef.current) return;
    const resume = takePaneDragResume(agentId);
    if (!resume) return;
    const rect = windowRef.current.getBoundingClientRect();
    beginTitleDrag({
      startX: 0,
      startY: 0,
      grabRatioX: resume.grabRatioX,
      grabRatioY: resume.grabRatioY,
      width: rect.width > 0 ? rect.width : resume.width,
      height: rect.height > 0 ? rect.height : resume.height,
      resumed: true,
      // 커서의 화면 좌표를 창 안 좌표로 옮긴다(`window.screenX/Y` = 이 창의 콘텐츠 좌상단).
      //   없거나 화면 밖으로 나오면 넘기지 않는다 — 첫 mousemove 가 곧 자리를 잡아 준다.
      cursor: resume.cursor
        ? { x: resume.cursor.x - window.screenX, y: resume.cursor.y - window.screenY }
        : undefined,
    });
  }, [agentId, agent, fullWindow, beginTitleDrag]);

  /**
   * 떠 있는 창의 **여덟 방향** 리사이즈. 종전에는 우하단 한 곳뿐이라 왼쪽·위로 넓히려면
   * "옮겼다 늘렸다"를 반복해야 했다(두 창을 나란히 맞추는 일이 사실상 불가능했다).
   */
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

  /**
   * 같은 변에서 **내 칸 바로 뒤의 칸** — 그 칸과 내 칸 사이에 분할 손잡이가 선다.
   * 종전에는 같은 변의 창들이 무조건 균등 분할이라 "위는 길게, 아래 로그는 짧게"를 만들 수 없었다.
   *
   * ⚠ 세는 단위는 창이 아니라 **칸**이다. 탭으로 겹친 창을 이웃으로 잡으면 자기 자신과 비율을
   *   나누게 되어(같은 자리·같은 몫) 손잡이가 아무 일도 하지 않는다.
   */
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
  }, [otherDockedPanes, paneKey, setPaneDock, viewportNow, dockSizeAtDrop]);

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
      // (판올림 번호 발급 대기) §5.5 #17-1 — 종전에는 "반대편 도크 + 캔버스 최소치"에서 손잡이가
      //   그대로 멎었다. 이제 그 문턱을 넘기면 **마주 보는 도크가 밀려난다**(창끼리 밀리는 것과 같은
      //   규칙 — 부딪히면 멈추는 것이 아니라 상대가 비켜 준다). 캔버스 여유는 끝까지 지킨다.
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

  // (판올림 번호 발급 대기) 헤더 [창] 메뉴의 레이아웃 프리셋이 배치를 바꿨다 — 창 모양을 다시 읽는다.
  //   모양(모달/플로팅/도킹)은 컴포넌트 로컬 상태라, 이 반영이 없으면 스토어만 바뀌고 화면은 그대로 남는다.
  useEffect(() => {
    if (layoutEpoch === 0 || fullWindow || !agentId) return;
    const slot = selectIDEPane(useGraphStore.getState(), paneKey);
    setMaximized(false);
    if (slot.dockSide && !disableDock) {
      setMode('docked');
      return;
    }
    const g = floatGeomFor(paneKey, paneIndex);
    setFloatSize({ w: g.w, h: g.h });
    setFloatPos({ x: g.x, y: g.y });
    setMode('floating');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutEpoch]);

  /**
   * (판올림 번호 발급 대기) 창 배치 단축키 — **맨 앞 창 하나만** 받는다(여러 창이 같은 키에 함께 반응하면 안 된다).
   *
   * `Ctrl+Alt+화살표`(mac ⌥⌘) 그 변에 붙이기 · `+Enter` 최대화/복원 · `+D` 떼어 내기 ·
   * `+W` 다음 창 앞으로. 판정은 자판 배열과 무관한 `e.code` 로 하고, 글자를 치는 중에는
   * 통째로 비켜선다 — 일부 유럽 자판에서 AltGr 이 곧 Ctrl+Alt 라 입력을 가로챌 수 있다.
   */
  //
  // §5.5 #17-6 (H-5) — 독립 창에서는 **최대화(+Enter) 하나만** 받는다. 붙이기·떼기·다음 창은 그
  //   창에 뜻이 없지만, 최대화는 이제 그 창에서도 하는 일이 있다(버튼·더블클릭과 같은 일).
  useEffect(() => {
    if (!agentId || !isFrontPane) return;
    function onKey(e: KeyboardEvent): void {
      // mac 에서 실제로 눌리는 것은 ⌘⌥ 다 — 이 저장소의 단축키는 전부 `ctrlKey || metaKey` 를 함께 본다.
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const side: IDEDockSide | null =
        e.code === 'ArrowLeft' ? 'left'
        : e.code === 'ArrowRight' ? 'right'
        : e.code === 'ArrowUp' ? 'top'
        : e.code === 'ArrowDown' ? 'bottom'
        : null;
      if (side) {
        if (fullWindow || disableDock) return;
        dockToSide(side);
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        toggleMaximized();
      } else if (e.code === 'KeyD') {
        if (fullWindow || disableDock) return;
        undock();
      } else if (e.code === 'KeyW') {
        if (fullWindow) return;
        cyclePaneFocus(1);
      } else {
        return;
      }
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agentId, isFrontPane, fullWindow, disableDock, dockToSide, toggleMaximized, undock, cyclePaneFocus]);

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
    //   §5.7 #26 — **그 버블의 소속 프로젝트**를 다시 받는다. 워크트리 버블에서 활성 탭(=부모)을
    //   다시 받아 봐야 그 버블의 스냅샷은 한 줄도 안 온다(워크트리는 독립 프로젝트로 등록된다).
    const st = useGraphStore.getState();
    const proj = st.agentProjects[agentId] ?? st.activeProject;
    if (proj) st.hydrateProject(proj);
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
  // (판올림 번호 발급 대기) 한 칸을 나눠 쓰는 창들 중 **앞에 선 하나만** 그린다(언리얼식 탭 도킹).
  //   훅은 이미 다 돌았으므로 뒤 탭도 스트림·상태는 그대로 살아 있고, 무거운 본문만 안 붙는다.
  //   ⚠ 오버레이 위젯 창(fullWindow·disableDock)은 이 셈에서 뺀다 — 그 창은 **자기 창 전체가 IDE** 라
  //   메인 창에서 뒤 탭이 됐다는 이유로 통째로 비면 사용자는 빈 창을 보게 된다.
  if (!fullWindow && !disableDock && storeDockSide && selfPaneKey && slotFrontKey !== selfPaneKey) return null;

  // §5.5 #17-6 (H) — **끌어다 합치는 중**: 창이 칩 크기로 줄어 커서를 따라온다. 그 안에 IDE 를
  //   그대로 그리면 글자만 잘려 보이므로, 무엇을 들고 있고 지금 놓으면 어떻게 되는지만 말한다
  //   (별창 mini ghost(§5.4 #14-1)와 같은 모양 — 두 기능이 같은 손버릇이면 배울 것이 하나다).
  if (fullWindow && redockDrag.dragging) {
    return (
      <div
        data-ide-redock-ghost="1"
        className={`flex h-screen w-screen select-none flex-col items-stretch justify-center gap-0.5 rounded-md px-3 py-1 ${
          redockDrag.hovering
            ? 'bg-blue-600/90 ring-2 ring-blue-300/80'
            : 'bg-[#1f2937] shadow-lg shadow-black/60 ring-1 ring-amber-400/50'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <svg className="h-3 w-3 flex-shrink-0 text-blue-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 2v4m0 12v4M2 12h4m12 0h4" />
          </svg>
          <span className="truncate text-[12px] font-semibold text-white">{agent.label}</span>
        </div>
        <span className={`truncate text-[12px] font-medium ${redockDrag.hovering ? 'text-blue-100' : 'text-amber-200/90'}`}>
          {redockDrag.hovering ? t('ide.overlay.redockDropHint') : t('ide.overlay.redockKeepHint')}
        </span>
      </div>
    );
  }

  // §5.5 #17-1 윈도우 모드 — mode 에 따라 컨테이너/윈도우 스타일 분기
  const isModal = mode === 'modal';
  // 붙을 변이 없으면 도킹이 아니다 — 모드만 남고 변이 사라진 찰나에 창을 잃지 않게 한다.
  const isDocked = mode === 'docked' && !!storeDockSide;
  // (판올림 번호 발급 대기) 남이 나를 밀 수 있는가 — **떠 있는 창일 때만**. 붙어 있거나·최대화·모달·
  //   독립 창은 옮길 자리가 아니다(store 의 `float` 만 보고 판정하면 최대화된 창을 옮기려 든다).
  //   그리고 **실제로 그려지는** 창이어야 한다 — 에이전트가 스냅샷에 없으면 화면에 아무것도 없는데
  //   자리만 남으므로, 없는 창을 밀어 그 자리를 슬롯에 적는 일이 생긴다.
  pushableRef.current = !!agentId && !!agent
    && mode === 'floating' && !maximized && !isModal && !isDocked && !fullWindow;
  const dockRect = isDocked ? dockLayout.rects[selfPaneKey] ?? null : null;

  // §5.5 #17-6 (H-5) — 지금 이 창이 최대화 상태인가. 앱 안 창은 창 안 레이아웃(`maximized`),
  //   독립 창은 **OS 창**(main 이 밀어 준 `osMaximized`) — 아이콘·툴팁이 그 하나만 본다.
  const isMaximized = fullWindow ? osMaximized : maximized;

  // 폰 폭에서 타이틀바 한 줄이 넘쳐 **맨 오른쪽 [닫기]가 화면 밖으로 밀려나던** 것을 막는다.
  //   무엇을 접을지는 순수 함수 한 곳에서만 정한다(titleBarChrome + 단위 테스트) — 조건을 JSX 에
  //   흩어 두면 "붙어 있는데 [떼기]가 사라진" 조합이 생겨 폰에서 창에 갇힌다.
  //   접는 기준은 이제 뷰포트가 아니라 **이 창의 폭**이다 — 같은 넘침이 넓은 화면에서 창만 좁혀도
  //   똑같이 일어나는데, `max-md` 는 그 경우를 모른다(`bodyLayout.titleBarNarrow`).
  const chrome = resolveTitleBarChrome({
    narrow: bodyLayout.titleBarNarrow, isModal, isDocked, fullWindow, disableDock,
  });

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
    // §5.5 #17-6 (H-6) ② 끄는 동안의 이동은 `left/top` 이 아니라 `transform` 이다(레이아웃 없는
    //   합성). 값은 `dragOffsetRef` — rAF 가 DOM 에 직접 쓰는 것과 **같은 곳**을 읽으므로, 끄는
    //   도중에 다른 이유로 리렌더가 나도 창이 옛 자리로 튀지 않는다.
    // 끄는 이동 + 밀린 이동 — rAF 가 DOM 에 쓰는 것과 **같은 합**이라 리렌더가 나도 창이 안 튄다.
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
      // (H-6) ③ 밖으로 빼는 중에는 본체가 그 자리에 **멎는다** — 지금 손을 따라가는 것은 선이다.
      opacity: popOutGhost ? 0.35 : undefined,
      transition: popOutGhost ? 'opacity 120ms ease-out' : undefined,
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
    <IDEBodyLayoutContext.Provider value={bodyLayoutValue}>
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
      {/* (판올림 번호 발급 대기) **도킹 십자**(언리얼 방향 위젯) — 끌기 시작하면 붙을 수 있는 자리가
          버튼으로 뜬다. 겨눈 버튼이 밝아지고, 그 자리가 곧 위 미리보기 박스다(판정은 한 함수). */}
      {zoneButtons.map((zone) => {
        const active = sameDockTarget(zone.target, dropTarget);
        return (
          <div
            key={`${zone.target.side}:${zone.target.index}:${zone.target.mode}`}
            className={`fixed flex items-center justify-center rounded-md border transition-all duration-100 ${
              active
                ? 'border-blue-300 bg-blue-500/35 text-blue-50 shadow-lg shadow-blue-500/30'
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
      {/* §5.5 #17-6 (H-6) ③ **선으로 그린 가상 창** — 앱 밖까지 이어지는 정본은 main 의 클릭통과
          투명 창이고(`ghostFrame.ts`), 이것은 그 창을 만들지 못한 환경의 폴백이라 앱 경계에서
          잘린다. 선이 아예 없는 것보다 잘린 선이 낫다(무엇이 어디로 빠지는지는 여전히 보인다).
          자리는 상태가 아니라 rAF 가 DOM 에 직접 쓴다 — 끄는 동안 리렌더 ❌. */}
      {popOutGhost?.kind === 'inapp' && (
        <div
          ref={ghostElRef}
          data-ide-popout-ghost="1"
          className={`fixed left-0 top-0 rounded-lg border-2 ${
            popOutGhost.armed
              ? 'border-violet-300/90 bg-violet-500/[0.12]'
              : 'border-violet-400/70 bg-violet-500/[0.06]'
          }`}
          style={{ pointerEvents: 'none', zIndex: 49, willChange: 'transform' }}
          aria-hidden="true"
        />
      )}
      {/* 자석 안내선 — 왜 창이 마지막 몇 px 을 알아서 맞췄는지 눈으로 보이게 한다. */}
      {magnetGuides.x !== null && (
        <div className="fixed bottom-0 top-0 w-px bg-sky-400/70" style={{ left: magnetGuides.x, pointerEvents: 'none', zIndex: 49 }} aria-hidden="true" />
      )}
      {magnetGuides.y !== null && (
        <div className="fixed left-0 right-0 h-px bg-sky-400/70" style={{ top: magnetGuides.y, pointerEvents: 'none', zIndex: 49 }} aria-hidden="true" />
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
        {/* §5.5 #17-6 (H-6) ③ 밖으로 빼는 중 — 본체는 여기 멎어 있고 손을 따라가는 것은 선이다.
            그 자리에 남는 이 창은 **무슨 일이 일어나는지**만 말한다: 조금 더 끌면 나간다(연보라),
            여기까지 왔으면 놓기만 해도 나간다(무장 — 밝은 보라). 종전 (H-3) 의 예고 문구가
            문구뿐이었던 자리를, 이제는 문구와 **그림**(가상 창)이 함께 채운다. */}
        {popOutGhost && (
          <div
            className={`pointer-events-none absolute inset-0 z-30 rounded-lg border-2 ${
              popOutGhost.armed
                ? 'border-violet-300/80 bg-violet-500/[0.10]'
                : 'border-violet-400/40 bg-violet-500/[0.04]'
            }`}
            aria-hidden="true"
          >
            <div className={`absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-md border bg-gray-900/90 px-2.5 py-1 text-[12px] shadow-lg shadow-black/50 ${
              popOutGhost.armed ? 'border-violet-300/80 text-violet-50' : 'border-violet-400/60 text-violet-100'
            }`}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="8" width="13" height="13" rx="2" />
                <path d="M8 3h13v13" />
              </svg>
              {popOutGhost.armed ? t('ide.overlay.popOutGhostArmedHint') : t('ide.overlay.popOutGhostHint')}
            </div>
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
        {/* Title bar — §3.7 v2.14 명도 ramp 중간 톤 (v2.15: 상단 액센트 라인 제거 — 사용자 요청).
            §5.5 #17-1 — 타이틀바 드래그로 modal↔floating↔docked 전이.
            §5.5 #17-6 (H-4) — fullWindow(독립 창)도 **우리 드래그**로 OS 창째 옮긴다(종전 app-drag ❌).
            OS 가 창을 끄는 동안에는 렌더러에 아무 신호도 오지 않아 "앱 안으로 들어왔다"를 알 수 없다. */}
        <div
          onMouseDown={handleTitleBarMouseDown}
          onDoubleClick={handleTitleBarDoubleClick}
          onMouseEnter={() => { titleBarHoveredRef.current = true; }}
          onMouseLeave={() => { titleBarHoveredRef.current = false; }}
          className="flex h-10 flex-shrink-0 cursor-grab items-center justify-between border-b border-gray-700 bg-[#1a2236] px-4 select-none active:cursor-grabbing"
        >
          {/* 좌측 묶음은 **줄어들 수 있어야** 한다(min-w-0) — 이게 없으면 긴 에이전트 이름이
              우측 버튼 묶음을 통째로 화면 밖으로 밀어 [닫기]가 사라진다(폰 실사용 보고). */}
          <div className="flex min-w-0 items-center gap-2">
            {/* §4 v3.24 — 좌측 내비 서랍 토글. 활동바·사이드바가 자리를 비운 동안 그것을 되부르는
                유일한 손잡이라, **서랍인 동안에만** 뜬다(넓은 창에서는 종전처럼 없다). */}
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
            {isLocalAgent || !chrome.showTypeBadge ? (
              /* 폰(chrome.showTypeBadge=false)에서도 이 자리를 비운다 — `커스텀/훅/CMD` 는 같은 사실이
                 하단 상태바에 있고, 좁은 줄에서는 이름과 [닫기]가 먼저다.
                 §5.19 (G) — 로컬 버블의 정체 뱃지(All Model + 지금 문 모델명)는 이 자리를 떠나
                 **하단 상태바의 밀도 토글 옆**(`StreamLocalModelButton`)으로 내려갔다(사용자 지시).
                 여기에 `커스텀` 뱃지를 대신 달지는 않는다 — 정체를 거짓으로 말하게 된다. */
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
            {/* §4 v3.25 — 폰 전용 하단 상태바 토글(md:hidden). 기본 숨김인 IDEStatusBar 표시/숨김. */}
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
            {/* §5.5 읽기 설정 — 폭 안(A~D)·읽기 폭·행간/자간/어간·글꼴·모바일 자동 변형.
                초광폭 창에서 한 줄이 길어져 읽기 어려운 문제를 사용자가 직접 조절하는 자리.
                §4 (CMD) — **CMD 버블에서는 그리지 않는다.** 이 설정이 먹는 표면은 `.ide-md`(IDE 본문
                마크다운) 하나인데 CMD 버블은 모든 탭이 PTY 터미널이라 그 표면이 없다 — 터미널 글자는
                xterm 이 셀 폭을 직접 재서 그리므로 CSS 변수가 닿지 않는다(카드 레일도 `.ide-md` 를
                쓰지 않는다). 눌러도 아무 일이 없는 버튼은 "고장난 것"으로 읽히므로 자리를 비운다.
                터미널 쪽 글자 크기는 터미널 자신의 컨트롤(Ctrl +/- · 툴바)이 이미 맡고 있다. */}
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
                {readingOpen && (
                  <ReadingSettingsPopover
                    onClose={closeReading}
                    mobileAdapted={mobileAdapted}
                    fontAvailability={fontAvailability}
                  />
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
                        dock: shortcutLabel('Ctrl+Alt+←→↑↓'),
                        undock: shortcutLabel('Ctrl+Alt+D'),
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
            {/* (판올림 번호 발급 대기) 꺼내 둔 창에서만 뜨는 **되돌리기** — 메인 창의 그 자리로
                IDE 를 다시 열고 이 창은 닫는다. 꺼내는 길만 있고 돌아오는 길이 없으면 함정이다. */}
            {fullWindow && !!window.api?.overlay?.revealInMain && (
              <button
                type="button"
                onClick={handleReturnClick}
                // (H) 잡아 끌면 합치기 드래그 — 누르고 바로 떼면 종전대로 즉시 되돌리기.
                onPointerDown={handleReturnPointerDown}
                className="app-nodrag flex h-6 w-6 cursor-grab items-center justify-center rounded text-gray-400 transition-colors pointer-coarse:h-9 pointer-coarse:w-9 hover:bg-gray-700 hover:text-gray-200 active:cursor-grabbing"
                aria-label={t('ide.overlay.returnToApp')}
                title={t('ide.overlay.returnToAppHint')}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M14 16l-4-4 4-4" />
                  <path d="M10 12h11" />
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
              aria-label={isMaximized ? t('ide.overlay.restoreLabel') : t('ide.overlay.maximizeLabel')}
              title={isMaximized ? t('ide.overlay.restoreLabel') : t('ide.overlay.maximizeLabel')}
            >
              {isMaximized ? (
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
        />

        {/* Body: Activity bar + Sidebar + Main area.
            §5.5 #17-20 ④ — 활동바 우측 영역 전체를 덮는 별도 "세션창"은 이제 실행 출력 하나뿐이다
            (북마크·세션 요약은 v4.93, 실행 중 서브에이전트는 #17-9 ③ v4.95 부터 사이드바 뷰). */}
        <div ref={bodyRef} className="relative flex min-h-0 flex-1">
          {/* §4 v3.24 — 좌측 내비(활동바+사이드바)가 서랍이면 타이틀바 토글로만 연다. 열리면 본문 위
              오버레이로 뜨고, backdrop 탭으로 닫는다. 서랍이 되는 조건이 폰 폭에서 **창 폭**으로
              넓어졌을 뿐(#17-1 확장), 여는 손잡이와 거동은 종전 그대로다. */}
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
          <IDESplitView agentId={agentId} isCustom={isCustom} />
          {/* §5.5 #17-27 v4.87 — 내장 편집창. 대화를 덮지 않고 그 오른쪽에 선다(열린 파일이 없으면 렌더 ❌).
              나란히 세울 폭이 안 남으면(폰이거나 창이 좁으면) 대화 위 오버레이로 뜬다. */}
          <IDEEditorPane />
          {/* §5.5 #17-20 ④ v4.74 — 실행 출력. 디버그 뷰에서 [출력]을 누르면 열린다(같은 덮개 자리).
              활동바가 서랍이면 화면 전체, 자리에 서 있으면 그 오른쪽부터 — 덮개가 활동바를 가리면
              사이드바를 되부를 손잡이가 사라진다(편집창 덮개와 같은 규칙). */}
          {runOutputRunId && (
            <div className={`absolute inset-y-0 right-0 z-20 ${bodyLayout.navDrawer ? 'left-0' : 'left-12'}`}>
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

        {/* §5.5 #17-35 ⑨⑩ — 시연 녹화 상시 마운트 층(스트림·녹화기·소스 피커·시연 창).
            검증 뷰가 아니라 여기 사는 이유는 하나다 — 사이드바가 접혀도 녹화가 끊기면 안 된다. */}
        <VerifyDemoLayer />

        {/* Status bar — §4 v3.25: 서랍 폭에서는 기본 숨김, 타이틀바 토글 버튼으로만 표시. */}
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
    </IDEBodyLayoutContext.Provider>
  );
});

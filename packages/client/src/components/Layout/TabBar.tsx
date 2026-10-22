import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import type { IframeTab } from '../../stores/graphStore.js';
import { TabContextMenu } from './TabContextMenu.js';
import { HoverTooltip } from './HoverTooltip.js';
import { useTabPushAnimation } from '../../hooks/useTabPushAnimation.js';
// §5.4 #14 — 고른 탭이 커지는 움직임(FLIP · 합성 스레드 · 아이폰식 스프링).
import { useTabSelectionMotion } from '../../hooks/useTabSelectionMotion.js';
import { TAB_SELECTION_FLIP, tabSelectionKey } from '../../hooks/tabSelectionMotionGeom.js';
import { useCommand } from '../../hooks/useCommand.js';
import { applyLocalOrder } from '../../hooks/tabPushGeom.js';
// §5.4 #14-2 — 집어 들어 옮기는 손짓 한 벌(활동바·IDE 세션 탭과 같은 훅 — 탭은 꾹 누르지 않고 끌어서 든다, (F-6)).
import { usePointerDragReorder, type PointerDragGrab, type PointerDragPoint } from '../../hooks/usePointerDragReorder.js';
// §5.4 #14-1 (H) — 띠 밖에서 손을 따라오는 가상 창의 수명 그물 주기는 IDE·앱 창의 선과 같은 값이다.
import { WINDOW_PULL_OUT } from '../../hooks/floatingWindowGeom.js';
import { TabDetachOutline } from './TabDetachOutline.js';
// 화면에 선 탭만 끌 수 있으므로(별창으로 빠진 탭은 줄에 없다) 새 순서는 **그 자리들에만** 되꽂는다.
import {
  applyVisibleOrder,
  detachGhostFrame,
  isRemoteWebUrl,
  projectOrderFollows,
  PROJECT_TAB_ORDER,
  type DetachGhostFrame,
} from '@vibisual/shared';
// §5.4 #14-2 (C-1) — 프로젝트 탭끼리의 순서는 서버 `openProjects` 순서를 따르고, 놓은 직후에는 그 순서를 붙든다.
import {
  syncTabOrder,
  sameTabOrder,
  beginProjectTabOrderHold,
  settleProjectTabOrderHold,
  isProjectTabOrderHoldDone,
  heldProjectTabOrder,
  type TabOrderEntry,
  type ProjectTabOrderHold,
} from './projectTabOrder.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { resolveHeaderAgentCounts } from './headerAgentCounts.js';
import { resolveTabCloseIntent, stopTargetProjectIds, type TabCloseTarget } from './tabCloseConfirm.js';
import { clientPathKey, clientPathPlatform } from '../../utils/platform.js';

/** 서버 순서를 아직 모를 때(첫 스냅샷 전) — 한 배열을 돌려 써서 메모가 매 렌더 깨지지 않게. */
const NO_PROJECT_ORDER: readonly string[] = [];

type TabItem =
  | {
      kind: 'project';
      key: string;
      name: string;
      path: string;
      /** 이 프로젝트의 살아 있는(휴지통 아닌) 에이전트 수 — 배지를 그릴지 말지의 기준. */
      count: number;
      completedCount: number;
      /** 그 에이전트들의 세션 수(배지 분모). */
      sessionCount: number;
      /** 그중 지금 돌고 있는 세션 수(배지 분자). */
      runningCount: number;
    }
  | { kind: 'iframe'; key: string; tab: IframeTab };

// Header 우측 인디케이터와 동일 신호 — active>0 파랑, completed>0 녹색, 그 외 회색.
type ProjectDotState = 'idle' | 'completed' | 'active';
const PROJECT_DOT_STYLES: Record<ProjectDotState, string> = {
  idle: 'bg-gray-400',
  completed: 'bg-emerald-400 animate-pulse',
  active: 'bg-blue-400 animate-pulse',
};

/**
 * §5.4 #14 — 탭 폭. 고르지 않은 탭은 한 칸으로 줄 세우고, **고른 탭만** 폭이 내용을 따라간다.
 *
 * 한 칸(128px)을 이름·배지(`1/19`)·닫기 버튼이 나눠 쓰면 이름 몫이 40px 남짓이라, 지금 보고 있는
 * 프로젝트조차 `P_M…` 로 읽혔다(사용자 지시). 고른 탭은 한 칸보다 좁아지지 않고, 이름 칸이
 * `TAB_LABEL_ACTIVE_MAX` 까지 이름 전체를 보인다 — 그보다 긴 이름은 오른쪽 끝에서 부드럽게 흐려진다.
 * 기준을 탭이 아니라 이름 칸에 거는 것은 핀·기본 글리프나 배지 자릿수가 이름 몫을 다시 깎지 않게 하려는 것이다.
 * 프로젝트 탭·iframe 탭이 같은 값을 쓴다(같은 줄에서 고른 탭의 모양이 종류마다 갈리지 않게).
 */
const TAB_WIDTH_IDLE = 'w-32';
const TAB_WIDTH_ACTIVE = 'min-w-32';
/** 고른 탭 이름 칸의 최대 폭(끝 페이드 여백 포함). 넘는 이름은 툴팁으로 읽는다. */
const TAB_LABEL_ACTIVE_MAX = 'max-w-[200px]';
/**
 * §5.4 #14 — 고른 탭이 바뀔 때 **CSS 가 맡는 것은 글자색뿐**이다. 크기·위치·판은 `useTabSelectionMotion` 이
 * 옛 모양에서 새 모양으로 풀어 준다(FLIP — transform·opacity 만 움직여 합성 스레드가 돌린다). 종전에는 높이·
 * 바깥 여백·폭을 메인 스레드에서 바꿔 가며 움직여, 프로젝트를 바꾸며 캔버스를 다시 그리는 동안 움직임이
 * 화면에 거의 안 남았고, 움직임 줄이기(OS 설정)에서는 `motion-reduce:` 변형으로 전환이 통째로 꺼졌다.
 */
const TAB_SELECTION_MOTION = 'transition-colors duration-200 ease-out';
/**
 * §5.4 #14 — 탭의 **판**(배경·윗선·구분선·둥근 모서리). 크기가 바뀌는 순간 판만 옛 크기에서 새 크기로
 * 늘거나 줄어야 하므로 본체가 아니라 본체를 덮는 이 층이 그린다(본체의 테두리는 자리만 잡는 투명 선이다 —
 * 판이 그 자리까지 덮는다). 쉬는 판과 고른 판을 겹쳐 두고 불투명도로 갈아 끼운다.
 */
const TAB_PLATE = 'pointer-events-none absolute -top-0.5 -right-px bottom-0 left-0 origin-top-left';
const TAB_PLATE_LAYER = 'absolute inset-0 border-r border-t-2 border-black/30 transition-[opacity,background-color] duration-[260ms] ease-out';
const TAB_PLATE_IDLE = `${TAB_PLATE_LAYER} rounded-t border-t-transparent bg-black/25 group-hover:bg-black/40`;
const TAB_PLATE_ACTIVE = `${TAB_PLATE_LAYER} rounded-t-md bg-gray-950`;

/**
 * projectId 정규화 — 서버 appState(경로키)와 동일 semantics.
 * 대소문자 접기는 플랫폼이 정한다(utils/platform.ts) — Linux 에서 무조건 접으면 케이스만 다른
 * 두 프로젝트가 같은 탭으로 뭉개진다.
 */
function npClient(p: string): string {
  return clientPathKey(p);
}

type TabContextState = {
  key: string;
  index: number;
  x: number;
  y: number;
};

function tabPinKey(item: TabItem): string {
  // iframe만 로컬 tabPins 대상. project는 서버 appState에서 관리되므로 이 key는 사용 X.
  return item.kind === 'iframe' ? `iframe:${item.tab.id}` : `project:${item.name}`;
}

/**
 * §5.4 #14-3 — 탭 하나를 닫기 판정용 모양으로 접는다.
 *
 * `runningCount` 는 탭 배지가 그리는 **바로 그 숫자**다(서버 집계 SSOT, §3.1). 팝업이 자기 식으로
 * 다시 세면 배지에는 `3/12` 인데 팝업은 "도는 게 없다"고 말하는 어긋남이 생긴다.
 */
function toCloseTarget(item: TabItem): TabCloseTarget {
  if (item.kind === 'project') {
    return {
      key: item.key,
      kind: 'project',
      label: item.name,
      runningCount: item.runningCount,
      projectId: item.path,
    };
  }
  // iframe 탭은 에이전트를 갖지 않는다 — 언제나 즉시 닫힘 경로.
  return { key: item.key, kind: 'iframe', label: item.tab.label, runningCount: 0 };
}

// §5.4 #14-1 v2.35 — safe-zone 은 **헤더 행 전체**(h-9 = 36px 띠, 가로 무관)다.
// 사용자 의도: File 메뉴 등 헤더 안 어디서든 reorder 영역, 헤더 띠를 벗어나야(=캔버스로 내려와야) detach.
// 별창에서도 동일 — 별창의 미니 타이틀바도 36px 띠지만 별창엔 TabBar 가 없으므로 이 컨테이너 자체가 마운트 안 됨.
const HEADER_SAFE_HEIGHT = 36;

/**
 * 이 창에서 탭을 별창으로 뗄 수 있는가 — 창을 못 여는 판(웹·모바일 접속)에서 "놓으면 별창" 표시와
 * 선만 뜨고 아무 일도 안 일어나면 그건 고장으로 읽힌다(§5.13 (S-3) `pullOut.enabled` 와 같은 규율).
 */
function canDetachTabs(): boolean {
  return typeof window !== 'undefined' && !!window.api?.window;
}

/**
 * §5.4 #14-1 (H) — 떼어 내는 동안의 선을 **누가 그리는가**. `os` 면 main 의 클릭통과 창이 앱 밖까지
 * 잇고(`ghostFrame.ts`), `inapp` 은 그 창이 서기 전이거나 못 띄우는 환경이라 앱 안에 그린다.
 */
interface DetachGhostView {
  kind: 'os' | 'inapp';
  frame: DetachGhostFrame;
  /** 손에 든 고스트 칸 안에서 선이 설 자리(탭 안 잡은 지점 − 선의 잡은 지점). */
  offset: { x: number; y: number };
}

/** 한 판의 선 — 유지·멈춤을 부탁할 때 같은 값을 보내야 선이 흔들리지 않는다. */
interface DetachGhostSession {
  seq: number;
  frame: DetachGhostFrame;
  label: string;
  hint: string;
  /** main 에 선을 부탁했는가 — 그랬다면 거둘 때도 main 에 말해야 한다(클릭통과 선은 사용자가 못 없앤다). */
  requested: boolean;
  /** main 의 선이 실제로 그려졌는가(`ghostShow` 가 참으로 답했다) — 아니면 놓는 순간 앱 안 선이 그 틈을 잇는다. */
  painted: boolean;
  keepAlive: number | null;
}

/** 손을 뗀 뒤 main 의 선이 그려지기를 기다리며 놓은 자리에 세워 두는 앱 안 선. */
interface SettledDetachOutline {
  seq: number;
  frame: DetachGhostFrame;
  /** 뷰포트 좌표의 선 좌상단 — 놓은 커서에서 선의 잡은 지점을 뺀 자리(= main 의 선이 멈춘 자리). */
  at: { x: number; y: number };
  label: string;
  hint: string;
}

/**
 * 멈춘 앱 안 선의 상한(ms) — main 의 선 대답이 끝내 안 와도 화면에 남지 않게.
 * main 은 선의 문서가 선 뒤에 대답하고 그 기다림의 상한이 300ms 다(`ghostFrame.ts`) — 그보다 넉넉히.
 */
const DETACH_SETTLED_OUTLINE_MAX_MS = 600;

export function TabBar(): React.JSX.Element | null {
  const { t } = useTranslation();
  const registeredProjects = useGraphStore((s) => s.projects);
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const activeProject = useGraphStore((s) => s.activeProject);
  const agents = useGraphStore((s) => s.agents);
  // §9 스코프드 구독 — 배지 숫자는 **서버 집계**를 쓴다. `agents` 는 지금 보는 프로젝트 것만
  //   실려 오므로(구독 범위), 그걸로 세면 배경 탭 배지가 전부 0 으로 보인다.
  const projectAgentCounts = useGraphStore((s) => s.projectAgentCounts);
  // 서버 집계가 없을 때만 쓰는 폴백 입력(구버전 스냅샷 · 첫 프레임). 헤더 배지와 **같은 함수**를
  //   통과시켜 두 배지가 다른 규칙으로 세는 일을 없앤다.
  const subAgents = useGraphStore((s) => s.subAgents);
  const queuedCommands = useGraphStore((s) => s.queuedCommands);
  const runningSubagentTasks = useGraphStore((s) => s.runningSubagentTasks);
  // §9 배경 탭 유휴 해제 — 내려간(stub) 프로젝트도 **탭은 그대로 보여야 한다**. 안 그리면
  //   "오래 안 봤더니 탭이 사라졌다"가 되어 정리가 아니라 손실로 보인다. 클릭하면 되살아난다.
  const stubProjects = useGraphStore((s) => s.stubProjects);
  // §5.4 #14 v1.34 — × 를 누른 즉시 사라지게 하는 표시. 서버 왕복 + 스냅샷 배치 창(§9, 최대 250ms)
  //   동안 탭이 그대로 남아 "닫기가 안 먹었다"로 보이던 것을 없앤다(별창 `detachedTabKeys` 와 같은 방식).
  const closingProjectPaths = useGraphStore((s) => s.closingProjectPaths);
  const iframeTabs = useGraphStore((s) => s.iframeTabs);
  const activeIframeId = useGraphStore((s) => s.activeIframeId);
  const tabPins = useGraphStore((s) => s.tabPins);
  const defaultTabbarKey = useGraphStore((s) => s.defaultTabbarKey);
  const appState = useGraphStore((s) => s.appState);
  // §5.4 #14-4 — "닫은 탭 다시 열기" 목록. 서버 AppState 가 SSOT 라 여기서는 **그리기만** 한다.
  //   선택자가 이미 있는 배열 참조를 그대로 돌려주므로(구조적 공유를 탄 appState) 매 스냅샷마다
  //   새 참조가 되어 다시 그려지는 일은 없다.
  const recentlyClosed = useGraphStore((s) => s.appState?.recentlyClosedTabs);
  // SCENARIO.md §5.4 #14-1 (v2.29) — 별창으로 분리된 탭은 메인 TabBar 에서 숨김.
  const detachedTabKeys = useGraphStore((s) => s.detachedTabKeys);
  // Redock hover 상태(별창 헤더 드래그가 메인 탭바 위에 있을 때 별창이 메인에 푸시).
  const [redockHoverKey, setRedockHoverKey] = useState<string | null>(null);

  // 프로젝트 탭은 서버 appState가 SSOT, iframe 탭은 로컬 tabPins/defaultTabbarKey가 SSOT.
  const isItemPinned = useCallback((item: TabItem): boolean => {
    if (item.kind === 'project') {
      // v1.63: appState 는 projectId(경로) 키 — item.path 로 정규화 비교.
      const k = npClient(item.path);
      return !!appState?.pinnedProjects.some((p) => npClient(p) === k);
    }
    return !!tabPins[tabPinKey(item)];
  }, [appState, tabPins]);

  const isItemDefault = useCallback((item: TabItem): boolean => {
    if (item.kind === 'project') {
      return !!appState?.defaultProject && npClient(appState.defaultProject) === npClient(item.path);
    }
    return defaultTabbarKey === tabPinKey(item);
  }, [appState, defaultTabbarKey]);

  // --- Build unordered tab items ---
  const projectItems = useMemo((): TabItem[] => {
    // SSOT §5.7 #26: worktree 프로젝트는 부모 캔버스 내 버블로만 노출 — TabBar에서 제외.
    // 닫는 중(× 를 누른) 프로젝트는 서버 스냅샷이 아직 그것을 싣고 있어도 그리지 않는다.
    const isClosing = (p: string): boolean => !!closingProjectPaths[npClient(p)];
    const hydratedItems = Object.values(registeredProjects)
      .filter((info) => !info.parentProjectPath && !isClosing(info.path))
      .map((info) => {
        // 서버가 준 집계가 있으면 그것이 SSOT(§3.1). 없을 때만(구버전 스냅샷) 종전처럼 직접 센다.
        //   숫자 규칙은 헤더 배지와 공유한다 — 같은 사실을 두 벌로 세면 반드시 어긋난다.
        const counts = resolveHeaderAgentCounts(projectAgentCounts[info.name], {
          agents,
          agentProjects,
          project: info.name,
          subAgents,
          queuedCommands,
          runningSubagentTasks,
        });
        const served = projectAgentCounts[info.name];
        return {
          kind: 'project' as const,
          key: `p:${info.name}`,
          name: info.name,
          path: info.path,
          count: counts.agents,
          completedCount: counts.completed,
          sessionCount: counts.sessions,
          runningCount: counts.running,
        };
      });
    // 내려가 있는(stub) 프로젝트를 같은 목록에 얹는다. 에이전트 수는 메모리에 없으므로 0 —
    // 배지는 `count > 0` 일 때만 그려지니 숫자가 "0/0" 으로 보이지 않고 조용히 빠진다.
    const stubItems = Object.entries(stubProjects)
      .filter(([name, meta]) => !meta.project.parentProjectPath && !registeredProjects[name] && !isClosing(meta.project.path))
      .map(([name, meta]): TabItem => ({
        kind: 'project' as const,
        key: `p:${name}`,
        name,
        path: meta.project.path,
        count: 0,
        completedCount: 0,
        sessionCount: 0,
        runningCount: 0,
      }));
    return [...hydratedItems, ...stubItems];
  }, [registeredProjects, stubProjects, closingProjectPaths, agentProjects, agents, projectAgentCounts, subAgents, queuedCommands, runningSubagentTasks]);

  const iframeItems = useMemo((): TabItem[] => {
    return iframeTabs.map((tab) => ({
      kind: 'iframe' as const,
      key: `i:${tab.id}`,
      tab,
    }));
  }, [iframeTabs]);

  // --- Tab ordering (local UI state) ---
  const [tabOrder, setTabOrder] = useState<string[]>([]);

  // §5.4 #14-2 (C-1) — **프로젝트 탭끼리의 순서는 서버 `AppState.openProjects` 의 배열 순서**다(껐다 켜도 남는다).
  //   종전에는 이 줄 순서가 여기 휘발 상태뿐이라, 앱을 켤 때마다 첫 스냅샷이 실어 온 순서("마지막으로 보던 프로젝트
  //   → 나머지")로 다시 섰다 — 끌어서 맞춰 둔 자리가 흐트러지고 마지막에 본 탭이 맨 앞으로 튀었다(사용자 보고).
  //   iframe 탭은 서버가 모르므로 종전처럼 이 로컬 순서 안의 제자리다.
  const serverProjectOrder = appState?.openProjects ?? NO_PROJECT_ORDER;
  // 놓은 직후의 붙들기 — PATCH 전에 떠난 스냅샷이 옛 순서를 싣고 와 탭을 한 번 되돌리지 않게(`linkViewHold` 와 같은 규율).
  const [orderHold, setOrderHoldState] = useState<ProjectTabOrderHold | null>(null);
  // PATCH 의 답이 자기 붙들기를 찾으려면 지금 값을 곧바로 읽어야 한다 — 바꿀 때마다 ref 도 함께 맞춘다.
  const orderHoldRef = useRef<ProjectTabOrderHold | null>(null);
  const setOrderHold = useCallback((next: ProjectTabOrderHold | null) => {
    orderHoldRef.current = next;
    setOrderHoldState(next);
  }, []);
  /** 줄이 따를 프로젝트 순서 — 붙드는 동안은 서버 순서 위에 놓은 순서를 얹은 것(서버가 PATCH 를 받으면 같은 답). */
  const projectOrder = useMemo(
    () => heldProjectTabOrder(serverProjectOrder, orderHold, clientPathPlatform()),
    [serverProjectOrder, orderHold],
  );

  const tabEntries = useMemo((): TabOrderEntry[] => [
    ...projectItems.map((t): TabOrderEntry => (t.kind === 'project' ? { key: t.key, path: t.path } : { key: t.key })),
    ...iframeItems.map((t): TabOrderEntry => ({ key: t.key })),
  ], [projectItems, iframeItems]);

  useEffect(() => {
    const platform = clientPathPlatform();
    setTabOrder((prev) => {
      const next = syncTabOrder(prev, tabEntries, projectOrder, platform);
      return sameTabOrder(prev, next) ? prev : next;
    });
  }, [tabEntries, projectOrder]);

  // 붙들기를 놓는다 — 보낸 PATCH 가 다 답한 뒤 서버 순서가 놓은 순서를 따르면 곧바로, 아무것도 안 오면 안전망 시간 뒤에.
  useEffect(() => {
    if (!orderHold) return;
    const now = Date.now();
    if (isProjectTabOrderHoldDone(orderHold, serverProjectOrder, now, PROJECT_TAB_ORDER.pendingMs, clientPathPlatform())) {
      setOrderHold(null);
      return;
    }
    const timer = setTimeout(() => {
      if (orderHoldRef.current === orderHold) setOrderHold(null);
    }, Math.max(0, orderHold.at + PROJECT_TAB_ORDER.pendingMs - now) + 1);
    return () => clearTimeout(timer);
  }, [orderHold, serverProjectOrder, setOrderHold]);

  const tabMap = useMemo(() => {
    const map = new Map<string, TabItem>();
    for (const item of projectItems) map.set(item.key, item);
    for (const item of iframeItems) map.set(item.key, item);
    return map;
  }, [projectItems, iframeItems]);

  const orderedTabs = useMemo(() => {
    return tabOrder
      .map((key) => tabMap.get(key))
      .filter((t): t is TabItem => !!t)
      // §5.4 #14-1 — 별창으로 분리된 탭은 메인 탭바에서 숨김.
      .filter((t) => !detachedTabKeys[t.key]);
  }, [tabOrder, tabMap, detachedTabKeys]);

  /** 지금 줄에 실제로 선 탭들 — 끌 수 있는 것도, 새 순서를 되꽂을 자리도 이것뿐이다. */
  const visibleKeys = useMemo(() => orderedTabs.map((t) => t.key), [orderedTabs]);

  // --- 가로 스크롤 칸 (탭 오버플로우 시 좌/우 페이드 + wheel 가로 스크롤 + hover 오버레이 썸) ---
  // 콜백 ref 패턴 — useRef 는 DOM 마운트 시점에 effect 를 깨우지 못한다(초기 마운트 때 ref 가 null 이면
  // observer 가 영영 등록되지 않는 버그가 있었다). state 기반 ref 는 element 가 붙는 시점에 useEffect 가
  // 다시 돌아가서 항상 observer/scroll listener 가 정상 부착된다.
  //   **끄는 손짓도 이 칸을 기준으로 잰다**(중앙선·가장자리 자동 스크롤)므로 선언이 여기 앞에 있다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  // §5.4 #14-1 (v2.29) — 별창이 메인에 푸시하는 redock-hover/commit 구독.
  // 메인 윈도우의 TabBar 만 이 신호를 본다(별창은 자기 자신을 띄운 게 아니라 detach 한 측이 메인).
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.window) return;
    const offHover = api.window.onRedockHover(({ tabKey, hovering }) => {
      setRedockHoverKey(hovering ? tabKey : null);
    });
    const offCommit = api.window.onRedockCommit(({ tabKey }) => {
      setRedockHoverKey((cur) => (cur === tabKey ? null : cur));
    });
    return () => {
      offHover();
      offCommit();
    };
  }, []);

  // --- 끌어서 자리를 옮긴다 (§5.4 #14-2 (F-6) · 활동바 §5.5 #16-1 (E) 와 같은 한 벌) ---
  //
  // 종전에는 HTML5 네이티브 DnD 였다 — 살짝만 밀어도 탭이 즉시 "뚝 떨어져" 반투명해지고, 손에 붙어
  // 오는 것은 탭이 아니라(그마저도 1×1 투명 캔버스로 지워 놓아서) 안내 카드 한 장뿐이었으며, 놓을
  // 때는 네이티브 되돌리기 연출이 한 번 더 끼어들었다(사용자 지적 — "때서 붙이는 느낌이 너무
  // 어색해"). 그 셋은 전부 네이티브 DnD 가 정하는 것이라 CSS 로는 손댈 수 없다.
  //
  // 이제 **탭 자신이 손에 붙어 온다** — 누른 채 끌면 곧장 집어 들고, 지나는 탭이 밀리고, 헤더 띠 밖에서
  // 놓으면 별창으로 나간다(#14-1 detach 는 그대로다 — 판정 좌표만 `dragend` 에서 `pointerup` 으로 옮겼다).
  // 꾹 누르는 기다림은 없다(§5.4 #14-2 (F-6)) — 문턱(`POINTER_DRAG.dragStartPx`) 안에서 떼면 평소의 클릭이다.

  // §5.4 #14-1 — 드래그 중 마우스가 탭바 밖에 있어 detach 가 예상되는 상태일 때 detach-hint 표시.
  const [detachHint, setDetachHint] = useState(false);

  /**
   * §5.4 #14-1 (H) — 띠 밖에서 손을 따라오는 **가상 창**(곧 설 별창 크기 그대로의 선).
   *
   * 종전에 손에 들린 것은 탭 모양의 DOM 이라 **앱 창 경계에서 잘려 사라졌다** — 앱 밖은 렌더러가 그릴
   * 수 없다(사용자 보고 — "앱의 경계에서 그림이 사라져서 내 마우스를 따라오지 않는 느낌"). IDE 창을 밖으로
   * 빼는 길(§5.5 #17-6 (H-6)·(H-19))과 같이, 띠 밖에서는 탭 대신 선 하나가 손을 따라오고 그 선은 main 의
   * 클릭통과 창이 앱 밖까지 잇는다. 놓으면 별창이 **그 선의 자리·크기 그대로** 선다((H-17) ④).
   */
  const [detachGhost, setDetachGhost] = useState<DetachGhostView | null>(null);
  const detachGhostRef = useRef<DetachGhostSession | null>(null);
  const detachGhostSeqRef = useRef(0);
  // 빠르게 놓은 손 — main 의 선이 그려지기 전에 손을 뗐으면 그 선이 설 때까지 앱 안 선이 놓은 자리를 지킨다.
  const [settledOutline, setSettledOutline] = useState<SettledDetachOutline | null>(null);
  const settledOutlineTimerRef = useRef<number | null>(null);

  /** 헤더 띠 밖에서 놓았다 — 그 탭을 별창으로 뗀다(§5.4 #14-1). `fromGhost` 면 멈춰 세운 선의 자리·크기에 선다. */
  const detachTab = useCallback((draggedKey: string, screenX: number, screenY: number, fromGhost = false) => {
    const item = tabMap.get(draggedKey);
    if (!item) {
      // 그 사이 탭이 사라졌다 — 이어받을 별창이 없으니 멈춰 세운 선도 남기지 않는다.
      if (fromGhost) void window.api?.overlay?.ghostHide?.();
      return;
    }

    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.window) {
      // packaged 가 아닌 경우엔 detach 불가 — 단순 noop.
      return;
    }

    // screen 좌표가 필요(BrowserWindow 좌상단 기준) — 포인터 이벤트의 screenX/Y 를 그대로 쓴다.
    //   선이 있으면 main 은 이 좌표 대신 선의 경계를 직접 읽는다(배율이 다른 모니터에서도 놓은 그 자리).
    const cursor = { x: screenX, y: screenY };

    void api.window
      .detach({ kind: item.kind, tabKey: draggedKey, cursor, ...(fromGhost ? { fromGhost: true } : {}) })
      .then(({ reused }) => {
        // 활성 탭을 detach 한 경우 메인을 다음 visible 탭으로 자동 전환(§5.4 #14-1 B).
        // detach 후 server 의 detachedTabKeys 가 broadcast 되어 store 가 즉시 갱신됨.
        // 메인의 activeProject/activeIframeId 가 detach 된 탭과 같으면 다음 탭으로 이동.
        if (reused) return;
        const store = useGraphStore.getState();
        const wasActiveProject = item.kind === 'project' && store.activeProject === item.name;
        const wasActiveIframe = item.kind === 'iframe' && store.activeIframeId === item.tab.id;
        if (!wasActiveProject && !wasActiveIframe) return;
        const remaining = tabOrder
          .map((k) => tabMap.get(k))
          .filter((t): t is TabItem => !!t)
          .filter((t) => t.key !== draggedKey)
          // 새로 detach 된 키는 아직 store 에 반영 안 됐을 수 있으므로 명시 제외.
          .filter((t) => !store.detachedTabKeys[t.key]);
        const nextTab = remaining[0] ?? null;
        if (!nextTab) {
          // 비울 수 없는 setter 가 없으므로 직접 store set.
          store.setActiveProjectLocal(null);
          store.setActiveIframeIdLocal(null);
        } else if (nextTab.kind === 'project') {
          // 메인은 setActiveProject(서버 patch 포함) 호출 — local 이 아니라 정식 액션.
          store.setActiveProject(nextTab.name);
        } else {
          store.setActiveIframeTab(nextTab.tab.id);
        }
      })
      .catch((err) => {
        console.error('[TabBar] detach failed', err);
        // §5.4 #14-1 (H) 별창이 못 섰다 — 멈춰 세운 선을 남기지 않는다(클릭통과라 사용자가 없앨 수 없다).
        if (fromGhost) void window.api?.overlay?.ghostHide?.();
      });
  }, [tabMap, tabOrder]);

  /**
   * §5.4 #14-1 (H) 띠 밖으로 나왔다 — 곧 설 별창 크기의 선을 손에 매단다. 이미 떠 있으면 그대로다
   * (한 판 안에서 크기·잡은 지점은 변하지 않는다 — 다시 재면 선이 손 아래에서 흔들린다).
   */
  const showDetachGhost = useCallback((key: string, grab: PointerDragGrab): void => {
    if (detachGhostRef.current) return;
    const item = tabMap.get(key);
    const label = item?.kind === 'project' ? item.name : item?.kind === 'iframe' ? item.tab.label : key;
    const scr = typeof window !== 'undefined' ? window.screen : undefined;
    const frame = detachGhostFrame({
      grab,
      avail: scr && scr.availWidth > 0 && scr.availHeight > 0 ? { width: scr.availWidth, height: scr.availHeight } : null,
    });
    const hint = t('tabDetach.detachCardTitle', { defaultValue: 'Drop here to open as new window' });
    const seq = detachGhostSeqRef.current + 1;
    detachGhostSeqRef.current = seq;
    const ov = window.api?.overlay;
    const session: DetachGhostSession = { seq, frame, label, hint, requested: !!ov?.ghostShow, painted: false, keepAlive: null };
    detachGhostRef.current = session;
    // 선은 **지금 이 프레임에** 서야 한다 — 손에 든 탭은 이미 숨는데 main 의 창이 서기를(백 밀리초 남짓)
    //   기다리면 그동안 손을 따라오는 것이 없다. 앱 안 선으로 먼저 그리고, main 의 선이 그려지면 넘긴다.
    setDetachGhost({ kind: 'inapp', frame, offset: { x: grab.x - frame.grabX, y: grab.y - frame.grabY } });
    if (!ov?.ghostShow) return;
    const look = { ...frame, label, armed: true, hint };
    void ov.ghostShow(look).then((ok) => {
      // 못 띄웠거나(합성 창이 없는 환경 등) 그 사이 선을 거뒀으면 앱 안 선 그대로 간다.
      if (!ok || detachGhostRef.current?.seq !== seq) return;
      session.painted = true;
      setDetachGhost((cur) => (cur ? { ...cur, kind: 'os' } : cur));
    }).catch(() => { /* 앱 안 선으로 계속 간다 */ });
    // main 의 선은 클릭통과라 스스로 걷는 수명 그물(20초)이 있다 — 띠 밖에서 오래 머무는 손 아래에서 그
    //   그물이 선을 걷지 않게 아직 끌고 있다고 알린다(IDE·앱 창 선과 같은 주기).
    session.keepAlive = window.setInterval(() => {
      if (detachGhostRef.current?.seq !== seq) return;
      void window.api?.overlay?.ghostShow?.(look);
    }, WINDOW_PULL_OUT.GHOST_KEEPALIVE_MS);
  }, [tabMap, t]);

  /** §5.4 #14-1 (H) 선을 거둔다 — 띠 안으로 돌아왔거나 판이 끝났다(띠 안에 놓음 · Esc · 창 포커스 상실). */
  const hideDetachGhost = useCallback((): void => {
    const session = detachGhostRef.current;
    if (!session) return;
    detachGhostRef.current = null;
    if (session.keepAlive !== null) window.clearInterval(session.keepAlive);
    setDetachGhost(null);
    if (session.requested) void window.api?.overlay?.ghostHide?.();
  }, []);

  /**
   * §5.4 #14-1 (H) 띠 밖에서 손을 뗐다 — 선을 **그 자리에 멈춘다**. 별창은 그 선의 자리·크기에 서고(main 이
   * 선의 경계를 직접 읽는다), 선은 main 이 그 창이 보인 뒤에 걷는다 — 여기서 걷으면 창이 뜨기까지 놓은
   * 자리가 빈다. 멈춤 부탁은 반드시 `detach` 보다 먼저 나간다(같은 통로라 main 이 차례대로 받는다).
   * @param at 손을 뗀 자리(뷰포트 좌표) — main 의 선이 아직 안 그려졌으면 그 자리에 앱 안 선을 세워 둔다.
   * @returns 별창을 그 선에 맞춰 세울 수 있는가(`detach` 의 `fromGhost`).
   */
  const settleDetachGhost = useCallback((at: PointerDragPoint): boolean => {
    const session = detachGhostRef.current;
    if (!session) return false;
    detachGhostRef.current = null;
    if (session.keepAlive !== null) window.clearInterval(session.keepAlive);
    setDetachGhost(null);
    const ov = window.api?.overlay;
    if (!session.requested || !ov?.ghostShow) return false;
    // main 의 선이 아직 안 섰어도 이 부탁이 지금 커서 자리에 세운다 — 놓은 자리가 비지 않는다.
    const settled = ov.ghostShow({ ...session.frame, label: session.label, armed: true, hint: session.hint, settled: true });
    if (session.painted) {
      void settled.catch(() => { /* 선 없이도 별창은 선다 — main 이 커서 기준 자리로 떨어진다 */ });
      return true;
    }
    // §5.5 #17-6 (H-7) ② 와 같은 자리 — 빠르게 놓은 손에서는 main 의 선이 아직 안 그려졌다. 손에 든 칸이
    //   사라지며 앱 안 선도 함께 사라지면 그 선이 그려질 때까지 놓은 자리에 아무 선도 없는 틈이 생기므로,
    //   대답이 올 때까지 앱 안 선을 놓은 그 자리(= main 의 선이 멈춘 자리)에 세워 둔다.
    const seq = session.seq;
    setSettledOutline({
      seq,
      frame: session.frame,
      at: { x: at.x - session.frame.grabX, y: at.y - session.frame.grabY },
      label: session.label,
      hint: session.hint,
    });
    const clear = (): void => { setSettledOutline((cur) => (cur?.seq === seq ? null : cur)); };
    void settled.then(clear, clear);
    if (settledOutlineTimerRef.current !== null) window.clearTimeout(settledOutlineTimerRef.current);
    settledOutlineTimerRef.current = window.setTimeout(clear, DETACH_SETTLED_OUTLINE_MAX_MS);
    return true;
  }, []);

  // 탭바가 내려가면 떠 있던 선도 함께 거둔다 — 클릭통과 선은 사용자가 없앨 수 없다.
  useEffect(() => () => {
    hideDetachGhost();
    if (settledOutlineTimerRef.current !== null) window.clearTimeout(settledOutlineTimerRef.current);
  }, [hideDetachGhost]);

  /**
   * 손이 지금 띠 밖인가 — 그때 놓으면 별창이다. 무장 표시(`detachHint`)와 선은 이 한 곳에서 함께 켜고
   * 끈다(둘이 갈리면 "놓으면 별창"이라 말하는 그림과 실제가 어긋난다).
   */
  const followDetachZone = useCallback((key: string, p: PointerDragPoint, grab: PointerDragGrab): void => {
    const armed = canDetachTabs() && p.y >= HEADER_SAFE_HEIGHT;
    setDetachHint(armed);
    if (armed) showDetachGhost(key, grab);
    else hideDetachGhost();
  }, [showDetachGhost, hideDetachGhost]);

  /**
   * §5.4 #14-2 (C-1) — 놓은 순서 중 **프로젝트 탭끼리의 앞뒤**를 서버에 남긴다(다음에 켜도 그 자리에 선다).
   * 화면은 기다리지 않는다 — 붙들기가 놓은 순서를 곧바로 그리고, 답은 붙들기를 놓는 근거로만 쓴다.
   */
  const commitProjectOrder = useCallback((nextVisible: readonly string[]) => {
    const paths: string[] = [];
    for (const key of nextVisible) {
      const item = tabMap.get(key);
      if (item?.kind === 'project') paths.push(item.path);
    }
    // 프로젝트 탭끼리의 앞뒤가 그대로면(iframe 탭만 옮겼다) 보낼 것이 없다.
    if (paths.length < 2 || projectOrderFollows(projectOrder, paths, clientPathPlatform())) return;
    const now = Date.now();
    // 답이 자기 붙들기를 찾는 표 — 붙들기를 세우기 **전에** 읽는다(이미 붙들고 있으면 그 붙들기의 것).
    const since = orderHoldRef.current?.since ?? now;
    setOrderHold(beginProjectTabOrderHold(orderHoldRef.current, paths, now));
    void useGraphStore.getState().reorderProjectTabs(paths).then((ok) => {
      setOrderHold(settleProjectTabOrderHold(orderHoldRef.current, since, ok));
    });
  }, [tabMap, projectOrder, setOrderHold]);

  const tabDrag = usePointerDragReorder({
    axis: 'x',
    container: scrollEl,
    keyAttribute: 'data-tab-key',
    order: visibleKeys,
    // 닫기 X 위에서 시작된 누르기는 그 버튼의 것이다(종전 `onPointerDown` stopPropagation 과 같은 뜻).
    ignoreSelector: 'button',
    // §5.4 #14-2 (F-6) — 꾹 누르지 않는다. 누른 채 문턱을 넘게 끌면 곧장 든다(터치만 꾹 누르기로 남는다).
    activation: 'drag',
    onDragStart: (key, p, grab) => { followDetachZone(key, p, grab); },
    onDragMove: (key, p, grab) => { followDetachZone(key, p, grab); },
    onCommit: (next, p, key) => {
      setDetachHint(false);
      // §5.4 #14-1 (H) 놓은 자리가 띠 밖이면 선을 그 자리에 멈추고(별창이 이어받는다), 띠 안이면 거둔다.
      const detaching = canDetachTabs() && p.y >= HEADER_SAFE_HEIGHT;
      const fromGhost = detaching && settleDetachGhost(p);
      if (!detaching) hideDetachGhost();
      // 화면에 선 탭만 끌 수 있으므로 새 순서는 전체 `tabOrder` 의 **그 자리들에만** 되꽂는다
      //   (별창으로 빠진 탭이 사이에 껴 있어도 보이는 앞뒤가 어긋나지 않는다 — #14-2 (C) 키 기반 규약).
      if (next) setTabOrder((prev) => applyVisibleOrder(prev, visibleKeys, next));
      // §5.4 #14-2 (C-1) — 프로젝트 탭끼리의 새 앞뒤는 서버 `openProjects` 순서로 남긴다(껐다 켜도 그 자리).
      if (next) commitProjectOrder(next);
      // 순서가 그대로여도 놓은 자리가 헤더 띠 밖이면 별창이다 — 그래서 `next` 와 배타적이지 않다.
      if (detaching) detachTab(key, p.screenX, p.screenY, fromGhost);
    },
    onCancel: () => { setDetachHint(false); hideDetachGhost(); },
  });

  // 끄는 동안에는 손이 만든 순서가 화면을 붙든다(서버·스토어 왕복 ❌ — #14-2 (C)).
  const shownTabs = useMemo(
    () => (tabDrag.localOrder ? applyLocalOrder(orderedTabs, tabDrag.localOrder, (t) => t.key) : orderedTabs),
    [orderedTabs, tabDrag.localOrder],
  );

  /** 손에 들린 탭의 이름 — 고스트와 안내 문구가 같은 값을 쓴다. */
  const dragLabel = useMemo((): string => {
    const key = tabDrag.dragKey;
    if (key === null) return '';
    const item = tabMap.get(key);
    return item?.kind === 'project' ? item.name : item?.kind === 'iframe' ? item.tab.label : key;
  }, [tabDrag.dragKey, tabMap]);

  // --- Stub tab click ---
  // --- Close handlers ---
  /**
   * 실제 닫기 — 팝업을 거치든 안 거치든 **마지막에는 여기 한 곳**으로 들어온다.
   * (종전 X 버튼 경로가 iframe 기본 탭 해제를 빠뜨리고 있었다 — 컨텍스트 메뉴가 이미 하던
   *  정리를 합치면서 같이 맞춘다. 닫힌 탭이 기본 탭으로 남으면 다음 실행에 없는 탭을 가리킨다.)
   */
  const closeTabsNow = useCallback((items: TabItem[]) => {
    const store = useGraphStore.getState();
    for (const item of items) {
      if (item.kind === 'project') {
        void store.closeProject(item.path, item.name);
        store.setTabPin(`project:${item.name}`, false);
      } else {
        store.closeIframeTab(item.tab.id);
        const key = tabPinKey(item);
        store.setTabPin(key, false);
        if (store.defaultTabbarKey === key) store.setDefaultTabbar(null);
      }
    }
  }, []);

  // §5.4 #14-3 — 확인 대기 중인 닫기 대상. 팝업이 떠 있는 동안 탭 목록이 바뀌어도 닫을 것이
  //   흔들리지 않게 **그 순간의 항목을 그대로** 들고 있는다(키로 다시 찾으면, 그 사이 스냅샷에서
  //   빠진 탭을 영영 못 닫는다).
  const [pendingClose, setPendingClose] = useState<TabItem[] | null>(null);
  // 팝업의 [ ] 모든 에이전트 강제 종료 — 켜면 [닫기] 의 중지 범위가 이 탭에서 **전체**로 넓어진다.
  const [forceStopAll, setForceStopAll] = useState(false);

  const closeIntent = useMemo(
    () => resolveTabCloseIntent((pendingClose ?? []).map(toCloseTarget)),
    [pendingClose],
  );

  /** 닫기 공용 진입점 — X 버튼·컨텍스트 메뉴가 전부 여기로 들어온다(한쪽만 묻는 일이 없게). */
  const requestCloseTabs = useCallback((items: TabItem[]) => {
    if (items.length === 0) return;
    if (!resolveTabCloseIntent(items.map(toCloseTarget)).needsConfirm) {
      closeTabsNow(items);
      return;
    }
    setForceStopAll(false);
    setPendingClose(items);
  }, [closeTabsNow]);

  /**
   * [닫기] — **멈추느냐를 정하는 것은 이 버튼이 아니라 위의 체크 한 칸**이다(§5.4 #14-3 (B)(C)).
   *   체크가 켜져 있으면 열려 있는 **모든 프로젝트**의 에이전트를 멈춘 뒤 닫고, 꺼져 있으면
   *   아무것도 멈추지 않고 탭만 닫는다 — 그 세션들은 백단에서 계속 돈다(종전 동작).
   *   버튼을 [닫기]/[그냥 닫기] 둘로 벌리지 않는 이유는, 이름이 비슷한 두 버튼이 나란히 서면
   *   눌러 보기 전에는 무엇이 다른지 알 수 없기 때문이다.
   */
  const confirmClose = useCallback(() => {
    const items = pendingClose;
    setPendingClose(null);
    if (!items) return;
    if (forceStopAll) {
      // 스코프는 서버가 body 로 받으므로 통로는 프로젝트 **하나**면 충분하다. 팝업은 도는
      //   프로젝트 탭이 있을 때만 뜨므로 목록이 비는 일은 없지만, 비면 부를 곳이 없으니 닫기만 한다.
      const conduit = stopTargetProjectIds(items.map(toCloseTarget))[0];
      if (conduit) void useGraphStore.getState().stopProjectAgents(conduit, 'all');
    }
    closeTabsNow(items);
  }, [pendingClose, forceStopAll, closeTabsNow]);

  const cancelClose = useCallback(() => setPendingClose(null), []);
  const closeBackdrop = useBackdropDismiss(cancelClose);

  // 확인 팝업이 열려 있는 동안 Esc 로 취소(§5.5 #17-8 과 같은 규약).
  useEffect(() => {
    if (!pendingClose) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); setPendingClose(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingClose]);

  const handleCloseTab = useCallback(
    (e: React.MouseEvent, item: TabItem) => {
      e.stopPropagation();
      requestCloseTabs([item]);
    },
    [requestCloseTabs],
  );

  // --- §5.4 #14-4 닫은 탭 다시 열기 ---
  const handleReopenClosed = useCallback((key?: string) => {
    void useGraphStore.getState().reopenClosedTab(key);
  }, []);

  const handleClearClosed = useCallback(() => {
    void useGraphStore.getState().clearClosedTabs();
  }, []);

  // 브라우저와 같은 Ctrl+Shift+T. **되열 것이 있을 때만** 등록한다 — 빈 스택에서도 살아 있으면
  //   단축키 오버레이가 지금 쓸 수 없는 키를 알려 주고, 눌러도 아무 일이 없는 키가 된다.
  useCommand('global.reopenClosedTab', () => { handleReopenClosed(); }, {
    enabled: (recentlyClosed?.length ?? 0) > 0,
  });

  // --- Context menu ---
  const [ctx, setCtx] = useState<TabContextState | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, item: TabItem, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ key: item.key, index, x: e.clientX, y: e.clientY });
  }, []);

  const ctxItem = ctx ? tabMap.get(ctx.key) ?? null : null;
  const ctxIsPinned = ctxItem ? isItemPinned(ctxItem) : false;
  const ctxIsDefault = ctxItem ? isItemDefault(ctxItem) : false;

  const ctxHasOthers = useMemo(() => {
    if (!ctx) return false;
    return orderedTabs.some((it, i) => i !== ctx.index && !isItemPinned(it));
  }, [ctx, orderedTabs, isItemPinned]);

  const ctxHasLeft = useMemo(() => {
    if (!ctx) return false;
    return orderedTabs.some((it, i) => i < ctx.index && !isItemPinned(it));
  }, [ctx, orderedTabs, isItemPinned]);

  const ctxHasRight = useMemo(() => {
    if (!ctx) return false;
    return orderedTabs.some((it, i) => i > ctx.index && !isItemPinned(it));
  }, [ctx, orderedTabs, isItemPinned]);

  const handleCtxAction = useCallback((action: 'close' | 'closeOthers' | 'closeLeft' | 'closeRight' | 'closeAll' | 'togglePin' | 'toggleDefault' | 'detach' | 'rename') => {
    if (!ctx || !ctxItem) return;
    const store = useGraphStore.getState();

    // §5.4 #14-1 — 컨텍스트 메뉴로 detach. cursor 좌표는 컨텍스트 메뉴 위치 사용.
    if (action === 'detach') {
      const api = typeof window !== 'undefined' ? window.api : undefined;
      if (!api?.window) return;
      void api.window.detach({
        kind: ctxItem.kind,
        tabKey: ctxItem.key,
        cursor: { x: ctx.x, y: ctx.y },
      });
      // 활성 탭이면 다음 visible 탭으로 자동 전환.
      const wasActiveProject = ctxItem.kind === 'project' && store.activeProject === ctxItem.name;
      const wasActiveIframe = ctxItem.kind === 'iframe' && store.activeIframeId === ctxItem.tab.id;
      if (wasActiveProject || wasActiveIframe) {
        const remaining = orderedTabs.filter((t) => t.key !== ctxItem.key);
        const next = remaining[0];
        if (!next) {
          store.setActiveProjectLocal(null);
          store.setActiveIframeIdLocal(null);
        } else if (next.kind === 'project') {
          store.setActiveProject(next.name);
        } else {
          store.setActiveIframeTab(next.tab.id);
        }
      }
      return;
    }

    if (action === 'togglePin') {
      if (ctxItem.kind === 'project') {
        // 서버 appState 경유 — projectId(경로) 기준.
        const current = store.appState?.pinnedProjects ?? [];
        const k = npClient(ctxItem.path);
        const next = ctxIsPinned
          ? current.filter((p) => npClient(p) !== k)
          : [...current, ctxItem.path];
        void store.patchAppState({ pinnedProjects: next });
      } else {
        // iframe — 로컬
        store.setTabPin(tabPinKey(ctxItem), !ctxIsPinned);
      }
      return;
    }
    if (action === 'toggleDefault') {
      if (ctxItem.kind === 'project') {
        void store.patchAppState({ defaultProject: ctxIsDefault ? null : ctxItem.path });
      } else {
        store.setDefaultTabbar(ctxIsDefault ? null : tabPinKey(ctxItem));
      }
      return;
    }

    // 닫기 대상 결정 (pin된 탭은 제외)
    let targets: TabItem[] = [];
    if (action === 'close') {
      targets = [ctxItem];
    } else if (action === 'closeOthers') {
      targets = orderedTabs.filter((it, i) => i !== ctx.index && !isItemPinned(it));
    } else if (action === 'closeLeft') {
      targets = orderedTabs.filter((it, i) => i < ctx.index && !isItemPinned(it));
    } else if (action === 'closeRight') {
      targets = orderedTabs.filter((it, i) => i > ctx.index && !isItemPinned(it));
    } else if (action === 'closeAll') {
      targets = orderedTabs.filter((it) => !isItemPinned(it));
    }

    // §5.4 #14-3 — 컨텍스트 메뉴의 닫기 계열도 X 버튼과 **같은 진입점**을 탄다. 한쪽만 물으면
    //   "닫기는 묻는데 모두 닫기는 안 묻는다"가 되어 도는 세션이 조용히 잘린다(#17-8 과 같은 결론).
    requestCloseTabs(targets);
  }, [ctx, ctxItem, ctxIsPinned, ctxIsDefault, orderedTabs, isItemPinned, requestCloseTabs]);

  // 네이티브 스크롤바는 레이아웃 점유로 탭을 줄이기 때문에 hide 하고, 오버레이 썸을 별도 DOM 으로 그린다(VS Code 식).
  // 페이드/썸 갱신은 imperative ref 조작 — 스크롤·리사이즈마다 React 리렌더 없이 즉시 반영.
  //   (스크롤 칸 자체는 위에서 이미 선언했다 — 끄는 손짓이 그것을 기준으로 잰다.)
  const fadeLeftRef = useRef<HTMLDivElement>(null);
  const fadeRightRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const updateScrollState = useCallback(() => {
    const el = scrollEl;
    const fL = fadeLeftRef.current;
    const fR = fadeRightRef.current;
    const th = thumbRef.current;
    if (!el || !fL || !fR || !th) return;
    const overflow = el.scrollWidth - el.clientWidth;
    fL.classList.toggle('scroll-fade-shown', el.scrollLeft > 4);
    fR.classList.toggle('scroll-fade-shown', overflow - el.scrollLeft > 4);
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
  }, [scrollEl]);

  useEffect(() => {
    if (!scrollEl) return;
    updateScrollState();
    scrollEl.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(scrollEl);
    // The viewport stays fixed while tab widths animate, so observe the slots too.
    for (const tab of Array.from(scrollEl.children)) ro.observe(tab);
    if (scrollEl.parentElement) ro.observe(scrollEl.parentElement);
    ro.observe(document.documentElement);
    const onWinResize = (): void => {
      updateScrollState();
      requestAnimationFrame(updateScrollState);
    };
    window.addEventListener('resize', onWinResize);
    return () => {
      scrollEl.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
      window.removeEventListener('resize', onWinResize);
    };
  }, [scrollEl, updateScrollState, orderedTabs]);

  useEffect(() => { updateScrollState(); }, [orderedTabs, updateScrollState]);

  // §5.4 #14 — 순서가 바뀌면 옆 탭이 **밀려나며** 제자리에 앉는다(FLIP). 끌고 있는 탭은 손을 바로
  // 따라오고 이웃은 살짝 넘겼다 돌아온다. 탭이 닫혀 옆이 메워질 때도 같은 재생이 돈다.
  useTabPushAnimation({
    container: scrollEl,
    keyAttribute: 'data-tab-key',
    order: shownTabs.map((t) => t.key),
    leadKey: tabDrag.dragKey,
  });

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollEl;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) return;
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (delta === 0) return;
    el.scrollLeft += delta;
    e.preventDefault();
  }, [scrollEl]);

  // 활성 탭이 뷰포트 밖이면 자동 가시화.
  const activeKey = useMemo(() => tabSelectionKey(activeIframeId, activeProject), [activeIframeId, activeProject]);

  // §5.4 #14 — 고른 탭이 바뀌면 그 탭은 이름만큼 커지고 앞서 고른 탭은 한 칸으로 준다. 폭은 그 자리에서
  //   끝 값이 되고, 보이는 쪽만 옛 모양에서 새 모양으로 풀린다(아이폰식 스프링 · 이름은 커튼처럼 드러나며
  //   또렷해진다 · 움직임 줄이기에서는 튐과 흐림만 뺀다).
  useTabSelectionMotion(scrollEl, activeKey, tabDrag.dragKey !== null);

  useEffect(() => {
    if (!activeKey || !scrollEl || tabDrag.dragKey !== null) return;
    const tab = Array.from(scrollEl.children).find((node) => node.getAttribute('data-tab-key') === activeKey) as HTMLElement | undefined;
    if (!tab) return;
    let frame = 0;
    const deadline = performance.now() + TAB_SELECTION_FLIP.followMs;
    const reveal = (): void => {
      const tl = tab.offsetLeft;
      const tr = tl + tab.offsetWidth;
      const vl = scrollEl.scrollLeft;
      const vr = vl + scrollEl.clientWidth;
      // A tab wider than the viewport cannot expose both edges: keep its label
      // anchored instead of alternating between left and right every frame.
      if (tab.offsetWidth + 16 >= scrollEl.clientWidth) scrollEl.scrollLeft = tl - 8;
      else if (tl < vl) scrollEl.scrollLeft = tl - 8;
      else if (tr > vr) scrollEl.scrollLeft = tr - scrollEl.clientWidth + 8;
      if (performance.now() < deadline) frame = requestAnimationFrame(reveal);
    };
    const stopFollowing = (): void => cancelAnimationFrame(frame);
    reveal();
    // Follow the expanding edge only during selection; a new gesture takes over.
    scrollEl.addEventListener('wheel', stopFollowing, { passive: true });
    scrollEl.addEventListener('pointerdown', stopFollowing);
    return () => {
      stopFollowing();
      scrollEl.removeEventListener('wheel', stopFollowing);
      scrollEl.removeEventListener('pointerdown', stopFollowing);
    };
  }, [activeKey, orderedTabs.length, scrollEl, tabDrag.dragKey]);

  // §5.4 #14 — 고른 탭만 이름을 따라 넓어지므로 고른 탭이 바뀌면 줄 길이가 바뀐다. 스크롤 칸 자체의
  //   크기는 그대로라 ResizeObserver 가 모른다 — 좌우 페이드·오버레이 썸을 여기서 다시 잰다.
  useEffect(() => { updateScrollState(); }, [activeKey, updateScrollState]);

  // 탭이 0개여도 wrapper 는 유지 — 빈 영역이 윈도우 드래그 영역으로 동작하도록.
  // (TabBar 가 return null 하면 부모 flex-1 도 사라져 드래그 영역 자체가 없어진다.)

  // §3.7 v2.13/v2.14 — Chrome 스타일 탭. 라벨 truncate, 탭 간 1px 우측 구분선.
  //  폭은 한 칸(w-32)이되 고른 탭만 이름을 따라 넓어진다(§5.4 #14 — 위 `TAB_WIDTH_*`·`TAB_LABEL_ACTIVE_MAX`).
  // tab-folder 연결 효과(헤더 border-b 제거 후 색·높이로만 구현 — 고정 px 폭 키우기 ❌):
  //  · 활성 = h-full 로 헤더(h-9) 꽉 채움 + 콘텐츠 배경(gray-950) + 상단 2px 액센트 + rounded-t.
  //    헤더 밑줄이 없어 활성 탭 바닥(gray-950)이 캔버스(BubbleMap bg-gray-950)로 끊김 없이 이어짐.
  //  · 비활성 = mt-[5px] + h-[calc(100%-5px)] 로 위가 들여진 "작고 눌리지 않은" 탭(상대적으로 활성이 큼).
  //  (이전엔 overflow-y-hidden 컨테이너 안에서 after 세로 브리지로 밑줄을 덮으려 했으나 잘려서 안 보였음.)
  // §5.4 #14-1 — redock-hover 가 활성이면 탭바 자체에 드롭존 글로우. 별창 헤더가 메인 탭바 위로
  // 옮겨와 있을 때 사용자에게 "여기 떨어뜨리면 합쳐짐" 시각 신호.
  const tabBarRedockGlow = redockHoverKey !== null;
  return (
    <div
      className={`group/tabscroll relative flex h-full min-w-0 flex-1 items-stretch transition-colors duration-150 ${
        tabBarRedockGlow ? 'bg-blue-900/30 ring-1 ring-inset ring-blue-400/60' : ''
      } ${detachHint ? 'opacity-60' : ''}`}
      data-redock-target={tabBarRedockGlow ? '1' : undefined}
    >
      {/* §5.4 #14-1 — redock/detach 시 상단 바 안내 텍스트는 제거. 글로우(tabBarRedockGlow)와
          opacity(detachHint) 시각 신호만 유지하고, 안내는 손에 들린 탭 아래에만 노출. */}
      {/*
        §5.4 #14-2 — **손에 들린 탭.** 종전 안내 카드가 하던 일(무엇을 들고 있나 + 여기서 놓으면
        무슨 일이 나나)을 그대로 이어받되, 카드 대신 **탭 자신의 모양**으로 온다 — 커서 옆에 뜨는
        네모가 둘(네이티브 고스트 + 안내 카드)이던 것을 하나로 합친 셈이다.
        `document.body` 로 내보내고 자리는 훅이 `transform` 으로 준다(프레임마다 리렌더 ❌).
        §5.4 #14-1 (H) 띠 밖에서는 탭·안내 대신 **곧 설 별창 크기의 선** 하나가 손을 따라온다 —
        main 의 선이 서면(`os`) 앱 밖까지 그쪽이 이으므로 여기는 비운다(같은 자리를 두 선이 그리지 않게).
      */}
      {tabDrag.dragKey !== null && createPortal(
        <div
          ref={tabDrag.ghostRef}
          data-tab-floating-hint="1"
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 z-[9999] will-change-transform"
        >
          {detachGhost ? (
            detachGhost.kind === 'inapp' && (
              <TabDetachOutline
                frame={detachGhost.frame}
                offset={detachGhost.offset}
                label={dragLabel}
                hint={t('tabDetach.detachCardTitle', { defaultValue: 'Drop here to open as new window' })}
              />
            )
          ) : (
            <>
              <div
                // 집어 든 순간 원본 탭이 차지하던 치수 그대로(§5.4 #14-2 (F-2)) — 폭을 `w-32` 로 박아
                //   두면 프로젝트 이름·배지 때문에 탭이 넓어졌을 때 손에 드는 순간 좁아진다.
                style={tabDrag.dragSize ?? undefined}
                className="flex items-center gap-1.5 rounded-t-md border-t-2 border-t-blue-400 bg-gray-950 px-2.5 text-[12px] font-medium text-white/90 shadow-lg shadow-black/60 ring-1 ring-white/[0.08]"
              >
                <span className="min-w-0 flex-1 truncate">{dragLabel}</span>
              </div>
              <div className="mt-1 flex max-w-[260px] items-center gap-1 rounded-md bg-vb-raised/85 px-2.5 py-1 text-[12px] font-medium text-gray-300 shadow-lg shadow-black/50 ring-1 ring-white/[0.08]">
                <svg className="h-3 w-3 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 5h13" />
                  <path d="M8 12h13" />
                  <path d="M8 19h13" />
                  <path d="M3 5h.01M3 12h.01M3 19h.01" />
                </svg>
                <span className="truncate">
                  {t('tabDetach.reorderCardSubtitle', { defaultValue: 'Stay inside the tab bar to reorder' })}
                </span>
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
      {/* §5.4 #14-1 (H) 빠르게 놓은 손 — 끌기는 끝났지만 main 의 선이 아직 안 그려졌다. 그 선이 설 때까지
          놓은 자리에 앱 안 선을 세워 둔다(손에 든 칸과 함께 사라지면 놓은 자리가 잠깐 빈다 — (H-7) ②). */}
      {settledOutline && createPortal(
        <div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[9999]">
          <TabDetachOutline frame={settledOutline.frame} offset={settledOutline.at} label={settledOutline.label} hint={settledOutline.hint} />
        </div>,
        document.body,
      )}
      <div
        ref={setScrollEl}
        onWheel={handleWheel}
        className="scrollbar-overlay flex h-full min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
      >
      {shownTabs.map((item, idx) => {
        const isDragging = item.key === tabDrag.dragKey;
        const isPinned = isItemPinned(item);
        const isDefault = isItemDefault(item);

        if (item.kind === 'project') {
          const isActive = item.name === activeProject && activeIframeId === null;
          return (
            // §5.4 #14-2 — 밀림 재생(`useTabPushAnimation`)이 미는 것은 이 **겉칸**이다. 탭 본체가
            //   고스트로 떠나도 자리는 남아 있어야 하고(점선 홈), 미는 노드와 숨기는 노드가 같으면
            //   `opacity-0` 이 그 홈까지 지운다(활동바 §5.5 #16-1 (E) 와 같은 구조).
            <div
              key={item.key}
              data-tab-key={item.key}
              className="relative flex flex-shrink-0 items-stretch"
            >
              {isDragging && (
                <span className="pointer-events-none absolute inset-x-0 inset-y-[5px] rounded-t border border-dashed border-blue-400/60 bg-blue-400/10" />
              )}
            <div
              onPointerDown={(e) => { tabDrag.onPointerDown(e, item.key); }}
              onContextMenu={(e) => handleContextMenu(e, item, idx)}
              // 끄는 동안 브라우저가 스크롤·선택으로 가로채지 않게(터치·펜 포함).
              style={tabDrag.dragKey !== null ? { touchAction: 'none' } : undefined}
              data-tab-surface
              data-tab-active={isActive}
              className={`group app-nodrag relative flex flex-shrink-0 items-center gap-1.5 border-r border-t-2 border-transparent px-2.5 text-[12px] font-medium ${TAB_SELECTION_MOTION} cursor-grab select-none ${
                isDragging ? 'opacity-0' : ''
              } ${
                isActive
                  ? `${TAB_WIDTH_ACTIVE} h-full text-white/90`
                  : `${TAB_WIDTH_IDLE} mt-[5px] h-[calc(100%-5px)] text-gray-400 hover:text-gray-200`
              }`}
              onClick={() => {
                // 끌고 난 직후의 클릭은 그 탭으로 가라는 뜻이 아니다.
                if (tabDrag.consumeClick()) return;
                useGraphStore.getState().setActiveProject(item.name);
              }}
            >
              {/* §5.4 #14 판 — 크기가 바뀔 때 이 층만 늘고 준다. 첫 자식이고, 그 뒤 칸들은 모두 `relative` 라 글자가 판 위에 선다. */}
              <span data-tab-part="plate" aria-hidden className={TAB_PLATE}>
                <span className={`${TAB_PLATE_IDLE} ${isActive ? 'opacity-0' : 'opacity-100'}`} />
                <span className={`${TAB_PLATE_ACTIVE} border-t-blue-400 ${isActive ? 'opacity-100' : 'opacity-0'}`} />
              </span>
              {isPinned && (
                <span className="relative flex-shrink-0 cursor-help" title={t('tabMenu.pinTooltip')}>
                  <svg className="h-3 w-3 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 17v5" />
                    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                  </svg>
                </span>
              )}
              {isDefault && (
                <span className="relative flex-shrink-0 cursor-help" title={t('tabMenu.defaultTooltip')}>
                  <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.3l6.5-.9z" />
                  </svg>
                </span>
              )}
              <HoverTooltip className={`min-w-0 flex-1 tab-selection-label ${isActive ? TAB_LABEL_ACTIVE_MAX : ''}`} label={item.name}>
                {/* 이름 칸이 늘 때 안쪽은 그 역수로 펴(글자는 늘어나지 않는다), 글자 칸은 흐림에서 또렷하게 나타난다. */}
                <span data-tab-part="label-inner" className="inline-block origin-left">
                  <span data-tab-part="label-text" className="inline-block">{item.name}</span>
                </span>
              </HoverTooltip>
              {item.count > 0 && (() => {
                const dotState: ProjectDotState =
                  item.runningCount > 0
                    ? 'active'
                    : item.completedCount > 0
                      ? 'completed'
                      : 'idle';
                const tooltip =
                  item.runningCount > 0
                    ? t('header.agentStatus.tooltipWorking', {
                        running: item.runningCount,
                        sessions: item.sessionCount,
                        agents: item.count,
                      })
                    : t('header.agentStatus.tooltipIdle', {
                        sessions: item.sessionCount,
                        agents: item.count,
                      });
                return (
                  <span
                    title={tooltip}
                    className="relative flex flex-shrink-0 items-center gap-1 text-[12px] tabular-nums text-gray-300"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${PROJECT_DOT_STYLES[dotState]}`} />
                    <span>{item.runningCount}/{item.sessionCount}</span>
                  </span>
                );
              })()}
              <button
                type="button"
                // 탭 전체가 끌면 곧장 들리므로 X 에서 시작된 누르기는 여기서 멈춰 세운다 — 끌기 훅의
                //   `ignoreSelector` 와 겹치는 이중 방어다(어느 한쪽이 사라져도 닫기는 닫기로 남는다).
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => handleCloseTab(e, item)}
                // 터치에서는 눈에 보이는 16px 은 그대로 두고 누르는 자리만 32px 로 넓힌다(투명 ::before) —
                //   글리프를 키우면 128px 탭의 이름 칸이 그만큼 줄어든다.
                className="relative ml-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-white/[0.1] group-hover:opacity-100 pointer-coarse:opacity-100 pointer-coarse:before:absolute pointer-coarse:before:-inset-2"
                title={t('header.tab.closeProject')}
              >
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </div>
            </div>
          );
        }

        // iframe tab
        const isActive = activeIframeId === item.tab.id;
        return (
          // 겉칸·점선 홈 규약은 바로 위 프로젝트 탭과 같다.
          <div
            key={item.key}
            data-tab-key={item.key}
            className="relative flex flex-shrink-0 items-stretch"
          >
            {isDragging && (
              <span className="pointer-events-none absolute inset-x-0 inset-y-[5px] rounded-t border border-dashed border-sky-400/60 bg-sky-400/10" />
            )}
          <div
            onPointerDown={(e) => { tabDrag.onPointerDown(e, item.key); }}
            onContextMenu={(e) => handleContextMenu(e, item, idx)}
            style={tabDrag.dragKey !== null ? { touchAction: 'none' } : undefined}
            data-tab-surface
            data-tab-active={isActive}
            className={`group app-nodrag relative flex flex-shrink-0 items-center gap-1.5 border-r border-t-2 border-transparent px-2.5 text-[12px] font-medium ${TAB_SELECTION_MOTION} cursor-grab select-none ${
              isDragging ? 'opacity-0' : ''
            } ${
              isActive
                ? `${TAB_WIDTH_ACTIVE} h-full text-sky-300`
                : `${TAB_WIDTH_IDLE} mt-[5px] h-[calc(100%-5px)] text-gray-400 hover:text-gray-200`
            }`}
            onClick={() => {
              if (tabDrag.consumeClick()) return;
              useGraphStore.getState().setActiveIframeTab(item.tab.id);
            }}
          >
            {/* 판 규약은 위 프로젝트 탭과 같다 — 윗선 색만 iframe 의 하늘색. */}
            <span data-tab-part="plate" aria-hidden className={TAB_PLATE}>
              <span className={`${TAB_PLATE_IDLE} ${isActive ? 'opacity-0' : 'opacity-100'}`} />
              <span className={`${TAB_PLATE_ACTIVE} border-t-sky-400 ${isActive ? 'opacity-100' : 'opacity-0'}`} />
            </span>
            {isPinned && (
              <span className="relative flex-shrink-0 cursor-help" title={t('tabMenu.pinTooltip')}>
                <svg className="h-3 w-3 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 17v5" />
                  <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                </svg>
              </span>
            )}
            {isDefault && (
              <span className="relative flex-shrink-0 cursor-help" title={t('tabMenu.defaultTooltip')}>
                <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.3l6.5-.9z" />
                </svg>
              </span>
            )}
            {/* SVG 를 직접 옮기면 배율 ≠ 100% 에서 합성기가 맡지 않는다 — 감싼 칸이 움직인다. */}
            <span className="relative flex flex-shrink-0">
              <svg className="h-3 w-3 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" fillOpacity={0.6} stroke="currentColor" strokeWidth={1.5}>
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zM4 12c0-.93.16-1.82.46-2.65L8 12.83V14a2 2 0 0 0 2 2v3.73A8.01 8.01 0 0 1 4 12zm14.54 3.35A2 2 0 0 0 17 14h-1v-3a1 1 0 0 0-1-1H9V8h2a1 1 0 0 0 1-1V5.08A7.97 7.97 0 0 1 20 12c0 1.2-.27 2.34-.74 3.35z" />
              </svg>
            </span>
            <HoverTooltip className={`min-w-0 flex-1 tab-selection-label ${isActive ? TAB_LABEL_ACTIVE_MAX : ''}`} label={item.tab.label}>
              <span data-tab-part="label-inner" className="inline-block origin-left">
                <span data-tab-part="label-text" className="inline-block">{item.tab.label}</span>
              </span>
            </HoverTooltip>
            {/* FE/BE 는 로컬 서버 탭의 말이다 — 인터넷 페이지(§5.23 「더블클릭」 웹 탭)에는 달지 않는다. */}
            {!isRemoteWebUrl(item.tab.url) && (
              <span className={`relative flex-shrink-0 rounded px-1 text-[12px] font-semibold ${item.tab.serverKind === 'frontend' ? 'bg-sky-500/20 text-sky-400' : 'bg-amber-500/20 text-amber-400'}`}>
                {item.tab.serverKind === 'frontend' ? t('common.serverKind.frontendShort') : t('common.serverKind.backendShort')}
              </span>
            )}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => handleCloseTab(e, item)}
              className="relative ml-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-white/[0.1] group-hover:opacity-100 pointer-coarse:opacity-100 pointer-coarse:before:absolute pointer-coarse:before:-inset-2"
              title={t('header.tab.closeTab')}
            >
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          </div>
          </div>
        );
      })}
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

      {ctx && ctxItem && (
        <TabContextMenu
          x={ctx.x}
          y={ctx.y}
          isPinned={ctxIsPinned}
          isDefault={ctxIsDefault}
          hasOthers={ctxHasOthers}
          hasLeft={ctxHasLeft}
          hasRight={ctxHasRight}
          recentlyClosed={recentlyClosed}
          onReopen={handleReopenClosed}
          onClearClosed={handleClearClosed}
          onAction={(action) => {
            // §5.5 #17-34 — 화면 나누기는 IDE 세션 탭 전용이라 여긴 메뉴 자체가 안 뜬다(showSplit 기본 false).
            //   도달하지 않지만 타입을 좁히기 위한 가드(detach 선례와 같은 자리).
            if (action === 'splitRight' || action === 'splitDown') return;
            // §5.4 #14-4 — 다시 열기 묶음은 전용 콜백(onReopen)으로 빠지므로 여기 오지 않는다.
            if (action === 'reopenClosed' || action === 'recentlyClosed') return;
            handleCtxAction(action);
          }}
          onClose={() => setCtx(null)}
        />
      )}

      {/* §5.4 #14-3 — 동작 중인 에이전트가 있는 탭을 닫을 때만 뜨는 확인 팝업.
          도는 게 없으면 이 자리는 아예 만들어지지 않고 탭이 즉시 닫힌다. */}
      {pendingClose && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60"
          {...closeBackdrop}
        >
          <div className="mx-4 w-[clamp(20rem,38vw,32rem)] max-w-[calc(100vw-2rem)] rounded-lg border border-gray-700 bg-gray-900 shadow-xl shadow-black/40">
            <div className="flex items-center gap-2 border-b border-gray-800 px-5 py-3 text-sm font-semibold text-gray-100">
              <svg className="h-4 w-4 flex-shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <span className="min-w-0 truncate">{t('header.tab.confirmCloseTitle')}</span>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-300">
                {t('header.tab.confirmCloseMessage', { count: closeIntent.runningSessions })}
              </p>
              {/* 도는 탭 목록 — 라벨은 사용자 콘텐츠라 i18n 대상이 아니다(§5.5 #17-8 과 같은 규약). */}
              {closeIntent.running.length > 0 && (
                <ul className="scrollbar-thin mt-3 flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {closeIntent.running.map((target) => (
                    <li key={target.key} className="flex items-center gap-2 text-[12px] text-gray-300">
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-400" />
                      <span className="min-w-0 flex-1 truncate">{target.label}</span>
                      <span className="flex-shrink-0 tabular-nums text-gray-500">{target.runningCount}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
                {t('header.tab.confirmCloseHint', {
                  close: t('header.tab.confirmCloseConfirm'),
                  force: t('header.tab.confirmCloseForceAll'),
                })}
              </p>
              {/* 옵션 — [닫기] 가 멈출지 말지를 정하는 **유일한 스위치**. 누르기 전에 보이도록 버튼 위에 둔다. */}
              <label className="mt-4 flex cursor-pointer items-start gap-2 text-[12px] text-gray-300">
                <input
                  type="checkbox"
                  checked={forceStopAll}
                  onChange={(e) => setForceStopAll(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-red-500"
                />
                <span className="min-w-0">
                  {t('header.tab.confirmCloseForceAll')}
                  <span className="mt-0.5 block text-gray-500">{t('header.tab.confirmCloseForceAllHint')}</span>
                </span>
              </label>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {/* 색은 **체크를 따라간다** — 켜져 있으면 붉게(멈춤이 일어난다), 꺼져 있으면 중립
                    (탭만 닫는다). 안 멈추는 손에 붉은 버튼을 세워 두면 겁을 주고, 멈추는 손에
                    중립색을 세워 두면 무게를 숨긴다. */}
                <button
                  type="button"
                  autoFocus
                  onClick={confirmClose}
                  className={`rounded border px-3 py-1.5 text-sm text-white transition-colors ${
                    forceStopAll
                      ? 'border-red-700 bg-red-800 hover:bg-red-700'
                      : 'border-gray-600 bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  {t('header.tab.confirmCloseConfirm')}
                </button>
                <button
                  type="button"
                  onClick={cancelClose}
                  className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-700"
                >
                  {t('header.tab.confirmCloseCancel')}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

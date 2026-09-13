import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import type { IframeTab } from '../../stores/graphStore.js';
import { TabContextMenu } from './TabContextMenu.js';
import { HoverTooltip } from './HoverTooltip.js';
import { useTabPushAnimation } from '../../hooks/useTabPushAnimation.js';
import { useCommand } from '../../hooks/useCommand.js';
import { applyLocalOrder } from '../../hooks/tabPushGeom.js';
// §5.4 #14-2 — 꾹 눌러 집어 드는 손짓 한 벌(활동바·IDE 세션 탭과 같은 훅).
import { usePointerDragReorder } from '../../hooks/usePointerDragReorder.js';
// 화면에 선 탭만 끌 수 있으므로(별창으로 빠진 탭은 줄에 없다) 새 순서는 **그 자리들에만** 되꽂는다.
import { applyVisibleOrder } from '@vibisual/shared';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { resolveHeaderAgentCounts } from './headerAgentCounts.js';
import { resolveTabCloseIntent, stopTargetProjectIds, type TabCloseTarget } from './tabCloseConfirm.js';
import { clientPathKey } from '../../utils/platform.js';

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

  useEffect(() => {
    const allKeys = new Set([
      ...projectItems.map((t) => t.key),
      ...iframeItems.map((t) => t.key),
    ]);
    setTabOrder((prev) => {
      const kept = prev.filter((k) => allKeys.has(k));
      const existing = new Set(kept);
      const newKeys = [...allKeys].filter((k) => !existing.has(k));
      if (newKeys.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...newKeys];
    });
  }, [projectItems, iframeItems]);

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

  // --- 꾹 눌러 자리를 옮긴다 (§5.4 #14-2 · 활동바 §5.5 #16-1 (E) 와 같은 한 벌) ---
  //
  // 종전에는 HTML5 네이티브 DnD 였다 — 살짝만 밀어도 탭이 즉시 "뚝 떨어져" 반투명해지고, 손에 붙어
  // 오는 것은 탭이 아니라(그마저도 1×1 투명 캔버스로 지워 놓아서) 안내 카드 한 장뿐이었으며, 놓을
  // 때는 네이티브 되돌리기 연출이 한 번 더 끼어들었다(사용자 지적 — "때서 붙이는 느낌이 너무
  // 어색해"). 그 셋은 전부 네이티브 DnD 가 정하는 것이라 CSS 로는 손댈 수 없다.
  //
  // 이제 **탭 자신이 손에 붙어 온다** — 꾹 눌러 집어 들고, 지나는 탭이 밀리고, 헤더 띠 밖에서 놓으면
  // 별창으로 나간다(#14-1 detach 는 그대로다 — 판정 좌표만 `dragend` 에서 `pointerup` 으로 옮겼다).

  // §5.4 #14-1 — 드래그 중 마우스가 탭바 밖에 있어 detach 가 예상되는 상태일 때 detach-hint 표시.
  const [detachHint, setDetachHint] = useState(false);

  // §5.4 #14-1 v2.35 — safe-zone 은 **헤더 행 전체**(h-9 = 36px 띠, 가로 무관)다.
  // 사용자 의도: File 메뉴 등 헤더 안 어디서든 reorder 영역, 헤더 띠를 벗어나야(=캔버스로 내려와야) detach.
  // 별창에서도 동일 — 별창의 미니 타이틀바도 36px 띠지만 별창엔 TabBar 가 없으므로 이 컨테이너 자체가 마운트 안 됨.
  const HEADER_SAFE_HEIGHT = 36;

  /** 헤더 띠 밖에서 놓았다 — 그 탭을 별창으로 뗀다(§5.4 #14-1). */
  const detachTab = useCallback((draggedKey: string, screenX: number, screenY: number) => {
    const item = tabMap.get(draggedKey);
    if (!item) return;

    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.window) {
      // packaged 가 아닌 경우엔 detach 불가 — 단순 noop.
      return;
    }

    // screen 좌표가 필요(BrowserWindow 좌상단 기준) — 포인터 이벤트의 screenX/Y 를 그대로 쓴다.
    const cursor = { x: screenX, y: screenY };

    void api.window
      .detach({ kind: item.kind, tabKey: draggedKey, cursor })
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
      });
  }, [tabMap, tabOrder]);

  const tabDrag = usePointerDragReorder({
    axis: 'x',
    container: scrollEl,
    keyAttribute: 'data-tab-key',
    order: visibleKeys,
    // 닫기 X 위에서 시작된 누르기는 그 버튼의 것이다(종전 `onPointerDown` stopPropagation 과 같은 뜻).
    ignoreSelector: 'button',
    onDragStart: (_key, p) => { setDetachHint(p.y >= HEADER_SAFE_HEIGHT); },
    onDragMove: (_key, p) => { setDetachHint(p.y >= HEADER_SAFE_HEIGHT); },
    onCommit: (next, p, key) => {
      setDetachHint(false);
      // 화면에 선 탭만 끌 수 있으므로 새 순서는 전체 `tabOrder` 의 **그 자리들에만** 되꽂는다
      //   (별창으로 빠진 탭이 사이에 껴 있어도 보이는 앞뒤가 어긋나지 않는다 — #14-2 (C) 키 기반 규약).
      if (next) setTabOrder((prev) => applyVisibleOrder(prev, visibleKeys, next));
      // 순서가 그대로여도 놓은 자리가 헤더 띠 밖이면 별창이다 — 그래서 `next` 와 배타적이지 않다.
      if (p.y >= HEADER_SAFE_HEIGHT) detachTab(key, p.screenX, p.screenY);
    },
    onCancel: () => { setDetachHint(false); },
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
  }, [scrollEl]);

  useEffect(() => {
    if (!scrollEl) return;
    updateScrollState();
    scrollEl.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(scrollEl);
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
  }, [scrollEl, updateScrollState]);

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
  const activeKey = useMemo(() => {
    if (activeIframeId) return `i:${activeIframeId}`;
    if (activeProject) return `p:${activeProject}`;
    return null;
  }, [activeIframeId, activeProject]);

  useEffect(() => {
    if (!activeKey || !scrollEl) return;
    const tab = scrollEl.querySelector<HTMLElement>(`[data-tab-key="${activeKey}"]`);
    if (!tab) return;
    const tl = tab.offsetLeft;
    const tr = tl + tab.offsetWidth;
    const vl = scrollEl.scrollLeft;
    const vr = vl + scrollEl.clientWidth;
    if (tl < vl) scrollEl.scrollLeft = tl - 8;
    else if (tr > vr) scrollEl.scrollLeft = tr - scrollEl.clientWidth + 8;
  }, [activeKey, orderedTabs.length, scrollEl]);

  // 탭이 0개여도 wrapper 는 유지 — 빈 영역이 윈도우 드래그 영역으로 동작하도록.
  // (TabBar 가 return null 하면 부모 flex-1 도 사라져 드래그 영역 자체가 없어진다.)

  // §3.7 v2.13/v2.14 — Chrome 스타일 탭. 폭 w-32, 라벨 truncate, 탭 간 1px 우측 구분선.
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
      */}
      {tabDrag.dragKey !== null && createPortal(
        <div
          ref={tabDrag.ghostRef}
          data-tab-floating-hint="1"
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 z-[9999] will-change-transform"
        >
          <div
            // 집어 든 순간 원본 탭이 차지하던 치수 그대로(§5.4 #14-2 (F-2)) — 폭을 `w-32` 로 박아
            //   두면 프로젝트 이름·배지 때문에 탭이 넓어졌을 때 손에 드는 순간 좁아진다.
            style={tabDrag.dragSize ?? undefined}
            className={`flex items-center gap-1.5 rounded-t-md border-t-2 px-2.5 text-[12px] font-medium shadow-lg shadow-black/60 transition-colors duration-100 ${
              detachHint
                ? 'border-t-amber-400 bg-[#1f2937] text-amber-100 ring-1 ring-amber-400/60'
                : 'border-t-blue-400 bg-gray-950 text-white/90 ring-1 ring-white/[0.08]'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{dragLabel}</span>
          </div>
          <div
            className={`mt-1 flex max-w-[260px] items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium shadow-lg shadow-black/50 transition-colors duration-100 ${
              detachHint
                ? 'bg-[#1f2937] text-amber-200 ring-1 ring-amber-400/60'
                : 'bg-[#1f2937]/85 text-gray-300 ring-1 ring-white/[0.08]'
            }`}
          >
            {detachHint ? (
              <svg className="h-3 w-3 flex-shrink-0 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 4h6v6" />
                <path d="M10 14L20 4" />
                <path d="M20 14v6H4V4h6" />
              </svg>
            ) : (
              <svg className="h-3 w-3 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 5h13" />
                <path d="M8 12h13" />
                <path d="M8 19h13" />
                <path d="M3 5h.01M3 12h.01M3 19h.01" />
              </svg>
            )}
            <span className="truncate">
              {detachHint
                ? t('tabDetach.detachCardTitle', { defaultValue: 'Drop here to open as new window' })
                : t('tabDetach.reorderCardSubtitle', { defaultValue: 'Stay inside the tab bar to reorder' })}
            </span>
          </div>
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
              className={`group app-nodrag relative flex w-32 flex-shrink-0 items-center gap-1.5 border-r border-black/30 px-2.5 text-[12px] font-medium transition-all duration-150 cursor-grab select-none ${
                isDragging ? 'opacity-0' : ''
              } ${
                isActive
                  ? 'h-full rounded-t-md border-t-2 border-t-blue-400 bg-gray-950 text-white/90'
                  : 'mt-[5px] h-[calc(100%-5px)] rounded-t bg-black/25 text-gray-400 hover:bg-black/40 hover:text-gray-200'
              }`}
              onClick={() => {
                // 끌고 난 직후의 클릭은 그 탭으로 가라는 뜻이 아니다.
                if (tabDrag.consumeClick()) return;
                useGraphStore.getState().setActiveProject(item.name);
              }}
            >
              {isPinned && (
                <span className="flex-shrink-0 cursor-help" title={t('tabMenu.pinTooltip')}>
                  <svg className="h-3 w-3 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 17v5" />
                    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                  </svg>
                </span>
              )}
              {isDefault && (
                <span className="flex-shrink-0 cursor-help" title={t('tabMenu.defaultTooltip')}>
                  <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.3l6.5-.9z" />
                  </svg>
                </span>
              )}
              <HoverTooltip className="min-w-0 flex-1 truncate" label={item.name} />
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
                    className="flex flex-shrink-0 items-center gap-1 text-[12px] tabular-nums text-gray-300"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${PROJECT_DOT_STYLES[dotState]}`} />
                    <span>{item.runningCount}/{item.sessionCount}</span>
                  </span>
                );
              })()}
              <button
                type="button"
                // 탭 전체가 꾹 눌러 끌리므로 X 에서 시작된 누르기는 여기서 멈춰 세운다 — 끌기 훅의
                //   `ignoreSelector` 와 겹치는 이중 방어다(어느 한쪽이 사라져도 닫기는 닫기로 남는다).
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => handleCloseTab(e, item)}
                className="ml-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-white/[0.1] group-hover:opacity-100 pointer-coarse:opacity-100"
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
            className={`group app-nodrag relative flex w-32 flex-shrink-0 items-center gap-1.5 border-r border-black/30 px-2.5 text-[12px] font-medium transition-all duration-150 cursor-grab select-none ${
              isDragging ? 'opacity-0' : ''
            } ${
              isActive
                ? 'h-full rounded-t-md border-t-2 border-t-sky-400 bg-gray-950 text-sky-300'
                : 'mt-[5px] h-[calc(100%-5px)] rounded-t bg-black/25 text-gray-400 hover:bg-black/40 hover:text-gray-200'
            }`}
            onClick={() => {
              if (tabDrag.consumeClick()) return;
              useGraphStore.getState().setActiveIframeTab(item.tab.id);
            }}
          >
            {isPinned && (
              <span className="flex-shrink-0 cursor-help" title={t('tabMenu.pinTooltip')}>
                <svg className="h-3 w-3 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 17v5" />
                  <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                </svg>
              </span>
            )}
            {isDefault && (
              <span className="flex-shrink-0 cursor-help" title={t('tabMenu.defaultTooltip')}>
                <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.3l6.5-.9z" />
                </svg>
              </span>
            )}
            <svg className="h-3 w-3 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" fillOpacity={0.6} stroke="currentColor" strokeWidth={1.5}>
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zM4 12c0-.93.16-1.82.46-2.65L8 12.83V14a2 2 0 0 0 2 2v3.73A8.01 8.01 0 0 1 4 12zm14.54 3.35A2 2 0 0 0 17 14h-1v-3a1 1 0 0 0-1-1H9V8h2a1 1 0 0 0 1-1V5.08A7.97 7.97 0 0 1 20 12c0 1.2-.27 2.34-.74 3.35z" />
            </svg>
            <HoverTooltip className="min-w-0 flex-1 truncate" label={item.tab.label} />
            <span className={`flex-shrink-0 rounded px-1 text-[12px] font-semibold ${item.tab.serverKind === 'frontend' ? 'bg-sky-500/20 text-sky-400' : 'bg-amber-500/20 text-amber-400'}`}>
              {item.tab.serverKind === 'frontend' ? t('common.serverKind.frontendShort') : t('common.serverKind.backendShort')}
            </span>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => handleCloseTab(e, item)}
              className="ml-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-white/[0.1] group-hover:opacity-100 pointer-coarse:opacity-100"
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
          <div className="mx-4 w-[clamp(20rem,38vw,32rem)] rounded-lg border border-gray-700 bg-gray-900 shadow-xl shadow-black/40">
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

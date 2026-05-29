import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import type { IframeTab } from '../../stores/graphStore.js';
import { TabContextMenu } from './TabContextMenu.js';

type TabItem =
  | {
      kind: 'project';
      key: string;
      name: string;
      path: string;
      count: number;
      activeCount: number;
      completedCount: number;
    }
  | { kind: 'iframe'; key: string; tab: IframeTab };

// Header 우측 인디케이터와 동일 신호 — active>0 파랑, completed>0 녹색, 그 외 회색.
type ProjectDotState = 'idle' | 'completed' | 'active';
const PROJECT_DOT_STYLES: Record<ProjectDotState, string> = {
  idle: 'bg-gray-400',
  completed: 'bg-emerald-400 animate-pulse',
  active: 'bg-blue-400 animate-pulse',
};

/** projectId 정규화 — 서버 appState(경로키)와 동일 semantics. */
function npClient(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
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

export function TabBar(): React.JSX.Element | null {
  const { t } = useTranslation();
  const registeredProjects = useGraphStore((s) => s.projects);
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const activeProject = useGraphStore((s) => s.activeProject);
  const agents = useGraphStore((s) => s.agents);
  const iframeTabs = useGraphStore((s) => s.iframeTabs);
  const activeIframeId = useGraphStore((s) => s.activeIframeId);
  const tabPins = useGraphStore((s) => s.tabPins);
  const defaultTabbarKey = useGraphStore((s) => s.defaultTabbarKey);
  const appState = useGraphStore((s) => s.appState);
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
    return Object.values(registeredProjects)
      .filter((info) => !info.parentProjectPath)
      .map((info) => {
        const agentIds = Object.entries(agentProjects)
          .filter(([, p]) => p === info.name)
          .map(([id]) => id);
        const activeCount = agents.filter(
          (a) => agentIds.includes(a.id) && a.status === 'active',
        ).length;
        const completedCount = agents.filter(
          (a) => agentIds.includes(a.id) && a.status === 'completed',
        ).length;
        return {
          kind: 'project' as const,
          key: `p:${info.name}`,
          name: info.name,
          path: info.path,
          count: agentIds.length,
          activeCount,
          completedCount,
        };
      });
  }, [registeredProjects, agentProjects, agents]);

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

  // --- Drag & Drop ---
  const dragIndexRef = useRef<number | null>(null);
  const dragKeyRef = useRef<string | null>(null);
  const tabBarRectRef = useRef<DOMRect | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  // §5.4 #14-1 — 드래그 중 마우스가 탭바 밖에 있어 detach 가 예상되는 상태일 때 detach-hint 표시.
  const [detachHint, setDetachHint] = useState(false);
  // §5.4 #14-1 v2.30 — cursor 옆에 따라다니는 floating hint card 위치 + 상태.
  // outside = true 면 "여기 놓으면 별창" 메시지(amber), false 면 "탭바 안에서 떼면 순서 변경"(neutral).
  const [floatingHint, setFloatingHint] = useState<{ x: number; y: number; outside: boolean; label: string } | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number, key: string) => {
      dragIndexRef.current = index;
      dragKeyRef.current = key;
      setDragKey(key);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', key);
      // bounding rect 는 dragstart 시점이 아니라 dragOver 시점에 lazy 캡처(scrollEl 이 이 시점엔 안전).
      tabBarRectRef.current = null;

      // §5.4 #14-1 v2.35 — native dragImage 를 1×1 transparent 로 비워서 cursor 옆에 박스가
      // 두 개 보이는 문제 해결. 실제 사용자 시야에 보이는 박스는 우리 floating hint card 하나만.
      try {
        const transparent = document.createElement('canvas');
        transparent.width = 1;
        transparent.height = 1;
        transparent.style.cssText = 'position:absolute;top:-9999px;left:-9999px;';
        document.body.appendChild(transparent);
        e.dataTransfer.setDragImage(transparent, 0, 0);
        window.setTimeout(() => {
          try { document.body.removeChild(transparent); } catch { /* noop */ }
        }, 0);
      } catch { /* noop */ }
    },
    [tabMap],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, overIndex: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const fromIndex = dragIndexRef.current;
      if (fromIndex === null || fromIndex === overIndex) return;
      // Live reorder (Chrome-tab-like behavior)
      setTabOrder((prev) => {
        const next = [...prev];
        const moved = next.splice(fromIndex, 1)[0] as string;
        next.splice(overIndex, 0, moved);
        return next;
      });
      dragIndexRef.current = overIndex;
    },
    [],
  );

  // §5.4 #14-1 v2.35 — safe-zone 을 TabBar scroll 영역에서 **헤더 행 전체**로 확장.
  // 사용자 의도: File 메뉴 등 헤더 안 어디서든 reorder 영역, 헤더 띠를 벗어나야(=캔버스로 내려와야) detach hint.
  // 헤더 행 = h-9 (= 36px) 띠 전체(가로 무관). 메인 윈도우 좌상단 (clientY 0) 에서 36px 까지가 safe.
  // 별창에서도 동일 — 별창의 미니 타이틀바도 36px 띠지만 별창엔 TabBar 가 없으므로 이 컨테이너 자체가 마운트 안 됨.
  const HEADER_SAFE_HEIGHT = 36;

  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    if (!dragKeyRef.current) return;
    e.preventDefault();
    const inside = e.clientY < HEADER_SAFE_HEIGHT;
    setDetachHint(!inside);
  }, []);

  // §5.4 #14-1 v2.30+v2.35 — 드래그 중 cursor 위치를 document 레벨로 추적해 floating hint card 띄움.
  // 캔버스/메인 영역 등 탭바 밖으로 가도 이벤트가 잡혀야 하므로 document.body 에 부착.
  // safe-zone 판정 = 헤더 행 전체(세로 36px 띠).
  useEffect(() => {
    if (!dragKey) {
      setFloatingHint(null);
      return;
    }
    const handleDocDragOver = (e: DragEvent): void => {
      if (!dragKeyRef.current) return;
      e.preventDefault();
      const inside = e.clientY < HEADER_SAFE_HEIGHT;
      const item = tabMap.get(dragKeyRef.current);
      const label =
        item?.kind === 'project' ? item.name : item?.kind === 'iframe' ? item.tab.label : dragKeyRef.current;
      setFloatingHint({ x: e.clientX, y: e.clientY, outside: !inside, label });
      setDetachHint(!inside);
    };
    document.addEventListener('dragover', handleDocDragOver);
    return () => {
      document.removeEventListener('dragover', handleDocDragOver);
    };
  }, [dragKey, tabMap]);

  // 탭바 자체에서 dragleave 가 발생해도 hint 즉시 OFF 하지 않음 — drag image 가 위에 떠 있으면
  // dragover/dragleave 가 깜빡거릴 수 있어 좌표 기반으로만 판정.

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    const draggedKey = dragKeyRef.current;
    dragIndexRef.current = null;
    dragKeyRef.current = null;
    setDragKey(null);
    setDetachHint(false);
    setFloatingHint(null);
    tabBarRectRef.current = null;
    if (!draggedKey) return;

    // §5.4 #14-1 v2.35 — dragEnd 좌표가 헤더 행(36px 띠) 밖이면 detach 트리거.
    const outside = e.clientY >= 36;
    if (!outside) return;

    const item = tabMap.get(draggedKey);
    if (!item) return;

    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.window) {
      // packaged 가 아닌 경우엔 detach 불가 — 단순 noop.
      return;
    }

    // screen 좌표가 필요(BrowserWindow 좌상단 기준) — Electron MouseEvent 의 screenX/Y 사용.
    const cursor = { x: e.screenX, y: e.screenY };

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

  // --- Stub tab click ---
  // --- Close handlers ---
  const handleCloseProject = useCallback(
    (e: React.MouseEvent, projectId: string, name: string) => {
      e.stopPropagation();
      const store = useGraphStore.getState();
      void store.closeProject(projectId, name);
      store.setTabPin(`project:${name}`, false);
    },
    [],
  );

  const handleCloseIframe = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const store = useGraphStore.getState();
      store.closeIframeTab(id);
      store.setTabPin(`iframe:${id}`, false);
    },
    [],
  );

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

  const ctxHasRight = useMemo(() => {
    if (!ctx) return false;
    return orderedTabs.some((it, i) => i > ctx.index && !isItemPinned(it));
  }, [ctx, orderedTabs, isItemPinned]);

  const handleCtxAction = useCallback((action: 'close' | 'closeOthers' | 'closeRight' | 'closeAll' | 'togglePin' | 'toggleDefault' | 'detach') => {
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
    } else if (action === 'closeRight') {
      targets = orderedTabs.filter((it, i) => i > ctx.index && !isItemPinned(it));
    } else if (action === 'closeAll') {
      targets = orderedTabs.filter((it) => !isItemPinned(it));
    }

    for (const target of targets) {
      if (target.kind === 'project') {
        void store.closeProject(target.path, target.name);
      } else {
        store.closeIframeTab(target.tab.id);
        store.setTabPin(tabPinKey(target), false);
        if (store.defaultTabbarKey === tabPinKey(target)) store.setDefaultTabbar(null);
      }
    }
  }, [ctx, ctxItem, ctxIsPinned, ctxIsDefault, orderedTabs, isItemPinned]);

  // --- 가로 스크롤 (탭 오버플로우 시 좌/우 페이드 + wheel 가로 스크롤 + hover 오버레이 썸) ---
  // 네이티브 스크롤바는 레이아웃 점유로 탭을 줄이기 때문에 hide 하고, 오버레이 썸을 별도 DOM 으로 그린다(VS Code 식).
  // 페이드/썸 갱신은 imperative ref 조작 — 스크롤·리사이즈마다 React 리렌더 없이 즉시 반영.
  // 콜백 ref 패턴 — useRef 는 DOM 마운트 시점에 effect 를 깨우지 못한다(초기 마운트 때 ref 가 null 이면
  // observer 가 영영 등록되지 않는 버그가 있었다). state 기반 ref 는 element 가 붙는 시점에 useEffect 가
  // 다시 돌아가서 항상 observer/scroll listener 가 정상 부착된다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
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

  // §3.7 v2.13/v2.14 — Chrome 스타일 탭. h-full 로 헤더(h-9) 꽉 채움, 고정 폭(w-40),
  // 라벨 truncate, 활성 탭은 콘텐츠 배경(gray-950) + 상단 2px 액센트 → 헤더 하단 구분선을
  // "씹고" 콘텐츠로 떨어지는 tab-folder 효과. 탭 간 1px 우측 구분선.
  // §5.4 #14-1 — redock-hover 가 활성이면 탭바 자체에 드롭존 글로우. 별창 헤더가 메인 탭바 위로
  // 옮겨와 있을 때 사용자에게 "여기 떨어뜨리면 합쳐짐" 시각 신호.
  const tabBarRedockGlow = redockHoverKey !== null;
  return (
    <div
      className={`group/tabscroll relative flex h-full min-w-0 flex-1 items-stretch transition-colors duration-150 ${
        tabBarRedockGlow ? 'bg-blue-900/30 ring-1 ring-inset ring-blue-400/60' : ''
      } ${detachHint ? 'opacity-60' : ''}`}
      data-redock-target={tabBarRedockGlow ? '1' : undefined}
      onDragOver={handleContainerDragOver}
    >
      {tabBarRedockGlow && (
        <span className="pointer-events-none absolute inset-x-2 top-0 z-10 flex items-center justify-center text-[10px] font-semibold uppercase tracking-wider text-blue-200">
          {t('tabDetach.redockZoneHint', { defaultValue: 'Drop here to redock' })}
        </span>
      )}
      {detachHint && (
        <span className="pointer-events-none absolute inset-x-2 bottom-0 z-10 flex items-center justify-center text-[10px] font-medium tracking-wide text-amber-300/90">
          {t('tabDetach.detachHint', { defaultValue: 'Drop outside the tab bar to open in a new window' })}
        </span>
      )}
      {/* §5.4 #14-1 v2.30 — cursor 옆에 따라다니는 floating hint card. outside=true 일 때만 강조. */}
      {floatingHint && createPortal(
        <div
          data-tab-floating-hint="1"
          className={`pointer-events-none fixed z-[9999] flex max-w-[260px] flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium shadow-lg shadow-black/50 transition-colors duration-100 ${
            floatingHint.outside
              ? 'bg-[#1f2937] text-amber-200 ring-1 ring-amber-400/60'
              : 'bg-[#1f2937]/85 text-gray-300 ring-1 ring-white/[0.08]'
          }`}
          style={{
            left: floatingHint.x + 18,
            top: floatingHint.y + 18,
          }}
        >
          <div className="flex items-center gap-1">
            {floatingHint.outside ? (
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
            <span className="truncate text-[12px] font-semibold text-white">{floatingHint.label}</span>
          </div>
          <span className={floatingHint.outside ? 'text-amber-200/95' : 'text-gray-400/90'}>
            {floatingHint.outside
              ? t('tabDetach.detachCardTitle', { defaultValue: 'Drop here to open as new window' })
              : t('tabDetach.reorderCardSubtitle', { defaultValue: 'Stay inside the tab bar to reorder' })}
          </span>
        </div>,
        document.body,
      )}
      <div
        ref={setScrollEl}
        onWheel={handleWheel}
        className="scrollbar-overlay flex h-full min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
      >
      {orderedTabs.map((item, idx) => {
        const isDragging = item.key === dragKey;
        const isPinned = isItemPinned(item);
        const isDefault = isItemDefault(item);

        if (item.kind === 'project') {
          const isActive = item.name === activeProject && activeIframeId === null;
          return (
            <div
              key={item.key}
              data-tab-key={item.key}
              draggable
              onDragStart={(e) => handleDragStart(e, idx, item.key)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              onContextMenu={(e) => handleContextMenu(e, item, idx)}
              className={`group app-nodrag relative flex h-full w-32 flex-shrink-0 items-center gap-1.5 border-r border-black/30 px-2.5 text-[12px] font-medium transition-colors duration-150 cursor-grab select-none ${
                isDragging ? 'opacity-40' : ''
              } ${
                isActive
                  ? 'bg-gray-950 text-white/90 before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-blue-400 after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-gray-950'
                  : 'bg-black/25 text-gray-400 hover:bg-black/40 hover:text-gray-200'
              }`}
              onClick={() => useGraphStore.getState().setActiveProject(item.name)}
            >
              {isPinned && (
                <span className="flex-shrink-0 cursor-help" title={t('tabMenu.pinTooltip')}>
                  <svg className="h-3 w-3 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 3l-1 1 1 1-4 4-3-1-4 4 5 5-5 5 1 1 5-5 5 5 1-1-5-5 4-4-1-3 4-4 1 1 1-1-5-5z" />
                  </svg>
                </span>
              )}
              {isDefault && (
                <span className="flex-shrink-0 cursor-help" title={t('tabMenu.defaultTooltip')}>
                  <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l2.39 7.36H22l-6.19 4.5L18.2 21 12 16.5 5.8 21l2.39-7.14L2 9.36h7.61z" />
                  </svg>
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {item.count > 0 && (() => {
                const dotState: ProjectDotState =
                  item.activeCount > 0
                    ? 'active'
                    : item.completedCount > 0
                      ? 'completed'
                      : 'idle';
                const tooltip =
                  item.activeCount > 0
                    ? t('header.agentStatus.tooltipWorking', {
                        active: item.activeCount,
                        total: item.count,
                      })
                    : t('header.agentStatus.tooltipCompleted', { count: item.count });
                return (
                  <span
                    title={tooltip}
                    className="flex flex-shrink-0 items-center gap-1 text-[10px] tabular-nums text-gray-300"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${PROJECT_DOT_STYLES[dotState]}`} />
                    <span>{item.activeCount}/{item.count}</span>
                  </span>
                );
              })()}
              <button
                type="button"
                draggable={false}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onDragStart={(e) => e.preventDefault()}
                onClick={(e) => handleCloseProject(e, item.path, item.name)}
                className="ml-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-white/[0.1] group-hover:opacity-100"
                title={t('header.tab.closeProject')}
              >
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </div>
          );
        }

        // iframe tab
        const isActive = activeIframeId === item.tab.id;
        return (
          <div
            key={item.key}
            data-tab-key={item.key}
            draggable
            onDragStart={(e) => handleDragStart(e, idx, item.key)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            onContextMenu={(e) => handleContextMenu(e, item, idx)}
            className={`group app-nodrag relative flex h-full w-32 flex-shrink-0 items-center gap-1.5 border-r border-black/30 px-2.5 text-[12px] font-medium transition-colors duration-150 cursor-grab select-none ${
              isDragging ? 'opacity-40' : ''
            } ${
              isActive
                ? 'bg-gray-950 text-sky-300 before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-sky-400 after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-gray-950'
                : 'bg-black/25 text-gray-400 hover:bg-black/40 hover:text-gray-200'
            }`}
            onClick={() => useGraphStore.getState().setActiveIframeTab(item.tab.id)}
          >
            {isPinned && (
              <span className="flex-shrink-0 cursor-help" title={t('tabMenu.pinTooltip')}>
                <svg className="h-3 w-3 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 3l-1 1 1 1-4 4-3-1-4 4 5 5-5 5 1 1 5-5 5 5 1-1-5-5 4-4-1-3 4-4 1 1 1-1-5-5z" />
                </svg>
              </span>
            )}
            {isDefault && (
              <span className="flex-shrink-0 cursor-help" title={t('tabMenu.defaultTooltip')}>
                <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l2.39 7.36H22l-6.19 4.5L18.2 21 12 16.5 5.8 21l2.39-7.14L2 9.36h7.61z" />
                </svg>
              </span>
            )}
            <svg className="h-3 w-3 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" fillOpacity={0.6} stroke="currentColor" strokeWidth={1.5}>
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zM4 12c0-.93.16-1.82.46-2.65L8 12.83V14a2 2 0 0 0 2 2v3.73A8.01 8.01 0 0 1 4 12zm14.54 3.35A2 2 0 0 0 17 14h-1v-3a1 1 0 0 0-1-1H9V8h2a1 1 0 0 0 1-1V5.08A7.97 7.97 0 0 1 20 12c0 1.2-.27 2.34-.74 3.35z" />
            </svg>
            <span className="min-w-0 flex-1 truncate">{item.tab.label}</span>
            <span className={`flex-shrink-0 rounded px-1 text-[9px] font-semibold ${item.tab.serverKind === 'frontend' ? 'bg-sky-500/20 text-sky-400' : 'bg-amber-500/20 text-amber-400'}`}>
              {item.tab.serverKind === 'frontend' ? t('common.serverKind.frontendShort') : t('common.serverKind.backendShort')}
            </span>
            <button
              type="button"
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
              onClick={(e) => handleCloseIframe(e, item.tab.id)}
              className="ml-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-white/[0.1] group-hover:opacity-100"
              title={t('header.tab.closeTab')}
            >
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
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
          hasRight={ctxHasRight}
          onAction={handleCtxAction}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  );
}

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { applyVisibleOrder } from '@vibisual/shared';
import { useGraphStore, countProjectBookmarks, selectActiveAutoGoalSummary } from '../../stores/graphStore.js';
import { useIDEPaneValue, useIDEPaneActions } from './idePane.js';
import type { IDEViewType } from '../../stores/graphStore.js';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';
import { buildExplorerActivityMenuItems } from './explorerContextMenu.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { openFolderByPath } from './useWorkspaceExplorer.js';
import { useRunningSubagentCount } from './IDERunningSubagentsView.js';
import { useHookFiring } from './IDEHooksView.js';
import { computeGoalIndicator } from './goalIndicator.js';
import { countRunning, useRunSessions } from '../../stores/runSessions.js';
import { fallbackViewForProvider, isViewAllowedForProvider } from './ideProviderViews.js';
import { useIDEBodyLayout } from './ideBodyLayoutContext.js';
import { activityItem } from './ideActivityItems.js';
import { ActivityIcon } from './ideActivityIcons.js';
import { useIDEActivityBarStore, selectActivityOrder } from '../../stores/ideActivityBar.js';
import { IDEActivityBarCustomize } from './IDEActivityBarCustomize.js';
import { useTabPushAnimation } from '../../hooks/useTabPushAnimation.js';
import { applyLocalOrder } from '../../hooks/tabPushGeom.js';
// §5.5 #16-1 (E) — 꾹 눌러 집어 드는 손짓. 두 탭바(§5.4 #14-2)와 **같은 훅**이라 손맛이 갈리지 않는다.
import { usePointerDragReorder } from '../../hooks/usePointerDragReorder.js';

/**
 * 이 칸이 지금 무엇을 말하고 있는가 — **표기 규약 한 벌**.
 *
 * 종전에는 배지가 두 벌이었다: 어떤 칸은 우상단 원형 배지(북마크·요약·실행·루프), 어떤 칸은
 * 아이콘 아래 숫자(목표·정독·서브에이전트). 그래서 40×40 칸에 숫자가 제각각 붙어 화면에서
 * 읽히는 것이 `2 / 1` 같은 낱개 숫자의 나열이 됐다(사용자 지적). 이제 **아이콘 아래 한 줄** 하나로
 * 모은다 — SSOT 가 "사용자가 정한 읽는 방식"이라고 못박은 쪽이고(#17-9 ⑤ v5.06 · #17-17 ⑩),
 * 원형 배지와 달리 글리프를 가리지 않는다.
 *
 * `dot` 만 예외다 — 검증의 마지막 판정은 **수가 아니라 색 하나**라 숫자 자리에 넣을 것이 없다.
 */
interface ActivityState {
  /** 아이콘 아래 한 줄. `null` 이면 아무것도 붙지 않는다(평소엔 조용히). */
  badge: string | null;
  /**
   * 글리프와 그 숫자에 입힐 색. `null` 이면 다른 항목과 같은 회색.
   * **점등은 글리프에만 건다** — 버튼에 색을 걸면 40×40 칸 전체가 물들어 옆 항목과 뭉쳐 보인다
   * (#17-17 ⑩ v4.69 가 세운 규칙).
   */
  tone: string | null;
  /** 지금 도는 중 — 글리프만 반짝인다. */
  blink: boolean;
  /** 숫자가 아닌 점 하나(검증의 마지막 판정 색). */
  dot: string | null;
}

const NEUTRAL: ActivityState = { badge: null, tone: null, blink: false, dot: null };

/** 세 자리를 넘는 수는 읽을 이유가 없다 — 40px 칸에서는 자리만 먹는다. */
function clampCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/*
 * 길게 누르기 시간·취소 거리·가장자리 자동 스크롤 수치는 `hooks/pointerDragGeom.ts`(`POINTER_DRAG`)
 * 한 곳에 있다 — 활동바와 두 탭바가 같은 손맛을 써야 하므로 이 자리에 사본을 두지 않는다.
 */

/** 오버레이 썸의 최소 길이(px). 칸이 많아져도 이보다 짧아지면 손에 잡히지도 눈에 띄지도 않는다. */
const ACTIVITY_THUMB_MIN_PX = 24;
/**
 * 밀어내기 재생(`useTabPushAnimation`)이 칸을 알아보는 표식.
 *
 * 버튼의 `data-activity-view` 와 **자리가 다르다** — 재생이 미는 것은 버튼이 아니라 그것을 감싼
 * 칸(줄 하나)이고, 그 칸이 목록의 직속 자식이어야 `offsetTop` 이 곧 줄의 자리가 된다.
 */
const ACTIVITY_KEY_ATTR = 'data-activity-key';

export const IDEActivityBar = memo(function IDEActivityBar(): React.JSX.Element {
  const { t } = useTranslation();
  const activeView = useIDEPaneValue((o) => o.activeView);
  const { setActiveView, toggleSidebar } = useIDEPaneActions();
  const sidebarCollapsed = useIDEPaneValue((o) => o.sidebarCollapsed);
  // 창이 좁아 사이드바가 서랍인가 — 그렇다면 항목을 누를 때 그 서랍까지 펴 줘야 한다
  //   (안 그러면 뷰만 조용히 바뀌고 화면에는 아무 일도 안 일어난 것처럼 보인다).
  const { navDrawer, sidebarDrawer, setNavOpen } = useIDEBodyLayout();

  // §5.5 #17-7 v4.93 — 북마크는 덮개 패널이 아니라 사이드바 뷰('bookmarks')다. 배지 = 보관 개수.
  //   (프로젝트별로 갈라 담기) 개수는 **지금 보고 있는 프로젝트 칸**만 센다 — 목록(IDEBookmarkView)과
  //   같은 산식(countProjectBookmarks/selectProjectBookmarks)을 써야 배지와 목록이 어긋나지 않는다.
  const bookmarkCount = useGraphStore(countProjectBookmarks);

  const agentId = useIDEPaneValue((o) => o.agentId);
  // §5.19 (G) · §5.25 (M) — 이 IDE 를 문 엔진이 무엇인가. **어느 엔진인지까지 봐야 한다** —
  //   로컬 모델에는 MCP·스킬·플러그인·훅이 정말 없지만 코덱스에는 전부 있어서, 같은 목록을 쓰면
  //   코덱스 사용자가 자기가 깔아 둔 것을 우리 창에서 못 본다(목록은 `ideProviderViews.ts` 한 곳).
  const providerKind = useGraphStore((s) => (agentId ? s.agentConfigs[agentId]?.provider?.kind : undefined));
  const show = useCallback(
    (view: IDEViewType) => isViewAllowedForProvider(view, providerKind),
    [providerKind],
  );
  // §5.5 #17-20 v4.74 — 이 에이전트가 켜 둔 실행(디버그 런처)의 수. PTY 수명이라 서버 스냅샷이
  //   아니라 런타임 스토어에서 읽는다.
  const runningRuns = useRunSessions((s) => countRunning(s.sessions, agentId));

  // §5.5 #17-9 ③(a) v4.95 — 백그라운드 서브에이전트: **지금 보고 있는 탭이 띄운 수** 하나로
  //   항목 노출·점등·배지를 모두 결정한다(종전엔 노출만 에이전트 전체 수라 `(0)` 배지가 났다).
  const runningCount = useRunningSubagentCount(agentId);

  // §5.5 #17-32 ④ — 이 세션의 훅이 지금 울리고 있는가(목록은 뷰가 읽는다 — 여기선 한 비트만).
  const hookFiring = useHookFiring(agentId);

  // §5.5 #17-11 v3.79 — 세션 반복 실행(루프). 설정 단위가 **지금 열려 있는 세션 탭**이라
  //   배지도 그 탭의 루프만 읽는다(메인 탭이면 배지 없음 — 설정 대상이 없다는 뜻).
  //   ⑨ v4.51 — 화면은 덮개 패널이 아니라 **사이드바 뷰**('loop') 다(스킬·목표와 같은 자리).
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const activeLoop = useGraphStore((s) => (activeSessionId ? s.sessionLoops[activeSessionId] : undefined));
  const loopRunning = !!activeLoop?.enabled;
  const loopBadge = activeLoop
    ? (activeLoop.mode === 'count' ? `${activeLoop.completed}/${activeLoop.total ?? 0}` : `${activeLoop.completed}`)
    : null;

  // §5.5 #17-17 v4.47 — 세션 목표. 루프와 같은 세션 탭 축이라 그 탭의 목표만 읽는다.
  //   항목은 **사이드바 뷰**(스킬창 자리)라 덮개 패널이 아니고, 아이콘은 **진행 중일 때만** 색이 켜진다
  //   (목표가 없거나 달성·중단이면 다른 항목과 같은 회색 = 평소엔 조용히).
  const activeGoal = useGraphStore((s) => (activeSessionId ? s.sessionGoals[activeSessionId] : undefined));
  // §5.5 #17-17 ⑩ v4.61 — "목표가 있다"와 "지금 그 목표를 향해 돌고 있다"는 다른 상태다.
  //   그 세션 탭(sub)이 실제로 실행 중일 때만 **아이콘 글리프가 반짝여** 셋이 한눈에 갈린다(v4.69).
  const goalWorking = useGraphStore((s) => {
    if (!agentId || !activeSessionId) return false;
    return s.subAgents[agentId]?.some((su) => su.id === activeSessionId && su.status === 'active') ?? false;
  });
  // §5.5 #17-17 ⑩ v4.73 — 점등·표기 판정은 `goalIndicator` 한 곳에 산다(두 번 뒤집힌 규칙이라
  //   순수 함수 + 테스트로 고정했다). 여기서는 그 결과를 그리기만 한다.
  const goalInd = computeGoalIndicator(activeGoal, goalWorking);
  // 툴팁은 좁은 한 줄이 못 담는 "얼마나 남았는지"까지 말한다.
  const goalTitle = goalInd.steps
    ? `${t('ide.activityBar.goal')} — ${t('ide.goal.stepCount', { done: goalInd.steps.done, total: goalInd.steps.total })} · ${t('ide.goal.stepRemaining', { count: goalInd.steps.total - goalInd.steps.done })}`
    : goalInd.lit
      ? `${t('ide.activityBar.goal')} — ${goalInd.meter}`
      : t('ide.activityBar.goal');

  /*
   * §5.10 (P) — **절차 감지** 칸. 목표에서 갈라져 나온 칸이라 읽는 재료도 다르다: 목표는 이 세션
   * 탭의 진행이고, 이 칸은 **이 프로젝트에 쌓인 절차**다(`autoGoal[activeProject]` — 절차는
   * 프로젝트별로 갈라져 저장된다).
   *
   * 전선에는 **에이전트 층까지만** 실려 온다(세션 층 덮어쓰기는 맵이 세션 수만큼 자라지 않도록
   * 싣지 않는다 — §5.10 (G)). 그래서 여기 점등은 "이 프로젝트·이 에이전트에서 도는가"까지이고,
   * 세션 한 칸까지 접은 마지막 판정은 뷰 머리글의 점이 말한다(REST 응답으로 그린다).
   */
  const autoGoalSummary = useGraphStore(selectActiveAutoGoalSummary);
  const autoGoalOn = autoGoalSummary
    ? (autoGoalSummary.agentEnabled?.[agentId ?? ''] ?? autoGoalSummary.enabled)
    : false;
  const autoGoalSkills = autoGoalSummary?.skillCount ?? 0;
  // 꺼져 있으면 후보는 세지 않는다 — 끄기는 삭제가 아니라 정지라 디스크에 남은 옛 후보가 그대로
  //   있는데(§5.10 "끄면 지우지 않는다"), 그것으로 색을 켜면 훑지도 않는 칸이 계속 재촉하게 된다.
  const autoGoalBrewing = autoGoalOn ? (autoGoalSummary?.candidateCount ?? 0) : 0;

  // 클로드 버블을 보다가 로컬 버블로 갈아타면 그 순간 열려 있던 뷰가 사라질 수 있다 —
  // 사이드바가 빈 채로 남지 않게 파일로 떨어뜨린다(§5.19 (G)).
  useEffect(() => {
    const next = fallbackViewForProvider(activeView, providerKind);
    if (next !== activeView) setActiveView(next);
  }, [activeView, providerKind, setActiveView]);

  // §5.5 #17-35 — 이 탭이 지금 검증 중인가 / 마지막 판정은 무엇인가. 원시값만 구독해
  //   스냅샷마다 새로 만들어지는 배열을 그대로 물지 않는다(zustand 파생 선택자 함정).
  const verifyState = useGraphStore((s) => {
    const runs = activeSessionId ? s.verificationRuns[activeSessionId] : undefined;
    if (!runs || runs.length === 0) return '';
    const live = runs.some((r) => r.status === 'running' || r.status === 'queued');
    const last = runs.find((r) => r.status === 'done');
    return `${live ? '1' : '0'}:${last?.verdict ?? ''}`;
  });
  const verifyRunning = verifyState.startsWith('1');
  const verifyDotTone = ((): string | null => {
    const verdict = verifyState.slice(2);
    if (verdict === 'pass') return 'bg-emerald-400';
    if (verdict === 'fail') return 'bg-rose-400';
    if (verdict === 'held') return 'bg-amber-400';
    return null;
  })();

  /*
   * §5.11 정독 게이트 — 이 세션이 **기획을 어디까지 읽었는가**.
   *
   * 검증 배지와 같은 규약으로 원시값 하나만 구독한다 — 정독 상태는 절 목록·구간까지 든 무거운 객체라
   * 그대로 물면 스냅샷마다 활동바가 통째로 다시 그려진다(zustand 파생 선택자 함정).
   * `충족/필수|인용실패|되돌림` 세 조각이면 점등·숫자·색이 전부 정해진다.
   */
  const readingState = useGraphStore((s) => {
    const r = activeSessionId ? s.specReading[activeSessionId] : undefined;
    if (!r || r.trust.requiredTotal === 0) return '';
    return `${r.trust.satisfied}/${r.trust.requiredTotal}|${r.trust.citationsFailed}|${r.stopRetries}`;
  });
  const reading = ((): { badge: string; tone: string } | null => {
    if (readingState === '') return null;
    const [ratio = '', failed = '0', retries = '0'] = readingState.split('|');
    // 색은 하나만 말한다 — **지금 이 세션을 믿어도 되는가.** 인용이 틀렸으면 그것이 가장 나쁜 소식이고,
    //   다 채웠으면 초록, 되돌린 적이 있으면 amber, 그 밖에는 다른 항목과 같은 회색(평소엔 조용히).
    const [done = '0', total = '0'] = ratio.split('/');
    const tone = Number(failed) > 0
      ? 'text-rose-400'
      : done === total
        ? 'text-emerald-400'
        : Number(retries) > 0
          ? 'text-amber-400'
          : 'text-gray-500';
    return { badge: ratio, tone };
  })();

  /**
   * §5.5 #17-19 ⑦ — 활동바 **파일** 우클릭 = 이 프로젝트 폴더를 OS 탐색기에서 연다.
   *
   * 사이드바를 열지 않아도 늘 떠 있는 자리라 여기서 답할 물음은 하나다 — "그 폴더를 열어 달라".
   * 만들기·이름 바꾸기·삭제는 **트리 안**(탐색기 행 우클릭)에 산다: 화면에 트리가 없는 채로
   * 파일을 만들면 만들어진 것이 어디 갔는지 보이지 않는다.
   */
  const filesRoot = useIDEProjectRoot();
  const [filesMenu, setFilesMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const handleFilesContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // IDE 창은 DOM 상 캔버스의 자식이라(§5.5 #17-6) 손짓을 여기서 멈춰 세운다.
    e.stopPropagation();
    setFilesMenu({
      x: e.clientX,
      y: e.clientY,
      items: buildExplorerActivityMenuItems(
        { hasProject: !!filesRoot },
        {
          revealFolder: () => { if (filesRoot) openFolderByPath(filesRoot, ''); },
          copyPath: () => { if (filesRoot) void navigator.clipboard?.writeText(filesRoot).catch(() => { /* 거부는 무시 */ }); },
        },
        t,
      ),
    });
  }, [filesRoot, t]);

  const openView = useCallback((view: IDEViewType) => {
    // v4.93·v4.95 — 북마크·세션 요약·실행 중 서브에이전트가 차례로 덮개를 벗어, 활동바의 모든 항목이
    // 이 한 함수를 탄다(같은 항목 재클릭 = 접힘). 상호 배타로 닫아 줄 덮개는 더 이상 없다.
    if (activeView === view && !sidebarCollapsed) {
      toggleSidebar();
      // 서랍이었다면 접는 쪽도 서랍을 함께 닫는다 — 접힌 사이드바 자리에 빈 서랍만 남지 않게.
      if (sidebarDrawer) setNavOpen(false);
    } else {
      setActiveView(view);
      if (sidebarCollapsed) toggleSidebar();
      if (sidebarDrawer) setNavOpen(true);
    }
  }, [activeView, sidebarCollapsed, sidebarDrawer, setNavOpen, setActiveView, toggleSidebar]);

  /*
   * §5.5 #17-44 ⑧(c) — **이 바에 예외는 없다.** 한때 `정독` 만 클릭 규약이 달라 켬/끔 3층 팝오버가
   * 떴는데, 열넷 중 하나만 다른 것이 열리면 그 칸은 손에 익지 않고 고장난 칸으로 읽힌다(사용자 지시).
   * 3층 스위치는 정독 뷰 안으로 들어갔으므로 여기서 갈릴 이유가 남지 않았다 — 모든 칸이 `openView`.
   */

  /* ─── §5.5 #16-1 사용자가 만들어 둔 배치(순서 · 내려놓은 칸) ─── */

  const order = useIDEActivityBarStore(selectActivityOrder);
  const hiddenList = useIDEActivityBarStore((s) => s.hidden);
  const prefsLoaded = useIDEActivityBarStore((s) => s.loaded);
  const fetchPrefs = useIDEActivityBarStore((s) => s.fetchPrefs);
  const setOrder = useIDEActivityBarStore((s) => s.setOrder);
  useEffect(() => { if (!prefsLoaded) void fetchPrefs(); }, [prefsLoaded, fetchPrefs]);

  // 화면에 실제로 서는 칸 = 순서 − 내려놓은 것 − 이 엔진에 없는 것.
  const visible = useMemo(
    () => order.filter((v) => !hiddenList.includes(v) && show(v)),
    [order, hiddenList, show],
  );
  // 내려놓은 칸도 **이 엔진에 있는 것만** 보여 준다 — 켤 수 없는 것을 켜라고 목록에 두면
  // 눌러도 아무 일이 없는 죽은 줄이 된다(§5.19 (G) "없는 기능의 입구는 거짓말이다").
  const excluded = useMemo(
    () => order.filter((v) => hiddenList.includes(v) && show(v)),
    [order, hiddenList, show],
  );

  /** 항목 이름 — `subagents` 만 수를 받는다. 구성 패널의 목록이 읽는 값이다. */
  const nameOf = useCallback((view: IDEViewType): string => {
    const item = activityItem(view);
    if (!item) return view;
    if (view === 'subagents') return t(item.labelKey, { count: runningCount });
    return t(item.labelKey);
  }, [t, runningCount]);

  /**
   * 활동바 칸의 툴팁. 이름과 **다르다** — 좁은 40px 칸이 못 담는 것을 여기서 말한다
   * (목표는 남은 단계까지). 구성 패널은 이 긴 문장 대신 위 `nameOf` 를 쓴다.
   */
  const labelOf = useCallback((view: IDEViewType): string => {
    if (view === 'goal') return goalTitle;
    // §5.10 (P) — 아래 숫자만으로는 그것이 무엇의 수인지 알 수 없다. 목록 머리글이 쓰는 그 문장을
    //   그대로 빌려 쓴다(새 키 ❌ — 같은 뜻에 문장이 둘이면 12 로케일에서 갈린다).
    if (view === 'autoGoal' && autoGoalSkills > 0) {
      return `${nameOf(view)} — ${t('ide.autoGoal.groupSkills', { count: autoGoalSkills })}`;
    }
    return nameOf(view);
  }, [goalTitle, nameOf, autoGoalSkills, t]);

  /** 그 칸이 지금 무엇을 말하는가(배지·점등). 항목마다 재료가 달라 여기 한 곳에서 갈린다. */
  const stateOf = useCallback((view: IDEViewType): ActivityState => {
    switch (view) {
      case 'goal':
        return {
          badge: goalInd.meter,
          tone: goalInd.lit ? 'text-emerald-400' : null,
          blink: goalInd.blink,
          dot: null,
        };
      case 'autoGoal':
        // 숫자는 **굳은 절차의 양**이라 그 자체로는 재촉할 일이 아니다(북마크와 같은 규약 — 색 ❌).
        //   색이 켜지는 때는 하나뿐이다: **곧 굳을 후보가 있을 때**(뷰에서 그 줄이 amber 인 것과 같은 뜻).
        return {
          badge: autoGoalSkills > 0 ? clampCount(autoGoalSkills) : null,
          tone: autoGoalBrewing > 0 ? 'text-amber-400' : null,
          blink: false,
          dot: null,
        };
      case 'hooks':
        return {
          badge: null,
          tone: hookFiring ? 'text-amber-400 drop-shadow-[0_0_5px_rgba(251,191,36,0.7)]' : null,
          blink: hookFiring,
          dot: null,
        };
      case 'debug':
        return {
          badge: runningRuns > 0 ? clampCount(runningRuns) : null,
          tone: runningRuns > 0 ? 'text-amber-400' : null,
          blink: false,
          dot: null,
        };
      case 'loop':
        return {
          badge: loopBadge,
          tone: loopRunning ? 'text-amber-400' : null,
          blink: false,
          dot: null,
        };
      case 'verify':
        return {
          badge: null,
          tone: verifyRunning ? 'text-amber-400' : null,
          blink: false,
          dot: verifyDotTone,
        };
      case 'specReading':
        return {
          badge: reading?.badge ?? null,
          tone: reading?.tone ?? null,
          blink: false,
          dot: null,
        };
      case 'subagents':
        return {
          badge: runningCount > 0 ? clampCount(runningCount) : null,
          tone: runningCount > 0 ? 'text-sky-400 drop-shadow-[0_0_5px_rgba(56,189,248,0.7)]' : null,
          blink: runningCount > 0,
          dot: null,
        };
      case 'bookmarks':
        // 보관 개수는 상태가 아니라 **양**이다 — 재촉할 일이 아니므로 색은 켜지 않는다.
        return { badge: bookmarkCount > 0 ? clampCount(bookmarkCount) : null, tone: null, blink: false, dot: null };
      default:
        return NEUTRAL;
    }
  }, [
    goalInd, hookFiring, runningRuns, loopBadge, loopRunning, verifyRunning, verifyDotTone,
    reading, runningCount, bookmarkCount, autoGoalSkills, autoGoalBrewing,
  ]);

  /* ─── 꾹 눌러 자리 옮기기 — 손에 붙어 따라오고, 지나는 칸이 밀린다 ─── */

  /*
   * 종전에는 끄는 동안 **아무것도 움직이지 않았다** — 잡은 칸은 제자리에서 흐려지기만 하고,
   * 놓일 자리는 파란 삽입선 한 줄로만 말했다. 그래서 "무엇을 들고 있는지"가 손이 아니라 목록
   * 어딘가에 남아 있어, 스마트폰 앱 아이콘을 옮기는 것과 전혀 다른 손짓이 됐다(사용자 지시:
   * "꾹 누르면 마우스에 아이콘이 붙어서 따라오고 아래로 내리면 직관적으로 아래 아이콘이 밀려야지").
   *
   * 이제 둘로 나뉜다.
   *   ① **고스트** — 잡은 글리프가 원래 자리를 떠나 커서에 붙는다(잡은 지점 그대로).
   *      원래 자리에는 점선 홈만 남아 "이 칸이 어디에 앉을지"를 말한다.
   *   ② **밀림** — 커서가 이웃 칸의 **중앙선을 넘는 순간** 순서를 바꾸고, 바뀐 자리로 되돌아
   *      앉는 재생을 건다. 삽입선 ❌ — §6 이 이미 탭바에 세워 둔 규칙과 같은 손맛이고,
   *      기하·수치도 그 한 벌(`tabPushGeom` · `useTabPushAnimation`)을 **축만 세로로** 돌려 쓴다.
   */

  const listRef = useRef<HTMLDivElement | null>(null);

  /*
   * 제스처 자체(길게 누르기 · 창이 따라가는 이벤트원 · 고스트 자리 · 중앙선 밀어내기 ·
   * 가장자리 자동 스크롤 · `click` 삼킴 · `Esc` 되돌리기)는 **공용 훅 한 벌**이 갖는다
   * (`hooks/usePointerDragReorder.ts`). 여기 남는 것은 활동바만의 것 둘뿐이다 —
   * `axis:'y'`(세로로 선 줄)와, 저장할 때 **전체 순서의 그 자리들에만 되꽂는** 규칙.
   */
  const drag = usePointerDragReorder({
    axis: 'y',
    container: listRef,
    keyAttribute: ACTIVITY_KEY_ATTR,
    order: visible,
    onCommit: (next) => {
      if (!next) return; // 제자리 — 저장할 것이 없다.
      // 화면에 선 것만 끌 수 있으므로(내려놓은 칸·이 엔진에 없는 칸은 목록에 없다) 새 순서를
      // 전체 순서의 **그 자리들**에만 되꽂는다(§5.5 #16-1 `applyVisibleOrder`).
      void setOrder(applyVisibleOrder(order, visible, next) as IDEViewType[]);
    },
  });
  const dragView = drag.dragKey as IDEViewType | null;
  const isDragging = dragView !== null;

  /**
   * 화면에 실제로 그리는 순서 — 끄는 동안에는 로컬 순서가 이긴다.
   *
   * 서버 목록 위에 **덧씌우는** 것이라(치환 ❌), 끄는 사이 목록 자체가 바뀌어도(엔진 교체 ·
   * 구성 패널에서 내려놓기) 로컬에 없는 칸이 사라지지 않고 뒤에 그대로 붙는다.
   */
  const shown = useMemo(
    () => (drag.localOrder ? applyLocalOrder(visible, drag.localOrder as IDEViewType[], (v) => v) : visible),
    [visible, drag.localOrder],
  );

  // 순서가 바뀐 그 렌더에서 **밀린 칸이 제자리로 되돌아 앉는** 재생을 건다(FLIP · 세로축).
  useTabPushAnimation({
    container: listRef,
    keyAttribute: ACTIVITY_KEY_ATTR,
    order: shown,
    leadKey: dragView,
    axis: 'y',
  });

  /* ─── 스크롤 레일 (오버레이 썸) ─── */

  /**
   * §5.5 #16-1 (D) — **스크롤바가 아이콘의 가운데선을 밀지 않는다(사용자 지시).**
   *
   * 네이티브 세로 스크롤바는 **레이아웃을 점유한다**. 폭 48px 짜리 바에서 그 몇 px 은 목록의
   * 내용 상자만 좁히므로, 스크롤이 생기는 순간 아이콘 열이 통째로 왼쪽으로 기울고 **위에 고정된
   * 구성 버튼과 축이 어긋났다**(사용자 보고 "가운데에서 왼쪽으로 기운다 · 지금 이상해").
   * 게다가 `.scrollbar-thin` 의 `::-webkit-scrollbar { width: 5px }` 는 지금 엔진에서 먹지 않는다 —
   * Chromium 121+ 는 표준 `scrollbar-width`/`scrollbar-color` 가 지정돼 있으면 webkit 유사요소의
   * 폭 지정을 통째로 무시하고 자기 `thin` 두께를 쓴다. 그래서 실제로 밀린 양은 5px 이 아니었다.
   *
   * 그래서 탭바(§5.5 #17-9)가 이미 세워 둔 규약을 **축만 세로로** 돌려 쓴다: 네이티브 스크롤바는
   * `scrollbar-overlay` 로 지우고(폭 점유 0 → 목록의 내용 상자는 늘 48px, 아이콘은 스크롤 유무와
   * 무관하게 같은 자리) 얇은 썸을 **별도 DOM 으로 목록 위에 띄운다**(VS Code 식).
   * 갱신은 스크롤·리사이즈마다 도는 자리라 상태가 아니라 DOM 을 직접 만진다(고스트와 같은 이유).
   */
  const thumbRef = useRef<HTMLDivElement | null>(null);

  const updateScrollThumb = useCallback((): void => {
    const el = listRef.current;
    const th = thumbRef.current;
    if (!el || !th) return;
    const overflow = el.scrollHeight - el.clientHeight;
    if (overflow <= 0 || el.clientHeight <= 0) {
      th.style.opacity = '0';
      th.style.height = '0px';
      return;
    }
    const ratio = el.clientHeight / el.scrollHeight;
    const height = Math.max(ACTIVITY_THUMB_MIN_PX, el.clientHeight * ratio);
    const top = (el.scrollTop / overflow) * (el.clientHeight - height);
    th.style.opacity = '1';
    th.style.height = `${height}px`;
    th.style.transform = `translateY(${top}px)`;
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    updateScrollThumb();
    el.addEventListener('scroll', updateScrollThumb, { passive: true });
    const ro = new ResizeObserver(updateScrollThumb);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    const onWinResize = (): void => {
      updateScrollThumb();
      requestAnimationFrame(updateScrollThumb);
    };
    window.addEventListener('resize', onWinResize);
    return () => {
      el.removeEventListener('scroll', updateScrollThumb);
      ro.disconnect();
      window.removeEventListener('resize', onWinResize);
    };
  }, [updateScrollThumb]);

  // 칸이 늘거나 줄면 `scrollHeight` 는 바뀌는데 **스크롤 상자 자신의 크기는 그대로**라, 위의
  //   `ResizeObserver` 는 그 변화를 못 본다 — 목록이 갈릴 때 다시 잰다. 구독을 다시 걸지 않는
  //   별도 효과인 이유: 끄는 동안 순서가 바뀔 때마다 관찰자를 뜯어 다시 세우지 않게.
  useEffect(() => { updateScrollThumb(); }, [shown, updateScrollThumb]);

  /* ─── 구성 패널 ─── */

  const [customizeOpen, setCustomizeOpen] = useState(false);
  // 이 엔진에 아무 칸도 없을 리는 없지만, 창이 닫힌 사이 목록이 비면 패널도 함께 닫는다.
  useEffect(() => {
    if (customizeOpen && visible.length === 0 && excluded.length === 0) setCustomizeOpen(false);
  }, [customizeOpen, visible.length, excluded.length]);

  return (
    // §4 v3.24 — 서랍일 때는 타이틀바 토글로 열리는 오버레이(본문을 상시 짓누르지 않게).
    //   사이드바(v3.18 오버레이, left-12)와 나란히 뜨도록 좌측 고정 + 불투명 배경.
    //   판정은 뷰포트 미디어 쿼리가 아니라 **이 창의 폭**이다(`ideResponsive`) — 넓은 화면에서
    //   창만 좁힌 경우에도 접혀야 하고, 그 조건은 `max-md` 가 모른다.
    //   §5.5 #16-1 — `relative` 는 구성 패널이 이 바의 오른쪽에 붙기 위한 기준점이다.
    <div className={`relative flex w-12 flex-shrink-0 flex-col items-center border-r border-gray-700 ${
      navDrawer ? 'absolute inset-y-0 left-0 z-40 bg-gray-900' : 'bg-gray-900/80'
    }`}>
      {/* §5.5 #16-1 — **구성.** 무엇을 올려 두고 어떤 차례로 둘지 정하는 자리(lucide sliders 톤).
          맨 위에 서는 이유: 아래 목록이 스크롤되는 동안에도 이 입구는 늘 같은 자리에 있어야 한다. */}
      <button
        type="button"
        onClick={() => setCustomizeOpen((o) => !o)}
        className={`mt-2 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition-colors ${
          customizeOpen ? 'bg-gray-800 text-gray-200' : 'text-gray-600 hover:bg-gray-800 hover:text-gray-300'
        }`}
        title={t('ide.activityBar.customize')}
        aria-label={t('ide.activityBar.customize')}
        aria-expanded={customizeOpen}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" />
          <circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="16" cy="18" r="2" />
        </svg>
      </button>
      <div className="my-1.5 h-px w-6 flex-shrink-0 bg-gray-700/70" />

      {/* 창 높이에 맞춰 **여기만** 스크롤한다 — 종전에는 바 전체가 고정 높이라 항목이 창 밖으로
          잘려 나갔다(창을 줄이면 아래쪽 칸에 손이 닿지 않았다). 구성 버튼은 위에 남는다.
          이 겉칸은 **오버레이 썸의 기준점**이다 — 썸을 스크롤 상자 안에 두면 내용과 함께 흘러간다. */}
      <div className="group/actrail relative flex w-full min-h-0 flex-1 flex-col items-center">
        <div
          ref={listRef}
          // `relative` 는 장식이 아니다 — 이 칸이 `offsetParent` 여야 각 줄의 `offsetTop` 이 곧
          //   목록 안의 자리가 되고, 밀림 재생·중앙선 판정이 스크롤과 무관하게 맞는다.
          // `scrollbar-overlay` — 네이티브 스크롤바는 **폭을 점유해** 아이콘 열을 왼쪽으로 밀므로
          //   지우고, 대신 아래 썸을 목록 위에 띄운다(위 「스크롤 레일」 주석).
          className="scrollbar-overlay relative flex w-full min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden pb-2"
        >
          {shown.map((view) => {
            const item = activityItem(view);
            if (!item) return null;
            const isActive = activeView === view && !sidebarCollapsed;
            const st = stateOf(view);
            // 지금 손에 들려 있는 칸 — 글리프는 고스트로 떠났고 여기엔 점선 홈만 남는다.
            const lifted = dragView === view;
            return (
              <div key={view} data-activity-key={view} className="relative flex w-full flex-shrink-0 justify-center">
                {lifted && (
                  <span className="pointer-events-none absolute inset-y-0 left-1 right-1 rounded border border-dashed border-blue-400/60 bg-blue-400/10" />
                )}
                <button
                  type="button"
                  data-activity-view={view}
                  onClick={() => {
                    if (drag.consumeClick()) return;
                    openView(view);
                  }}
                  // 누르기만 여기서 받는다 — 그 뒤의 이동·놓기·취소는 **창**이 받는다(위 규약).
                  //   버튼에 걸면 자리가 갈리는 순간 그 노드가 옮겨지면서 끌기가 손에서 사라진다.
                  onPointerDown={(e) => { drag.onPointerDown(e, view); }}
                  {...(view === 'files' ? { onContextMenu: handleFilesContextMenu } : {})}
                  className={`relative flex h-10 w-10 flex-col items-center justify-center gap-px rounded transition-colors ${
                    isActive
                      ? `border-l-2 ${item.accent} bg-gray-800 text-white`
                      : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
                  } ${lifted ? 'opacity-0' : ''}`}
                  // 끄는 동안 브라우저가 스크롤·선택으로 가로채지 않게(터치·펜 포함).
                  style={isDragging ? { touchAction: 'none' } : undefined}
                  title={labelOf(view)}
                  aria-label={labelOf(view)}
                >
                  <ActivityIcon
                    view={view}
                    className={`h-5 w-5 ${st.tone && !isActive ? st.tone : ''} ${st.blink ? 'animate-pulse' : ''}`}
                  />
                  {/* 숫자는 아이콘과 한 몸 — 점등이 버튼이 아니라 글리프에 사는 이상 색도 여기서 직접 준다. */}
                  {st.badge && (
                    <span className={`text-[12px] font-bold leading-none tabular-nums ${st.tone && !isActive ? st.tone : ''}`}>
                      {st.badge}
                    </span>
                  )}
                  {st.dot && <span className={`absolute right-1 top-1.5 h-2 w-2 rounded-full ${st.dot}`} />}
                </button>
              </div>
            );
          })}
        </div>
        {/* 오버레이 스크롤바 썸 — 목록 위로 떠서 hover 시 표시. **레이아웃 점유 0** 이라 아이콘의
            가운데선을 밀지 않는다. 길이·자리는 `updateScrollThumb()` 이 ref 로 직접 갱신한다. */}
        <div
          ref={thumbRef}
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 w-[3px] rounded-full bg-slate-400/0 transition-[background-color] duration-200 group-hover/actrail:bg-slate-400/50"
          style={{ opacity: 0, height: 0 }}
        />
      </div>

      {/*
        손에 들린 칸. **`document.body` 로 내보낸다** — 활동바는 DOM 상 캔버스의 자식이고(§5.5 #17-6)
        그 위에는 React Flow 의 `transform` 이 걸려 있어, 여기서 `fixed` 를 쓰면 뷰포트가 아니라
        그 변환된 조상 기준이 돼 고스트가 커서에서 어긋난다.
        자리는 렌더가 아니라 `moveGhost()` 가 transform 으로 준다(프레임마다 리렌더 ❌).
      */}
      {dragView && typeof document !== 'undefined' && createPortal(
        <div
          ref={drag.ghostRef}
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 z-[200] will-change-transform"
        >
          <div
            // 치수는 흉내 내지 않고 **재서 물려받는다**(§5.4 #14-2 (F-2)) — 종전 `h-10 w-10` 은
            //   원본 버튼과 우연히 같았을 뿐이라, 버튼이 커지면 조용히 어긋난다. `scale-110` 은
            //   "들어 올렸다"는 신호라 그대로 둔다.
            style={drag.dragSize ?? undefined}
            className="flex scale-110 flex-col items-center justify-center gap-px rounded-lg border border-blue-400/70 bg-gray-800 text-blue-300 shadow-lg shadow-black/60"
          >
            <ActivityIcon view={dragView} className="h-5 w-5" />
            {stateOf(dragView).badge && (
              <span className="text-[12px] font-bold leading-none tabular-nums">{stateOf(dragView).badge}</span>
            )}
          </div>
        </div>,
        document.body,
      )}

      {customizeOpen && (
        <IDEActivityBarCustomize
          order={order}
          visible={visible}
          hidden={excluded}
          labelOf={nameOf}
          onClose={() => setCustomizeOpen(false)}
        />
      )}

      {/* §5.5 #17-19 ⑦ — 활동바 **파일** 우클릭 메뉴. 위젯은 IDE 공용 하나를 그대로 쓴다. */}
      {filesMenu && (
        <IDEContextMenu x={filesMenu.x} y={filesMenu.y} items={filesMenu.items} onClose={() => setFilesMenu(null)} />
      )}
    </div>
  );
});

import { memo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore, selectIDEOverlay, countProjectBookmarks } from '../../stores/graphStore.js';
import { useIDEPaneValue, useIDEPaneActions } from './idePane.js';
import type { IDEViewType } from '../../stores/graphStore.js';
import { useRunningSubagentCount } from './IDERunningSubagentsView.js';
import { useHookFiring } from './IDEHooksView.js';
import { computeGoalIndicator } from './goalIndicator.js';
import { countRunning, useRunSessions } from '../../stores/runSessions.js';
import { fallbackViewForProvider, isViewAllowedForProvider } from './ideProviderViews.js';

interface ActivityItem {
  view: IDEViewType;
  labelKey: string;
  icon: string;
}

const ACTIVITIES: ActivityItem[] = [
  // §5.5 #17-31 — 첫 항목은 **이 프로젝트에서 쓸 수 있는 MCP**(종전 `터미널` = 세션 목록 자리).
  //   세션 목록은 탭 바·세션 요약이 이미 보여 주고 있었고, 여기서만 볼 수 있는 것은 무엇이
  //   붙어 있고 무엇이 켜져 있는가다. 아이콘은 lucide plug 톤(꽂는 것) stroke SVG.
  { view: 'mcp', labelKey: 'ide.activityBar.mcp', icon: 'M12 22v-5 M9 8V2 M15 8V2 M6 8h12v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z' },
  { view: 'files', labelKey: 'ide.activityBar.files', icon: 'M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z' },
  // §5.5 #17-28 v4.96 — 종전 `결과`(훅 이벤트 목록) 자리를 **컨텍스트 주입원 통제**가 잇는다.
  //   아이콘은 "쌓여 들어가는 층"(lucide layers 톤) — 이 프롬프트 앞에 무엇이 겹쳐 실리는가.
  { view: 'context', labelKey: 'ide.activityBar.context', icon: 'M12 2l9 5-9 5-9-5 9-5z M3 12l9 5 9-5 M3 17l9 5 9-5' },
  // §5.5 #17-4 v2.32 — Skills: lucide sparkles 톤 (별 + 작은 별 2개) stroke SVG.
  { view: 'skills', labelKey: 'ide.activityBar.skills', icon: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z' },
];

export const IDEActivityBar = memo(function IDEActivityBar(): React.JSX.Element {
  const { t } = useTranslation();
  const activeView = useIDEPaneValue((o) => o.activeView);
  const { setActiveView, toggleSidebar } = useIDEPaneActions();
  const sidebarCollapsed = useIDEPaneValue((o) => o.sidebarCollapsed);

  // §5.5 #17-7 v4.93 — 북마크는 덮개 패널이 아니라 사이드바 뷰('bookmarks')다. 배지 = 보관 개수.
  //   (프로젝트별로 갈라 담기) 개수는 **지금 보고 있는 프로젝트 칸**만 센다 — 목록(IDEBookmarkView)과
  //   같은 산식(countProjectBookmarks/selectProjectBookmarks)을 써야 배지와 목록이 어긋나지 않는다.
  const bookmarkCount = useGraphStore(countProjectBookmarks);

  // §5.5 #17-8 v2.95 — 세션 요약 보드 + "미확인 완료" 세션 수 배지.
  //   v4.93 — 이 항목도 사이드바 뷰('summary') 로 바뀌었다(덮개 토글 폐지).
  const agentId = useIDEPaneValue((o) => o.agentId);
  // §5.19 (G) — 이 IDE 가 로컬 버블(All Model)의 것인가. 그렇다면 클로드 CLI 에 매인 항목은
  //   아예 그리지 않는다 — 없는 기능의 입구를 남겨 두면 눌러 본 사용자가 빈 화면을 본다.
  const isLocalProvider = useGraphStore((s) => (agentId ? !!s.agentConfigs[agentId]?.provider : false));
  const show = useCallback(
    (view: IDEViewType) => isViewAllowedForProvider(view, isLocalProvider),
    [isLocalProvider],
  );
  const unreviewedCount = useGraphStore((s) => {
    const subs = agentId ? s.subAgents[agentId] : undefined;
    if (!subs) return 0;
    return subs.filter((su) => su.status === 'idle' && !s.acknowledgedSubAgents[su.id]).length;
  });

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

  // 클로드 버블을 보다가 로컬 버블로 갈아타면 그 순간 열려 있던 뷰가 사라질 수 있다 —
  // 사이드바가 빈 채로 남지 않게 파일로 떨어뜨린다(§5.19 (G)).
  useEffect(() => {
    const next = fallbackViewForProvider(activeView, isLocalProvider);
    if (next !== activeView) setActiveView(next);
  }, [activeView, isLocalProvider, setActiveView]);

  const handleClick = useCallback((view: IDEViewType) => {
    // v4.93·v4.95 — 북마크·세션 요약·실행 중 서브에이전트가 차례로 덮개를 벗어, 활동바의 모든 항목이
    // 이 한 함수를 탄다(같은 항목 재클릭 = 접힘). 상호 배타로 닫아 줄 덮개는 더 이상 없다.
    if (activeView === view && !sidebarCollapsed) {
      toggleSidebar();
    } else {
      setActiveView(view);
      if (sidebarCollapsed) toggleSidebar();
    }
  }, [activeView, sidebarCollapsed, setActiveView, toggleSidebar]);

  return (
    // §4 v3.24 — 폰(max-md)에선 타이틀바 토글로 열리는 오버레이(본문을 상시 짓누르지 않게).
    //   사이드바(v3.18 max-md 오버레이, left-12)와 나란히 뜨도록 좌측 고정 + 불투명 배경.
    <div className="flex w-12 flex-shrink-0 flex-col items-center gap-1 border-r border-gray-700 bg-gray-900/80 py-2 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:bg-gray-900">
      {ACTIVITIES.filter((item) => show(item.view)).map((item) => {
        const isActive = activeView === item.view && !sidebarCollapsed;
        return (
          <button
            key={item.view}
            type="button"
            onClick={() => handleClick(item.view)}
            className={`flex h-10 w-10 items-center justify-center rounded transition-colors ${
              isActive
                ? 'border-l-2 border-blue-400 bg-gray-800 text-white'
                : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
            }`}
            title={t(item.labelKey)}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d={item.icon} />
            </svg>
          </button>
        );
      })}

      {/* §5.5 #17-32 — 이 세션에 적용되는 훅. 첫 항목 MCP(무엇이 꽂혀 있나)와 같은 결의 물음
          — **무엇이 실제로 도는가**. 아이콘은 lucide webhook 톤 stroke SVG(이모지 ❌).
          ④ 발동 중에는 amber 로 켜지고 글리프가 깜빡인다. 점등을 **글리프에만** 거는 것은
          #17-17 ⑩ v4.69 가 세운 규칙 그대로다 — 버튼에 색을 걸면 40×40 칸 전체가 물들어 옆
          항목들과 뭉쳐 보인다. 여기서는 목록을 읽지 않는다(사이드바를 열지 않아도 떠 있는 자리라
          매번 디스크를 긁을 이유가 없다) — "울리고 있나" 한 비트면 충분하다. */}
      {show('hooks') && (
        <button
          type="button"
          onClick={() => handleClick('hooks')}
          className={`relative flex h-10 w-10 items-center justify-center rounded transition-colors ${
            activeView === 'hooks' && !sidebarCollapsed
              ? 'border-l-2 border-amber-400 bg-gray-800 text-white'
              : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
          }`}
          title={t('ide.activityBar.hooks')}
          aria-label={t('ide.activityBar.hooks')}
        >
          <svg
            className={`h-5 w-5 ${hookFiring ? 'animate-pulse text-amber-400 drop-shadow-[0_0_5px_rgba(251,191,36,0.7)]' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" />
            <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" />
            <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />
          </svg>
        </button>
      )}

      {/* §5.5 #17-33 — Claude Code 자신의 플러그인(명령·에이전트·스킬·훅·MCP 묶음) + 마켓플레이스.
          훅(#17-32) 바로 옆에 서는 같은 결의 물음 — **무엇이 이 세션에 실려 있는가**.
          §5.11 의 우리 관측 플러그인과는 다른 물건이라 아이콘도 다르다(lucide puzzle 톤 stroke SVG).
          배지는 **이 세션에 실제로 실리는 켜진 수**만 센다(남의 프로젝트에 매인 것은 빼고) —
          그 수가 0 이면 배지가 없다. 목록은 뷰가 읽는다(활동바가 매번 CLI 를 부르면 안 된다). */}
      {show('plugins') && (
        <button
          type="button"
          onClick={() => handleClick('plugins')}
          className={`relative flex h-10 w-10 items-center justify-center rounded transition-colors ${
            activeView === 'plugins' && !sidebarCollapsed
              ? 'border-l-2 border-indigo-400 bg-gray-800 text-white'
              : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
          }`}
          title={t('ide.activityBar.plugins')}
          aria-label={t('ide.activityBar.plugins')}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15.5 3.5a2.5 2.5 0 0 0-5 0V5H7a2 2 0 0 0-2 2v3.5H3.5a2.5 2.5 0 0 0 0 5H5V19a2 2 0 0 0 2 2h3.5v-1.5a2.5 2.5 0 0 1 5 0V21H19a2 2 0 0 0 2-2v-3.5h-1.5a2.5 2.5 0 0 1 0-5H21V7a2 2 0 0 0-2-2h-3.5z" />
          </svg>
        </button>
      )}

      {/* §5.5 #17-17 v4.47 — 세션 목표. 누르면 사이드바가 목표 뷰(최종 목표 + todo 체크리스트)로
          바뀌고, 같은 항목을 다시 누르면 접힌다(다른 사이드바 항목과 같은 규약).
          ⑩ v4.61 — 색이 세 상태로 갈리고(회색 = 목표 없음·달성·중단 / emerald = 진행 중이나 세션은
          멈춤 / **아이콘만 반짝임** = 지금 도는 중), 아이콘 아래 한 줄이 `완료/전체`(단계가 없으면
          퍼센트)를 띄운다 — 사이드바를 열지 않아도 어디까지 왔는지 읽힌다.
          v4.69 — 도는 중 표시는 **아이콘 하나에만** 건다. 버튼 배경·링을 칠하면 40×40 칸 전체가
          물들어 옆 항목들과 뭉쳐 보인다(사용자 지적) — 깜빡이는 것은 그 글리프뿐이어야 한다.
          v4.73 — 켜지는 조건은 "목표가 있다"가 아니라 **"보여줄 내용이 들어왔다"**(`goalIndicator`). 명령마다
          카드가 자동 생성되므로 빈 0% 에도 불이 켜져 눌러 보면 빈 화면이었다 — 불은 약속이다. */}
      {show('goal') && (
        <button
          type="button"
          onClick={() => handleClick('goal')}
          className={`relative flex h-10 w-10 flex-col items-center justify-center gap-px rounded transition-colors ${
            activeView === 'goal' && !sidebarCollapsed
              ? 'border-l-2 border-emerald-400 bg-gray-800 text-white'
              : goalInd.lit
                ? 'text-emerald-400 hover:bg-gray-800 hover:text-emerald-300'
                : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
          }`}
          title={goalTitle}
          aria-label={goalTitle}
        >
          <svg
            className={`h-5 w-5 ${goalInd.blink ? 'animate-pulse' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" />
          </svg>
          {/* 색은 부모 text-* 를 그대로 따른다(회색/emerald 자동 추종). */}
          {goalInd.meter && (
            <span className="text-[12px] font-bold leading-none tabular-nums">{goalInd.meter}</span>
          )}
        </button>
      )}

      {/* §5.5 #17-20 v4.74 — 디버그·실행 런처. 재생 + 벌레 글리프(VS Code 의 Run and Debug 와 같은 뜻).
          이 프로젝트의 실행 구성을 켜고 끄는 자리이자, 에이전트에 디버그 도구(MCP)를 꽂는 자리.
          돌고 있는 실행이 있으면 amber 로 켜지고 배지에 그 수가 뜬다(루프 배지와 같은 규약). */}
      {show('debug') && (
        <button
          type="button"
          onClick={() => handleClick('debug')}
          className={`relative flex h-10 w-10 items-center justify-center rounded transition-colors ${
            activeView === 'debug' && !sidebarCollapsed
              ? 'border-l-2 border-emerald-400 bg-gray-800 text-white'
              : runningRuns > 0
                ? 'text-amber-400 hover:bg-gray-800 hover:text-amber-300'
                : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
          }`}
          title={t('ide.activityBar.debug')}
          aria-label={t('ide.activityBar.debug')}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4l7 4-7 4z" />
            <rect x="10" y="11" width="8" height="8" rx="4" />
            <path d="M10 15H7M18 15h3M11.5 11.5L10 9M16.5 11.5L18 9M11.5 19l-1.5 2M16.5 19l1.5 2" />
          </svg>
          {runningRuns > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[12px] font-bold tabular-nums text-white">
              {runningRuns > 99 ? '99+' : runningRuns}
            </span>
          )}
        </button>
      )}

      {/* 북마크 — §5.5 #17-7 v4.93: 세션창을 덮던 패널을 폐지하고 **사이드바 뷰**로. 누르면 사이드바가
          북마크 목록으로 바뀌고, 같은 항목을 다시 누르면 접힌다(스킬·목표·루프와 같은 규약). */}
      {show('bookmarks') && (
        <button
          type="button"
          onClick={() => handleClick('bookmarks')}
          className={`relative flex h-10 w-10 items-center justify-center rounded transition-colors ${
            activeView === 'bookmarks' && !sidebarCollapsed
              ? 'border-l-2 border-blue-400 bg-gray-800 text-white'
              : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
          }`}
          title={t('ide.activityBar.bookmarks')}
          aria-label={t('ide.activityBar.bookmarks')}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          {bookmarkCount > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[12px] font-bold text-white">
              {bookmarkCount > 99 ? '99+' : bookmarkCount}
            </span>
          )}
        </button>
      )}

      {/* 세션 요약 — 쌓인 세션을 한눈에 요약 카드로. 배지 = 미확인 완료 세션 수("확인할 게 N개").
          §5.5 #17-8 v4.93: 북마크와 함께 덮개를 벗고 사이드바 뷰가 됐다(본문을 보면서 곁눈으로 훑는 자리). */}
      {show('summary') && (
        <button
          type="button"
          onClick={() => handleClick('summary')}
          className={`relative flex h-10 w-10 items-center justify-center rounded transition-colors ${
            activeView === 'summary' && !sidebarCollapsed
              ? 'border-l-2 border-violet-400 bg-gray-800 text-white'
              : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
          }`}
          title={t('ide.activityBar.sessionSummary')}
          aria-label={t('ide.activityBar.sessionSummary')}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <rect x="8" y="3" width="8" height="4" rx="1" />
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <path d="M9 12h6" /><path d="M9 16h4" />
          </svg>
          {unreviewedCount > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[12px] font-bold text-white">
              {unreviewedCount > 99 ? '99+' : unreviewedCount}
            </span>
          )}
        </button>
      )}

      {/* §5.5 #17-11 v3.79 — 세션 반복 실행(루프). 항목은 항상 있고(설정하러 들어오는 입구),
          배지는 지금 열린 세션 탭의 루프 진행(완료/목표 — 무한이면 완료 횟수)만 보여준다.
          도는 동안에는 아이콘이 amber 로 켜져 "이 탭은 지금 반복 중"이 한눈에 보인다.
          ⑨ v4.51 — 누르면 세션창을 덮는 대신 **사이드바가 루프 뷰로 바뀐다**(같은 항목 재클릭 시 접힘). */}
      {show('loop') && (
        <button
          type="button"
          onClick={() => handleClick('loop')}
          className={`relative flex h-10 w-10 items-center justify-center rounded transition-colors ${
            activeView === 'loop' && !sidebarCollapsed
              ? 'border-l-2 border-amber-400 bg-gray-800 text-white'
              : loopRunning
                ? 'text-amber-400 hover:bg-gray-800 hover:text-amber-300'
                : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
          }`}
          title={t('ide.activityBar.loop')}
          aria-label={t('ide.activityBar.loop')}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 2l4 4-4 4" />
            <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
            <path d="M7 22l-4-4 4-4" />
            <path d="M21 13v1a4 4 0 0 1-4 4H3" />
          </svg>
          {loopBadge !== null && (
            <span
              className={`absolute right-0 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[12px] font-bold tabular-nums text-white ${
                loopRunning ? 'bg-amber-500' : 'bg-gray-600'
              }`}
            >
              {loopBadge}
            </span>
          )}
        </button>
      )}

      {/* §5.5 #17-9 ⑤ v5.06 — 실행 중 서브에이전트. **항목은 늘 여기 있다**(터미널·파일·스킬과 같은
          자리·같은 규약). 도는 게 있을 때만 나타나게 두면 그 순간을 놓친 사용자에게는 이 기능이
          없는 것과 같다(사용자 지적) — 그래서 조건부 렌더와 "뷰 여는 동안만 회색" 예외를 함께 없앴다.
          상태는 색과 숫자로만 말한다: 도는 중이면 sky 점등 + **아이콘 바로 아래 개수**(목표 항목의
          진행 표기와 같은 형태 — 사용자가 정한 읽는 방식), 없으면 다른 항목과 같은 회색·숫자 없음.
          누르면 언제나 사이드바가 이 뷰로 바뀌고(재클릭 = 접힘), 도는 게 없으면 뷰가 설명을 띄운다.
          개수 산식은 '지금 보고 있는 탭' 한 벌 — `runningSubagents.ts`(③(a) v4.95).
          ⑨ — 도는 중 점등은 **아이콘(과 그 아래 숫자)에만** 건다. 버튼에 색을 걸면 호버 배경까지
          그 상태를 따라가 40×40 칸 전체가 물들어 옆 항목들과 뭉쳐 보인다(#17-17 ⑩ v4.69 와 같은 규칙) —
          빛나는 것은 그 글리프뿐이어야 한다. 버튼 자체는 다른 항목과 같은 회색·같은 호버를 유지한다. */}
      {show('subagents') && (
        <button
          type="button"
          onClick={() => handleClick('subagents')}
          className={`relative flex h-10 w-10 flex-col items-center justify-center gap-px rounded transition-colors ${
            activeView === 'subagents' && !sidebarCollapsed
              ? 'border-l-2 border-sky-400 bg-gray-800 text-white'
              : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
          }`}
          title={t('ide.activityBar.runningSubagents', { count: runningCount })}
          aria-label={t('ide.activityBar.runningSubagents', { count: runningCount })}
        >
          <svg
            className={`h-5 w-5 ${runningCount > 0 ? 'animate-pulse text-sky-400 drop-shadow-[0_0_5px_rgba(56,189,248,0.7)]' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
          >
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          {/* 숫자는 아이콘과 한 몸 — 점등이 버튼이 아니라 글리프에 사는 이상 색도 여기서 직접 준다. */}
          {runningCount > 0 && (
            <span className="text-[12px] font-bold leading-none tabular-nums text-sky-400">
              {runningCount > 99 ? '99+' : runningCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
});

import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentPhase } from '@vibisual/shared';
import { useTranslation } from 'react-i18next';
import { selectEffectiveProject, useGraphStore } from '../../stores/graphStore.js';
import { isPackagedDesktop } from '../../transport/index.js';
import { isMac } from '../../utils/platform.js';
import { FileMenu } from './FileMenu.js';
import { TabBar } from './TabBar.js';
import { HeaderLanguageSlot } from './HeaderLanguageSlot.js';
import { UpdateButton } from './UpdateButton.js';
import { PluginHeaderSlot } from '../../plugins/host.js';
import { OverlayToggleButton } from './OverlayToggleButton.js';
import { IDEWindowsMenu, type AgentDotState } from './IDEWindowsMenu.js';
import { UsagePill } from './UsagePill.js';
import { AuditPill } from './AuditPill.js';
import { ServerLogPopup } from '../Panel/ServerLogPopup.js';
import { resolveHeaderAgentCounts } from './headerAgentCounts.js';

interface HeaderProps {
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  agentPhase: AgentPhase;
}

// 폰 전용 [펼치기] 손잡이가 가리키는 묶음 — aria-controls 와 실제 id 가 한 벌이어야 한다.
const RIGHT_TOOLS_ID = 'header-right-tools';

const CONN_DOT: Record<HeaderProps['connectionStatus'], string> = {
  connecting: 'bg-yellow-400 animate-pulse',
  connected: 'bg-emerald-400',
  disconnected: 'bg-red-400',
};

// Connection labels are built inside the component via t() to support i18n.

// §3.7 v2.15 — 색 신호는 좌측 dot 한 점이 전담. 박스는 항상 동일한 중성 톤.
//   active > 0          → 파랑 깜빡
//   completed > 0 only  → 녹색 깜빡
//   전부 idle           → 회색 정적
//   0개                 → 배지 자체를 숨김
// (판올림 번호 발급 대기) 그 dot/글자를 실제로 그리는 곳은 `IDEWindowsMenu` 의 트리거다 —
//   배지가 [창과 버블] 메뉴를 여는 버튼을 겸하게 되면서 색표도 그쪽으로 옮겼다.
//   여기서는 어떤 상태인지만 정하고, 표는 한 벌만 둔다(두 벌이면 색이 갈라진다).

// agentLabel is now built inside the component using t() for i18n.

export function Header({
  connectionStatus,
  agentPhase,
}: HeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const agents = useGraphStore((s) => s.agents);
  const agentProjects = useGraphStore((s) => s.agentProjects);
  // 캔버스가 보고 있는 프로젝트 그대로 — worktree 버블 안으로 드릴다운 중이면 그 worktree.
  //   activeProject 만 보면 워크트리 안에서 도는 것을 세지 못해 배지와 화면이 서로 다른 말을 한다.
  const effectiveProject = useGraphStore(selectEffectiveProject);
  const subAgents = useGraphStore((s) => s.subAgents);
  const queuedCommands = useGraphStore((s) => s.queuedCommands);
  const runningSubagentTasks = useGraphStore((s) => s.runningSubagentTasks);
  // §9 — 배지 숫자의 SSOT 는 서버 집계다(탭 배지와 같은 값을 봐야 둘이 어긋나지 않는다).
  const projectAgentCounts = useGraphStore((s) => s.projectAgentCounts);
  // §7.7 v1.99 — 연결 인디케이터 클릭 시 서버 코어 로그 팝업.
  const [showServerLog, setShowServerLog] = useState(false);
  // 폰에서 우측 도구 묶음을 펼쳤는지. 기본 접힘 — 프로젝트 탭이 폭을 그대로 쓰게 한다.
  //   데스크톱은 묶음이 CSS 로 항상 보이므로 이 값이 화면을 바꾸지 않는다.
  const [rightToolsOpen, setRightToolsOpen] = useState(false);

  // 지금 보고 있는 캔버스 스코프로만 집계 — 전역 합산 ❌, 휴지통 ❌, 판정은 세션 축.
  //   숫자를 만드는 규칙 자체는 headerAgentCounts 가 갖는다(순수 함수 + 단위 테스트).
  const counts = useMemo(() => resolveHeaderAgentCounts(
    effectiveProject ? projectAgentCounts[effectiveProject] : undefined,
    { agents, agentProjects, project: effectiveProject, subAgents, queuedCommands, runningSubagentTasks },
  ), [
    projectAgentCounts, agents, agentProjects, effectiveProject, subAgents, queuedCommands, runningSubagentTasks,
  ]);

  // §5.12 (A) — 지휘통제실의 **두 번째 입구**. (판올림 번호 발급 대기) 이제 배지를 누르면 곧바로
  //   열리는 게 아니라 [창과 버블] 메뉴가 열리고, 그 **맨 아래 항목**이 이것을 부른다.
  //   프로젝트 root(home) 버블 좌더블클릭과 같은 호출이라 창 정체성(앱 전체 1창 · 이미 있으면
  //   focus + 보는 프로젝트 교체)도 그대로다. 지휘통제실은 desktop IPC 전용이므로 그 채널이 없는
  //   창(웹·모바일)에서는 그 항목만 안 그린다 — `BubbleNode` 가 root 를 더블클릭 대상에서 빼는 것과
  //   같은 가드.
  const canOpenCommandCenter = typeof window !== 'undefined' && !!window.api?.command?.open && !!effectiveProject;
  const openCommandCenter = useCallback((): void => {
    if (!effectiveProject) return;
    void window.api?.command?.open({ projectId: effectiveProject });
  }, [effectiveProject]);

  // prop `agentPhase` 는 전역값이라 탭 전환 시 갱신되지 않음 → 로컬 파생값 사용.
  void agentPhase;

  const dotState: AgentDotState =
    counts.running > 0 ? 'active' : counts.completed > 0 ? 'completed' : 'idle';
  const badgeVisible = counts.agents > 0;

  const connLabel: Record<HeaderProps['connectionStatus'], string> = {
    connecting: t('header.conn.connecting'),
    connected: t('header.conn.connected'),
    disconnected: t('header.conn.disconnected'),
  };

  const phaseTooltip =
    counts.agents === 0
      ? t('header.agentStatus.tooltipWaiting')
      : counts.running > 0
        ? t('header.agentStatus.tooltipWorking', {
          running: counts.running,
          sessions: counts.sessions,
          agents: counts.agents,
        })
        : t('header.agentStatus.tooltipIdle', {
          sessions: counts.sessions,
          agents: counts.agents,
        });

  return (
    // §3.7 v2.10/v2.12/v2.13 — 통합 타이틀바 한 줄(VS Code 톤). `app-drag` 로 헤더 전체가
    // 윈도우 드래그 영역. 우측 `pr-36`(=144px) 가 Windows titleBarOverlay 의 윈도우 컨트롤 폭
    // (기본 138px) 자리를 비워둔다. 내부 interactive 요소는 `app-nodrag` 로 클릭 복귀.
    // v2.13 — 한 줄 통합: h-9(36px), 로고 + File + (구분선) + 프로젝트 탭 + (드래그 spacer) + 우측 컨트롤.
    // §4 v3.16 — pr-36(윈도우 컨트롤 오버레이 자리)은 packaged Electron 에서만. 모바일/웹
    // 브라우저에는 네이티브 min/max/close 가 없어 144px 이 통째로 낭비돼 탭 영역을 짓눌렀다.
    //
    // macOS 는 컨트롤이 **좌상단 신호등**이라 반대로 잡아야 한다(2026-08-26 조사).
    //   - 좌측 `pl-20`(=80px): main 이 잡은 trafficLightPosition{x:12,y:11} 기준으로 신호등 3개가
    //     대략 78px 까지 차지한다. 이 여백이 없으면 신호등이 로고와 **File 메뉴 버튼을 덮어**
    //     폴더 열기·설정·플러그인의 유일한 진입로가 막힌다(네이티브 앱 메뉴가 없어 대안 없음).
    //   - 우측 `pr-36` 은 mac 에서 불필요하다 — titleBarOverlay 의 min/max/close 는 Windows·Linux
    //     전용이라, mac 에서 그대로 두면 144px 이 통째로 낭비돼 탭 영역만 짓눌린다.
    <header
      className={`app-drag relative z-[100] flex h-9 items-stretch bg-[#334155] ${
        isPackagedDesktop()
          ? isMac()
            ? 'pl-20 pr-1'
            : 'pr-36'
          : 'pr-1'
      }`}
    >
      {/* 좌측: 로고 + File 메뉴 + 프로젝트 탭 — 탭이 많아지면 내부에서 가로 스크롤. */}
      <div className="flex min-w-0 flex-1 items-stretch">
        {/* 로고 — 드래그 영역에 포함 (텍스트라 클릭 불필요). 가운데 정렬되도록 별도 h-full 박스.
            §4 v3.24 — 폰(max-md)에선 로고 블록 전체(dot 포함)를 숨겨 File+탭만 남긴다. */}
        <div className="flex h-full items-center gap-1.5 pl-3 pr-2 max-md:hidden">
          <div className="h-3 w-3 rounded-full bg-gradient-to-br from-blue-400 to-violet-500" />
          <span className="text-[12px] font-semibold tracking-tight text-white/90">
            {t('header.logo.name')}
          </span>
        </div>

        {/* File 메뉴 */}
        <div className="app-nodrag flex h-full items-center">
          <FileMenu />
        </div>

        {/* 구분선 */}
        <div className="mx-2 h-3.5 w-px self-center bg-white/[0.08]" />

        {/* 프로젝트 탭 — 한 줄 안에 인라인, h-full 로 헤더 꽉 채움. 가로 오버플로우 시 내부 스크롤.
            wrapper 자체는 app-drag(부모 헤더 상속) — 탭이 없거나 영역이 남으면 윈도우 드래그 가능.
            각 탭 div 에서 app-nodrag 로 클릭 복귀. */}
        <div className="flex min-w-0 flex-1 items-stretch">
          <TabBar />
        </div>
      </div>

      {/* 우측: 업데이트 + [접히는 묶음 — 에이전트 상태·연결·사용량·감사·언어] + 폰 전용 손잡이 */}
      <div className="ml-auto flex h-full flex-shrink-0 items-center gap-2 pr-2 max-md:min-w-0 max-md:shrink">
        {/* §4 v2.44 — 자동 업데이트 버튼(VS Code 식). available/downloading/downloaded 일 때만 노출.
            접히는 묶음 **밖**에 둔다 — 뜰 일이 드물고, 뜬 순간이 가장 중요한 알림이다. */}
        <UpdateButton />

        {/* (판올림 번호 발급 대기) **폰에서 접히는 우측 묶음**.
            §4 v3.24 는 이 자리(에이전트 배지·연결·언어)를 폰에서 **아예 지웠다** — 그 결과 [창과
            버블] 메뉴·지휘통제실·사용량·감사로 가는 입구가 폰에서 통째로 사라졌다(사용자 보고 —
            "프로젝트 상단 우측을 볼 길이 없다"). 지우는 대신 **접는다**: 기본은 접힌 채라 프로젝트
            탭이 폭을 그대로 쓰고, 오른쪽 손잡이를 누르면 펼쳐지고 다시 눌러 접는다.
            데스크톱(md 이상)은 항상 펼쳐져 있고 손잡이 자체가 없다 — 기존 화면 불변. */}
        <div
          id={RIGHT_TOOLS_ID}
          className={`flex h-full min-w-0 items-center gap-2 max-md:gap-1 ${rightToolsOpen ? '' : 'max-md:hidden'}`}
        >
          {/* §5.11 v4.01 — 플러그인 헤더 슬롯. 활성 기여가 없으면 호스트가 null 을 돌려 DOM 이 안 생긴다. */}
          <PluginHeaderSlot />

          {/* §5.5 #17-6 — 데스크톱 오버레이 위젯 전역 토글. 빼낸 버블이 있을 때만 노출. */}
          <OverlayToggleButton />

          {/* §4 v3.60 — Claude.ai 현재 세션(5시간 창) 사용률. 에이전트 배지 바로 왼쪽에 두고,
              클릭하면 사용량 전체(5h/7d·리셋 카운트다운·수집기 스위치)를 팝업으로 연다.
              §5.21 — 오늘 비용(비용 필)도 그 팝업 **하단**에 들어 있다. 헤더에는 두지 않는다. */}
          <UsagePill />

          {/* §5.22 — 오늘 위험 호출 수. 사용량 필 오른쪽에 붙어 클릭하면 감사 타임라인(§7.20)을 연다. */}
          <AuditPill />

          {/* §5.5 #17-1 · §5.12 (A) — 에이전트 배지가 곧 [창과 버블] 메뉴의 트리거다.
              창을 네 변에 붙이면 캔버스가 줄어드는데, 새 창을 여는 길과 에이전트 설정을 여는 길이
              캔버스 하나뿐이라 도크가 화면을 채우면 손이 닿지 않았다. 헤더는 z-[100] 이라 어떤 도크도
              못 가린다 — 그래서 그 진입로들을, 그리고 지휘통제실까지 여기 한 자리에 모은다. */}
          <IDEWindowsMenu
            badgeState={badgeVisible ? dotState : null}
            badgeRunning={counts.running}
            badgeSessions={counts.sessions}
            badgeTitle={t('header.agentStatus.tooltipMenu', { status: phaseTooltip })}
            canOpenCommandCenter={canOpenCommandCenter}
            onOpenCommandCenter={openCommandCenter}
          />

          {/* Connection indicator — 클릭 시 서버 코어 로그 팝업 (§7.7 v1.99). */}
          <button
            type="button"
            onClick={() => setShowServerLog(true)}
            title={t('header.conn.viewLogs')}
            className="app-nodrag flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-white/[0.08]"
          >
            <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${CONN_DOT[connectionStatus]}`} />
            {/* 폰에서는 점만 — 글자는 자리를 두 배로 먹는데 색이 이미 같은 말을 한다. */}
            <span className="text-[12px] text-gray-300 max-md:hidden">{connLabel[connectionStatus]}</span>
          </button>

          {/* Language switcher — 옵션창 Appearance › Language 와 같은 값을 만진다(§4 v3.24).
              §4 (첫 실행 온보딩) — 설치·로그인·폴더·버전 창이 떠 있으면 백드롭이 이 자리를 덮어
              눌리지 않는다. 슬롯이 그 동안만 같은 전환기를 창 위로 띄운다(자리·크기는 그대로). */}
          <HeaderLanguageSlot />
        </div>

        {/* 폰 전용 — 위 묶음을 펼치고 다시 접는 손잡이. md 이상에서는 그리지 않는다. */}
        <button
          type="button"
          onClick={() => setRightToolsOpen((v) => !v)}
          aria-expanded={rightToolsOpen}
          aria-controls={RIGHT_TOOLS_ID}
          aria-label={rightToolsOpen ? t('header.rightTools.collapse') : t('header.rightTools.expand')}
          title={rightToolsOpen ? t('header.rightTools.collapse') : t('header.rightTools.expand')}
          className="app-nodrag hidden h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-300 transition-colors max-md:flex hover:bg-white/[0.08]"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            {rightToolsOpen ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
          </svg>
        </button>
      </div>

      {/* §7.7 v1.99 — header 의 backdrop-filter 가 fixed 자식의 containing block 이 되므로
          (fixed inset-0 가 헤더 박스에 갇힘) 팝업은 body 로 portal 해서 화면 전체를 덮게 한다. */}
      {showServerLog && createPortal(
        <ServerLogPopup
          connectionStatus={connectionStatus}
          onClose={() => setShowServerLog(false)}
        />,
        document.body,
      )}
    </header>
  );
}

import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentPhase } from '@vibisual/shared';
import { useTranslation } from 'react-i18next';
import { selectEffectiveProject, useGraphStore } from '../../stores/graphStore.js';
import { isPackagedDesktop } from '../../transport/index.js';
import { isMac } from '../../utils/platform.js';
import { isDragRegionTarget } from '../../utils/titlebarPress.js';
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

// §3.7 — 배지 색은 좌측 dot 하나가 전담: active > 0 파랑 깜빡 · limited 만 주황(§2.4) · completed 만 녹색 · idle 회색 · 0개 숨김.
// 여기선 상태만 정하고 색표는 `IDEWindowsMenu` 트리거에 한 벌만 둔다.

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
  // §7.7 — 연결 인디케이터를 누르면 서버 코어 로그 팝업.
  const [showServerLog, setShowServerLog] = useState(false);
  // 폰에서 우측 도구 묶음을 펼쳤는지. 기본 접힘 — 프로젝트 탭이 폭을 그대로 쓰게 한다.
  //   데스크톱은 묶음이 CSS 로 항상 보이므로 이 값이 화면을 바꾸지 않는다.
  const [rightToolsOpen, setRightToolsOpen] = useState(false);
  // 로고·헤더·탭 줄 빈 자리는 같은 OS 제목줄이다. 페이지까지 온 더블클릭은 공통 보조 경로로
  // 최대화/복원한다. 누름은 부팅 지점의 installTitlebarPressCatch 가 받으며 탭·버튼은 제외한다.
  const handleTitlebarDoubleClick = useCallback((event: React.MouseEvent<HTMLElement>): void => {
    if (!isDragRegionTarget(event.target)) return;
    void window.api?.window?.toggleMaximizeSelf();
  }, []);

  // 지금 보고 있는 캔버스 스코프로만 집계 — 전역 합산 ❌, 휴지통 ❌, 판정은 세션 축.
  //   숫자를 만드는 규칙 자체는 headerAgentCounts 가 갖는다(순수 함수 + 단위 테스트).
  const counts = useMemo(() => resolveHeaderAgentCounts(
    effectiveProject ? projectAgentCounts[effectiveProject] : undefined,
    { agents, agentProjects, project: effectiveProject, subAgents, queuedCommands, runningSubagentTasks },
  ), [
    projectAgentCounts, agents, agentProjects, effectiveProject, subAgents, queuedCommands, runningSubagentTasks,
  ]);

  // §5.12 (A) — 지휘통제실의 두 번째 입구([창과 버블] 메뉴 맨 아래 항목). root 버블 좌더블클릭과 같은 호출이라 창 정체성도 같다.
  // desktop IPC 전용 — 채널이 없는 창(웹·모바일)에서는 그 항목만 안 그린다.
  const canOpenCommandCenter = typeof window !== 'undefined' && !!window.api?.command?.open && !!effectiveProject;
  const openCommandCenter = useCallback((): void => {
    if (!effectiveProject) return;
    void window.api?.command?.open({ projectId: effectiveProject });
  }, [effectiveProject]);

  // prop `agentPhase` 는 전역값이라 탭 전환 시 갱신되지 않음 → 로컬 파생값 사용.
  void agentPhase;

  // §2.4 (한도 정지) — **도는 것이 이긴다.** 한도를 무시하고 다시 돌린 세션이 하나라도 있으면
  //   그 프로젝트는 여전히 일하는 중이라 파랑이다. 도는 것이 하나도 없는데 끊긴 세션이 남아 있으면,
  //   그때가 사용자가 알아야 하는 순간이다 — 초록(끝남)으로 내려가면 멈춘 사실이 사라진다.
  const dotState: AgentDotState =
    counts.running > 0 ? 'active'
      : counts.limited > 0 ? 'limited'
        : counts.completed > 0 ? 'completed' : 'idle';
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
        // §2.4 (한도 정지) — 도는 것이 없을 때는 "몇 개가 멈춰 있는지"가 유일하게 급한 사실이다.
        : counts.limited > 0
          ? t('header.agentStatus.tooltipLimited', {
            limited: counts.limited,
            sessions: counts.sessions,
            agents: counts.agents,
          })
          : t('header.agentStatus.tooltipIdle', {
            sessions: counts.sessions,
            agents: counts.agents,
          });

  return (
    // §3.7 — 통합 타이틀바 한 줄(h-9). 헤더 전체가 `app-drag`, 누르는 요소만 `app-nodrag`.
    // `select-none` 을 다시 붙이지 말 것 — 글자 선택 차단은 `.app-drag`(`index.css`)가 소유한다.
    // 우측 `pr-36`(144px)은 Windows·Linux titleBarOverlay 컨트롤 자리 — packaged Electron 에서만(웹·모바일·mac 은 낭비).
    // macOS 좌측 `pl-20`(80px, 2026-08-26 조사): 신호등(trafficLightPosition{x:12,y:11})이 약 78px 를 차지해, 없으면 File 메뉴(유일한 입구)를 덮는다.
    <header
      className={`app-drag relative z-[100] flex h-9 items-stretch bg-vb-titlebar ${
        isPackagedDesktop()
          ? isMac()
            ? 'pl-20 pr-1'
            : 'pr-36'
          : 'pr-1'
      }`}
      onDoubleClick={handleTitlebarDoubleClick}
    >
      {/* 좌측: 로고 + File 메뉴 + 프로젝트 탭 — 탭이 많아지면 내부에서 가로 스크롤. */}
      <div className="flex min-w-0 flex-1 items-stretch">
        {/* 로고 상자 전체가 창 손잡이(제목줄과 같은 drag 영역) — no-drag 덮개를 두면 로고만 수동 이동 경로에 갇힌다. 폰(max-md)에선 숨긴다.
           OS 가 누름을 페이지로 보내면 installTitlebarPressCatch 와 헤더 더블클릭 보조 처리가 받는다. */}
        <div
          className="app-titlebar-handle app-drag relative flex h-full items-center gap-1.5 pl-3 pr-2 max-md:hidden"
        >
          <div className="h-3 w-3 rounded-full bg-gradient-to-br from-blue-400 to-violet-500" />
          <span className="text-[12px] font-semibold tracking-tight text-white/90">
            {t('header.logo.name')}
          </span>
        </div>

        {/* File 메뉴 */}
        <div className="flex h-full items-center px-1">
          {/* §3.7 — 클릭 자리는 `FileMenu` 루트(`app-nodrag`)뿐이다. 감싸개에 `app-nodrag` 를 걸지 말 것 — 버튼 둘레로 창을 못 옮긴다. */}
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
        {/* §4 — 자동 업데이트 버튼(받을 것이 있을 때만). 폰에서 접히는 묶음 밖에 둔다 — 뜬 순간이 가장 중요한 알림이다. */}
        <UpdateButton />

        {/* 폰에서 접히는 우측 묶음 — 지우지 않고 접는다(지우면 [창과 버블]·지휘통제실·사용량·감사 입구가 사라진다). 데스크톱(md 이상)은 늘 펼침, 손잡이 없음.
           §4 — 펼치면 헤더 아래 띠로 내려온다(같은 줄이면 탭 줄이 눌린다). 안의 팝업은 body 포털이거나 `useAnchoredMenuPlacement` 라 띠에 갇히지 않는다. */}
        <div
          id={RIGHT_TOOLS_ID}
          className={`flex h-full min-w-0 items-center gap-2 max-md:gap-1 ${
            rightToolsOpen
              ? 'max-md:absolute max-md:inset-x-0 max-md:top-full max-md:h-auto max-md:min-h-9 max-md:flex-wrap max-md:justify-end max-md:border-b max-md:border-black/40 max-md:bg-vb-titlebar max-md:px-2 max-md:py-1 max-md:shadow-lg max-md:shadow-black/40'
              : 'max-md:hidden'
          }`}
        >
          {/* §5.11 — 플러그인 헤더 슬롯. 활성 기여가 없으면 호스트가 null 을 돌려 DOM 이 안 생긴다. */}
          <PluginHeaderSlot />

          {/* §5.5 #17-6 — 데스크톱 오버레이 위젯 전역 토글. 빼낸 버블이 있을 때만 노출. */}
          <OverlayToggleButton />

          {/* §4 — 현재 세션(5시간 창) 사용률. 누르면 사용량 팝업(§5.21 오늘 비용도 그 하단 — 헤더에 두지 않는다). */}
          <UsagePill />

          {/* §5.22 — 오늘 위험 호출 수. 사용량 필 오른쪽에 붙어 클릭하면 감사 타임라인(§7.20)을 연다. */}
          <AuditPill />

          {/* §5.5 #17-1 · §5.12 (A) — 배지가 [창과 버블] 메뉴 트리거다. 도크가 캔버스를 덮어도 헤더(z-[100])는 안 가려지므로
             새 창·에이전트 설정·지휘통제실 입구를 여기 모은다. */}
          <IDEWindowsMenu
            badgeState={badgeVisible ? dotState : null}
            badgeRunning={counts.running}
            badgeSessions={counts.sessions}
            badgeTitle={t('header.agentStatus.tooltipMenu', { status: phaseTooltip })}
            canOpenCommandCenter={canOpenCommandCenter}
            onOpenCommandCenter={openCommandCenter}
          />

          {/* Connection indicator — 누르면 서버 코어 로그 팝업(§7.7). */}
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

          {/* Language switcher — 옵션창 Appearance › Language 와 같은 값(§4). 온보딩 백드롭이 덮는 동안은 슬롯이 같은 전환기를 창 위로 띄운다. */}
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
          className="app-nodrag hidden h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-300 transition-colors max-md:flex hover:bg-white/[0.08] pointer-coarse:h-8 pointer-coarse:w-8"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            {rightToolsOpen ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
          </svg>
        </button>
      </div>

      {/* §7.7 — header 의 backdrop-filter 가 fixed 자식의 containing block 이 되므로 팝업은 body 로 portal 한다. */}
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

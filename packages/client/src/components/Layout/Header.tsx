import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentPhase } from '@vibisual/shared';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { FileMenu } from './FileMenu.js';
import { TabBar } from './TabBar.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';
import { UpdateButton } from './UpdateButton.js';
import { OverlayToggleButton } from './OverlayToggleButton.js';
import { ServerLogPopup } from '../Panel/ServerLogPopup.js';

interface HeaderProps {
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  agentPhase: AgentPhase;
}

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
type AgentDotState = 'idle' | 'completed' | 'active';
const DOT_STYLES: Record<AgentDotState, string> = {
  idle: 'bg-gray-400',
  completed: 'bg-emerald-400 animate-pulse',
  active: 'bg-blue-400 animate-pulse',
};
const BADGE_STYLE = 'text-gray-300';

// agentLabel is now built inside the component using t() for i18n.

export function Header({
  connectionStatus,
  agentPhase,
}: HeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const agents = useGraphStore((s) => s.agents);
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const activeProject = useGraphStore((s) => s.activeProject);
  // §7.7 v1.99 — 연결 인디케이터 클릭 시 서버 코어 로그 팝업.
  const [showServerLog, setShowServerLog] = useState(false);

  // 활성 프로젝트 탭 스코프로만 집계 — 전역 합산이 아닌 현재 탭의 에이전트만.
  const { projectTotal, projectActive, projectCompleted } = useMemo(() => {
    if (!activeProject) return { projectTotal: 0, projectActive: 0, projectCompleted: 0 };
    const inProject = agents.filter((a) => agentProjects[a.id] === activeProject);
    return {
      projectTotal: inProject.length,
      projectActive: inProject.filter((a) => a.status === 'active').length,
      projectCompleted: inProject.filter((a) => a.status === 'completed').length,
    };
  }, [agents, agentProjects, activeProject]);

  // prop `agentPhase` 는 전역값이라 탭 전환 시 갱신되지 않음 → 로컬 파생값 사용.
  void agentPhase;

  const dotState: AgentDotState =
    projectActive > 0 ? 'active' : projectCompleted > 0 ? 'completed' : 'idle';
  const badgeVisible = projectTotal > 0;

  const connLabel: Record<HeaderProps['connectionStatus'], string> = {
    connecting: t('header.conn.connecting'),
    connected: t('header.conn.connected'),
    disconnected: t('header.conn.disconnected'),
  };

  const phaseTooltip =
    projectTotal === 0
      ? t('header.agentStatus.tooltipWaiting')
      : projectActive > 0
        ? t('header.agentStatus.tooltipWorking', { active: projectActive, total: projectTotal })
        : t('header.agentStatus.tooltipCompleted', { count: projectTotal });

  return (
    // §3.7 v2.10/v2.12/v2.13 — 통합 타이틀바 한 줄(VS Code 톤). `app-drag` 로 헤더 전체가
    // 윈도우 드래그 영역. 우측 `pr-36`(=144px) 가 Windows titleBarOverlay 의 윈도우 컨트롤 폭
    // (기본 138px) 자리를 비워둔다. 내부 interactive 요소는 `app-nodrag` 로 클릭 복귀.
    // v2.13 — 한 줄 통합: h-9(36px), 로고 + File + (구분선) + 프로젝트 탭 + (드래그 spacer) + 우측 컨트롤.
    <header className="app-drag relative z-[100] flex h-9 items-stretch bg-[#334155] pr-36">
      {/* 좌측: 로고 + File 메뉴 + 프로젝트 탭 — 탭이 많아지면 내부에서 가로 스크롤. */}
      <div className="flex min-w-0 flex-1 items-stretch">
        {/* 로고 — 드래그 영역에 포함 (텍스트라 클릭 불필요). 가운데 정렬되도록 별도 h-full 박스. */}
        <div className="flex h-full items-center gap-1.5 pl-3 pr-2">
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

      {/* 우측: 업데이트 + 에이전트 상태 + 연결 + 언어 */}
      <div className="ml-auto flex h-full flex-shrink-0 items-center gap-2 pr-2">
        {/* §4 v2.44 — 자동 업데이트 버튼(VS Code 식). available/downloading/downloaded 일 때만 노출. */}
        <UpdateButton />

        {/* §5.5 #17-6 — 데스크톱 오버레이 위젯 전역 토글. 빼낸 버블이 있을 때만 노출. */}
        <OverlayToggleButton />

        {/* Agent status — 에이전트가 1개라도 있을 때만 표시. 클릭 없음(순수 인디케이터). */}
        {badgeVisible && (
          <div
            title={phaseTooltip}
            className={`app-nodrag flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium tabular-nums tracking-tight ${BADGE_STYLE}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${DOT_STYLES[dotState]}`} />
            <span>
              {projectActive}/{projectTotal}
            </span>
          </div>
        )}

        {/* Connection indicator — 클릭 시 서버 코어 로그 팝업 (§7.7 v1.99) */}
        <button
          type="button"
          onClick={() => setShowServerLog(true)}
          title={t('header.conn.viewLogs')}
          className="app-nodrag flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-white/[0.08]"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${CONN_DOT[connectionStatus]}`} />
          <span className="text-[11px] text-gray-300">{connLabel[connectionStatus]}</span>
        </button>

        {/* Language switcher */}
        <div className="app-nodrag">
          <LanguageSwitcher />
        </div>
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

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  BubbleData,
  QueuedCommand,
  RunningSubagentTask,
  SessionRunState,
  SubAgent,
} from '@vibisual/shared';
import { BUBBLE_COLORS } from '@vibisual/shared';
import {
  useGraphStore,
  selectCanvasAgentBubbles,
  selectOrphanIDEPanes,
  selectProjectIDEPanes,
  selectRenderedIDEPanes,
  type IDEOverlayState,
  type IDEWindowLayoutKind,
} from '../../stores/graphStore.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { AgentConfigPopup } from '../Panel/AgentConfigPopup.js';
import type { IDEDockSide } from '../IDE/ideDockLayout.js';
import { useViewportSize } from '../IDE/useIDEDockLayout.js';
import { shortcutLabel } from '../../utils/platform.js';
import {
  SESSION_STATUS_LABEL_KEY,
  sessionDotClass,
  type SessionFocusGlow,
} from '../../utils/sessionStatus.js';
import { resolveAgentRunSummary, type AgentRunSummary } from './headerAgentCounts.js';

// §5.5 #17-1 (판올림 번호 발급 대기) — **도크가 화면을 채워도 늘 닿는 자리**.
//
// 창을 네 변에 붙이면 캔버스가 그만큼 줄어든다. 그런데 "새 창을 연다"와 "에이전트 설정을 연다"의
// 진입로가 **캔버스에서 버블을 누르는 것 하나뿐**이라, 창 두엇만 붙여도 그 두 가지에 손이 닿지
// 않는 상태가 생긴다(사용자 지적: "커스텀 화면이 가득 찬 경우 새 버블을 어떻게 뜨게 하지?").
//
// 헤더는 `z-[100]` 이라 어떤 도크도 가리지 못한다 — 그래서 그 두 진입로를 여기 하나로 모은다.
// 목록은 캔버스와 **같은 산식**(`selectCanvasAgentBubbles`)을 읽는다(두 곳이 갈라지면 안 된다).
//
// (판올림 번호 발급 대기) **헤더의 입구는 하나다.** 종전에는 같은 것을 가리키는 버튼이 헤더에 둘
// 서 있었다 — 이 메뉴의 창 아이콘 트리거와, 그 옆의 에이전트 상태 배지(`0/36`, 좌클릭 = 지휘통제실).
// 이제 **배지가 이 메뉴의 트리거**이고(창 아이콘 버튼 폐지), 지휘통제실은 메뉴 맨 아래 항목으로
// 들어온다(§5.12 (A) 트리거 ②). 에이전트가 없어 배지가 안 뜨는 프로젝트에서도 **버블이 사라진 창**은
// 남을 수 있으므로, 그때만 트리거가 종전 창 아이콘 모양으로 되돌아간다 — 그 창을 닫을 자리가 여기뿐이다.

const EMPTY_AGENTS: BubbleData[] = [];
const EMPTY_PANES: IDEOverlayState[] = [];
const EMPTY_NODE_MAP: Record<string, BubbleData> = {};
// 실행 상태 재료 — 메뉴가 닫혀 있는 동안에는 이 빈 것들을 구독해 스냅샷마다 다시 그리지 않는다.
const EMPTY_SUBS: Record<string, SubAgent[]> = {};
const EMPTY_COMMANDS: Record<string, QueuedCommand[]> = {};
const EMPTY_TASKS: Record<string, RunningSubagentTask[]> = {};
const EMPTY_ACK: Record<string, true> = {};
const EMPTY_GLOW: Record<string, SessionFocusGlow> = {};

/**
 * 배지 색 신호 — 좌측 dot 한 점이 전담하고 글자는 항상 같은 중성 톤(§3.7 v2.15 규약 그대로,
 * 배지가 이 메뉴의 트리거가 되면서 자리만 `Header` 에서 옮겨 왔다).
 */
export type AgentDotState = 'idle' | 'completed' | 'active' | 'limited';

const BADGE_DOT: Record<AgentDotState, string> = {
  idle: 'bg-gray-400',
  completed: 'bg-emerald-400 animate-pulse',
  active: 'bg-blue-400 animate-pulse',
  // §2.4 (한도 정지) — 세션 도트(`SESSION_STATUS_DOT.limited`)와 **같은 주황**이다. 배지에서
  //   주황을 보고 메뉴를 열면 그 색 그대로의 줄들이 맨 위에 서 있어야 눈이 이어진다.
  limited: 'bg-orange-400 animate-pulse',
};

interface IDEWindowsMenuProps {
  /**
   * 에이전트 배지 상태 — `null` 이면 이 프로젝트에 셀 에이전트가 없다는 뜻이라 트리거가 종전
   * 창 아이콘으로 되돌아간다(버블이 사라진 창을 닫을 자리는 남아 있어야 한다).
   *
   * ⚠ 배지 재료는 **원시값으로만** 받는다. 객체나 ReactNode 로 받으면 `Header` 가 스냅샷마다
   *   새 참조를 만들어 아래 `memo` 가 통째로 무력해진다(닫힌 메뉴가 매 스냅샷 다시 그려진다).
   */
  badgeState: AgentDotState | null;
  /** 지금 돌고 있는 세션 수 — 배지의 분자. */
  badgeRunning: number;
  /** 이 프로젝트의 세션 수 — 배지의 분모. */
  badgeSessions: number;
  /**
   * §2.4 (한도 정지) — 한도로 끊긴 채 다시 돌지 않은 세션 수. 0 보다 크면 메뉴 맨 위에 그 사실을
   * 한 줄로 세운다(색만으로는 "몇 개가" 를 말할 수 없다).
   */
  badgeLimited: number;
  /** 배지 툴팁 — 집계 문장 + "누르면 목록이 열린다" 안내. */
  badgeTitle: string;
  /** §5.12 (A) — 지휘통제실은 desktop IPC 전용이라 채널이 없는 창에서는 항목을 그리지 않는다. */
  canOpenCommandCenter: boolean;
  onOpenCommandCenter: () => void;
}

/** 창 하나 + 그 창이 붙은 에이전트 — 목록 한 줄의 재료. */
interface WindowRow {
  agent: BubbleData;
  pane: IDEOverlayState | null;
  /**
   * 이 에이전트가 **지금 도는가** — 배지와 같은 산식(`resolveAgentRunSummary`).
   * 창 유무와는 다른 축이다: 창이 없어도 도는 에이전트가 있고, 창만 띄워 둔 채 조용한 것도 있다.
   */
  run: AgentRunSummary;
  /**
   * (판올림 번호 발급 대기) 이 버블의 세션 중 **방금 눌러 들어간 자국** — 있으면 그 색이 줄에도
   * 남는다. 줄의 색은 버블 단위이고 자국은 세션 단위라, 그 버블의 세션들 중 **가장 최근 자국**을 쓴다.
   */
  glow: SessionFocusGlow | undefined;
}

function sideLabelKey(side: IDEDockSide): string {
  return `header.ideWindows.side.${side}`;
}

/**
 * (판올림 번호 발급 대기) **레이아웃 프리셋**(언리얼 Window ▸ 레이아웃 관용).
 *
 * 창을 서넛 띄우면 겹쳐 쌓여 아래 것을 찾을 수 없고, 하나씩 끌어 맞추는 데 시간이 든다.
 * 여기서 한 번에 늘어놓거나(바둑판·계단식) 한 칸에 모은다(탭·좌우). 실행은 스토어 액션 하나
 * (`applyIDEWindowLayout`)가 맡고 이 표는 **무엇을 보여 줄지**만 정한다.
 */
const LAYOUT_ITEMS: ReadonlyArray<{ kind: IDEWindowLayoutKind; icon: React.JSX.Element }> = [
  {
    kind: 'tile',
    icon: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="1" />
        <rect x="13" y="3" width="8" height="8" rx="1" />
        <rect x="3" y="13" width="8" height="8" rx="1" />
        <rect x="13" y="13" width="8" height="8" rx="1" />
      </>
    ),
  },
  {
    kind: 'cascade',
    icon: (
      <>
        <rect x="3" y="3" width="13" height="13" rx="2" />
        <path d="M8 20h11a1 1 0 0 0 1-1V8" />
      </>
    ),
  },
  {
    kind: 'tabRight',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M13 4v16M16 8h5" />
      </>
    ),
  },
  {
    kind: 'splitLeftRight',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16M15 4v16" />
      </>
    ),
  },
  {
    kind: 'undockAll',
    icon: (
      <>
        <rect x="3" y="8" width="13" height="13" rx="2" />
        <path d="M8 3h13v13" />
      </>
    ),
  },
];

export const IDEWindowsMenu = memo(function IDEWindowsMenu({
  badgeState,
  badgeRunning,
  badgeSessions,
  badgeLimited,
  badgeTitle,
  canOpenCommandCenter,
  onOpenCommandCenter,
}: IDEWindowsMenuProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [configAgentId, setConfigAgentId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // 정렬 계산은 **지금 화면 크기**를 알아야 한다 — 자리를 비우는 쪽과 같은 훅에서 받는다.
  const viewport = useViewportSize();

  // 닫혀 있는 동안에는 스냅샷마다 새로 오는 `agents` 배열을 구독하지 않는다 — 헤더가 매 스냅샷
  //   다시 그려질 이유가 없다. 열 때만 실제 목록을 구독한다.
  const agents = useGraphStore((s) => (open ? s.agents : EMPTY_AGENTS));
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const currentFolderId = useGraphStore((s) => s.currentFolderId);
  const worktreeProjects = useGraphStore((s) => s.worktreeProjects);
  const activeProject = useGraphStore((s) => s.activeProject);
  const ideOverlays = useGraphStore((s) => s.ideOverlays);
  const agentConfigs = useGraphStore((s) => s.agentConfigs);
  // 실행 상태 재료 — 열려 있을 때만 진짜를 구독한다. 전부 스토어 필드라 참조가 안정적이다
  //   (여기서 배열·객체를 새로 만들어 고르면 zustand v5 가 매 커밋 "또 바뀌었다"로 읽는다).
  const subAgents = useGraphStore((s) => (open ? s.subAgents : EMPTY_SUBS));
  const queuedCommands = useGraphStore((s) => (open ? s.queuedCommands : EMPTY_COMMANDS));
  const runningSubagentTasks = useGraphStore((s) => (open ? s.runningSubagentTasks : EMPTY_TASKS));
  const acknowledgedSubAgents = useGraphStore((s) => (open ? s.acknowledgedSubAgents : EMPTY_ACK));
  // (판올림 번호 발급 대기) 방금 눌러 들어간 색 — 목록을 다시 열었을 때 그 줄이 아직 그 색으로
  //   뛰고 있어야 "내가 이걸 눌렀지"가 이어진다. 닫혀 있는 동안은 그릴 일이 없어 구독하지 않는다.
  const sessionFocusGlow = useGraphStore((s) => (open ? s.sessionFocusGlow : EMPTY_GLOW));

  // 배지 숫자는 늘 필요하다 — 원시값이라 싸다. **실제로 그려지는 창**만 앞 숫자로 센다
  //   (접힌 창·버블이 사라진 유령 창까지 세면 화면에 없는 것이 숫자로만 남아 헷갈린다).
  const visibleCount = useGraphStore((s) => selectRenderedIDEPanes(s)
    .filter((o) => o.agentId && s.nodeMap[o.agentId]).length);
  const collapsedCount = useGraphStore((s) => selectProjectIDEPanes(s).filter((o) => o.collapsed).length);
  const orphanCount = useGraphStore((s) => selectOrphanIDEPanes(s).length);
  const openCount = visibleCount + collapsedCount + orphanCount;
  // 이 탭에 에이전트 버블이 있는가 — **닫혀 있을 때도** 알아야 버튼을 그릴지 정할 수 있다.
  //   숫자 하나라 배열 신원과 무관하게 값이 달라질 때만 다시 그린다.
  const agentCount = useGraphStore((s) => selectCanvasAgentBubbles(s).length);
  // 설정창이 가리키는 버블은 **스토어에서** 읽는다 — 목록(rows)은 메뉴가 닫히면 비므로,
  //   거기서 꺼내 쓰면 설정창을 여는 순간(= 바깥 누름으로 메뉴가 닫히며) 창도 같이 사라진다.
  const configAgent = useGraphStore((s) => (configAgentId ? s.nodeMap[configAgentId] : undefined));

  useOutsidePressDismiss({
    onDismiss: () => setOpen(false),
    enabled: open,
    refs: [menuRef],
    capture: false,
  });

  const rows = useMemo<WindowRow[]>(() => {
    if (!open) return [];
    const panes = selectProjectIDEPanes({ ideOverlays, activeProject });
    const paneByAgent = new Map<string, IDEOverlayState>();
    for (const p of panes) if (p.agentId) paneByAgent.set(p.agentId, p);
    const runSrc = {
      subAgents,
      queuedCommands,
      runningSubagentTasks,
      acknowledged: acknowledgedSubAgents,
    };
    // 그 버블의 세션 자국 중 가장 최근 것 — 한 버블에서 여럿을 눌렀으면 마지막 손이 이긴다.
    const glowOf = (agentId: string): SessionFocusGlow | undefined => {
      let best: SessionFocusGlow | undefined;
      for (const s of subAgents[agentId] ?? []) {
        const g = sessionFocusGlow[s.id];
        if (g && (best === undefined || g.at > best.at)) best = g;
      }
      return best;
    };
    const list = selectCanvasAgentBubbles({ agents, agentProjects, currentFolderId, worktreeProjects, activeProject })
      .map<WindowRow>((agent) => ({
        agent,
        pane: paneByAgent.get(agent.id) ?? null,
        run: resolveAgentRunSummary(agent, runSrc),
        glow: glowOf(agent.id),
      }));
    // §2.4 (한도 정지) — **멈춘 줄이 맨 위다.** 창이 떠 있는지보다 급하다: 한도로 끊기면 여러 개가
    //   한꺼번에 멎는데, 그것들이 목록 아래에 흩어져 있으면 무엇을 다시 돌려야 하는지 셀 수가 없다
    //   (사용자 지시 — "상단에 멈춘 애들 우선적으로 표시"). 멈춘 것이 없으면 아래 순서는 종전 그대로다.
    // 그다음이 창이 있는 것(맨 앞 창이 위) — 지금 보고 있는 것이 목록에서도 위에 있어야 한다.
    // 창이 없는 것들 사이에서는 **도는 것이 먼저**다 — 에이전트가 열댓 개면 도는 줄이 목록
    //   한참 아래에 묻혀, 배지가 "4개 실행 중"이라고 말해도 그 넷을 찾을 수 없다.
    return list.sort((a, b) => {
      const byLimited = (b.run.state === 'limited' ? 1 : 0) - (a.run.state === 'limited' ? 1 : 0);
      if (byLimited !== 0) return byLimited;
      const byPane = (b.pane?.z ?? -1) - (a.pane?.z ?? -1);
      if (byPane !== 0) return byPane;
      return (b.run.running > 0 ? 1 : 0) - (a.run.running > 0 ? 1 : 0);
    });
  }, [
    open, agents, agentProjects, currentFolderId, worktreeProjects, activeProject, ideOverlays,
    subAgents, queuedCommands, runningSubagentTasks, acknowledgedSubAgents, sessionFocusGlow,
  ]);

  // 슬롯은 살아 있는데 버블이 사라진 창 — 화면에는 아무것도 안 뜨는데 슬롯만 남아, 종전에는
  //   목록에도 안 나와 **닫을 방법이 없었다**(배지 숫자만 올랐다). 여기서 직접 닫게 한다.
  //
  // ⚠ 이 목록을 셀렉터로 **직접 구독하면 안 된다.** zustand v5 의 `useStore` 는 고른 값을 메모하지
  //   않고 `selector(getState())` 를 그대로 `useSyncExternalStore` 의 스냅샷으로 넘긴다. 그런데
  //   `selectOrphanIDEPanes` 는 호출마다 **새 배열**을 만든다(빈 배열도 새 리터럴이다) — React 는
  //   매 커밋 뒤 스냅샷을 다시 읽어 이전 값과 `Object.is` 로 견주므로 "스토어가 또 바뀌었다"가
  //   영원히 참이 되고, 강제 리렌더가 중첩 갱신 한도를 넘겨 예외가 난다. 전역 에러 경계가 없어
  //   그 예외는 루트를 통째로 내린다 — 메뉴를 여는 순간 화면 전체가 사라졌다.
  //   그래서 구독은 참조가 안정적인 스토어 필드만 하고, 배열은 위 `rows` 와 같이 `useMemo` 로 만든다.
  const nodeMap = useGraphStore((s) => (open ? s.nodeMap : EMPTY_NODE_MAP));
  const orphans = useMemo<IDEOverlayState[]>(
    () => (open ? selectOrphanIDEPanes({ ideOverlays, activeProject, nodeMap }) : EMPTY_PANES),
    [open, ideOverlays, activeProject, nodeMap],
  );

  /**
   * (판올림 번호 발급 대기) 레이아웃 프리셋 — 실행은 스토어 액션 하나가 맡는다.
   * 메뉴는 **닫지 않는다**: 바둑판으로 봤다가 계단식으로 바꾸는 식으로 이어 눌러 보게 된다.
   */
  const applyLayout = useCallback((kind: IDEWindowLayoutKind) => {
    useGraphStore.getState().applyIDEWindowLayout(kind, viewport);
  }, [viewport]);

  /**
   * 목록의 줄을 누른다 — **창이 있으면 그 하나만 남기고 본다**(§5.5 #17-1 판올림 번호 발급 대기).
   *
   * 종전에는 창이 있어도 `openIDEOverlay` 로 **앞으로 올리기만** 했다. 그런데 창을 서넛 띄워
   * 두면 겹쳐 쌓이므로, 목록에서 하나를 눌러도 그 창은 다른 창들 사이에 그대로 묻혀 "눌렀는데
   * 아무 일도 안 일어난" 화면이 된다(사용자 지시 — "여러개가 떠있는 경우 … 다른 창들은
   * 내려놓기 하고 해당 창에 포커싱해 화면도 가운데로"). 이제 다른 창은 **접고**(닫지 않는다 —
   * 되돌릴 수 있어야 한다) 이 창만 펴서 앞에 세우며, 캔버스 카메라도 그 버블로 간다.
   *
   * 창이 아직 없는 줄은 종전대로 **새 창**이다(접을 다른 창이 있어도, 없던 창을 여는 것은
   * "하나만 남기고 본다"와 다른 손짓이라 남의 배치를 건드리지 않는다).
   *
   * (판올림 번호 발급 대기) **그리고 그 색이 가리키는 세션이 창에 서 있어야 한다.** 종전에는 어느
   * 색을 눌러도 창이 **마지막에 보던 세션**으로 열렸다 — 주황 줄을 눌러도 조용한 세션이 떠서, 멈춘
   * 자리를 탭에서 다시 손으로 찾아야 했다(사용자 지시 — "각 색별로 저 버튼을 클릭한 경우 그 세션이
   * 열려 있어야지"). 이제 줄의 색을 낸 `resolveAgentRunSummary` 가 **그 색을 만든 세션 중 가장 최근
   * 것**(`focusSessionId`)까지 함께 돌려주고, 이 클릭이 그것을 창에 세운다. 회색(조용함) 줄은
   * `focusSessionId` 가 `null` 이라 종전 그대로 **마지막에 보던 세션**이 뜬다 — 버블 더블클릭과 같은 답.
   */
  const openWindow = useCallback((
    agentId: string,
    pane: IDEOverlayState | null,
    focusSessionId: string | null,
    rowState: SessionRunState,
  ) => {
    // (판올림 번호 발급 대기) **누른 색의 자국을 먼저 찍는다.** 아래 확인(ack)이 돌면 그 색은
    //   바로 걷히므로, 걷힌 뒤에 찍으면 무슨 색이었는지 알 길이 없다(`focusSessionId` 를 미리
    //   받아 두는 것과 같은 이유). 회색 줄은 남길 것이 없어 액션 쪽에서 조용히 무시한다.
    if (focusSessionId) useGraphStore.getState().markSessionFocusGlow(focusSessionId, rowState);
    // §2.4 (한도 정지) — 줄을 누르는 것은 "이 에이전트를 보러 간다"이므로, 그 버블에 달린 멈춘
    //   세션의 주황불도 이 손짓으로 확인된다(세션 탭을 눌렀을 때와 같은 규율 · §5.5 #17-47).
    //   창을 열면 활성 세션 하나는 `setIDEActiveSession` 이 따로 걷지만, 그 버블의 **나머지**
    //   멈춘 세션은 그 길로 닿지 않는다 — 그래서 여기서 버블 단위로 함께 걷는다.
    //   ⚠ `focusSessionId` 는 이 걷기 **전에** 이미 정해져 있어야 한다(주황 표식을 걷고 나서 다시
    //     고르면 방금 지운 근거로 아무것도 못 찾는다). 그래서 줄을 그릴 때 계산해 인자로 받는다.
    useGraphStore.getState().acknowledgeUsageLimit({ agentIds: [agentId] });
    if (pane) useGraphStore.getState().soloIDEPane(pane.paneKey);
    else useGraphStore.getState().openIDEOverlay(agentId, { pane: 'new' });
    // 세우는 것은 창이 선 **다음**이다 — `openIDEOverlay` 는 새 창이 설 자리(주 창 · 새 팬 · LRU
    //   재사용)를 스스로 고르므로, 그 답을 스토어에서 되읽어야 어느 창에 세울지 알 수 있다.
    //   밖으로 꺼낸 IDE 로 흘러갔거나(독립 창) 프로바이더 설치 창이 대신 뜬 경우에는 앱 안에 창이
    //   서지 않는다 — 그때는 찾을 팬이 없으니 조용히 넘어간다.
    if (focusSessionId) {
      const after = useGraphStore.getState();
      const owner = after.activeProject ?? after.agentProjects[agentId];
      const target = pane
        ? after.ideOverlays[pane.paneKey]
        : Object.values(after.ideOverlays).find((o) => o.agentId === agentId && o.projectId === owner);
      // 그새 사라진 세션에는 세우지 않는다(`openIDEOverlay` 의 `exists` 규율과 같은 감각).
      const live = (after.subAgents[agentId] ?? []).some((s) => s.id === focusSessionId);
      if (live && target?.agentId === agentId && target.activeSessionId !== focusSessionId) {
        after.setIDEActiveSession(focusSessionId, target.paneKey);
      }
    }
    setOpen(false);
  }, []);

  /**
   * §2.4 (한도 정지) — 띠의 [확인]. **목록에 선 멈춘 줄을 한 번에** 확인한다.
   *
   * 한도에 닿으면 여럿이 한꺼번에 멎으므로(그래서 배지가 주황이 된다) 하나씩 열어 눌러야만
   * 걷힌다면 확인 자체가 일이 된다. 메뉴는 **닫지 않는다** — 걷힌 뒤의 목록을 그 자리에서 보게 한다.
   *
   * 걷는 것은 표식뿐이라 세션·대화·결과는 그대로 남는다(지우는 것이 아니라 확인한 것이다).
   */
  const ackAllLimited = useCallback(() => {
    const agentIds = rows.filter((r) => r.run.state === 'limited').map((r) => r.agent.id);
    if (agentIds.length === 0) return;
    useGraphStore.getState().acknowledgeUsageLimit({ agentIds });
  }, [rows]);

  const stateLabel = useCallback((pane: IDEOverlayState): string => {
    if (pane.collapsed) return t('header.ideWindows.state.collapsed');
    if (pane.dockSide) return t(sideLabelKey(pane.dockSide));
    return t('header.ideWindows.state.floating');
  }, [t]);

  // 배지도 에이전트 버블도 열린 창도 없으면 헤더에 자리만 차지한다 — 그때는 아무것도 그리지 않는다.
  if (badgeState === null && agentCount === 0 && openCount === 0) return null;

  return (
    <div className="app-nodrag relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={badgeState ? badgeTitle : t('header.ideWindows.tooltip')}
        aria-label={t('header.ideWindows.label')}
        className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-150 ${
          open ? 'bg-white/[0.12]' : 'hover:bg-white/[0.08]'
        }`}
      >
        {badgeState ? (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${BADGE_DOT[badgeState]}`} />
            <span className="text-[12px] font-medium tabular-nums tracking-tight text-gray-300">
              {badgeRunning}/{badgeSessions}
            </span>
          </>
        ) : (
          <>
            <svg className="h-3.5 w-3.5 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M14 4v16" />
            </svg>
            <span className="text-[12px] tabular-nums text-gray-300">
              {visibleCount}
              {collapsedCount > 0 ? ` +${collapsedCount}` : ''}
            </span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-white/[0.08] bg-gray-900/95 p-1 shadow-2xl backdrop-blur-xl scrollbar-thin">
          <div className="px-2 py-1 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
            {t('header.ideWindows.sectionTitle')}
          </div>
          {/* §2.4 (한도 정지) — 색은 "무슨 일이 있다"까지만 말한다. 몇 개가 멈췄는지는 글자로 적어야
              사용자가 다시 돌릴 것을 셀 수 있다. 아래 목록은 그 줄들을 맨 위로 올려 둔 상태다. */}
          {badgeLimited > 0 && (
            <div className="mb-1 flex items-center gap-1.5 rounded border border-orange-400/30 bg-orange-400/10 px-2 py-1.5 text-[12px] text-orange-200">
              <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <line x1="10" y1="9" x2="10" y2="15" />
                <line x1="14" y1="9" x2="14" y2="15" />
              </svg>
              <span className="min-w-0 flex-1">
                {t('header.ideWindows.limitedBanner', { count: badgeLimited })}
              </span>
              {/* §2.4 (한도 정지) — 주황불을 **끄는 자리**. 색은 "손대야 다시 간다"를 말하는데,
                  그 말을 읽고 나면 불은 제 할 일을 다 한 것이라 여기서 걷힌다(사용자 지시 —
                  "클릭해서 확인하면 다시 평상태로"). 다시 돌릴지는 별개의 손짓이다. */}
              <button
                type="button"
                onClick={ackAllLimited}
                title={t('header.ideWindows.limitedAckHint')}
                className="flex flex-shrink-0 items-center gap-1 rounded border border-orange-400/40 px-1.5 py-0.5 text-[12px] font-medium text-orange-100 transition-colors hover:bg-orange-400/20"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                {t('header.ideWindows.limitedAck')}
              </button>
            </div>
          )}
          {/* (판올림 번호 발급 대기) 레이아웃 — 창이 둘 이상일 때만 뜻이 있다(하나면 정리할 것이 없다). */}
          {visibleCount + collapsedCount > 1 && (
            <div className="mb-1 flex items-center gap-0.5 border-b border-white/[0.06] px-1 pb-1.5">
              {LAYOUT_ITEMS.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => applyLayout(item.kind)}
                  title={t(`header.ideWindows.layout.${item.kind}`)}
                  aria-label={t(`header.ideWindows.layout.${item.kind}`)}
                  className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                    {item.icon}
                  </svg>
                </button>
              ))}
              <span className="flex-1" />
              {/* 접힌 창이 하나라도 있으면 **펴기**가 먼저다 — 안 보이는 창을 되찾는 것이 더 급하다. */}
              <button
                type="button"
                onClick={() => applyLayout(collapsedCount > 0 ? 'expandAll' : 'collapseAll')}
                title={t(collapsedCount > 0 ? 'header.ideWindows.layout.expandAll' : 'header.ideWindows.layout.collapseAll')}
                aria-label={t(collapsedCount > 0 ? 'header.ideWindows.layout.expandAll' : 'header.ideWindows.layout.collapseAll')}
                className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  {collapsedCount > 0 ? <path d="M7 14l5-5 5 5" /> : <path d="M5 12h14" />}
                </svg>
              </button>
            </div>
          )}
          {rows.length === 0 && (
            <div className="px-2 py-2 text-[12px] text-gray-500">{t('header.ideWindows.empty')}</div>
          )}
          {rows.map(({ agent, pane, run, glow }) => (
            <div
              key={agent.id}
              className="group flex items-center gap-1 rounded px-1 transition-colors hover:bg-white/[0.06]"
            >
              <button
                type="button"
                onClick={() => openWindow(agent.id, pane, run.focusSessionId, run.state)}
                // 한도로 끊긴 줄은 **원문 통지**를 그대로 붙인다 — 사용자가 CLI 에서 본 그 글자가
                //   "언제 풀리는가"를 이미 담고 있어, 우리가 다시 쓰면 틀릴 여지만 는다.
                title={`${t(SESSION_STATUS_LABEL_KEY[run.state])}${
                  run.limitMessage ? ` — ${run.limitMessage}` : ''
                } · ${pane ? t('header.ideWindows.soloFocus') : t('header.ideWindows.openNew')}`}
                className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1 text-left"
              >
                {/* 도트는 **실행 상태**다 — 세션 탭·사이드바와 같은 표(`SESSION_STATUS_DOT`)를 쓴다.
                    종전에는 이 자리가 "창이 떠 있는가"를 세션 도트와 같은 파랑으로 그려, 도는 중인데
                    창이 없는 에이전트는 불이 꺼진 것으로 보였다. 창 유무는 오른쪽 상태 낱말
                    (`stateLabel`)과 접기/닫기 손잡이가 이미 말한다. */}
                <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${sessionDotClass(run.state, glow, Date.now())}`} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-gray-200">{agent.label}</span>
                {/* 도는 세션 수 — 배지의 분자를 이 줄로 쪼갠 것이다(합이 배지와 같아야 한다).
                    조용한 줄에는 그리지 않는다(폭도 시선도 도는 줄에 쓴다). */}
                {run.running > 0 && (
                  <span className="flex-shrink-0 text-[12px] font-medium tabular-nums text-blue-300">
                    {run.running}/{run.sessions}
                  </span>
                )}
                {/* §2.4 (한도 정지) — 색은 "무슨 일인지"만 말하고 **몇 개가 언제 풀리는지**는 못
                    말한다. 리셋 표기는 CLI 원문 그대로 붙인다(번역 ❌ — 사용자가 본 그 글자다). */}
                {run.state === 'limited' && (
                  <span className="flex-shrink-0 text-[12px] font-medium text-orange-300">
                    {run.limitLabel
                      ? t('header.ideWindows.limitedUntil', { at: run.limitLabel })
                      : t('header.ideWindows.limited')}
                  </span>
                )}
                {pane && (
                  <span className="flex-shrink-0 text-[12px] text-gray-500">{stateLabel(pane)}</span>
                )}
              </button>

              {/* 설정 — 창이 있든 없든 여기서 연다(캔버스를 거치지 않는 유일한 길). */}
              <button
                type="button"
                onClick={() => setConfigAgentId(agent.id)}
                title={t('header.ideWindows.settings')}
                aria-label={t('header.ideWindows.settings')}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 opacity-0 transition-colors hover:bg-white/[0.08] hover:text-gray-200 group-hover:opacity-100"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 7h-9" />
                  <path d="M14 17H5" />
                  <circle cx="17" cy="17" r="3" />
                  <circle cx="7" cy="7" r="3" />
                </svg>
              </button>

              {pane && (
                <>
                  <button
                    type="button"
                    onClick={() => useGraphStore.getState().setIDEPaneCollapsed(pane.paneKey, !pane.collapsed)}
                    title={pane.collapsed ? t('header.ideWindows.expand') : t('header.ideWindows.collapse')}
                    aria-label={pane.collapsed ? t('header.ideWindows.expand') : t('header.ideWindows.collapse')}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      {pane.collapsed ? <path d="M7 14l5-5 5 5" /> : <path d="M5 12h14" />}
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => useGraphStore.getState().closeIDEOverlay(pane.paneKey)}
                    title={t('header.ideWindows.close')}
                    aria-label={t('header.ideWindows.close')}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          ))}
          {orphans.length > 0 && (
            <div className="mt-1 border-t border-white/[0.06] pt-1">
              {orphans.map((pane) => (
                <div key={pane.paneKey} className="flex items-center gap-1 rounded px-1 hover:bg-white/[0.06]">
                  <span className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1">
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500/70" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-gray-400">
                      {t('header.ideWindows.orphan')}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => useGraphStore.getState().closeIDEOverlay(pane.paneKey)}
                    title={t('header.ideWindows.close')}
                    aria-label={t('header.ideWindows.close')}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* §5.12 (A) 트리거 ② — 지휘통제실 입구가 이 자리로 들어왔다. 부르는 것은 root 버블
              좌더블클릭과 **같은 호출**이라 창 정체성(앱 전체 1창 · focus + show-project)이 그대로다. */}
          {canOpenCommandCenter && (
            <div className="mt-1 border-t border-white/[0.06] pt-1">
              <button
                type="button"
                onClick={() => { onOpenCommandCenter(); setOpen(false); }}
                title={t('header.ideWindows.commandCenterHint')}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
              >
                {/* 통제실 타이틀바와 같은 글리프 — 같은 창을 가리키는 두 자리가 다른 모양이면 안 된다. */}
                <svg className="h-3.5 w-3.5 flex-shrink-0 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
                <span className="min-w-0 flex-1 truncate text-[12px] text-gray-200">{t('commandCenter.title')}</span>
              </button>
            </div>
          )}
          <div className="mt-1 border-t border-white/[0.06] px-2 py-1.5 text-[12px] leading-snug text-gray-500">
            {t('header.ideWindows.hint')}
            {visibleCount > 1 && (
              <span className="mt-1 block text-gray-600">
                {t('header.ideWindows.shortcutHint', {
                  dock: shortcutLabel('Ctrl+Alt+←→↑↓'),
                  max: shortcutLabel('Ctrl+Alt+Enter'),
                  next: shortcutLabel('Ctrl+Alt+W'),
                })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 설정창 — 스스로 body 로 포털하므로 헤더 층에 갇히지 않는다(상세 패널에서 여는 것과 같은 컴포넌트). */}
      {configAgent && (
        <AgentConfigPopup
          agentId={configAgent.id}
          config={agentConfigs[configAgent.id] ?? null}
          currentColor={BUBBLE_COLORS[configAgent.bubbleType]}
          onClose={() => setConfigAgentId(null)}
        />
      )}
    </div>
  );
});

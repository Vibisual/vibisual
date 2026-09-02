import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BubbleData, BashEntry, ServerEntry, AgentEvent, FileEdit, SubAgent, SessionTokenData, TurnTokenUsage, AgentConfig } from '@vibisual/shared';
import { BUBBLE_COLORS, BUBBLE_STYLES, PANEL_DEFAULT_WIDTH, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, MAX_FILE_EDITS, TOKEN_SUBAGENT_FETCH_CONCURRENCY, LOCAL_TOOL_NAMES } from '@vibisual/shared';
import { mapWithConcurrency } from '../../utils/tokenFanout.js';
import { useGraphStore, selectIDEOverlay, selectActiveBrainSummary } from '../../stores/graphStore.js';
import { useIDEDockLayout } from '../IDE/useIDEDockLayout.js';
import { useIsNarrowViewport } from '../../hooks/useIsMobile.js';
import { ScrollFade } from '../ScrollFade.js';
import { BashHistoryList } from './BashHistoryList.js';
import { ServerList } from './ServerList.js';
import { IframeServerCard } from './IframeServerCard.js';
import { IframeServerLogsPopup } from './IframeServerLogsPopup.js';
import { AgentEventList } from './AgentEventList.js';
import { FileEditList } from './FileEditList.js';
import { SubAgentList } from './SubAgentList.js';
import { CommandQueue } from './CommandQueue.js';
import { TokenUsagePopup } from './TokenUsagePopup.js';
import { AgentConfigPopup } from './AgentConfigPopup.js';
import { localProviderOf, localToolVerdictOf } from '../LocalModel/localModelEntry.js';
import { FolderFileTree } from './FolderFileTree.js';
import { WebEntryList } from './WebEntryList.js';
import { RootFileList } from './RootFileList.js';
import { TaskEdgeDetail } from './TaskEdgeDetail.js';
import { CommentBoxDetail } from './CommentBoxDetail.js';
import { CaptureBubbleDetail } from './CaptureBubbleDetail.js';
import { AppBubbleDetail } from './AppBubbleDetail.js';
import { getInternalApp } from '../../apps/registry.js';
import { BrainCardDetail } from './BrainCardDetail.js';
import { CAPTURE_BUBBLE_DEFAULTS } from '@vibisual/shared';
import { AutoAgentPanel } from './AutoAgentPanel.js';
import { GitStatusCard } from './GitStatusCard.js';
import { AgentFeedbackSection } from './AgentFeedbackSection.js';
import { PluginPanelSectionSlot } from '../../plugins/host.js';
import { ContiHistoryDetail } from './ContiHistoryDetail.js';
import { TASK_EDGE_STYLES } from '@vibisual/shared';
import { clampUsagePct, usageBarToneClass } from '../../utils/usageLimits.js';

interface DetailPanelProps {
  onClose: () => void;
}

function getStatusLabel(status: string): { label: string; classes: string } {
  const map: Record<string, { label: string; classes: string }> = {
    idle: { label: 'Idle', classes: 'bg-slate-500/20 text-slate-400' },
    active: { label: 'Active', classes: 'bg-blue-500/20 text-blue-400' },
    completed: { label: 'Completed', classes: 'bg-red-500/20 text-red-400' },
    disappearing: { label: 'Disappearing', classes: 'bg-gray-500/20 text-gray-400' },
  };
  return map[status] ?? map['idle']!;
}

/** §4 v1.50 — 도구 실행 시간(ms)을 사람이 읽기 좋은 형식으로. */
function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s ? ` ${s}s` : ''}`;
}

/** §4 v1.50 — epoch ms 를 "방금 전" / "5m ago" 식으로. */
function formatRelativeTime(ts: number, t: (k: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return t('panel.detailPanel.justNow');
  if (diff < 3_600_000) return t('panel.detailPanel.minutesAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('panel.detailPanel.hoursAgo', { n: Math.floor(diff / 3_600_000) });
  return t('panel.detailPanel.daysAgo', { n: Math.floor(diff / 86_400_000) });
}

/**
 * §4 v1.50 / v3.64 — 한도 사용률 가로 게이지. `used` 단위는 **퍼센트(0~100)** 고정.
 *
 * v3.64 전에는 "0~1 이면 비율" 로 추측해 `used * 100` 을 했는데, 그 추측이 `1`(=1%)을
 * 100% 로 잘못 키웠다(헤더 필·팝업과 동일 사고). 값 `1` 은 추측으로 풀 수 없으므로 규약을
 * 퍼센트로 고정하고 정규화는 shared 헬퍼(`clampUsagePct`)로 단일화했다.
 */
function RateLimitBar({
  label,
  used,
  resetAt,
  t,
}: {
  label: string;
  used: number;
  resetAt: number | undefined;
  t: (k: string, opts?: Record<string, unknown>) => string;
}): React.JSX.Element {
  const pct = clampUsagePct(used);
  const barColor = usageBarToneClass(pct);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-gray-400">{label}</span>
        <span className="font-mono text-gray-300">
          {pct.toFixed(0)}%
          {resetAt ? ` · ${t('panel.detailPanel.resetsIn', { in: formatRelativeTime(2 * Date.now() - resetAt, t) })}` : ''}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-700">
        <div className={`h-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** §9 — 같은 에이전트 버블을 보는 동안 `/api/tokens` 재조회 최소 간격. */
const TOKEN_REFETCH_MIN_MS = 5_000;

export function DetailPanel({
  onClose,
}: DetailPanelProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const nodeMap = useGraphStore((s) => s.nodeMap);
  const agents = useGraphStore((s) => s.agents);
  const bashHistory = useGraphStore((s) => s.bashHistory);
  const runningServers = useGraphStore((s) => s.runningServers);
  const agentEvents = useGraphStore((s) => s.agentEvents);
  const fileEdits = useGraphStore((s) => s.fileEdits);
  const domainEntries = useGraphStore((s) => s.domainEntries);
  const currentFolderIdForRoot = useGraphStore((s) => s.currentFolderId);
  const rawNode = selectedNodeId ? nodeMap[selectedNodeId] : undefined;
  // 폴더 내부에서 현재 폴더 자신이 선택된 경우 → root 타입으로 표시
  const node = rawNode && currentFolderIdForRoot && selectedNodeId === currentFolderIdForRoot
    ? { ...rawNode, bubbleType: 'root' as const }
    : rawNode;
  const subAgents = useGraphStore((s) => s.subAgents);
  const completedCommands = useGraphStore((s) => s.completedCommands);
  const agentConfigs = useGraphStore((s) => s.agentConfigs);
  // §4 v1.50 — 도구 시간/컴팩션/한도 메트릭 (Anthropic SDK 2026-04~05 신규 필드 시각화)
  const recentToolDurations = useGraphStore((s) => s.recentToolDurations);
  const compactCounts = useGraphStore((s) => s.compactCounts);
  const rateLimits = useGraphStore((s) => s.rateLimits);

  // §5.5 #17-1 (v2.18) — IDE 가 우측에 붙어 있으면 DetailPanel 을 왼쪽으로.
  //   판정은 App 의 캔버스 축소와 **같은 산식**(useIDEDockLayout) — 도킹 슬롯만 남고 IDE 가
  //   안 그려지는 상태에서 패널만 좌측으로 넘어가 있으면 우측은 빈 칸인 채 자리만 어긋난다.
  //   (판올림 번호 발급 대기) 창이 여럿이 되면서 **양쪽이 다 막힐 수 있다** — 그때는 종전 자리(우측)를
  //   지키고, 어느 쪽에 서든 그 변의 도크 두께만큼 안쪽으로 물러나 도크 밑에 깔리지 않게 한다.
  const { insets: dockInsets } = useIDEDockLayout();
  const panelOnLeft = dockInsets.right > 0 && dockInsets.left === 0;
  // §4 v3.16 — 폰(좁은 뷰포트)에선 사이드 패널이 캔버스를 짓누르지 않게 하단 바텀시트로 전환한다.
  const isNarrow = useIsNarrowViewport();

  // 세션 토큰 팝업
  // 슬라이드 애니메이션 끝나면 클래스 제거 (transform 잔류 → fixed 팝업 깨짐 방지)
  const [animating, setAnimating] = useState(true);
  // §5.10 — 휴지통 영구 삭제 확인 팝업.
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  useEffect(() => { setPurgeConfirm(false); }, [selectedNodeId]);

  // 좌/우 위치 전환 시 슬라이드 애니메이션 재실행
  useEffect(() => {
    setAnimating(true);
  }, [panelOnLeft]);

  // 리사이즈
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const resizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(PANEL_DEFAULT_WIDTH);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    startX.current = e.clientX;
    startWidth.current = panelWidth;

    const onMove = (ev: MouseEvent): void => {
      if (!resizing.current) return;
      // 우측 패널은 좌로 끌면 +(handle 좌측), 좌측 패널은 우로 끌면 +(handle 우측)
      const delta = panelOnLeft ? ev.clientX - startX.current : startX.current - ev.clientX;
      const next = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, startWidth.current + delta));
      setPanelWidth(next);
    };
    const onUp = (): void => {
      resizing.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panelWidth, panelOnLeft]);

  const [showSessionTokens, setShowSessionTokens] = useState(false);
  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [showIframeLogs, setShowIframeLogs] = useState(false);
  /** 도구 요약 줄을 펼쳐 두었는가. 기본은 접힘(두 줄 고정) — 아래 Row 3 참고. */
  const [toolsExpanded, setToolsExpanded] = useState(false);

  // 노드 전환 시 iframe 로그 팝업 자동 닫기 (구독 해제까지 함께 발생)
  useEffect(() => {
    setShowIframeLogs(false);
    // 도구 줄도 접은 상태로 되돌린다 — 펼쳐 둔 채 다른 버블로 옮기면 그 버블 패널이 대뜸 길다.
    setToolsExpanded(false);
  }, [selectedNodeId]);

  // §4 v3.16 — 4개 패널 블록(노드/태스크엣지/코멘트박스 등)이 공유하는 래퍼 class·style.
  // 좁은 뷰포트(폰): 하단 바텀시트(전폭·80dvh·상단 라운드), 넓은 화면: 기존 사이드 패널(가변폭).
  const panelWrapperClass = isNarrow
    ? `absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t border-gray-800 bg-gray-900 ${animating ? 'animate-slide-in-right' : ''}`
    : `absolute ${panelOnLeft ? 'border-r' : 'border-l'} top-0 bottom-0 z-30 flex flex-col border-gray-800 bg-gray-900 ${animating ? (panelOnLeft ? 'animate-slide-in-left' : 'animate-slide-in-right') : ''}`;
  const panelWrapperStyle: React.CSSProperties = isNarrow
    ? { height: '80dvh' }
    : { width: panelWidth, ...(panelOnLeft ? { left: dockInsets.left } : { right: dockInsets.right }) };

  // billable tokens 가져오기 (자체 세션 비면 서브에이전트 세션 합산)
  const [tokenData, setTokenData] = useState<SessionTokenData | null>(null);
  const lastTokenActivity = useRef<number>(0);
  const agentSubIdsKey = node
    ? (subAgents[node.id] ?? []).filter((s) => s.sessionId).map((s) => s.sessionId).join(',')
    : '';
  const agentSubIds = useMemo(
    () => (agentSubIdsKey ? agentSubIdsKey.split(',') : []),
    [agentSubIdsKey],
  );
  // §9 — 토큰 조회 트레일링 스로틀. `node.activity` 는 도구 이벤트마다 오르는데, 예전엔 그때마다
  //   `/api/tokens` 를 때려 서버가 세션 JSONL 전체를 읽었다(자체 턴이 비면 서브에이전트 세션까지 연쇄).
  //   에이전트가 도는 동안 초당 수 건씩 나가 Electron 메인 스레드가 파일 읽기로 막혔다.
  //   숫자 패널은 실시간성이 이 정도면 충분하므로, 같은 버블을 보는 동안에는 최소 간격을 둔다.
  const tokenFetchAtRef = useRef(0);
  const tokenNodeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!node || node.bubbleType !== 'agent') { setTokenData(null); return; }
    // 다른 버블로 옮기면 즉시 조회(스로틀 창 초기화). `lastTokenActivity` 도 함께 비운다 —
    // 옮겨간 버블의 activity 가 직전 버블의 값과 우연히 같으면 아래 가드에 걸려
    // 새 버블 토큰을 영영 안 불러오기 때문.
    if (tokenNodeRef.current !== node.id) {
      tokenNodeRef.current = node.id;
      tokenFetchAtRef.current = 0;
      lastTokenActivity.current = -1;
    }
    if (node.activity === lastTokenActivity.current) return;
    const sessionId = node.path;
    let cancelled = false;
    const run = async (): Promise<void> => {
      tokenFetchAtRef.current = Date.now();
      try {
        const res = await fetch(`/api/tokens/${sessionId}`);
        if (!res.ok || cancelled) return;
        const primary = await res.json() as SessionTokenData;
        // 자체 세션 비면 서브에이전트 세션 합산
        if (primary.turns.length === 0 && agentSubIds.length > 0) {
          // §3.2.4 ② — 왕복을 겹친다. 결과는 **입력 순서 그대로** 오므로 합산 결과가 순차 때와 같다.
          const subResults = await mapWithConcurrency(
            agentSubIds,
            TOKEN_SUBAGENT_FETCH_CONCURRENCY,
            async (subSid): Promise<SessionTokenData | null> => {
              try {
                const subRes = await fetch(`/api/tokens/${subSid}`);
                if (!subRes.ok || cancelled) return null;
                return await subRes.json() as SessionTokenData;
              } catch { return null; }
            },
          );
          const allTurns: TurnTokenUsage[] = [];
          for (const subData of subResults) {
            if (subData) allTurns.push(...subData.turns);
          }
          if (!cancelled && allTurns.length > 0) {
            allTurns.sort((a, b) => a.timestamp - b.timestamp);
            setTokenData({ sessionId, turns: allTurns, categories: [] });
            lastTokenActivity.current = node.activity;
            return;
          }
        }
        if (!cancelled) {
          setTokenData(primary);
          lastTokenActivity.current = node.activity;
        }
      } catch { /* ignore */ }
    };

    // 최소 간격이 안 찼으면 남은 시간만큼 미뤄서 1회만 쏜다. activity 가 계속 올라 이 이펙트가
    // 재실행되면 아래 cleanup 이 예약을 걷어내고 다시 잡으므로, 폭주해도 창당 요청은 1건이다.
    const wait = Math.max(0, TOKEN_REFETCH_MIN_MS - (Date.now() - tokenFetchAtRef.current));
    if (wait === 0) {
      void run();
      return () => { cancelled = true; };
    }
    const timer = window.setTimeout(() => { void run(); }, wait);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [node?.id, node?.bubbleType, node?.path, node?.activity, agentSubIds.length]);

  const billableTokens = useMemo(() => {
    if (!tokenData) return 0;
    let input = 0, output = 0, cacheRead = 0, cacheCreate = 0;
    for (const t of tokenData.turns) {
      input += t.inputTokens;
      output += t.outputTokens;
      cacheRead += t.cacheReadTokens;
      cacheCreate += t.cacheCreateTokens;
    }
    return input + output + Math.round(cacheRead * 0.1) + cacheCreate;
  }, [tokenData]);

  // 인라인 이름 편집
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = useCallback(() => {
    if (!node || node.bubbleType !== 'agent') return;
    setEditValue(node.label);
    setEditing(true);
  }, [node]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const saveLabel = useCallback(() => {
    const trimmed = editValue.trim();
    if (!trimmed || !node) { setEditing(false); return; }
    if (trimmed !== node.label) {
      fetch(`/api/bubble/${node.id}/label`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: trimmed }),
      }).catch(() => {});
    }
    setEditing(false);
  }, [editValue, node]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveLabel();
    if (e.key === 'Escape') setEditing(false);
  }, [saveLabel]);

  // root 버블: 현재 뷰에 따라 실제 폴더 데이터를 결정
  const currentFolderId = useGraphStore((s) => s.currentFolderId);
  const storeNodeMap = useGraphStore((s) => s.nodeMap);

  const agentConfig = node ? agentConfigs[node.id] ?? null : null;

  /**
   * §5.19 (G) — 이 버블이 **말을 거는 상대**. `provider` 가 있으면 상대는 클로드 CLI 가 아니라
   * 내 PC 의 로컬 엔진이고, 그때 `config.model`·`config.tools` 는 저장만 될 뿐 아무 일도 하지
   * 않는 칸이 된다(러너가 읽는 것은 `provider` 와 고정 도구 목록뿐이다) — 아래 요약 줄들이
   * 진실을 가져올 곳은 여기다.
   */
  const localProvider = localProviderOf(agentConfig);
  const localTokensTotal = (localProvider?.tokensIn ?? 0) + (localProvider?.tokensOut ?? 0);
  const localContextUsed = localProvider?.contextUsed;
  const localContextLimit = localProvider?.contextLimit;
  // 도구 판정 문구·색은 설정 창(§5.19 (H))과 **같은 어휘**를 쓴다 — 두 화면이 다른 낱말로 같은
  //   상태를 말하면 사용자는 둘 다 믿지 않게 된다.
  const localToolVerdict = localToolVerdictOf(localProvider);
  const localToolVerdictTone = localToolVerdict === 'ok'
    ? 'text-emerald-400'
    : localToolVerdict === 'none' ? 'text-amber-400' : 'text-gray-500';
  const localToolVerdictLine = localToolVerdict === 'ok'
    ? t('panel.agentConfig.local.toolsOk', { defaultValue: '이 모델은 도구를 씁니다 — 파일을 읽고 고칠 수 있습니다.' })
    : localToolVerdict === 'none'
      ? t('panel.agentConfig.local.toolsNone', { defaultValue: '이 모델은 도구를 못 씁니다 — 대화만 합니다.' })
      : t('panel.agentConfig.local.toolsUnknown', { defaultValue: '아직 확인 전입니다 — 다음 턴에 도구를 실어 보내 확인합니다.' });

  /**
   * 요약 줄이 그릴 도구 이름들. 로컬 버블은 고정 한 벌, 클로드 버블은 설정에 저장된 목록
   * (없으면 최소 한 벌). 목록과 hover 툴팁이 **같은 배열**을 보게 한 곳에서 만든다.
   */
  const toolNames: readonly string[] = localProvider
    ? LOCAL_TOOL_NAMES
    : (agentConfig?.tools ?? ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob']);

  const isAgent = node?.bubbleType === 'agent';
  const isFile = node?.bubbleType === 'file';
  const isFolder = node?.bubbleType === 'internal_folder' || node?.bubbleType === 'external_folder';
  /** §5.23 — 도메인 버블. 디스크 경로가 없으므로 `hasPath` 대상이 아니다(탐색기 열기 ❌). */
  const isDomain = node?.bubbleType === 'domain';
  const isRoot = node?.bubbleType === 'root';
  const isGhost = node?.bubbleType === 'ghost';
  const isWorktree = node?.bubbleType === 'worktree';
  const hasPath = isFile || isFolder || isRoot || isGhost || isWorktree;

  // §7.6 v1.61 — GitStatusCard 는 "최상단 home" 에만. 합성 override(폴더 자신 선택 시
  // bubbleType:'root' 승격) 이전 원본 rawNode 기준으로 판정: 메인 프로젝트 root 버블 또는
  // worktree 버블을 드릴다운한 home 만 git 노출. 중첩 폴더를 root 로 승격한 home 은 숨김.
  const isTopLevelHome = rawNode?.bubbleType === 'root' || rawNode?.bubbleType === 'worktree';

  // preserve-pin (§2.4 v1.28) — root/back 제외
  const isPinEligible = !!node
    && node.bubbleType !== 'root'
    && node.bubbleType !== 'back';
  const handleTogglePreservePin = useCallback(() => {
    if (!node) return;
    fetch(`/api/bubble/${node.id}/preserve-pin`, { method: 'PATCH' }).catch(() => {});
  }, [node?.id]);
  const currentFolder = currentFolderId ? storeNodeMap[currentFolderId] : undefined;
  const rootEffectivePath = isRoot && currentFolder ? currentFolder.path : (node?.path ?? '');
  const rootEffectiveAbsPath = isRoot && currentFolder ? currentFolder.absolutePath : node?.absolutePath;

  const handleOpenFile = useCallback(() => {
    if (!isFile || !node) return;
    // absolutePath 우선 — 서버가 올바른 프로젝트 인스턴스에서 이미 해석한 경로.
    // nodePath만 보내면 서버가 첫 매치 인스턴스를 고르다 타 프로젝트 파일이 열리는 버그(프로젝트 컨텍스트 소실).
    fetch(`/api/open-node-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodePath: node.path, absolutePath: node.absolutePath ?? null }),
    }).catch(() => {});
  }, [isFile, node?.path, node?.absolutePath]);

  const handleOpenFolder = useCallback(() => {
    if (!hasPath || !node) return;
    const folderNodePath = isRoot ? rootEffectivePath : node.path;
    const folderAbs = isRoot ? (rootEffectiveAbsPath ?? null) : (node.absolutePath ?? null);
    fetch(`/api/open-node-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodePath: folderNodePath, absolutePath: folderAbs }),
    }).catch(() => {});
  }, [hasPath, isRoot, rootEffectivePath, rootEffectiveAbsPath, node?.path, node?.absolutePath]);

  // Task Edge / Comment Box 선택 훅 — 모든 조기 return 전에 호출해야 hooks order가 안정됨
  const selectedTaskEdgeId = useGraphStore((s) => s.selectedTaskEdgeId);
  const taskEdges = useGraphStore((s) => s.taskEdges);
  const selectedCommentBoxId = useGraphStore((s) => s.selectedCommentBoxId);
  const commentBoxes = useGraphStore((s) => s.commentBoxes);
  const selectedCaptureBubbleId = useGraphStore((s) => s.selectedCaptureBubbleId);
  const captureBubbles = useGraphStore((s) => s.captureBubbles);
  // §5.13 (M) v4.68 — 앱 버블도 다른 버블처럼 "선택 → 우측 옵션 패널".
  const selectedAppBubbleId = useGraphStore((s) => s.selectedAppBubbleId);
  const appBubbles = useGraphStore((s) => s.appBubbles);
  // §5.10 — 기억 카드/두뇌/휴지통 선택.
  const selectedBrainCardId = useGraphStore((s) => s.selectedBrainCardId);
  const selectedBrainCard = useGraphStore((s) => s.selectedBrainCard);
  const brainSummary = useGraphStore(selectActiveBrainSummary);
  const openBrainFeed = useGraphStore((s) => s.openBrainFeed);
  const restoreTrashedAgent = useGraphStore((s) => s.restoreTrashedAgent);
  const purgeTrashedAgent = useGraphStore((s) => s.purgeTrashedAgent);
  const agentBrainCardCount = useGraphStore((s) => selectedNodeId ? (selectActiveBrainSummary(s)?.agentCardCounts[selectedNodeId] ?? 0) : 0);

  // v1.37 — STRICT outbound 엣지 타겟 툴 합집합(현재 노드가 소스인 경우). 서버 computeStrictStripSet 과 동일 규칙.
  //         툴 구성은 사용자 책임 — 특수 예외 없음.
  // v1.44 — commandMode 게이트로 변경 (kind='command' + tool-delegation 만 박탈).
  //         undefined 는 legacy 후방호환(strict → 박탈).
  const strictStripSet = useMemo(() => {
    const strip = new Set<string>();
    if (!node || node.bubbleType !== 'agent') return strip;
    for (const edge of Object.values(taskEdges)) {
      if (edge.sourceAgentId !== node.id) continue;
      if ((edge.bundleRole ?? 'primary') !== 'primary') continue;
      if ((edge.kind ?? 'command') !== 'command') continue;
      const stripping = edge.commandMode !== undefined
        ? edge.commandMode === 'tool-delegation'
        : (edge.delegationPolicy ?? 'strict') === 'strict';
      if (!stripping) continue;
      const cfg = agentConfigs[edge.targetAgentId];
      for (const tool of (cfg?.tools ?? [])) strip.add(tool);
    }
    return strip;
  }, [taskEdges, agentConfigs, node]);

  // Comment Box 선택 시 전용 패널 렌더 (v1.45) — 다른 선택과 배타
  if (selectedCommentBoxId) {
    const box = commentBoxes.find((b) => b.id === selectedCommentBoxId);
    if (!box) return null;
    return (
      <aside
        className={panelWrapperClass}
        style={panelWrapperStyle}
        onAnimationEnd={() => setAnimating(false)}
      >
        <div
          className={`absolute ${panelOnLeft ? 'right-0' : 'left-0'} top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40 ${isNarrow ? 'hidden' : ''}`}
          onMouseDown={handleResizeStart}
        />
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div
              className="h-3 w-3 flex-shrink-0 rounded-sm border"
              style={{ borderColor: box.color, backgroundColor: box.color, boxShadow: `0 0 6px ${box.color}` }}
            />
            <span className="truncate text-sm font-bold text-gray-100">
              {t('panel.commentBox.title', 'Comment')}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
            aria-label={t('panel.detailPanel.close')}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <ScrollFade fill className="flex-1">
          <div className="p-4">
            <CommentBoxDetail box={box} />
          </div>
        </ScrollFade>
      </aside>
    );
  }

  // §5.9 v3.36 — 캡처 버블 선택 시 전용 패널 렌더 (다른 선택과 배타). 헤더에 몰려 있던 설정을
  // 다른 버블처럼 "선택 → 우측 디테일창"으로 옮긴다.
  if (selectedCaptureBubbleId) {
    const bubble = captureBubbles.find((b) => b.id === selectedCaptureBubbleId);
    if (!bubble) return null;
    return (
      <aside
        className={panelWrapperClass}
        style={panelWrapperStyle}
        onAnimationEnd={() => setAnimating(false)}
      >
        <div
          className={`absolute ${panelOnLeft ? 'right-0' : 'left-0'} top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40 ${isNarrow ? 'hidden' : ''}`}
          onMouseDown={handleResizeStart}
        />
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div
              className="h-3 w-3 flex-shrink-0 rounded-sm"
              style={{ backgroundColor: CAPTURE_BUBBLE_DEFAULTS.ACCENT_COLOR, boxShadow: `0 0 6px ${CAPTURE_BUBBLE_DEFAULTS.ACCENT_COLOR}` }}
            />
            <span className="truncate text-sm font-bold text-gray-100" title={bubble.sourceName}>
              {bubble.sourceName}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
            aria-label={t('panel.detailPanel.close')}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <ScrollFade fill className="flex-1">
          <div className="p-4">
            <CaptureBubbleDetail bubble={bubble} />
          </div>
        </ScrollFade>
      </aside>
    );
  }

  // §5.13 (M) v4.68 — 앱 버블 선택 시 전용 패널 (다른 선택과 배타). 우클릭 메뉴에만 있던
  // 조작(열기·설치·이름·고정·삭제)을 캡처 버블과 같은 자리에서도 낸다.
  if (selectedAppBubbleId) {
    const bubble = appBubbles.find((b) => b.id === selectedAppBubbleId);
    if (!bubble) return null;
    const appMeta = getInternalApp(bubble.appId);
    const headerName = bubble.title?.trim()
      ? bubble.title
      : appMeta
        ? t(appMeta.nameKey, { defaultValue: appMeta.name })
        : bubble.appId;
    return (
      <aside
        className={panelWrapperClass}
        style={panelWrapperStyle}
        onAnimationEnd={() => setAnimating(false)}
      >
        <div
          className={`absolute ${panelOnLeft ? 'right-0' : 'left-0'} top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40 ${isNarrow ? 'hidden' : ''}`}
          onMouseDown={handleResizeStart}
        />
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div
              className="h-3 w-3 flex-shrink-0 rounded-sm border"
              style={appMeta
                ? { backgroundColor: appMeta.color, borderColor: appMeta.glow }
                : { backgroundColor: '#F59E0B', borderColor: '#FCD34D' }}
            />
            <span className="truncate text-sm font-bold text-gray-100" title={headerName}>
              {headerName}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
            aria-label={t('panel.detailPanel.close')}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <ScrollFade fill className="flex-1">
          <div className="p-4">
            <AppBubbleDetail bubble={bubble} />
          </div>
        </ScrollFade>
      </aside>
    );
  }

  // Task Edge 선택 시 전용 패널 렌더 (노드 선택과 배타)
  if (selectedTaskEdgeId) {
    const edge = taskEdges[selectedTaskEdgeId];
    if (!edge) return null;
    const styleCfg = TASK_EDGE_STYLES[edge.status] ?? TASK_EDGE_STYLES['idle']!;
    return (
      <aside
        className={panelWrapperClass}
        style={panelWrapperStyle}
        onAnimationEnd={() => setAnimating(false)}
      >
        <div
          className={`absolute ${panelOnLeft ? 'right-0' : 'left-0'} top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40 ${isNarrow ? 'hidden' : ''}`}
          onMouseDown={handleResizeStart}
        />
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div
              className="h-3 w-3 flex-shrink-0 rounded-full border"
              style={{ borderColor: styleCfg.color, boxShadow: `0 0 6px ${styleCfg.color}` }}
            />
            <span className="truncate font-mono text-sm text-white">{t('panel.detailPanel.taskEdge')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
            aria-label={t('panel.detailPanel.close')}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <ScrollFade fill className="flex-1">
          <div className="p-4">
            <TaskEdgeDetail edge={edge} />
          </div>
        </ScrollFade>
      </aside>
    );
  }

  // §7.12 v1.47 — 콘티 버블 (id prefix: conti-bubble-) 선택 시 ContiHistoryDetail 노출
  if (selectedNodeId && selectedNodeId.startsWith('conti-bubble-')) {
    const agentId = selectedNodeId.slice('conti-bubble-'.length);
    return (
      <aside
        className={panelWrapperClass}
        style={panelWrapperStyle}
        onAnimationEnd={() => setAnimating(false)}
      >
        <div
          className={`absolute ${panelOnLeft ? 'right-0' : 'left-0'} top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40 ${isNarrow ? 'hidden' : ''}`}
          onMouseDown={handleResizeStart}
        />
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="h-3 w-3 flex-shrink-0 rounded-full bg-emerald-600" />
            <span className="truncate text-sm font-bold text-gray-100">
              {t('panel.detailPanel.contiHistory', { defaultValue: 'Conti History' })}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
            aria-label={t('panel.detailPanel.close')}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <ScrollFade fill className="flex-1">
          <ContiHistoryDetail agentId={agentId} />
        </ScrollFade>
      </aside>
    );
  }

  // §5.10 — 기억 카드 선택 시 전용 패널(다른 선택과 배타).
  if (selectedBrainCardId) {
    return (
      <aside className={panelWrapperClass} style={panelWrapperStyle} onAnimationEnd={() => setAnimating(false)}>
        <div className={`absolute ${panelOnLeft ? 'right-0' : 'left-0'} top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40 ${isNarrow ? 'hidden' : ''}`} onMouseDown={handleResizeStart} />
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* v4.66 — Brain 버블과 같은 인디고(BUBBLE_STYLES.brain). 여기만 푸시아라 같은 것이 두 색이었다. */}
            <div className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: BUBBLE_STYLES.brain.color }} />
            <span className="truncate text-sm font-bold text-gray-100">{t('brain.cardDetailTitle', { defaultValue: '기억 카드' })}</span>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white" aria-label={t('panel.detailPanel.close')}>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <ScrollFade fill className="flex-1">
          {selectedBrainCard ? (
            <BrainCardDetail card={selectedBrainCard} />
          ) : (
            <div className="p-4 text-sm text-gray-500">{t('brain.loading', { defaultValue: '불러오는 중…' })}</div>
          )}
        </ScrollFade>
      </aside>
    );
  }

  // §5.10 — Brain 상주 버블 선택 시 두뇌 요약 패널.
  if (selectedNodeId === '__brain__') {
    return (
      <aside className={panelWrapperClass} style={panelWrapperStyle} onAnimationEnd={() => setAnimating(false)}>
        <div className={`absolute ${panelOnLeft ? 'right-0' : 'left-0'} top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40 ${isNarrow ? 'hidden' : ''}`} onMouseDown={handleResizeStart} />
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: '#6366F1' }} />
            <span className="truncate text-sm font-bold text-gray-100">{t('brain.bubbleLabel', { defaultValue: '메모리' })}</span>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white" aria-label={t('panel.detailPanel.close')}>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <ScrollFade fill className="flex-1">
          <div className="space-y-4 p-4">
            {/* §5.10 v3.82 — 버블 배지와 같은 축으로 4칸. v3.81 이후 "저장 장수"와 "현재 진실"은
                다른 수이고, 사람이 손대야 하는 것은 검토 대기라서 그 둘을 윗줄에 둔다. */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-indigo-500/25 bg-indigo-500/10 p-3">
                <div className="text-2xl font-bold tabular-nums text-indigo-300">{brainSummary?.currentCount ?? 0}</div>
                <div className="text-xs text-gray-400" title={t('brain.summaryCurrentTip', { defaultValue: '검증돼 AI 에게 전달되는 지식' })}>
                  {t('brain.summaryCurrent', { defaultValue: '현재 진실' })}
                </div>
              </div>
              <div className={`rounded border p-3 ${(brainSummary?.reviewCount ?? 0) > 0 ? 'border-amber-500/30 bg-amber-500/10' : 'border-gray-800 bg-gray-800/40'}`}>
                <div className={`text-2xl font-bold tabular-nums ${(brainSummary?.reviewCount ?? 0) > 0 ? 'text-amber-300' : 'text-gray-500'}`}>
                  {brainSummary?.reviewCount ?? 0}
                </div>
                <div className="text-xs text-gray-400" title={t('brain.summaryReviewTip', { defaultValue: '확인해야 AI 에게 전달되는 후보' })}>
                  {t('brain.summaryReview', { defaultValue: '검토 대기' })}
                </div>
              </div>
              <div className="rounded border border-gray-800 bg-gray-800/40 p-3">
                <div className="text-lg font-bold tabular-nums text-gray-200">{brainSummary?.cardCount ?? 0}</div>
                <div className="text-xs text-gray-500">{t('brain.summaryCards', { defaultValue: '기억 카드' })}</div>
              </div>
              <div className="rounded border border-gray-800 bg-gray-800/40 p-3">
                <div className="text-lg font-bold tabular-nums text-gray-200">{brainSummary?.unseenCount ?? 0}</div>
                <div className="text-xs text-gray-500">{t('brain.summaryUnseen', { defaultValue: '미확인' })}</div>
              </div>
            </div>
            {brainSummary?.recentCardTitle && (
              <div className="rounded border border-gray-800 bg-gray-800/40 p-3">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('brain.summaryRecent', { defaultValue: '최근 저장' })}</div>
                <div className="truncate text-sm text-gray-200" title={brainSummary.recentCardTitle}>{brainSummary.recentCardTitle}</div>
              </div>
            )}
            {/* §5.10 v3.82 — 구 라벨 "내부 열기"는 버블 산개(v3.49 이전) 시절 표현이라, 실제로 열리는
                기억 라이브러리(v3.75~v3.77 창)를 가리키게 고쳤다. */}
            <button
              type="button"
              onClick={() => openBrainFeed({ scope: 'project' })}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
              </svg>
              {t('brain.openLibrary', { defaultValue: '기억 라이브러리 열기' })}
            </button>
          </div>
        </ScrollFade>
      </aside>
    );
  }

  // §5.10 — 휴지통 내부의 버려진 커스텀 에이전트 선택 시 전용 패널.
  if (node?.trashed) {
    return (
      <aside className={panelWrapperClass} style={panelWrapperStyle} onAnimationEnd={() => setAnimating(false)}>
        <div className={`absolute ${panelOnLeft ? 'right-0' : 'left-0'} top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40 ${isNarrow ? 'hidden' : ''}`} onMouseDown={handleResizeStart} />
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: '#57534E' }} />
            <span className="truncate text-sm font-bold text-gray-100" title={node.label}>{node.label}</span>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white" aria-label={t('panel.detailPanel.close')}>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <ScrollFade fill className="flex-1">
          <div className="space-y-4 p-4">
            <div className="rounded border border-gray-800 bg-gray-800/40 p-3 text-xs text-gray-400">
              <div>{t('brain.trashedAt', { defaultValue: '휴지통 이동' })}: {node.trashedAt ? new Date(node.trashedAt).toLocaleString('en-US', { hour12: false }) : '—'}</div>
              <div>{t('brain.trashedMemories', { defaultValue: '개별 기억' })}: {agentBrainCardCount}{t('brain.cardCountUnit', { defaultValue: '장' })}</div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void restoreTrashedAgent(node.id)}
                className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                {t('brain.restore', { defaultValue: '복구' })}
              </button>
              {purgeConfirm ? (
                <div className="rounded border border-red-800 bg-red-950/40 p-3 text-sm">
                  <div className="mb-2 text-red-300">
                    {t('brain.purgeConfirm', { defaultValue: '개별 기억 {{n}}장 포함 전부 삭제됩니다.', n: agentBrainCardCount })}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void purgeTrashedAgent(node.id)} className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500">
                      {t('brain.purgeYes', { defaultValue: '영구 삭제' })}
                    </button>
                    <button type="button" onClick={() => setPurgeConfirm(false)} className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-200 hover:bg-gray-600">
                      {t('brain.cancel', { defaultValue: '취소' })}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPurgeConfirm(true)}
                  className="w-full rounded bg-red-900/40 px-3 py-2 text-sm text-red-300 hover:bg-red-900/60"
                >
                  {t('brain.purge', { defaultValue: '영구 삭제' })}
                </button>
              )}
            </div>
          </div>
        </ScrollFade>
      </aside>
    );
  }

  if (!node) return null;

  const statusInfo = getStatusLabel(node.status);
  const color = BUBBLE_COLORS[node.bubbleType];

  return (
    <aside
      className={panelWrapperClass}
      style={panelWrapperStyle}
      onAnimationEnd={() => setAnimating(false)}
    >
      {/* Resize handle */}
      <div
        className={`absolute ${panelOnLeft ? 'right-0' : 'left-0'} top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40 ${isNarrow ? 'hidden' : ''}`}
        onMouseDown={handleResizeStart}
      />
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className="h-3 w-3 flex-shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          {editing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={handleKeyDown}
              className="min-w-0 flex-1 rounded border border-blue-500 bg-gray-800 px-1.5 py-0.5 text-sm font-bold text-gray-100 outline-none"
            />
          ) : (
            <h2
              className={`truncate text-sm font-bold text-gray-100 ${isAgent ? 'cursor-pointer hover:text-blue-400' : ''} ${isFile ? 'cursor-pointer hover:text-violet-400' : ''} ${isFolder || isRoot ? 'cursor-pointer hover:text-amber-400' : ''}`}
              onClick={isAgent ? startEdit : isFile ? handleOpenFile : (isFolder || isRoot) ? handleOpenFolder : undefined}
              title={isAgent ? t('panel.detailPanel.clickToRename') : isFile ? t('panel.detailPanel.clickToOpenFile') : (isFolder || isRoot) ? t('panel.detailPanel.clickToOpenFolder') : undefined}
            >
              {isRoot && currentFolder ? currentFolder.label : node.label}
            </h2>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {isPinEligible && (
            <button
              type="button"
              onClick={handleTogglePreservePin}
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                node.preservePinned
                  ? 'text-amber-400 hover:bg-amber-500/20'
                  : 'text-gray-500 hover:bg-gray-800 hover:text-amber-400'
              }`}
              aria-label={node.preservePinned ? t('panel.detailPanel.pin.pinned') : t('panel.detailPanel.pin.unpinned')}
              title={node.preservePinned ? t('panel.detailPanel.pin.pinnedTitle') : t('panel.detailPanel.pin.unpinnedTitle')}
              aria-pressed={node.preservePinned ? true : false}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill={node.preservePinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17v5" />
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            aria-label={t('panel.detailPanel.closePanel')}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <ScrollFade fill className="flex-1">
        <div className="flex flex-col gap-4 p-4">
          {/* §5.3 #10-2 v2.37 — Auto Agent 메타 버블 전용 패널 */}
          {node.bubbleType === 'auto' && <AutoAgentPanel node={node} />}

          {/* Path */}
          {hasPath && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-gray-500">{t('panel.detailPanel.path')}</span>
              <p
                className="cursor-pointer truncate rounded bg-gray-800/50 px-2 py-1 font-mono text-xs text-gray-300 hover:text-violet-400"
                onClick={handleOpenFolder}
                title={t('panel.detailPanel.clickToOpenFolder')}
              >
                {isRoot ? (rootEffectiveAbsPath ?? rootEffectivePath) : (node.absolutePath ?? node.path)}
              </p>
            </div>
          )}

          {/* Agent info: compact row layout */}
          {isAgent ? (
            <>
              {/* Session ID */}
              <div className="flex flex-col gap-0.5 -mt-2">
                <span className="text-[12px] text-gray-500">{t('panel.detailPanel.sessionId')}</span>
                <p className="truncate font-mono text-[12px] text-gray-400" title={node.path}>
                  {node.path}
                </p>
              </div>

              {/* Row 1: Type / Status / Activity */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">{t('panel.detailPanel.type')}</span>
                  <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${color}20`, color }}>{t('panel.detailPanel.agentBadge')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">{t('panel.detailPanel.status')}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.classes}`}>{statusInfo.label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">{t('panel.detailPanel.activity')}</span>
                  <span className="text-xs font-medium text-gray-300">{node.activity}</span>
                </div>
              </div>

              {/* Row 2: 토큰 / 컨텍스트.
                  §5.19 (G) — 로컬 버블은 **청구가 0**이고 대화 창도 클로드 세션이 아니라 엔진이
                  왕복마다 돌려준 수치다. 같은 자리에 클로드 어휘("청구 토큰" · M 단위 창)를 그대로
                  두면 이 줄 전체가 거짓말이 되므로, 로컬이면 로컬이 실제로 아는 값만 그린다. */}
              <div className="flex items-center gap-3">
                {!localProvider && billableTokens > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowSessionTokens(true)}
                    className="flex items-center gap-1.5 rounded bg-gray-800/40 px-2 py-1 transition-colors hover:bg-gray-800/80"
                  >
                    <span className="text-xs text-gray-500">{t('panel.detailPanel.billableTokens')}</span>
                    <span className="font-mono text-xs font-semibold text-amber-400">{billableTokens.toLocaleString()}</span>
                  </button>
                )}
                {/* §5.19 (D) — 로컬 누적 토큰(입+출). 청구액이 아니라 **양과 속도의 감각**이라
                    누를 팝업(턴별 청구 내역)도 없다 — 없는 원장을 여는 버튼은 고장으로 읽힌다. */}
                {localProvider && localTokensTotal > 0 && (
                  <div className="flex items-center gap-1.5 rounded bg-gray-800/40 px-2 py-1">
                    <span className="text-xs text-gray-500">{t('panel.cost.colTokens')}</span>
                    <span className="font-mono text-xs font-semibold text-amber-400">
                      {(localProvider.tokensIn ?? 0).toLocaleString()}+{(localProvider.tokensOut ?? 0).toLocaleString()}
                    </span>
                  </div>
                )}
                {!localProvider && (node.contextUsed !== undefined || node.contextMax !== undefined) && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">{t('panel.detailPanel.context')}</span>
                    <span className="font-mono text-xs text-cyan-400">
                      {node.contextUsed !== undefined ? `${(node.contextUsed / 1000).toFixed(0)}k` : '?'}
                      /{node.contextMax !== undefined ? `${(node.contextMax / 1_000_000).toFixed(0)}M` : '?'}
                    </span>
                  </div>
                )}
                {/* 로컬 창은 16K~262K 급이라 클로드의 M 단위 표기로는 전부 `0M` 이 된다. IDE 상태바
                    게이지와 **같은 K 표기**를 써 두 화면이 같은 숫자를 말하게 한다. */}
                {localProvider && localContextUsed !== undefined && localContextLimit !== undefined && localContextLimit > 0 && (
                  <div
                    className="flex items-center gap-1.5"
                    title={t('ide.overlay.localContextUsed', {
                      defaultValue: '대화 창 {{used}} / {{limit}} 토큰 ({{percent}}%) — 넘치면 오래된 말부터 덜어 냅니다',
                      used: localContextUsed,
                      limit: localContextLimit,
                      percent: Math.round(Math.min(1, localContextUsed / localContextLimit) * 100),
                    })}
                  >
                    <span className="text-xs text-gray-500">{t('panel.detailPanel.context')}</span>
                    <span className="font-mono text-xs text-cyan-400">
                      {Math.round(localContextUsed / 100) / 10}K/{Math.round(localContextLimit / 1024)}K
                    </span>
                  </div>
                )}
              </div>

              {/* Row 3: Model / Tools / Permission Mode (read-only).
                  §5.19 (G) — 로컬 버블에서 `config.model`·`config.tools` 는 **저장만 되고 아무 일도
                  하지 않는 칸**이다(러너는 `provider` 와 고정 `LOCAL_TOOL_DEFS` 만 읽는다). 그대로
                  그리면 로컬 버블이 `opus` 로 클로드 도구 한 벌을 쓰는 것처럼 보인다 — 설정 창을
                  이미 프로바이더에 맞췄으니 그 요약인 이 줄도 같은 진실을 말해야 한다.
                  권한 모드는 **로컬 턴도 실제로 읽으므로** 갈리지 않는다(양쪽 공통). */}
              <div className="flex flex-col gap-1.5 rounded border border-gray-700/50 bg-gray-800/30 p-2">
                <div className="flex items-center gap-2">
                  <span className="w-12 flex-shrink-0 text-xs text-gray-500">{t('panel.detailPanel.model')}</span>
                  {localProvider ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="flex-shrink-0 rounded bg-slate-500/15 px-1.5 py-0.5 text-[12px] font-semibold text-slate-300">
                        {t('ide.overlay.localLabel', { defaultValue: 'All Model' })}
                      </span>
                      <span className={`truncate text-xs font-medium ${localProvider.modelId ? 'text-gray-300' : 'text-gray-500'}`}>
                        {localProvider.modelName || localProvider.modelId
                          || t('panel.agentConfig.local.noModel', { defaultValue: '아직 모델을 고르지 않았습니다' })}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-gray-300">
                      {agentConfig?.model ?? (node.modelName ? node.modelName.replace('claude-', '').replace(/-\d+$/, '') : 'sonnet')}
                    </span>
                  )}
                </div>
                {/* 도구는 이제 45종이 기본이다. 알약을 다 펼치면 이 한 칸이 열 줄을 먹어 요약이
                    요약이 아니게 된다 — **두 줄로 못 박고 나머지는 `…`(CSS 말줄임)로 접는다.**
                    개수로 자르지 않는 이유는 패널 폭이 240~720px 로 변하기 때문이다. 줄 수로 접어야
                    어느 폭에서도 높이가 일정하다. 전체는 ① hover 툴팁 ② 눌러서 펼치기 ③ 설정 창,
                    셋으로 닿는다. */}
                <div className="flex items-start gap-2">
                  <span className="w-12 flex-shrink-0 pt-px text-xs text-gray-500">{t('panel.detailPanel.tools')}</span>
                  <div
                    className={`min-w-0 flex-1 cursor-pointer break-words text-[12px] leading-relaxed ${toolsExpanded ? '' : 'line-clamp-2'}`}
                    title={toolNames.join(', ')}
                    onClick={() => setToolsExpanded((v) => !v)}
                  >
                    {toolNames.map((tool, i) => {
                      // 로컬은 고르는 목록이 아니라 **언제나 이 한 벌**이 간다 — 파랑(=허용된 도구)
                      //   대신 읽기 전용 회색이고, 엣지 도구 박탈(strictStripSet)도 걸리지 않는다.
                      const cls = localProvider
                        ? 'text-gray-300'
                        : strictStripSet.has(tool) ? 'text-gray-500 line-through' : 'text-blue-400';
                      return (
                        <span key={tool}>
                          {i > 0 && <span className="text-gray-600">, </span>}
                          <span className={cls}>{tool}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
                {/* §5.19 (H) — 목록이 간다고 쓰는 것은 아니다. 이 모델이 실제로 도구를 부르는지는
                    물어봐야 알고, 그 판정 한 줄이 없으면 사용자는 못 쓰는 도구를 쓴다고 읽는다.
                    되돌리는 손잡이([다시 확인])는 설정 창에 있다 — 같은 버튼을 두 곳에 두지 않는다. */}
                {localProvider && (
                  <p className={`pl-14 text-[12px] leading-snug ${localToolVerdictTone}`}>{localToolVerdictLine}</p>
                )}
                <div className="flex items-center gap-2">
                  <span className="w-12 flex-shrink-0 text-xs text-gray-500">{t('panel.detailPanel.perm')}</span>
                  <span className="text-xs font-medium text-gray-300">{agentConfig?.permissionMode ?? 'default'}</span>
                </div>
              </div>

              {/* Agent Settings button — 훅으로 등록된 에이전트(customCreated=false)는 Claude Code 본체 소유라
                  Vibisual에서 설정을 바꿀 수 없으므로 비활성화. */}
              <button
                type="button"
                onClick={() => setShowConfigPopup(true)}
                disabled={!node.customCreated}
                title={!node.customCreated ? t('panel.detailPanel.hookAgentSettingsLocked') : undefined}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-gray-700 bg-gray-800/50 px-3 py-1.5 text-xs text-gray-400 transition-colors enabled:hover:border-blue-500/50 enabled:hover:bg-gray-800 enabled:hover:text-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Agent Settings
              </button>
            </>
          ) : (
            <>
              {/* Non-agent: Type */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{t('panel.detailPanel.type')}</span>
                <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: `${color}20`, color }}>
                  {node.bubbleType.replace('_', ' ')}
                </span>
              </div>

              {/* Non-agent: Status */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{t('panel.detailPanel.status')}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusInfo.classes}`}>
                  {statusInfo.label}
                </span>
              </div>
            </>
          )}

          {/* Ghost 정보 */}
          {isGhost && node.ghostInfo && (
            <div className="flex flex-col gap-2 rounded border border-gray-700/50 bg-gray-800/40 p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{t('panel.detailPanel.change')}</span>
                <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-medium text-red-400">
                  {node.ghostInfo.changeType === 'deleted' ? t('panel.detailPanel.deleted') : t('panel.detailPanel.renamed')}
                </span>
              </div>
              {node.ghostInfo.changeType === 'renamed' && node.ghostInfo.toPath && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-500">{t('panel.detailPanel.newPath')}</span>
                  <p className="truncate font-mono text-xs text-emerald-400">
                    {node.ghostInfo.toPath}
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-gray-500">{t('panel.detailPanel.originalPath')}</span>
                <p className="truncate font-mono text-xs text-gray-400">
                  {node.ghostInfo.fromPath}
                </p>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-gray-500">{t('panel.detailPanel.originalType')}</span>
                <span className="text-xs text-gray-400">
                  {node.ghostInfo.originalBubbleType.replace('_', ' ')}
                </span>
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={node.ghostInfo?.pinned ?? false}
                  onChange={() => {
                    fetch(`/api/bubble/${node.id}/disappear-pause`, {
                      method: 'PATCH',
                    }).catch(() => {});
                  }}
                  className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 accent-amber-500"
                />
                <span className="text-xs text-gray-400">{t('panel.detailPanel.persist')}</span>
              </label>
            </div>
          )}

          {/* Activity + Last tool (non-agent only). Root 버블은 Activity 대신 §7.6 GitStatusCard 로 대체.
              단 "최상단 home"(메인 root / worktree 드릴다운) 만 — 중첩 폴더 합성 root home 은 git 숨김(v1.61). */}
          {isRoot && isTopLevelHome && <GitStatusCard projectName={node.label} />}
          {/* §4 v1.50 — Root 한도 게이지 (5h / 7d) */}
          {isRoot && rateLimits && (
            <div className="flex flex-col gap-1.5 rounded-md border border-gray-700 bg-gray-800/40 px-2.5 py-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] uppercase tracking-wide text-gray-500">
                  {t('panel.detailPanel.rateLimits')}
                </span>
                <span className="text-[12px] text-gray-600">
                  {formatRelativeTime(rateLimits.updatedAt, t)}
                </span>
              </div>
              {typeof rateLimits.used5h === 'number' && (
                <RateLimitBar
                  label={t('panel.detailPanel.window5h')}
                  used={rateLimits.used5h}
                  resetAt={rateLimits.resetAt5h}
                  t={t}
                />
              )}
              {typeof rateLimits.used7d === 'number' && (
                <RateLimitBar
                  label={t('panel.detailPanel.window7d')}
                  used={rateLimits.used7d}
                  resetAt={rateLimits.resetAt7d}
                  t={t}
                />
              )}
            </div>
          )}
          {!isAgent && !isRoot && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{t('panel.detailPanel.activity')}</span>
                <span className="text-xs font-medium text-gray-300">{t('panel.detailPanel.activityEvents', { n: node.activity })}</span>
              </div>
              {node.lastTool && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{t('panel.detailPanel.lastTool')}</span>
                  <span className="text-xs font-medium text-gray-300">{node.lastTool}</span>
                </div>
              )}
            </>
          )}

          {/* Child count (folders) */}
          {node.childCount !== undefined && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{t('panel.detailPanel.files')}</span>
              <span className="text-xs font-medium text-gray-300">
                {node.childCount}
              </span>
            </div>
          )}

          {/* Connected Agents (비-에이전트 노드용) — 클릭 시 해당 에이전트로 공간 점프 */}
          {node.bubbleType !== 'agent' && node.activeAgentIds && node.activeAgentIds.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">{t('panel.detailPanel.activeAgents')}</span>
              {/* 이 파일·폴더를 건드린 에이전트 수만큼 늘어난다 — 바쁜 폴더에서는 칩이 예닐곱 줄이
                  되어 아래 내용을 밀어낸다. 세 줄까지만 보이고 그 뒤는 스크롤(집 표준). */}
              <ScrollFade maxHeight={76}><div className="flex flex-wrap gap-1">
                {node.activeAgentIds.map((agentId) => {
                  const agent = agents.find((a) => a.id === agentId);
                  return (
                    <button
                      key={agentId}
                      type="button"
                      onClick={() => {
                        const store = useGraphStore.getState();
                        // 에이전트는 메인 뷰 소속 — 폴더 내부였다면 먼저 메인으로 복귀
                        if (store.currentFolderId) store.goToMain();
                        store.selectNode(agentId);
                        store.focusOnNode(agentId);
                      }}
                      className="cursor-pointer rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/40 hover:text-blue-300"
                      title={t('panel.detailPanel.goToAgent')}
                    >
                      {agent?.label ?? agentId}
                    </button>
                  );
                })}
              </div></ScrollFade>
            </div>
          )}

          {/* §4 v1.50 — 에이전트: 최근 도구 실행 시간 + 컨텍스트 컴팩션 카운트 */}
          {node.bubbleType === 'agent' && (() => {
            const sessionId = node.path;
            const durations = recentToolDurations[sessionId] ?? [];
            const compact = compactCounts[sessionId];
            if (durations.length === 0 && !compact) return null;
            return (
              <div className="flex flex-col gap-1.5 rounded-md border border-gray-700 bg-gray-800/40 px-2.5 py-2">
                {durations.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] uppercase tracking-wide text-gray-500">
                      {t('panel.detailPanel.lastTools')}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {durations.map((d) => (
                        <span
                          key={`${d.ts}-${d.tool}`}
                          className="max-w-full break-all rounded bg-gray-700/60 px-1.5 py-0.5 text-[12px] font-mono text-gray-300"
                          title={new Date(d.ts).toLocaleTimeString()}
                        >
                          {d.tool} {formatDurationMs(d.durationMs)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {compact && (
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] uppercase tracking-wide text-gray-500">
                      {t('panel.detailPanel.contextCompacted')}
                    </span>
                    <span className="text-xs font-medium text-gray-300">
                      {t('panel.detailPanel.compactSummary', { count: compact.count, ago: formatRelativeTime(compact.lastAt, t) })}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* §4 v3.21 — 에이전트: 좋아요/싫어요 집계 + "규칙으로 승격" (피드백 없으면 미렌더) */}
          {node.bubbleType === 'agent' && <AgentFeedbackSection agentId={node.id} />}

          {/* §5.11 v3.88 — 플러그인 패널 섹션 슬롯. 활성 기여가 없으면 호스트가 null → DOM 없음. */}
          <PluginPanelSectionSlot
            bubbleId={node.id}
            bubbleType={node.bubbleType}
            label={node.label}
            customCreated={node.customCreated ?? false}
            agentConfig={agentConfig ?? undefined}
          />

          {/* Agent: SubAgent 목록 */}
          {node.bubbleType === 'agent' && (subAgents[node.id] ?? []).length > 0 && (
            <SubAgentList subAgents={subAgents[node.id] ?? []} />
          )}

          {/* Agent: 명령 대기열 (라이브 모드만).
              §5.5 #17-29 — 훅 버블은 읽기 전용이라 대기열은 보이되 [추가] 손잡이는 없다. */}
          {node.bubbleType === 'agent' && (
            <CommandQueue agentId={node.id} readOnly={!node.customCreated} />
          )}

          {/* Agent: 결과 목록 */}
          {node.bubbleType === 'agent' && (
            <AgentEventList
              events={agentEvents[node.id] ?? []}
              subAgents={subAgents[node.id] ?? []}
              completedCommands={completedCommands[node.id] ?? []}
              sessionId={node.path}
            />
          )}

          {/* Bash: server list + command history */}
          {node.bubbleType === 'bash' && (
            <>
              <ServerList servers={runningServers[node.id] ?? []} />
              <BashHistoryList entries={bashHistory[node.id] ?? []} />
            </>
          )}

          {/* Iframe: server controls (SCENARIO §7.11 v1.29) */}
          {node.bubbleType === 'iframe' && (
            <>
              <IframeServerCard node={node} runningServers={runningServers} />
              {/* §7.11 v1.44 — 서버 로그 뷰어 (패널엔 버튼만, 실시간 데이터는 팝업에서만 구독) */}
              <IframeServerLogsButton node={node} onOpen={() => setShowIframeLogs(true)} />
            </>
          )}

          {/* Root: 1단계 플랫 리스트 (독립 버블 토글) */}
          {isRoot && (
            <RootFileList
              folderPath={rootEffectivePath}
              projectName={node.label}
              folderAbsPath={rootEffectiveAbsPath ?? undefined}
              parentNodeId={currentFolderId ?? undefined}
            />
          )}

          {/* Folder: 파일 트리 (위성 토글) */}
          {isFolder && !isRoot && (
            <FolderFileTree
              folderPath={node.path}
              folderAbsPath={node.absolutePath ?? undefined}
              nodeId={node.id}
              maxSatellites={node.maxSatellites}
            />
          )}

          {/* §7.22 — 도메인 버블: 웹 이력(체크 = 제거) */}
          {isDomain && (
            <WebEntryList
              nodeId={node.id}
              entries={domainEntries[node.id] ?? []}
              maxWebEntries={node.maxWebEntries}
            />
          )}

          {/* File edits history */}
          {node.bubbleType === 'file' && (
            <div className="flex flex-col gap-1.5">
              <label
                className="flex cursor-pointer select-none items-center gap-1.5 text-[12px] text-gray-400"
                title={t('panel.fileEdit.limitHint')}
              >
                <input
                  type="checkbox"
                  className="h-3 w-3 accent-violet-500"
                  checked={!node.unlimitedFileEdits}
                  onChange={(e) => {
                    const unlimited = !e.target.checked;
                    fetch('/api/file-edits/unlimited', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ nodePath: node.path, unlimited }),
                    }).catch(() => {});
                  }}
                />
                {t('panel.fileEdit.limitLabel', { count: MAX_FILE_EDITS })}
              </label>
              <FileEditList edits={fileEdits[node.id] ?? []} />
            </div>
          )}
        </div>
      </ScrollFade>

      {/* 세션 토큰 종합 팝업 — 자체 세션 없으면 첫 서브에이전트 세션으로 대체 */}
      {showSessionTokens && isAgent && (
        <TokenUsagePopup
          sessionId={node.path}
          subSessionIds={agentSubIds}
          mode="session"
          onClose={() => setShowSessionTokens(false)}
        />
      )}

      {/* 에이전트 설정 팝업 */}
      {showConfigPopup && isAgent && (
        <AgentConfigPopup
          agentId={node.id}
          config={agentConfig}
          currentColor={color}
          onClose={() => setShowConfigPopup(false)}
        />
      )}

      {/* §7.11 v1.44 / v2.5 — Iframe 서버 로그 팝업. 스트림 식별자 (shellId, port). */}
      {showIframeLogs && node.bubbleType === 'iframe' && (() => {
        const port = extractPortFromUrl(node.url);
        if (port == null) return null;
        return (
          <IframeServerLogsPopup
            port={port}
            shellId={node.shellId}
            url={node.url}
            onClose={() => setShowIframeLogs(false)}
          />
        );
      })()}
    </aside>
  );
}

function extractPortFromUrl(url?: string): number | null {
  if (!url) return null;
  const m = url.match(/:(\d+)(?:\/|$)/);
  return m?.[1] ? parseInt(m[1], 10) : null;
}

interface IframeServerLogsButtonProps {
  node: BubbleData;
  onOpen: () => void;
}

/** §7.11 v1.44 — 패널 내 "서버 로그 보기" 버튼. 평상시 데이터 구독 ❌ — 버튼 + 설명만. */
function IframeServerLogsButton({ node, onOpen }: IframeServerLogsButtonProps): React.JSX.Element {
  const { t } = useTranslation();
  const port = extractPortFromUrl(node.url);
  const disabled = port == null;
  return (
    <div className="flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-800/30 p-2.5">
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        className="flex items-center justify-center gap-1.5 rounded border border-sky-700/60 bg-sky-900/40 px-2 py-1.5 text-xs font-medium text-sky-200 transition-colors hover:bg-sky-800/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M4 6h16M4 10h16M4 14h10M4 18h10" />
        </svg>
        {t('panel.iframeServerLog.openButton')}
      </button>
      <p className="text-[12px] leading-snug text-gray-500">
        {disabled
          ? t('panel.iframeServerLog.noPort')
          : t('panel.iframeServerLog.buttonHint')}
      </p>
    </div>
  );
}


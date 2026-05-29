import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BubbleData, BashEntry, ServerEntry, AgentEvent, FileEdit, SubAgent, SessionTokenData, TurnTokenUsage, AgentConfig } from '@vibisual/shared';
import { BUBBLE_COLORS, PANEL_DEFAULT_WIDTH, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, MAX_FILE_EDITS } from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
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
import { FolderFileTree } from './FolderFileTree.js';
import { RootFileList } from './RootFileList.js';
import { TaskEdgeDetail } from './TaskEdgeDetail.js';
import { CommentBoxDetail } from './CommentBoxDetail.js';
import { AutoAgentPanel } from './AutoAgentPanel.js';
import { GitStatusCard } from './GitStatusCard.js';
import { ContiHistoryDetail } from './ContiHistoryDetail.js';
import { TASK_EDGE_STYLES } from '@vibisual/shared';

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

/** §4 v1.50 — 한도 사용률 가로 게이지. used 가 0~1 또는 0~100 둘 다 허용. */
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
  const pct = used > 1 ? Math.min(100, used) : Math.min(100, used * 100);
  const danger = pct >= 90;
  const warn = !danger && pct >= 70;
  const barColor = danger ? 'bg-red-500' : warn ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-[10px]">
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

  // §5.5 #17-1 (v2.18) — IDE 가 우측 도킹된 상태면 DetailPanel 을 왼쪽으로.
  // selectIDEOverlay 는 activeProject 의 슬롯만 반환하므로 자동으로 현재 탭의 IDE 만 반영.
  const ideDockedRight = useGraphStore((s) => selectIDEOverlay(s).dockedRight);
  const panelOnLeft = ideDockedRight;

  // 세션 토큰 팝업
  // 슬라이드 애니메이션 끝나면 클래스 제거 (transform 잔류 → fixed 팝업 깨짐 방지)
  const [animating, setAnimating] = useState(true);

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

  // 노드 전환 시 iframe 로그 팝업 자동 닫기 (구독 해제까지 함께 발생)
  useEffect(() => {
    setShowIframeLogs(false);
  }, [selectedNodeId]);

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
  useEffect(() => {
    if (!node || node.bubbleType !== 'agent') { setTokenData(null); return; }
    if (node.activity === lastTokenActivity.current) return;
    const sessionId = node.path;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tokens/${sessionId}`);
        if (!res.ok || cancelled) return;
        const primary = await res.json() as SessionTokenData;
        // 자체 세션 비면 서브에이전트 세션 합산
        if (primary.turns.length === 0 && agentSubIds.length > 0) {
          const allTurns: TurnTokenUsage[] = [];
          for (const subSid of agentSubIds) {
            try {
              const subRes = await fetch(`/api/tokens/${subSid}`);
              if (!subRes.ok || cancelled) continue;
              const subData = await subRes.json() as SessionTokenData;
              allTurns.push(...subData.turns);
            } catch { /* skip */ }
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
    })();
    return () => { cancelled = true; };
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

  const isAgent = node?.bubbleType === 'agent';
  const isFile = node?.bubbleType === 'file';
  const isFolder = node?.bubbleType === 'internal_folder' || node?.bubbleType === 'external_folder';
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
        className={`absolute ${panelOnLeft ? 'left-0 border-r' : 'right-0 border-l'} top-0 bottom-0 z-30 flex flex-col border-gray-800 bg-gray-900 ${animating ? (panelOnLeft ? 'animate-slide-in-left' : 'animate-slide-in-right') : ''}`}
        style={{ width: panelWidth }}
        onAnimationEnd={() => setAnimating(false)}
      >
        <div
          className={`absolute ${panelOnLeft ? 'right-0' : 'left-0'} top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40`}
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

  // Task Edge 선택 시 전용 패널 렌더 (노드 선택과 배타)
  if (selectedTaskEdgeId) {
    const edge = taskEdges[selectedTaskEdgeId];
    if (!edge) return null;
    const styleCfg = TASK_EDGE_STYLES[edge.status] ?? TASK_EDGE_STYLES['idle']!;
    return (
      <aside
        className={`absolute ${panelOnLeft ? 'left-0 border-r' : 'right-0 border-l'} top-0 bottom-0 z-30 flex flex-col border-gray-800 bg-gray-900 ${animating ? (panelOnLeft ? 'animate-slide-in-left' : 'animate-slide-in-right') : ''}`}
        style={{ width: panelWidth }}
        onAnimationEnd={() => setAnimating(false)}
      >
        <div
          className={`absolute ${panelOnLeft ? 'right-0' : 'left-0'} top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40`}
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
        className={`absolute ${panelOnLeft ? 'left-0 border-r' : 'right-0 border-l'} top-0 bottom-0 z-30 flex flex-col border-gray-800 bg-gray-900 ${animating ? (panelOnLeft ? 'animate-slide-in-left' : 'animate-slide-in-right') : ''}`}
        style={{ width: panelWidth }}
        onAnimationEnd={() => setAnimating(false)}
      >
        <div
          className={`absolute ${panelOnLeft ? 'right-0' : 'left-0'} top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40`}
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

  if (!node) return null;

  const statusInfo = getStatusLabel(node.status);
  const color = BUBBLE_COLORS[node.bubbleType];

  return (
    <aside
      className={`absolute ${panelOnLeft ? 'left-0 border-r' : 'right-0 border-l'} top-0 bottom-0 z-30 flex flex-col border-gray-800 bg-gray-900 ${animating ? (panelOnLeft ? 'animate-slide-in-left' : 'animate-slide-in-right') : ''}`}
      style={{ width: panelWidth }}
      onAnimationEnd={() => setAnimating(false)}
    >
      {/* Resize handle */}
      <div
        className={`absolute ${panelOnLeft ? 'right-0' : 'left-0'} top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-500/40`}
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
                <span className="text-[10px] text-gray-500">{t('panel.detailPanel.sessionId')}</span>
                <p className="truncate font-mono text-[10px] text-gray-400" title={node.path}>
                  {node.path}
                </p>
              </div>

              {/* Row 1: Type / Status / Activity */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">{t('panel.detailPanel.type')}</span>
                  <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${color}20`, color }}>Agent</span>
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

              {/* Row 2: Billable Tokens / Context */}
              <div className="flex items-center gap-3">
                {billableTokens > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowSessionTokens(true)}
                    className="flex items-center gap-1.5 rounded bg-gray-800/40 px-2 py-1 transition-colors hover:bg-gray-800/80"
                  >
                    <span className="text-xs text-gray-500">{t('panel.detailPanel.billableTokens')}</span>
                    <span className="font-mono text-xs font-semibold text-amber-400">{billableTokens.toLocaleString()}</span>
                  </button>
                )}
                {(node.contextUsed !== undefined || node.contextMax !== undefined) && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">{t('panel.detailPanel.context')}</span>
                    <span className="font-mono text-xs text-cyan-400">
                      {node.contextUsed !== undefined ? `${(node.contextUsed / 1000).toFixed(0)}k` : '?'}
                      /{node.contextMax !== undefined ? `${(node.contextMax / 1_000_000).toFixed(0)}M` : '?'}
                    </span>
                  </div>
                )}
              </div>

              {/* Row 3: Model / Tools / Permission Mode (read-only) */}
              <div className="flex flex-col gap-1.5 rounded border border-gray-700/50 bg-gray-800/30 p-2">
                <div className="flex items-center gap-2">
                  <span className="w-12 text-xs text-gray-500">{t('panel.detailPanel.model')}</span>
                  <span className="text-xs font-medium text-gray-300">
                    {agentConfig?.model ?? (node.modelName ? node.modelName.replace('claude-', '').replace(/-\d+$/, '') : 'sonnet')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-12 flex-shrink-0 text-xs text-gray-500">{t('panel.detailPanel.tools')}</span>
                  <div className="flex flex-wrap gap-1">
                    {(agentConfig?.tools ?? ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob']).map((tool) => {
                      const stripped = strictStripSet.has(tool);
                      const cls = stripped
                        ? 'rounded bg-gray-700/30 px-1.5 py-0.5 text-[10px] text-gray-500 line-through'
                        : 'rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400';
                      return <span key={tool} className={cls}>{tool}</span>;
                    })}
                  </div>
                </div>
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
                <span className="text-xs text-gray-500">Type</span>
                <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: `${color}20`, color }}>
                  {node.bubbleType.replace('_', ' ')}
                </span>
              </div>

              {/* Non-agent: Status */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Status</span>
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
                <span className="text-xs text-gray-500">Change</span>
                <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-medium text-red-400">
                  {node.ghostInfo.changeType === 'deleted' ? 'Deleted' : 'Renamed'}
                </span>
              </div>
              {node.ghostInfo.changeType === 'renamed' && node.ghostInfo.toPath && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-500">New path</span>
                  <p className="truncate font-mono text-xs text-emerald-400">
                    {node.ghostInfo.toPath}
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-gray-500">Original path</span>
                <p className="truncate font-mono text-xs text-gray-400">
                  {node.ghostInfo.fromPath}
                </p>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-gray-500">Original type</span>
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
                <span className="text-xs text-gray-400">Persist (prevent fade out)</span>
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
                <span className="text-[10px] uppercase tracking-wide text-gray-500">
                  {t('panel.detailPanel.rateLimits')}
                </span>
                <span className="text-[9px] text-gray-600">
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
                <span className="text-xs text-gray-500">Activity</span>
                <span className="text-xs font-medium text-gray-300">{node.activity} events</span>
              </div>
              {node.lastTool && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Last tool</span>
                  <span className="text-xs font-medium text-gray-300">{node.lastTool}</span>
                </div>
              )}
            </>
          )}

          {/* Child count (folders) */}
          {node.childCount !== undefined && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Files</span>
              <span className="text-xs font-medium text-gray-300">
                {node.childCount}
              </span>
            </div>
          )}

          {/* Connected Agents (비-에이전트 노드용) — 클릭 시 해당 에이전트로 공간 점프 */}
          {node.bubbleType !== 'agent' && node.activeAgentIds && node.activeAgentIds.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Active Agents</span>
              <div className="flex flex-wrap gap-1">
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
                      title="Go to this agent"
                    >
                      {agent?.label ?? agentId}
                    </button>
                  );
                })}
              </div>
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
                    <span className="text-[10px] uppercase tracking-wide text-gray-500">
                      {t('panel.detailPanel.lastTools')}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {durations.map((d) => (
                        <span
                          key={`${d.ts}-${d.tool}`}
                          className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[10px] font-mono text-gray-300"
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
                    <span className="text-[10px] uppercase tracking-wide text-gray-500">
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

          {/* Agent: SubAgent 목록 */}
          {node.bubbleType === 'agent' && (subAgents[node.id] ?? []).length > 0 && (
            <SubAgentList subAgents={subAgents[node.id] ?? []} />
          )}

          {/* Agent: 명령 대기열 (라이브 모드만) */}
          {node.bubbleType === 'agent' && (
            <CommandQueue agentId={node.id} />
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
              parentNodeId={currentFolderId ?? undefined}
            />
          )}

          {/* Folder: 파일 트리 (위성 토글) */}
          {isFolder && !isRoot && (
            <FolderFileTree
              folderPath={node.path}
              nodeId={node.id}
              maxSatellites={node.maxSatellites}
            />
          )}

          {/* File edits history */}
          {node.bubbleType === 'file' && (
            <div className="flex flex-col gap-1.5">
              <label
                className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-gray-400"
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
      <p className="text-[10px] leading-snug text-gray-500">
        {disabled
          ? t('panel.iframeServerLog.noPort')
          : t('panel.iframeServerLog.buttonHint')}
      </p>
    </div>
  );
}


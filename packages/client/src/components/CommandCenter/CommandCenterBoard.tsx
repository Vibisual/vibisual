import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { sessionStopUrl } from '../../hooks/useSessionStop.js';
import { CommandCenterCard } from './CommandCenterCard.js';
import { CommandCenterDetail, type CommandCenterDetailHandle } from './CommandCenterDetail.js';
import {
  AUTO_TIDY_MINUTES,
  COMMAND_CENTER_LANES,
  COMMAND_CENTER_SORTS,
  activeLaneOf,
  buildCommandCenterItems,
  filterCommandCenterItems,
  flattenLanes,
  groupByLane,
  isAutoTidyTarget,
  isEmptyQuery,
  laneCounts,
  parseCommandCenterQuery,
  sortCommandCenterItems,
  stabilizeLanes,
  toggleLaneToken,
  type CommandCenterItem,
  type CommandCenterLane,
  type CommandCenterSort,
  type LaneMemory,
} from './commandCenterModel.js';
import {
  DEFAULT_COMMAND_CENTER_SETTINGS,
  type CommandCenterSettings,
  type CommandCenterView,
} from './commandCenterSettings.js';

// SCENARIO.md §5.12 (B)(C)(E)(H) — 레인 보드 + 검색 + 정리. 데이터는 전부 graph_snapshot 파생이다.
//
// v4.44 (H) 화면 구성 v2:
//   · 분류 막대 — 레인 개수 알약. 누르면 (C) 의 같은 질의 토큰을 검색 문자열에 넣고 뺀다
//     (알약 전용 상태를 따로 두지 않는다 — 두면 검색창과 어긋난다).
//   · board(칸반 열) / list(세로 구역) 두 보기. 창이 좁으면 코드가 list 로 접는다.
//   · 카드를 고르면 오른쪽 상세 패널이 근거 원문을 펼친다.
//   · 키보드 이동 — ↑↓/jk · Enter 점프 · c 명령창 · / 검색 · Esc.
//
// v4.47 (I) 우선순위 기준 고정: 기본 정렬이 `priority` 라 **작업이 도는 동안 순서가 변하지 않는다**.
// 여기서는 그 위에 두 가지를 얹는다 — 레인 정착(`stabilizeLanes`, 창이 기억한다)과 순서 번호 표시.

/** 상대 시간·대기 긴급도가 굳지 않게 하는 최소 주기. 정착이 풀리는 것도 이 틱이 보장한다. */
const TICK_MS = 15_000;

/** 이보다 좁으면 칸반 열이 다 안 들어와 list 로 접는다(§5.12 (H)). */
const BOARD_MIN_WIDTH = 1100;
/** 이보다 좁으면 상세 패널이 카드를 짓눌러 감춘다. */
const DETAIL_MIN_WIDTH = 900;

const LANE_ACCENT: Record<CommandCenterLane, string> = {
  'needs-answer': 'text-rose-300',
  'needs-review': 'text-violet-300',
  'needs-action': 'text-amber-300',
  working: 'text-sky-300',
  done: 'text-gray-400',
};

const LANE_PILL_ON: Record<CommandCenterLane, string> = {
  'needs-answer': 'border-rose-400/50 bg-rose-500/15 text-rose-100',
  'needs-review': 'border-violet-400/50 bg-violet-500/15 text-violet-100',
  'needs-action': 'border-amber-400/50 bg-amber-500/15 text-amber-100',
  working: 'border-sky-400/50 bg-sky-500/15 text-sky-100',
  done: 'border-white/25 bg-white/[0.08] text-gray-100',
};

const LANE_DOT: Record<CommandCenterLane, string> = {
  'needs-answer': 'bg-rose-400',
  'needs-review': 'bg-violet-400',
  'needs-action': 'bg-amber-400',
  working: 'bg-sky-400',
  done: 'bg-gray-500',
};

export interface CommandCenterBoardProps {
  projectId: string;
  /**
   * 설정은 **shell 이 소유**한다 — 프로젝트 고정(pinnedProject)은 타이틀바가, 보기·정리는 여기가
   * 건드리는데 둘이 각자 localStorage 를 읽어 쓰면 나중에 저장한 쪽이 상대 변경을 덮는다.
   */
  settings: CommandCenterSettings;
  onUpdate: (patch: Partial<CommandCenterSettings>) => void;
}

export function CommandCenterBoard({ projectId, settings, onUpdate: update }: CommandCenterBoardProps): React.JSX.Element {
  const { t } = useTranslation();
  const [rawQuery, setRawQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [tidyOpen, setTidyOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1400 : window.innerWidth));
  const searchRef = useRef<HTMLInputElement | null>(null);
  const detailRef = useRef<CommandCenterDetailHandle | null>(null);
  /** §5.12 (I) 레인 정착 기억 — 창이 열려 있는 동안만 산다(서버·체크포인트 무관). */
  const laneMemoryRef = useRef<LaneMemory>(new Map());

  const agents = useGraphStore((s) => s.agents);
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const agentConfigs = useGraphStore((s) => s.agentConfigs);
  const subAgents = useGraphStore((s) => s.subAgents);
  const queuedCommands = useGraphStore((s) => s.queuedCommands);
  // §5.12 (B) v4.55 — 카드가 아직 스트림 맨 끝인지(살아 있는지) 재는 데만 쓴다(대기 개수 ❌).
  const completedCommands = useGraphStore((s) => s.completedCommands);
  const runningSubagentTasks = useGraphStore((s) => s.runningSubagentTasks);
  const agentQuestions = useGraphStore((s) => s.agentQuestions);
  const agentReviews = useGraphStore((s) => s.agentReviews);
  const agentReports = useGraphStore((s) => s.agentReports);
  const pendingPermissions = useGraphStore((s) => s.pendingPermissions);
  const acknowledgedSubAgents = useGraphStore((s) => s.acknowledgedSubAgents);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const allItems = useMemo(
    () =>
      // §5.12 (I) — 판정 직후 레인 정착을 입힌다. 알약 개수·검색·정렬이 전부 이 목록을 보므로
      // 여기서 한 번만 걸어야 "카드는 ④에 있는데 알약은 ⑤로 세는" 어긋남이 생기지 않는다.
      stabilizeLanes(
        buildCommandCenterItems({
          projectId,
          agents,
          agentProjects,
          agentConfigs,
          subAgents,
          queuedCommands,
          completedCommands,
          runningSubagentTasks,
          agentQuestions,
          agentReviews,
          agentReports,
          pendingPermissions,
          acknowledgedSubAgents,
        }),
        laneMemoryRef.current,
        Date.now(),
      ),
    // `now` 는 값으로 쓰지 않지만 의존에 둔다 — 스냅샷이 더 안 와도 15초 틱이 붙잡아 둔 카드를 풀어 준다.
    [
      projectId, agents, agentProjects, agentConfigs, subAgents, queuedCommands, completedCommands,
      runningSubagentTasks, agentQuestions, agentReviews, agentReports,
      pendingPermissions, acknowledgedSubAgents, now,
    ],
  );

  const query = useMemo(() => parseCommandCenterQuery(rawQuery), [rawQuery]);
  const searching = !isEmptyQuery(query);
  const activeLane = useMemo(() => activeLaneOf(query), [query]);
  const counts = useMemo(() => laneCounts(allItems), [allItems]);

  const visible = useMemo(
    () => sortCommandCenterItems(filterCommandCenterItems(allItems, query), settings.sort),
    [allItems, query, settings.sort],
  );

  // 자동 정리 — **표시 접기 전용**(§5.12 (G)). 검색 중에는 숨기지 않는다(찾으러 온 것이므로).
  const { board, archived } = useMemo(() => {
    if (!settings.autoTidy || searching) return { board: visible, archived: [] as CommandCenterItem[] };
    const keep: CommandCenterItem[] = [];
    const away: CommandCenterItem[] = [];
    for (const item of visible) {
      if (isAutoTidyTarget(item, now, settings.autoTidyMinutes)) away.push(item);
      else keep.push(item);
    }
    return { board: keep, archived: away };
  }, [visible, settings.autoTidy, settings.autoTidyMinutes, searching, now]);

  const lanes = useMemo(() => groupByLane(board), [board]);
  const ordered = useMemo(() => flattenLanes(lanes), [lanes]);
  // §5.12 (I) — 카드에 붙는 순서 번호. 키보드 이동(ordered)과 **같은 목록**이라 눈과 손이 어긋나지 않는다.
  const rankByKey = useMemo(() => {
    const map = new Map<string, number>();
    ordered.forEach((item, idx) => map.set(item.key, idx + 1));
    return map;
  }, [ordered]);
  const attentionCount = counts['needs-answer'] + counts['needs-review'] + counts['needs-action'];

  // 좁은 창에서는 코드가 보기를 접는다 — 사용자가 고른 설정은 건드리지 않고 표시만 바꾼다.
  const effectiveView: CommandCenterView = width < BOARD_MIN_WIDTH ? 'list' : settings.view;
  const showDetail = settings.detailPane && width >= DETAIL_MIN_WIDTH;

  const selected = useMemo(
    () => ordered.find((i) => i.key === selectedKey) ?? null,
    [ordered, selectedKey],
  );

  // §5.12 (H) v4.56 — 상세 패널은 **고른 카드가 있을 때만** 열린다.
  // 닫히는 동안에도 마지막으로 보던 항목을 그대로 그려야 미끄러져 나가는 중에 내용이 사라지지 않는다.
  const lastDetailRef = useRef<CommandCenterItem | null>(null);
  if (selected) lastDetailRef.current = selected;
  const detailItem = selected ?? lastDetailRef.current;
  const detailOpen = selected !== null;

  /** 카드·조작 요소가 아닌 **빈 곳**을 누르면 선택을 놓는다(= 상세 패널이 접힌다). */
  const handleBoardBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
    if (!selectedKey) return;
    const el = e.target as HTMLElement | null;
    // 레인 접기 버튼·보관 토글 같은 조작 요소 위는 "빈 곳"이 아니다 — 눌렀다고 선택이 풀리면 안 된다.
    if (el?.closest('[data-command-card], button, a, input, textarea, select, label')) return;
    setSelectedKey(null);
  }, [selectedKey]);

  // 고른 카드가 목록에서 사라졌으면(정리·검색·세션 종료) 선택을 놓는다.
  useEffect(() => {
    if (selectedKey && !ordered.some((i) => i.key === selectedKey)) setSelectedKey(null);
  }, [ordered, selectedKey]);

  const moveSelection = useCallback((delta: number): void => {
    if (ordered.length === 0) return;
    const idx = selectedKey ? ordered.findIndex((i) => i.key === selectedKey) : -1;
    const nextIdx = idx < 0
      ? (delta > 0 ? 0 : ordered.length - 1)
      : Math.min(ordered.length - 1, Math.max(0, idx + delta));
    const next = ordered[nextIdx];
    if (!next) return;
    setSelectedKey(next.key);
    // 보이는 위치로 끌어온다 — 목록이 길면 선택만 옮겨선 어디 있는지 알 수 없다.
    window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-command-card="${CSS.escape(next.key)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }, [ordered, selectedKey]);

  const jumpTo = useCallback((item: CommandCenterItem): void => {
    void window.api?.command?.revealInMain({
      projectId,
      agentId: item.agentId,
      subAgentId: item.subAgentId,
    });
  }, [projectId]);

  const setLaneFilter = useCallback((lane: CommandCenterLane | null): void => {
    setRawQuery((prev) => toggleLaneToken(prev, lane));
  }, []);

  // ── 키보드(§5.12 (H)) ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if ((e.key === 'f' || e.key === 'F') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key === 'Escape') {
        if (document.activeElement === searchRef.current) {
          e.preventDefault();
          setRawQuery('');
          return;
        }
        if (!typing && selectedKey) {
          e.preventDefault();
          setSelectedKey(null);
          return;
        }
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); moveSelection(1); return; }
      if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); moveSelection(-1); return; }
      if (e.key === 'Enter') {
        const item = ordered.find((i) => i.key === selectedKey);
        if (item) { e.preventDefault(); jumpTo(item); }
        return;
      }
      if (e.key === 'c') {
        e.preventDefault();
        if (!selectedKey && ordered[0]) setSelectedKey(ordered[0].key);
        window.requestAnimationFrame(() => detailRef.current?.focusComposer());
        return;
      }
      // 1~5 = 레인 알약, 0 = 전체(§5.12 (H) 분류 막대의 키보드 짝).
      if (e.key >= '1' && e.key <= '5') {
        const lane = COMMAND_CENTER_LANES[Number(e.key) - 1];
        if (lane) { e.preventDefault(); setLaneFilter(lane); }
        return;
      }
      if (e.key === '0') { e.preventDefault(); setLaneFilter(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moveSelection, ordered, selectedKey, jumpTo, setLaneFilter]);

  const toggleLane = useCallback((lane: CommandCenterLane): void => {
    update({
      collapsedLanes: settings.collapsedLanes.includes(lane)
        ? settings.collapsedLanes.filter((l) => l !== lane)
        : [...settings.collapsedLanes, lane],
    });
  }, [settings.collapsedLanes, update]);

  // ── 일괄 정리(§5.12 (E)) — 전부 기존 엔드포인트 ──────────────────────────
  const handleBulkCloseDone = useCallback((): void => {
    const byAgent = new Map<string, string[]>();
    for (const item of allItems) {
      if (item.lane !== 'done' || !item.subAgentId || item.unacknowledged) continue;
      const list = byAgent.get(item.agentId) ?? [];
      list.push(item.subAgentId);
      byAgent.set(item.agentId, list);
    }
    const total = [...byAgent.values()].reduce((n, l) => n + l.length, 0);
    if (total === 0) return;
    if (!window.confirm(t('commandCenter.confirmCloseDone', { count: total }))) return;
    const store = useGraphStore.getState();
    for (const [agentId, ids] of byAgent) {
      for (const id of ids) store.optimisticRemoveSubAgent(agentId, id);
      void fetch(`/api/subagents/${agentId}/remove-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }).catch(() => {});
    }
  }, [allItems, t]);

  const handleStopAll = useCallback((): void => {
    const agentIds = [...new Set(allItems.filter((i) => i.lane === 'working').map((i) => i.agentId))];
    if (agentIds.length === 0) return;
    if (!window.confirm(t('commandCenter.confirmStopAll', { count: agentIds.length }))) return;
    for (const agentId of agentIds) {
      // 에이전트 단위 일괄 중지 — 경로는 카드 하나 중지와 같은 곳(`sessionStopUrl`)에서 낸다.
      void fetch(sessionStopUrl(agentId, null), { method: 'POST' }).catch(() => {});
    }
  }, [allItems, t]);

  const renderCard = useCallback(
    (item: CommandCenterItem): React.JSX.Element => (
      <CommandCenterCard
        key={item.key}
        item={item}
        projectId={projectId}
        now={now}
        rank={rankByKey.get(item.key)}
        selected={item.key === selectedKey}
        onSelect={(i) => setSelectedKey(i.key)}
        inlineComposer={!showDetail}
      />
    ),
    [projectId, now, selectedKey, showDetail, rankByKey],
  );

  const emptyBoard = board.length === 0 && archived.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-950">
      {/* ── 도구 막대 ─────────────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/[0.07] px-4 py-2.5">
        <div className="relative min-w-0 flex-1">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={searchRef}
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder={t('commandCenter.searchPlaceholder')}
            className="w-full rounded-md border border-white/10 bg-black/40 py-1.5 pl-8 pr-8 text-[12.5px] text-gray-100 outline-none placeholder:text-gray-600 focus:border-sky-500/50"
          />
          {rawQuery && (
            <button
              type="button"
              onClick={() => setRawQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-500 hover:text-gray-200"
              title={t('commandCenter.clearSearch')}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>

        <SortPicker value={settings.sort} onChange={(sort) => update({ sort })} />

        {width >= BOARD_MIN_WIDTH && (
          <ViewToggle value={settings.view} onChange={(view) => update({ view })} />
        )}

        {width >= DETAIL_MIN_WIDTH && (
          <IconToggle
            on={settings.detailPane}
            onClick={() => update({ detailPane: !settings.detailPane })}
            title={t('commandCenter.detailToggle')}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M14 4v16" />
            </svg>
          </IconToggle>
        )}

        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setTidyOpen((v) => !v)}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11.5px] transition-colors ${
              settings.autoTidy
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-white/10 bg-black/40 text-gray-400 hover:text-gray-100'
            }`}
            title={t('commandCenter.tidyHint')}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M6 12h12M9 18h6" />
            </svg>
            {t('commandCenter.tidy')}
          </button>
          {tidyOpen && (
            <TidyPanel
              settings={settings}
              onUpdate={update}
              onClose={() => setTidyOpen(false)}
              onBulkCloseDone={handleBulkCloseDone}
              onStopAll={handleStopAll}
            />
          )}
        </div>
      </div>

      {/* ── 분류 막대(§5.12 (H)) ──────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-white/[0.07] px-4 py-2">
        <TriagePill
          label={t('commandCenter.all')}
          count={allItems.length}
          active={activeLane === null && !searching}
          onClick={() => setLaneFilter(null)}
          shortcut="0"
        />
        <span className="mx-0.5 h-4 w-px bg-white/10" />
        {COMMAND_CENTER_LANES.map((lane, idx) => (
          <TriagePill
            key={lane}
            label={t(`commandCenter.lane.${lane}`)}
            count={counts[lane]}
            active={activeLane === lane}
            lane={lane}
            onClick={() => setLaneFilter(lane)}
            shortcut={String(idx + 1)}
          />
        ))}

        <span className="ml-auto flex items-center gap-3 text-[10.5px] text-gray-500">
          {searching && (
            <span className="tabular-nums">{t('commandCenter.resultCount', { count: visible.length })}</span>
          )}
          {attentionCount > 0 && (
            <span className="tabular-nums text-rose-300">{t('commandCenter.attentionCount', { count: attentionCount })}</span>
          )}
          {archived.length > 0 && (
            <button type="button" onClick={() => setArchiveOpen((v) => !v)} className="tabular-nums underline-offset-2 hover:underline">
              {t('commandCenter.archivedCount', { count: archived.length })}
            </button>
          )}
        </span>
      </div>

      {/* ── 본문 ──────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1" onClick={handleBoardBackdropClick}>
          {allItems.length === 0 ? (
            <EmptyState title={t('commandCenter.emptyTitle')} body={t('commandCenter.emptyBody')} />
          ) : emptyBoard ? (
            <EmptyState title={t('commandCenter.noMatchTitle')} body={t('commandCenter.noMatchBody')} />
          ) : effectiveView === 'board' ? (
            <BoardColumns
              lanes={lanes}
              archived={archived}
              archiveOpen={archiveOpen}
              onToggleArchive={() => setArchiveOpen((v) => !v)}
              renderCard={renderCard}
              groupByAgent={settings.groupByAgent}
            />
          ) : (
            <StackedLanes
              lanes={lanes}
              collapsedLanes={settings.collapsedLanes}
              onToggleLane={toggleLane}
              archived={archived}
              archiveOpen={archiveOpen}
              onToggleArchive={() => setArchiveOpen((v) => !v)}
              renderCard={renderCard}
              groupByAgent={settings.groupByAgent}
            />
          )}
        </div>

        {showDetail && (
          // 바깥 상자는 **자리(폭)** 만 0↔360 으로 여닫고, 안쪽은 제 폭을 지킨 채 오른쪽으로 미끄러진다.
          // 폭만 줄이면 글자가 짓눌리며 접히는 게 그대로 보인다 — 둘을 겹쳐야 "스르륵 들어가는" 모양이 된다.
          <div
            className={`flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
              detailOpen ? 'w-[360px]' : 'w-0'
            }`}
            aria-hidden={!detailOpen}
          >
            <div
              className={`h-full w-[360px] transition-transform duration-200 ease-out ${
                detailOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full'
              }`}
            >
              {detailItem && (
                <CommandCenterDetail
                  ref={detailRef}
                  item={detailItem}
                  projectId={projectId}
                  now={now}
                  onClose={() => setSelectedKey(null)}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 단축키 안내 줄 ────────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center gap-3 border-t border-white/[0.07] px-4 py-1.5 text-[10px] text-gray-600">
        <span className="tabular-nums">{t('commandCenter.sessionCount', { count: allItems.length })}</span>
        {/* §5.12 (I) — 지금 무슨 기준으로 줄 세웠는지 항상 보이게. 순서가 왜 이런지 묻지 않아도 되게 한다. */}
        <span className="min-w-0 truncate">{t(`commandCenter.sortRule.${settings.sort}`)}</span>
        <span className="ml-auto flex-shrink-0">{t('commandCenter.shortcuts')}</span>
      </div>
    </div>
  );
}

// ─── 보기: 칸반 열 ──────────────────────────────────────────────────────────

function BoardColumns({
  lanes,
  archived,
  archiveOpen,
  onToggleArchive,
  renderCard,
  groupByAgent,
}: {
  lanes: Record<CommandCenterLane, CommandCenterItem[]>;
  archived: CommandCenterItem[];
  archiveOpen: boolean;
  onToggleArchive: () => void;
  renderCard: (item: CommandCenterItem) => React.JSX.Element;
  groupByAgent: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  // 빈 레인은 열을 차지하지 않는다 — 개수는 위 분류 막대가 이미 알려 준다.
  const shown = COMMAND_CENTER_LANES.filter((lane) => lanes[lane].length > 0);
  return (
    <div className="flex h-full min-h-0 gap-3 overflow-x-auto px-4 py-3">
      {shown.map((lane) => (
        <section
          key={lane}
          className="flex h-full min-h-0 w-[320px] max-w-[520px] flex-shrink-0 flex-grow basis-[320px] flex-col rounded-xl border border-white/[0.06] bg-white/[0.015]"
        >
          <header className="flex flex-shrink-0 items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
            <span className={`h-2 w-2 rounded-full ${LANE_DOT[lane]}`} />
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${LANE_ACCENT[lane]}`}>
              {t(`commandCenter.lane.${lane}`)}
            </span>
            <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-[1px] text-[10px] tabular-nums text-gray-400">
              {lanes[lane].length}
            </span>
          </header>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
            {groupByAgent ? renderGrouped(lanes[lane], renderCard) : lanes[lane].map(renderCard)}
          </div>
        </section>
      ))}

      {archived.length > 0 && (
        <section className="flex h-full min-h-0 w-[280px] flex-shrink-0 flex-col rounded-xl border border-white/[0.06] bg-white/[0.01]">
          <button
            type="button"
            onClick={onToggleArchive}
            className="flex flex-shrink-0 items-center gap-1.5 border-b border-white/[0.06] px-3 py-2 text-left"
          >
            <svg
              className={`h-3 w-3 text-gray-600 transition-transform ${archiveOpen ? 'rotate-90' : ''}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">
              {t('commandCenter.archived')}
            </span>
            <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-[1px] text-[10px] tabular-nums text-gray-500">
              {archived.length}
            </span>
          </button>
          {archiveOpen && (
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2 opacity-70">
              {archived.map(renderCard)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ─── 보기: 세로 구역(좁은 창 · list) ────────────────────────────────────────

function StackedLanes({
  lanes,
  collapsedLanes,
  onToggleLane,
  archived,
  archiveOpen,
  onToggleArchive,
  renderCard,
  groupByAgent,
}: {
  lanes: Record<CommandCenterLane, CommandCenterItem[]>;
  collapsedLanes: string[];
  onToggleLane: (lane: CommandCenterLane) => void;
  archived: CommandCenterItem[];
  archiveOpen: boolean;
  onToggleArchive: () => void;
  renderCard: (item: CommandCenterItem) => React.JSX.Element;
  groupByAgent: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      <div className="flex flex-col gap-4">
        {COMMAND_CENTER_LANES.map((lane) => {
          const items = lanes[lane];
          if (items.length === 0) return null;
          const collapsed = collapsedLanes.includes(lane);
          return (
            <section key={lane}>
              <button
                type="button"
                onClick={() => onToggleLane(lane)}
                className="sticky top-0 z-10 mb-1.5 flex w-full items-center gap-1.5 bg-gray-950/95 py-1 text-left backdrop-blur"
              >
                <svg
                  className={`h-3 w-3 text-gray-600 transition-transform ${collapsed ? '' : 'rotate-90'}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
                <span className={`h-2 w-2 rounded-full ${LANE_DOT[lane]}`} />
                <span className={`text-[11px] font-semibold uppercase tracking-wide ${LANE_ACCENT[lane]}`}>
                  {t(`commandCenter.lane.${lane}`)}
                </span>
                <span className="rounded bg-white/[0.06] px-1.5 py-[1px] text-[10px] tabular-nums text-gray-400">{items.length}</span>
              </button>
              {!collapsed && (
                <div className="flex flex-col gap-1.5">
                  {groupByAgent ? renderGrouped(items, renderCard) : items.map(renderCard)}
                </div>
              )}
            </section>
          );
        })}

        {archived.length > 0 && (
          <section>
            <button
              type="button"
              onClick={onToggleArchive}
              className="mb-1.5 flex w-full items-center gap-1.5 text-left"
            >
              <svg
                className={`h-3 w-3 text-gray-600 transition-transform ${archiveOpen ? 'rotate-90' : ''}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                {t('commandCenter.archived')}
              </span>
              <span className="rounded bg-white/[0.06] px-1.5 py-[1px] text-[10px] tabular-nums text-gray-500">{archived.length}</span>
            </button>
            {archiveOpen && (
              <div className="flex flex-col gap-1.5 opacity-70">{archived.map(renderCard)}</div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** 에이전트별 묶어 보기 — 같은 에이전트의 세션을 한 덩어리로 붙여 그린다. */
function renderGrouped(
  items: CommandCenterItem[],
  renderCard: (item: CommandCenterItem) => React.JSX.Element,
): React.JSX.Element[] {
  const order: string[] = [];
  const byAgent = new Map<string, CommandCenterItem[]>();
  for (const item of items) {
    if (!byAgent.has(item.agentId)) { byAgent.set(item.agentId, []); order.push(item.agentId); }
    byAgent.get(item.agentId)!.push(item);
  }
  return order.map((agentId) => (
    <div key={agentId} className="flex flex-col gap-1.5 rounded-lg border border-white/[0.05] bg-white/[0.015] p-1.5">
      {byAgent.get(agentId)!.map(renderCard)}
    </div>
  ));
}

// ─── 부품 ───────────────────────────────────────────────────────────────────

function TriagePill({
  label,
  count,
  active,
  lane,
  onClick,
  shortcut,
}: {
  label: string;
  count: number;
  active: boolean;
  lane?: CommandCenterLane;
  onClick: () => void;
  shortcut: string;
}): React.JSX.Element {
  const on = lane ? LANE_PILL_ON[lane] : 'border-white/25 bg-white/[0.08] text-gray-100';
  return (
    <button
      type="button"
      onClick={onClick}
      title={shortcut}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
        active ? on : 'border-white/[0.08] bg-transparent text-gray-400 hover:border-white/20 hover:text-gray-100'
      } ${count === 0 && !active ? 'opacity-50' : ''}`}
    >
      {lane && <span className={`h-1.5 w-1.5 rounded-full ${LANE_DOT[lane]}`} />}
      <span>{label}</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function IconToggle({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex flex-shrink-0 items-center rounded-md border px-2 py-1.5 transition-colors ${
        on ? 'border-sky-400/40 bg-sky-500/10 text-sky-200' : 'border-white/10 bg-black/40 text-gray-500 hover:text-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

function ViewToggle({ value, onChange }: { value: CommandCenterView; onChange: (v: CommandCenterView) => void }): React.JSX.Element {
  const { t } = useTranslation();
  const options: Array<{ id: CommandCenterView; label: string; icon: React.JSX.Element }> = [
    {
      id: 'board',
      label: t('commandCenter.view.board'),
      icon: (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="5" height="16" rx="1" />
          <rect x="10" y="4" width="5" height="11" rx="1" />
          <rect x="17" y="4" width="4" height="7" rx="1" />
        </svg>
      ),
    },
    {
      id: 'list',
      label: t('commandCenter.view.list'),
      icon: (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      ),
    },
  ];
  return (
    <div className="flex flex-shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/40">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          title={o.label}
          className={`px-2 py-1.5 transition-colors ${
            value === o.id ? 'bg-white/[0.10] text-gray-100' : 'text-gray-500 hover:text-gray-200'
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
      <svg className="h-9 w-9 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M8 9h8M8 13h5" />
      </svg>
      <p className="text-[12.5px] text-gray-300">{title}</p>
      <p className="text-[11.5px] text-gray-600">{body}</p>
    </div>
  );
}

function SortPicker({ value, onChange }: { value: CommandCenterSort; onChange: (v: CommandCenterSort) => void }): React.JSX.Element {
  const { t } = useTranslation();
  // 선택지·순서는 모델의 COMMAND_CENTER_SORTS 하나가 정한다(둘로 나뉘면 언젠가 어긋난다).
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CommandCenterSort)}
      className="flex-shrink-0 rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-gray-300 outline-none focus:border-sky-500/50"
      title={`${t('commandCenter.sortHint')} — ${t(`commandCenter.sortRule.${value}`)}`}
    >
      {COMMAND_CENTER_SORTS.map((id) => (
        <option key={id} value={id} className="bg-gray-900">{t(`commandCenter.sort.${id}`)}</option>
      ))}
    </select>
  );
}

function TidyPanel({
  settings,
  onUpdate,
  onClose,
  onBulkCloseDone,
  onStopAll,
}: {
  settings: CommandCenterSettings;
  onUpdate: (patch: Partial<CommandCenterSettings>) => void;
  onClose: () => void;
  onBulkCloseDone: () => void;
  onStopAll: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="absolute right-0 top-9 z-30 w-72 rounded-md border border-white/10 bg-gray-900 p-3 shadow-lg shadow-black/60">
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={settings.groupByAgent}
          onChange={(e) => onUpdate({ groupByAgent: e.target.checked })}
          className="mt-0.5 h-3.5 w-3.5 accent-sky-500"
        />
        <span className="text-[11.5px] text-gray-300">{t('commandCenter.groupByAgent')}</span>
      </label>

      <div className="my-2.5 h-px bg-white/[0.07]" />

      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={settings.autoTidy}
          onChange={(e) => onUpdate({ autoTidy: e.target.checked })}
          className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
        />
        <span className="text-[11.5px] text-gray-300">
          {t('commandCenter.autoTidy')}
          <span className="mt-0.5 block text-[10.5px] leading-snug text-gray-500">
            {t('commandCenter.autoTidyNote')}
          </span>
        </span>
      </label>

      {settings.autoTidy && (
        <div className="mt-2 flex items-center gap-1.5 pl-5">
          {AUTO_TIDY_MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onUpdate({ autoTidyMinutes: m })}
              className={`rounded px-2 py-1 text-[10.5px] tabular-nums transition-colors ${
                settings.autoTidyMinutes === m
                  ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30'
                  : 'bg-white/[0.05] text-gray-400 hover:text-gray-100'
              }`}
            >
              {t('commandCenter.minutes', { count: m })}
            </button>
          ))}
        </div>
      )}

      <div className="my-2.5 h-px bg-white/[0.07]" />

      <button
        type="button"
        onClick={() => { onBulkCloseDone(); onClose(); }}
        className="block w-full rounded px-2 py-1.5 text-left text-[11.5px] text-gray-300 transition-colors hover:bg-white/[0.08]"
      >
        {t('commandCenter.bulkCloseDone')}
      </button>
      <button
        type="button"
        onClick={() => { onStopAll(); onClose(); }}
        className="block w-full rounded px-2 py-1.5 text-left text-[11.5px] text-red-300 transition-colors hover:bg-white/[0.08]"
      >
        {t('commandCenter.bulkStopAll')}
      </button>

      <button
        type="button"
        onClick={() => { onUpdate({ ...DEFAULT_COMMAND_CENTER_SETTINGS }); }}
        className="mt-1.5 block w-full rounded px-2 py-1.5 text-left text-[10.5px] text-gray-600 transition-colors hover:bg-white/[0.06] hover:text-gray-400"
      >
        {t('commandCenter.resetSettings')}
      </button>
    </div>
  );
}

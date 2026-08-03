import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { CommandCenterCard } from './CommandCenterCard.js';
import {
  AUTO_TIDY_MINUTES,
  COMMAND_CENTER_LANES,
  buildCommandCenterItems,
  filterCommandCenterItems,
  groupByLane,
  isAutoTidyTarget,
  isEmptyQuery,
  parseCommandCenterQuery,
  sortCommandCenterItems,
  type CommandCenterItem,
  type CommandCenterLane,
  type CommandCenterSort,
} from './commandCenterModel.js';
import {
  DEFAULT_COMMAND_CENTER_SETTINGS,
  loadCommandCenterSettings,
  saveCommandCenterSettings,
  type CommandCenterSettings,
} from './commandCenterSettings.js';

// SCENARIO.md §5.12 (B)(C)(E) — 레인 보드 + 검색 + 정리. 데이터는 전부 graph_snapshot 파생이다.

/** 상대 시간 표시가 굳지 않게 하는 최소 주기(30초). */
const TICK_MS = 30_000;

const LANE_ACCENT: Record<CommandCenterLane, string> = {
  'needs-answer': 'text-rose-300',
  'needs-review': 'text-violet-300',
  'needs-action': 'text-amber-300',
  working: 'text-sky-300',
  done: 'text-gray-400',
};

export interface CommandCenterBoardProps {
  projectId: string;
}

export function CommandCenterBoard({ projectId }: CommandCenterBoardProps): React.JSX.Element {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<CommandCenterSettings>(() => loadCommandCenterSettings());
  const [rawQuery, setRawQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [tidyOpen, setTidyOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const agents = useGraphStore((s) => s.agents);
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const agentConfigs = useGraphStore((s) => s.agentConfigs);
  const subAgents = useGraphStore((s) => s.subAgents);
  const queuedCommands = useGraphStore((s) => s.queuedCommands);
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

  const update = useCallback((patch: Partial<CommandCenterSettings>): void => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveCommandCenterSettings(next);
      return next;
    });
  }, []);

  // `/` 또는 Ctrl+F 로 검색창 포커스, Esc 로 비우기(§5.12 (C)).
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
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        e.preventDefault();
        setRawQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const allItems = useMemo(
    () =>
      buildCommandCenterItems({
        projectId,
        agents,
        agentProjects,
        agentConfigs,
        subAgents,
        queuedCommands,
        runningSubagentTasks,
        agentQuestions,
        agentReviews,
        agentReports,
        pendingPermissions,
        acknowledgedSubAgents,
      }),
    [
      projectId, agents, agentProjects, agentConfigs, subAgents, queuedCommands,
      runningSubagentTasks, agentQuestions, agentReviews, agentReports,
      pendingPermissions, acknowledgedSubAgents,
    ],
  );

  const query = useMemo(() => parseCommandCenterQuery(rawQuery), [rawQuery]);
  const searching = !isEmptyQuery(query);

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
  const attentionCount = lanes['needs-answer'].length + lanes['needs-review'].length + lanes['needs-action'].length;

  const toggleLane = useCallback((lane: CommandCenterLane): void => {
    setSettings((prev) => {
      const collapsed = prev.collapsedLanes.includes(lane)
        ? prev.collapsedLanes.filter((l) => l !== lane)
        : [...prev.collapsedLanes, lane];
      const next = { ...prev, collapsedLanes: collapsed };
      saveCommandCenterSettings(next);
      return next;
    });
  }, []);

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
    if (!window.confirm(t('commandCenter.confirmCloseDone', { defaultValue: 'Close {{count}} finished session tabs?', count: total }))) return;
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
    if (!window.confirm(t('commandCenter.confirmStopAll', { defaultValue: 'Stop all running sessions of {{count}} agents?', count: agentIds.length }))) return;
    for (const agentId of agentIds) {
      void fetch(`/api/subagents/${agentId}/stop-all`, { method: 'POST' }).catch(() => {});
    }
  }, [allItems, t]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-950">
      {/* ── 검색 + 도구 막대 ─────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 flex-col gap-2 border-b border-white/[0.07] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchRef}
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder={t('commandCenter.searchPlaceholder', { defaultValue: 'Search sessions —  is:working  needs:review  agent:…  tool:…' })}
              className="w-full rounded-md border border-white/10 bg-black/40 py-1.5 pl-8 pr-8 text-[12px] text-gray-100 outline-none placeholder:text-gray-600 focus:border-sky-500/50"
            />
            {rawQuery && (
              <button
                type="button"
                onClick={() => setRawQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-500 hover:text-gray-200"
                title={t('commandCenter.clearSearch', { defaultValue: 'Clear' })}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>

          <SortPicker value={settings.sort} onChange={(sort) => update({ sort })} />

          <div className="relative">
            <button
              type="button"
              onClick={() => setTidyOpen((v) => !v)}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                settings.autoTidy
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-white/10 bg-black/40 text-gray-400 hover:text-gray-100'
              }`}
              title={t('commandCenter.tidyHint', { defaultValue: 'Tidy options' })}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M6 12h12M9 18h6" />
              </svg>
              {t('commandCenter.tidy', { defaultValue: 'Tidy' })}
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

        {/* 요약 줄 */}
        <div className="flex items-center gap-3 text-[10.5px] text-gray-500">
          <span>
            {searching
              ? t('commandCenter.resultCount', { defaultValue: '{{count}} matches', count: visible.length })
              : t('commandCenter.sessionCount', { defaultValue: '{{count}} sessions', count: allItems.length })}
          </span>
          {attentionCount > 0 && (
            <span className="text-rose-300">
              {t('commandCenter.attentionCount', { defaultValue: '{{count}} need you', count: attentionCount })}
            </span>
          )}
          {archived.length > 0 && (
            <button type="button" onClick={() => setArchiveOpen((v) => !v)} className="underline-offset-2 hover:underline">
              {t('commandCenter.archivedCount', { defaultValue: '{{count}} tidied away', count: archived.length })}
            </button>
          )}
        </div>
      </div>

      {/* ── 레인 ──────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {allItems.length === 0 ? (
          <EmptyState
            title={t('commandCenter.emptyTitle', { defaultValue: 'No agents in this project yet' })}
            body={t('commandCenter.emptyBody', { defaultValue: 'Create an agent on the canvas and it will show up here.' })}
          />
        ) : board.length === 0 && archived.length === 0 ? (
          <EmptyState
            title={t('commandCenter.noMatchTitle', { defaultValue: 'Nothing matches' })}
            body={t('commandCenter.noMatchBody', { defaultValue: 'Try a different word, or clear the search.' })}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {COMMAND_CENTER_LANES.map((lane) => {
              const items = lanes[lane];
              if (items.length === 0) return null;
              const collapsed = settings.collapsedLanes.includes(lane);
              return (
                <section key={lane}>
                  <button
                    type="button"
                    onClick={() => toggleLane(lane)}
                    className="mb-1.5 flex w-full items-center gap-1.5 text-left"
                  >
                    <svg
                      className={`h-3 w-3 text-gray-600 transition-transform ${collapsed ? '' : 'rotate-90'}`}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    >
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                    <span className={`text-[11px] font-semibold uppercase tracking-wide ${LANE_ACCENT[lane]}`}>
                      {t(`commandCenter.lane.${lane}`, { defaultValue: lane })}
                    </span>
                    <span className="rounded bg-white/[0.06] px-1.5 py-[1px] text-[10px] text-gray-400">{items.length}</span>
                  </button>
                  {!collapsed && (
                    <div className="flex flex-col gap-1.5">
                      {settings.groupByAgent
                        ? renderGrouped(items, projectId, now)
                        : items.map((item) => (
                            <CommandCenterCard key={item.key} item={item} projectId={projectId} now={now} />
                          ))}
                    </div>
                  )}
                </section>
              );
            })}

            {archived.length > 0 && (
              <section>
                <button
                  type="button"
                  onClick={() => setArchiveOpen((v) => !v)}
                  className="mb-1.5 flex w-full items-center gap-1.5 text-left"
                >
                  <svg
                    className={`h-3 w-3 text-gray-600 transition-transform ${archiveOpen ? 'rotate-90' : ''}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  >
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                    {t('commandCenter.archived', { defaultValue: 'Tidied away' })}
                  </span>
                  <span className="rounded bg-white/[0.06] px-1.5 py-[1px] text-[10px] text-gray-500">{archived.length}</span>
                </button>
                {archiveOpen && (
                  <div className="flex flex-col gap-1.5 opacity-70">
                    {archived.map((item) => (
                      <CommandCenterCard key={item.key} item={item} projectId={projectId} now={now} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 에이전트별 묶어 보기 — 같은 에이전트의 세션을 한 덩어리로 붙여 그린다. */
function renderGrouped(items: CommandCenterItem[], projectId: string, now: number): React.JSX.Element[] {
  const order: string[] = [];
  const byAgent = new Map<string, CommandCenterItem[]>();
  for (const item of items) {
    if (!byAgent.has(item.agentId)) { byAgent.set(item.agentId, []); order.push(item.agentId); }
    byAgent.get(item.agentId)!.push(item);
  }
  return order.map((agentId) => {
    const group = byAgent.get(agentId)!;
    return (
      <div key={agentId} className="flex flex-col gap-1.5 rounded-lg border border-white/[0.05] bg-white/[0.015] p-1.5">
        {group.map((item) => (
          <CommandCenterCard key={item.key} item={item} projectId={projectId} now={now} />
        ))}
      </div>
    );
  });
}

function EmptyState({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
      <svg className="h-9 w-9 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M8 9h8M8 13h5" />
      </svg>
      <p className="text-[12px] text-gray-300">{title}</p>
      <p className="text-[11px] text-gray-600">{body}</p>
    </div>
  );
}

function SortPicker({ value, onChange }: { value: CommandCenterSort; onChange: (v: CommandCenterSort) => void }): React.JSX.Element {
  const { t } = useTranslation();
  const options: Array<{ id: CommandCenterSort; label: string }> = [
    { id: 'recent', label: t('commandCenter.sort.recent', { defaultValue: 'Recent' }) },
    { id: 'waiting', label: t('commandCenter.sort.waiting', { defaultValue: 'Waiting longest' }) },
    { id: 'context', label: t('commandCenter.sort.context', { defaultValue: 'Context left' }) },
  ];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CommandCenterSort)}
      className="rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-gray-300 outline-none focus:border-sky-500/50"
      title={t('commandCenter.sortHint', { defaultValue: 'Sort order' })}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id} className="bg-gray-900">{o.label}</option>
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
        <span className="text-[11px] text-gray-300">{t('commandCenter.groupByAgent', { defaultValue: 'Group by agent' })}</span>
      </label>

      <div className="my-2.5 h-px bg-white/[0.07]" />

      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={settings.autoTidy}
          onChange={(e) => onUpdate({ autoTidy: e.target.checked })}
          className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
        />
        <span className="text-[11px] text-gray-300">
          {t('commandCenter.autoTidy', { defaultValue: 'Auto-tidy idle sessions' })}
          <span className="mt-0.5 block text-[10px] leading-snug text-gray-500">
            {t('commandCenter.autoTidyNote', { defaultValue: 'Off by default. Only folds them out of the way — never stops or deletes a session.' })}
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
              className={`rounded px-2 py-1 text-[10px] transition-colors ${
                settings.autoTidyMinutes === m
                  ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30'
                  : 'bg-white/[0.05] text-gray-400 hover:text-gray-100'
              }`}
            >
              {t('commandCenter.minutes', { defaultValue: '{{count}}m', count: m })}
            </button>
          ))}
        </div>
      )}

      <div className="my-2.5 h-px bg-white/[0.07]" />

      <button
        type="button"
        onClick={() => { onBulkCloseDone(); onClose(); }}
        className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-gray-300 transition-colors hover:bg-white/[0.08]"
      >
        {t('commandCenter.bulkCloseDone', { defaultValue: 'Close all finished session tabs' })}
      </button>
      <button
        type="button"
        onClick={() => { onStopAll(); onClose(); }}
        className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-red-300 transition-colors hover:bg-white/[0.08]"
      >
        {t('commandCenter.bulkStopAll', { defaultValue: 'Stop everything that is running' })}
      </button>

      <button
        type="button"
        onClick={() => { onUpdate({ ...DEFAULT_COMMAND_CENTER_SETTINGS }); }}
        className="mt-1.5 block w-full rounded px-2 py-1.5 text-left text-[10px] text-gray-600 transition-colors hover:bg-white/[0.06] hover:text-gray-400"
      >
        {t('commandCenter.resetSettings', { defaultValue: 'Reset these options' })}
      </button>
    </div>
  );
}

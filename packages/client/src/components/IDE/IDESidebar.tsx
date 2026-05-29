import { memo, useMemo, useCallback, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent, AgentEvent, QueuedCommand, FileEdit, ActivityEdge } from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay, agentSessionInputKey } from '../../stores/graphStore.js';
import type { IDEViewType } from '../../stores/graphStore.js';
import { useAvailableSkills, deleteSkill, persistSkillOrder, type SkillInfo } from '../../hooks/useAvailableSkills.js';
import { ScrollFade } from '../ScrollFade.js';

const EMPTY_SUBS: SubAgent[] = [];
const EMPTY_EVENTS: AgentEvent[] = [];

interface IDESidebarProps {
  agentId: string;
}

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-emerald-400',
  active: 'bg-blue-400 animate-pulse',
  completed: 'bg-gray-400',
  error: 'bg-red-400',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatTokenShort(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

// ─── Terminal view: SubAgent list ───

function TerminalView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const subAgents = useGraphStore((s) => s.subAgents[agentId] ?? EMPTY_SUBS);
  const setSession = useGraphStore((s) => s.setIDEActiveSession);

  return (
    <div className="flex flex-col gap-1 p-2">
      <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{t('ide.sidebar.sessions')}</span>
      <ScrollFade maxHeight={400}>
        <ul className="flex flex-col gap-1">
          {subAgents.map((sub) => {
            const dot = STATUS_DOT[sub.status] ?? STATUS_DOT['idle'];
            return (
              <li
                key={sub.id}
                className="cursor-pointer rounded px-2 py-1.5 transition-colors hover:bg-gray-700/60"
                onClick={() => setSession(sub.id)}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dot}`} />
                  <span className="text-xs font-medium text-gray-300">{sub.label}</span>
                </div>
                {sub.lastCommand && (
                  <p className="mt-0.5 truncate pl-4 text-[10px] text-gray-500">{sub.lastCommand}</p>
                )}
                <div className="mt-0.5 flex items-center gap-2 pl-4">
                  <span className="text-[9px] text-gray-600">{formatTime(sub.lastActivityAt)}</span>
                  {(sub.totalInputTokens ?? 0) > 0 && (
                    <span className="text-[9px] text-violet-400/60">
                      {formatTokenShort(sub.totalInputTokens ?? 0)}in
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </ScrollFade>
    </div>
  );
}

// ─── Files view: files touched by agent ───

function FilesView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const allFileEdits = useGraphStore((s) => s.fileEdits);
  const storeEdges = useGraphStore((s) => s.edges);

  // Find file nodes connected to this agent via edges
  const touchedFiles = useMemo(() => {
    const fileIds = new Set<string>();
    for (const edge of storeEdges) {
      if (edge.source === agentId) fileIds.add(edge.target);
      if (edge.target === agentId) fileIds.add(edge.source);
    }
    return fileIds;
  }, [storeEdges, agentId]);

  // Collect file edits for touched files
  const files = useMemo(() => {
    const result: { id: string; edits: FileEdit[] }[] = [];
    for (const id of touchedFiles) {
      const edits = allFileEdits[id];
      if (edits && edits.length > 0) {
        result.push({ id, edits });
      }
    }
    result.sort((a, b) => (b.edits[0]?.timestamp ?? 0) - (a.edits[0]?.timestamp ?? 0));
    return result;
  }, [touchedFiles, allFileEdits]);

  return (
    <div className="flex flex-col gap-1 p-2">
      <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {t('ide.sidebar.files', { count: files.length })}
      </span>
      <ScrollFade maxHeight={400}>
        <ul className="flex flex-col gap-0.5">
          {files.map(({ id, edits }) => {
            const lastEdit = edits[0];
            const name = lastEdit?.filePath.split('/').pop() ?? id;
            return (
              <li
                key={id}
                className="rounded px-2 py-1 transition-colors hover:bg-gray-700/60"
              >
                <div className="flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 flex-shrink-0 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6" />
                  </svg>
                  <span className="truncate text-xs text-gray-300">{name}</span>
                  <span className="ml-auto text-[9px] text-gray-600">{edits.length}</span>
                </div>
              </li>
            );
          })}
          {files.length === 0 && (
            <li className="px-2 py-4 text-center text-xs text-gray-600">{t('ide.sidebar.noFileEdits')}</li>
          )}
        </ul>
      </ScrollFade>
    </div>
  );
}

// ─── Events view: agent event list ───

function EventsView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const events = useGraphStore((s) => s.agentEvents[agentId] ?? EMPTY_EVENTS);

  return (
    <div className="flex flex-col gap-1 p-2">
      <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {t('ide.sidebar.events', { count: events.length })}
      </span>
      <ScrollFade maxHeight={400}>
        <ul className="flex flex-col gap-1">
          {events.map((evt) => (
            <li
              key={evt.id}
              className="rounded px-2 py-1.5 transition-colors hover:bg-gray-700/60"
            >
              <p className="line-clamp-2 text-xs leading-relaxed text-gray-300">{evt.message}</p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-[9px] text-gray-600">{formatTime(evt.timestamp)}</span>
                <span className={`rounded px-1 py-px text-[8px] ${
                  evt.source === 'queue'
                    ? 'bg-amber-500/15 text-amber-400/80'
                    : 'bg-gray-600/30 text-gray-500'
                }`}>
                  {evt.source}
                </span>
                {evt.response && (
                  <span className="text-[9px] text-emerald-400/60">{t('ide.sidebar.hasResult')}</span>
                )}
              </div>
            </li>
          ))}
          {events.length === 0 && (
            <li className="px-2 py-4 text-center text-xs text-gray-600">{t('ide.sidebar.noEvents')}</li>
          )}
        </ul>
      </ScrollFade>
    </div>
  );
}

// ─── Skills view: 프로젝트 + 플러그인 스킬 목록 (§5.5 #17-4 v2.32) ───

type SkillSource = 'project' | 'plugin';

/** 고정 순서(pinned) 우선 정렬: pinned 에 있는 스킬은 그 순서로, 나머지는 cmp 로 정렬 후 뒤에 append. */
function applyPinnedOrder(
  list: SkillInfo[],
  pinned: string[],
  cmp: (a: SkillInfo, b: SkillInfo) => number,
): SkillInfo[] {
  const byName = new Map(list.map((s) => [s.name, s]));
  const used = new Set<string>();
  const head: SkillInfo[] = [];
  for (const n of pinned) {
    const s = byName.get(n);
    if (s && !used.has(n)) { head.push(s); used.add(n); }
  }
  const rest = list.filter((s) => !used.has(s.name)).sort(cmp);
  return [...head, ...rest];
}

function SkillsView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const { skills, order, loaded } = useAvailableSkills();
  const activeSessionId = useGraphStore((s) => selectIDEOverlay(s).activeSessionId);
  const setAgentSessionInputText = useGraphStore((s) => s.setAgentSessionInputText);
  // §5.5 #17-4 v2.36 — 이 에이전트가 속한 프로젝트의 카운트만 정렬·배지 표시.
  const projectName = useGraphStore((s) => s.agentProjects[agentId]);
  const projectCounts = useGraphStore((s) =>
    projectName ? (s.skillUsageCounts[projectName] ?? null) : null,
  );

  // 삭제 확인(인라인 2-step) 대상 스킬명. 드래그 in-flight 상태(타입 + 가시 순서).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [liveDrag, setLiveDrag] = useState<{ type: SkillSource; names: string[] } | null>(null);
  const dragNameRef = useRef<string | null>(null);

  const { projectSkills, pluginSkills } = useMemo(() => {
    const getCount = (name: string): number => projectCounts?.[name] ?? 0;
    const cmp = (a: SkillInfo, b: SkillInfo): number => {
      const d = getCount(b.name) - getCount(a.name);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    };
    const project: SkillInfo[] = [];
    const plugin: SkillInfo[] = [];
    for (const s of skills) {
      if (s.source === 'project') project.push(s);
      else plugin.push(s);
    }
    const pinnedFor = (type: SkillSource): string[] =>
      liveDrag?.type === type ? liveDrag.names : (type === 'project' ? order.project : order.plugin);
    return {
      projectSkills: applyPinnedOrder(project, pinnedFor('project'), cmp),
      pluginSkills: applyPinnedOrder(plugin, pinnedFor('plugin'), cmp),
    };
  }, [skills, projectCounts, order, liveDrag]);

  const insertSkill = useCallback((skill: SkillInfo) => {
    const key = agentSessionInputKey(agentId, activeSessionId);
    const existing = useGraphStore.getState().agentSessionInputs[key]?.text ?? '';
    const insert = `/${skill.name} `;
    const next = existing.length > 0 ? `${insert}\n${existing}` : insert;
    setAgentSessionInputText(agentId, activeSessionId, next);
    // textarea 자동 focus — §5.5 #17-3 의 data-ide-input 셀렉터 재사용.
    requestAnimationFrame(() => {
      const sessionAttr = activeSessionId ?? '';
      const ta = document.querySelector<HTMLTextAreaElement>(
        `textarea[data-ide-input="${agentId}"][data-ide-input-session="${sessionAttr}"]`,
      );
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
    });
  }, [agentId, activeSessionId, setAgentSessionInputText]);

  // ── 드래그 재정렬 (같은 타입 내에서만) ──
  const handleDragStart = useCallback((e: React.DragEvent, type: SkillSource, names: string[], name: string) => {
    dragNameRef.current = name;
    setLiveDrag({ type, names });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', name);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, type: SkillSource, overName: string) => {
    const dragged = dragNameRef.current;
    if (dragged === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setLiveDrag((prev) => {
      if (!prev || prev.type !== type) return prev; // 타입이 다르면 무시(교차 이동 금지).
      const names = [...prev.names];
      const from = names.indexOf(dragged);
      const to = names.indexOf(overName);
      if (from < 0 || to < 0 || from === to) return prev;
      names.splice(from, 1);
      names.splice(to, 0, dragged);
      return { type, names };
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    dragNameRef.current = null;
    setLiveDrag((prev) => {
      if (prev) void persistSkillOrder(prev.type, prev.names);
      return null;
    });
  }, []);

  const handleDelete = useCallback((s: SkillInfo) => {
    setConfirmDelete(null);
    void deleteSkill(s.name, s.source);
  }, []);

  const renderSkill = useCallback((s: SkillInfo, orderedNames: string[]) => {
    const accentText = s.source === 'project' ? 'text-emerald-400' : 'text-purple-400';
    const count = projectCounts?.[s.name] ?? 0;
    const confirming = confirmDelete === s.name;
    return (
      <li
        key={`${s.source}:${s.name}`}
        draggable
        onDragStart={(e) => handleDragStart(e, s.source, orderedNames, s.name)}
        onDragOver={(e) => handleDragOver(e, s.source, s.name)}
        onDragEnd={handleDragEnd}
        className="group relative cursor-grab rounded px-2 py-1.5 transition-colors hover:bg-gray-700/60 active:cursor-grabbing"
        onClick={() => { if (!confirming) insertSkill(s); }}
        title={confirming ? undefined : s.description}
      >
        <div className="flex items-center gap-1.5">
          <span className={`truncate font-mono text-[11px] font-semibold ${accentText}`}>
            /{s.name}
          </span>
          {s.source === 'plugin' && s.pluginName && (
            <span className="flex-shrink-0 rounded bg-purple-500/15 px-1 py-0.5 text-[9px] uppercase tracking-wide text-purple-400/80">
              {s.pluginName}
            </span>
          )}
          {count > 0 && (
            <span className="ml-auto flex-shrink-0 rounded bg-blue-500/15 px-1 py-0.5 font-mono text-[9px] font-semibold text-blue-300/90">
              {count}×
            </span>
          )}
          {/* 삭제 X — 프로젝트 스킬만, hover 시 노출. */}
          {s.source === 'project' && !confirming && (
            <button
              type="button"
              draggable={false}
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(s.name); }}
              onMouseDown={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
              title={t('ide.sidebar.deleteSkillTitle')}
              aria-label={t('ide.sidebar.deleteSkillTitle')}
              className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-gray-500 opacity-0 transition-opacity hover:bg-red-500/20 hover:text-red-300 group-hover:opacity-100 ${count > 0 ? 'ml-1' : 'ml-auto'}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {confirming ? (
          <div className="mt-1 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <span className="truncate text-[10px] text-red-300/90">{t('ide.sidebar.deleteSkillConfirm')}</span>
            <button
              type="button"
              draggable={false}
              onClick={(e) => { e.stopPropagation(); handleDelete(s); }}
              className="ml-auto flex-shrink-0 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-300 transition-colors hover:bg-red-500/30"
            >
              {t('ide.sidebar.deleteSkillYes')}
            </button>
            <button
              type="button"
              draggable={false}
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
              className="flex-shrink-0 rounded bg-gray-600/40 px-1.5 py-0.5 text-[10px] font-medium text-gray-300 transition-colors hover:bg-gray-600/60"
            >
              {t('ide.sidebar.deleteSkillNo')}
            </button>
          </div>
        ) : (
          s.description && (
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-gray-500">
              {s.description}
            </p>
          )
        )}
      </li>
    );
  }, [insertSkill, projectCounts, confirmDelete, handleDragStart, handleDragOver, handleDragEnd, handleDelete, t]);

  const projectNames = useMemo(() => projectSkills.map((s) => s.name), [projectSkills]);
  const pluginNames = useMemo(() => pluginSkills.map((s) => s.name), [pluginSkills]);

  return (
    <div className="flex flex-col gap-1 p-2">
      <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {t('ide.sidebar.skills', { count: skills.length })}
      </span>
      <ScrollFade maxHeight={500}>
        {!loaded ? (
          <div className="px-2 py-4 text-center text-xs text-gray-600">{t('ide.sidebar.skillsLoading')}</div>
        ) : skills.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-gray-600">{t('ide.sidebar.noSkills')}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {projectSkills.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="px-1 text-[9px] font-medium uppercase tracking-wider text-emerald-400/60">
                  {t('ide.sidebar.projectSkills', { count: projectSkills.length })}
                </span>
                <ul className="flex flex-col gap-0.5">{projectSkills.map((s) => renderSkill(s, projectNames))}</ul>
              </div>
            )}
            {pluginSkills.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="px-1 text-[9px] font-medium uppercase tracking-wider text-purple-400/60">
                  {t('ide.sidebar.pluginSkills', { count: pluginSkills.length })}
                </span>
                <ul className="flex flex-col gap-0.5">{pluginSkills.map((s) => renderSkill(s, pluginNames))}</ul>
              </div>
            )}
          </div>
        )}
      </ScrollFade>
    </div>
  );
}

// ─── 뷰 라우터 ───

const VIEW_MAP: Record<IDEViewType, React.FC<{ agentId: string }>> = {
  terminal: TerminalView,
  files: FilesView,
  events: EventsView,
  skills: SkillsView,
};

export const IDESidebar = memo(function IDESidebar({ agentId }: IDESidebarProps): React.JSX.Element {
  const activeView = useGraphStore((s) => selectIDEOverlay(s).activeView);
  const collapsed = useGraphStore((s) => selectIDEOverlay(s).sidebarCollapsed);
  const View = VIEW_MAP[activeView];

  if (collapsed) return <></>;

  return (
    <div className="flex w-52 flex-shrink-0 flex-col border-r border-gray-700 bg-gray-900/50">
      <View agentId={agentId} />
    </div>
  );
});

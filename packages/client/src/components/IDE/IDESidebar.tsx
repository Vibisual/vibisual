import { memo, useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent, AgentEvent, QueuedCommand, FileEdit, ActivityEdge } from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay, agentSessionInputKey } from '../../stores/graphStore.js';
import type { IDEViewType } from '../../stores/graphStore.js';
import { useAvailableSkills, deleteSkill, persistSkillOrder, persistSkillFavorites, refreshAvailableSkills, type SkillInfo } from '../../hooks/useAvailableSkills.js';
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

type SkillSource = 'project' | 'global' | 'plugin';

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
  // §5.5 #17-4 v2.36 — 이 에이전트가 속한 프로젝트의 카운트만 정렬·배지 표시.
  // v2.59 — 스킬 목록도 이 프로젝트의 .claude/skills/ 만 조회(탭별 개별).
  // 스킬 목록 조회는 agentId 를 권위 키로 넘긴다 — 서버가 그 에이전트의 소속 인스턴스에서
  // 프로젝트 path 를 직접 해소하므로, 활성 프로젝트 오염·표시명 어긋남에 영향받지 않는다.
  const projectName = useGraphStore((s) => s.agentProjects[agentId]);
  const { skills, order, favorites, loaded } = useAvailableSkills(projectName, agentId);
  // §5.5 #17-4 v2.93 — 신규(미클릭) 스킬 색 구분용 "본 것" 집합 + 시드/표시 액션.
  const seenSkills = useGraphStore((s) => s.seenSkills);
  const seedSeenSkills = useGraphStore((s) => s.seedSeenSkills);
  const markSkillSeen = useGraphStore((s) => s.markSkillSeen);
  const activeSessionId = useGraphStore((s) => selectIDEOverlay(s).activeSessionId);
  const setAgentSessionInputText = useGraphStore((s) => s.setAgentSessionInputText);
  // §4 v2.63 — CMD(interactive-terminal) 에이전트는 textarea 대신 임베디드 PTY 가 렌더된다.
  // 그 경우 스킬 클릭은 draft store 가 아니라 PTY stdin 으로 `/skill ` 을 직접 타이핑한다.
  const executionMode = useGraphStore((s) => s.agentConfigs[agentId]?.executionMode);
  const projectCounts = useGraphStore((s) =>
    projectName ? (s.skillUsageCounts[projectName] ?? null) : null,
  );

  // 삭제 확인(인라인 2-step) 대상 스킬명. 드래그 in-flight 상태(타입 + 가시 순서).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [liveDrag, setLiveDrag] = useState<{ type: SkillSource; names: string[] } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const dragNameRef = useRef<string | null>(null);

  // §5.5 #17-4 v2.93 — 즐겨찾기 집합. 출처 무관 스킬명 키.
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const { favoriteSkills, projectSkills, globalSkills, pluginSkills } = useMemo(() => {
    const getCount = (name: string): number => projectCounts?.[name] ?? 0;
    const cmp = (a: SkillInfo, b: SkillInfo): number => {
      const d = getCount(b.name) - getCount(a.name);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    };
    // 즐겨찾기는 출처 그룹에서 빠져 최상단으로. favorites 배열(별 누른 순서)대로 정렬.
    const byName = new Map(skills.map((s) => [s.name, s]));
    const favs: SkillInfo[] = [];
    for (const n of favorites) {
      const s = byName.get(n);
      if (s) favs.push(s);
    }
    const project: SkillInfo[] = [];
    const global: SkillInfo[] = [];
    const plugin: SkillInfo[] = [];
    for (const s of skills) {
      if (favoriteSet.has(s.name)) continue; // 즐겨찾기는 출처 그룹에서 제외(중복 표시 ❌).
      if (s.source === 'project') project.push(s);
      else if (s.source === 'global') global.push(s);
      else plugin.push(s);
    }
    const orderFor = (type: SkillSource): string[] =>
      type === 'project' ? order.project : type === 'global' ? order.global : order.plugin;
    const pinnedFor = (type: SkillSource): string[] =>
      liveDrag?.type === type ? liveDrag.names : orderFor(type);
    return {
      favoriteSkills: favs,
      projectSkills: applyPinnedOrder(project, pinnedFor('project'), cmp),
      globalSkills: applyPinnedOrder(global, pinnedFor('global'), cmp),
      pluginSkills: applyPinnedOrder(plugin, pinnedFor('plugin'), cmp),
    };
  }, [skills, projectCounts, order, liveDrag, favorites, favoriteSet]);

  // §5.5 #17-4 v2.93 — 최초 1회: 현재 보이는 전 스킬을 "본 것"으로 시드(첫 로드 전체 깜빡임 방지).
  useEffect(() => {
    if (loaded && skills.length > 0) {
      seedSeenSkills(skills.map((s) => `${s.source}:${s.name}`));
    }
  }, [loaded, skills, seedSeenSkills]);

  // §5.5 #17-4 v2.93 — 즐겨찾기 토글(전체 목록 치환 저장). 별 누른 순서 유지.
  const toggleFavorite = useCallback((s: SkillInfo) => {
    const next = favoriteSet.has(s.name)
      ? favorites.filter((n) => n !== s.name)
      : [...favorites, s.name];
    void persistSkillFavorites(next);
  }, [favorites, favoriteSet]);

  // §5.5 #17-4 v2.93 — 새로고침: 디스크에서 스킬 목록 재조회(새로 만든 스킬 즉시 반영).
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void refreshAvailableSkills().finally(() => {
      setTimeout(() => setRefreshing(false), 400);
    });
  }, []);

  const insertSkill = useCallback((skill: SkillInfo) => {
    const insert = `/${skill.name} `;
    // CMD(interactive-terminal): 임베디드 PTY 에 직접 타이핑. 줄바꿈은 보내지 않아(사용자가 Enter)
    // claude prefill 처럼 `/skill ` 만 입력행에 채워둔다. termId 는 IDETerminalView 와 동일 규약.
    if (executionMode === 'interactive-terminal' && window.api?.terminal) {
      const termId = `term:${agentId}:${activeSessionId ?? 'main'}`;
      void window.api.terminal.write(termId, insert);
      return;
    }
    const key = agentSessionInputKey(agentId, activeSessionId);
    const existing = useGraphStore.getState().agentSessionInputs[key]?.text ?? '';
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
  }, [agentId, activeSessionId, setAgentSessionInputText, executionMode]);

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

  const renderSkill = useCallback((s: SkillInfo, orderedNames: string[], inFavorites = false) => {
    const accentText = s.source === 'project' ? 'text-emerald-400' : s.source === 'global' ? 'text-sky-400' : 'text-purple-400';
    const count = projectCounts?.[s.name] ?? 0;
    const confirming = confirmDelete === s.name;
    const isFav = favoriteSet.has(s.name);
    const isNew = !seenSkills.keys[`${s.source}:${s.name}`];
    return (
      <li
        key={`${s.source}:${s.name}`}
        draggable={!inFavorites}
        onDragStart={inFavorites ? undefined : (e) => handleDragStart(e, s.source, orderedNames, s.name)}
        onDragOver={inFavorites ? undefined : (e) => handleDragOver(e, s.source, s.name)}
        onDragEnd={inFavorites ? undefined : handleDragEnd}
        className={`group relative rounded px-2 py-1.5 transition-colors active:cursor-grabbing ${inFavorites ? 'cursor-pointer' : 'cursor-grab'} ${isNew ? 'bg-amber-500/10 hover:bg-amber-500/20' : 'hover:bg-gray-700/60'}`}
        onClick={() => { if (!confirming) { markSkillSeen(`${s.source}:${s.name}`); insertSkill(s); } }}
        title={confirming ? undefined : s.description}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {/* 신규(미클릭) 표시 점 — amber. */}
          {isNew && (
            <span
              title={t('ide.sidebar.newSkill')}
              aria-label={t('ide.sidebar.newSkill')}
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400"
            />
          )}
          <span className={`min-w-0 truncate font-mono text-[11px] font-semibold ${accentText}`}>
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
          {/* 즐겨찾기 별 — 모든 출처. 즐겨찾기면 항상 노출(amber), 아니면 hover 시 노출. */}
          <button
            type="button"
            draggable={false}
            onClick={(e) => { e.stopPropagation(); toggleFavorite(s); }}
            onMouseDown={(e) => e.stopPropagation()}
            onDragStart={(e) => e.preventDefault()}
            title={isFav ? t('ide.sidebar.favoriteRemove') : t('ide.sidebar.favoriteAdd')}
            aria-label={isFav ? t('ide.sidebar.favoriteRemove') : t('ide.sidebar.favoriteAdd')}
            className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-opacity hover:bg-amber-500/20 ${count > 0 ? 'ml-1' : 'ml-auto'} ${isFav ? 'text-amber-400 opacity-100' : 'text-gray-500 opacity-0 hover:text-amber-300 group-hover:opacity-100'}`}
          >
            <svg viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
              <path d="M12 2.5l2.95 5.98 6.6.96-4.77 4.65 1.13 6.57L12 17.52 6.09 20.63l1.13-6.57L2.45 9.44l6.6-.96L12 2.5z" />
            </svg>
          </button>
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
              className="ml-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-gray-500 opacity-0 transition-opacity hover:bg-red-500/20 hover:text-red-300 group-hover:opacity-100"
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
  }, [insertSkill, projectCounts, confirmDelete, handleDragStart, handleDragOver, handleDragEnd, handleDelete, t, favoriteSet, seenSkills, markSkillSeen, toggleFavorite]);

  const favoriteNames = useMemo(() => favoriteSkills.map((s) => s.name), [favoriteSkills]);
  const projectNames = useMemo(() => projectSkills.map((s) => s.name), [projectSkills]);
  const globalNames = useMemo(() => globalSkills.map((s) => s.name), [globalSkills]);
  const pluginNames = useMemo(() => pluginSkills.map((s) => s.name), [pluginSkills]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
      <div className="flex items-center gap-1 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          {t('ide.sidebar.skills', { count: skills.length })}
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          title={t('ide.sidebar.refreshSkills')}
          aria-label={t('ide.sidebar.refreshSkills')}
          className="ml-auto flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-700/60 hover:text-gray-300"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}>
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>
      <ScrollFade fill className="flex-1">
        {!loaded ? (
          <div className="px-2 py-4 text-center text-xs text-gray-600">{t('ide.sidebar.skillsLoading')}</div>
        ) : skills.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-gray-600">{t('ide.sidebar.noSkills')}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {favoriteSkills.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="px-1 text-[9px] font-medium uppercase tracking-wider text-amber-400/70">
                  {t('ide.sidebar.favoriteSkills', { count: favoriteSkills.length })}
                </span>
                <ul className="flex flex-col gap-0.5">{favoriteSkills.map((s) => renderSkill(s, favoriteNames, true))}</ul>
              </div>
            )}
            {projectSkills.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="px-1 text-[9px] font-medium uppercase tracking-wider text-emerald-400/60">
                  {t('ide.sidebar.projectSkills', { count: projectSkills.length })}
                </span>
                <ul className="flex flex-col gap-0.5">{projectSkills.map((s) => renderSkill(s, projectNames))}</ul>
              </div>
            )}
            {globalSkills.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="px-1 text-[9px] font-medium uppercase tracking-wider text-sky-400/60">
                  {t('ide.sidebar.globalSkills', { count: globalSkills.length })}
                </span>
                <ul className="flex flex-col gap-0.5">{globalSkills.map((s) => renderSkill(s, globalNames))}</ul>
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
    // §4 v3.16 — 좁은 화면(폰)에선 사이드바가 본문을 짓누르지 않게 활동바 옆 오버레이로 뜬다.
    <div className="flex w-52 min-h-0 flex-shrink-0 flex-col border-r border-gray-700 bg-gray-900/50 max-md:absolute max-md:inset-y-0 max-md:left-12 max-md:z-30 max-md:w-64 max-md:max-w-[75vw] max-md:bg-gray-900 max-md:shadow-2xl max-md:shadow-black/60">
      <View agentId={agentId} />
    </div>
  );
});

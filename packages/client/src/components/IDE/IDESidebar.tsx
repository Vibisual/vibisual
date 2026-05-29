import { memo, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent, AgentEvent, QueuedCommand, FileEdit, ActivityEdge } from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay, agentSessionInputKey } from '../../stores/graphStore.js';
import type { IDEViewType } from '../../stores/graphStore.js';
import { useAvailableSkills, type SkillInfo } from '../../hooks/useAvailableSkills.js';
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

function SkillsView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const { skills, loaded } = useAvailableSkills();
  const activeSessionId = useGraphStore((s) => selectIDEOverlay(s).activeSessionId);
  const setAgentSessionInputText = useGraphStore((s) => s.setAgentSessionInputText);
  // §5.5 #17-4 v2.36 — 이 에이전트가 속한 프로젝트의 카운트만 정렬·배지 표시.
  const projectName = useGraphStore((s) => s.agentProjects[agentId]);
  const projectCounts = useGraphStore((s) =>
    projectName ? (s.skillUsageCounts[projectName] ?? null) : null,
  );

  const { projectSkills, pluginSkills } = useMemo(() => {
    const getCount = (name: string): number => projectCounts?.[name] ?? 0;
    // 같은 섹션 내 정렬: count desc → name asc.
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
    project.sort(cmp);
    plugin.sort(cmp);
    return { projectSkills: project, pluginSkills: plugin };
  }, [skills, projectCounts]);

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

  const renderSkill = useCallback((s: SkillInfo) => {
    const accentText = s.source === 'project' ? 'text-emerald-400' : 'text-purple-400';
    const count = projectCounts?.[s.name] ?? 0;
    return (
      <li
        key={`${s.source}:${s.name}`}
        className="cursor-pointer rounded px-2 py-1.5 transition-colors hover:bg-gray-700/60"
        onClick={() => insertSkill(s)}
        title={s.description}
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
        </div>
        {s.description && (
          <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-gray-500">
            {s.description}
          </p>
        )}
      </li>
    );
  }, [insertSkill, projectCounts]);

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
                <ul className="flex flex-col gap-0.5">{projectSkills.map(renderSkill)}</ul>
              </div>
            )}
            {pluginSkills.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="px-1 text-[9px] font-medium uppercase tracking-wider text-purple-400/60">
                  {t('ide.sidebar.pluginSkills', { count: pluginSkills.length })}
                </span>
                <ul className="flex flex-col gap-0.5">{pluginSkills.map(renderSkill)}</ul>
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

import { memo, useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { QueuedCommand, ActivityEdge, SessionGoalStepStatus } from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay, agentSessionInputKey } from '../../stores/graphStore.js';
import { useIDEPaneValue } from './idePane.js';
import { useIDEBodyLayout } from './ideBodyLayoutContext.js';
import type { IDEViewType } from '../../stores/graphStore.js';
import { useAvailableSkills, deleteSkill, persistSkillOrder, persistSkillFavorites, refreshAvailableSkills, type SkillInfo } from '../../hooks/useAvailableSkills.js';
import { IDESkillCopyPanel } from './IDESkillCopyPanel.js';
import { IDELoopView } from './IDELoopView.js';
import { IDEVerifyView } from './IDEVerifyView.js';
import { IDEExplorerView } from './IDEExplorerView.js';
import { IDEMcpView } from './IDEMcpView.js';
import { IDEHooksView } from './IDEHooksView.js';
import { IDEPluginsView } from './IDEPluginsView.js';
import { IDEDebugView } from './IDEDebugView.js';
import { IDEContextView } from './IDEContextView.js';
import { IDEBookmarkView } from './IDEBookmarkView.js';
import { IDESessionSummaryView } from './IDESessionSummaryView.js';
import { IDERunningSubagentsView } from './IDERunningSubagentsView.js';
import { ScrollFade } from '../ScrollFade.js';
import { autosizeInput } from './inputAutosize.js';

interface IDESidebarProps {
  agentId: string;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// §5.5 #17-31 — 종전 이 자리의 `TerminalView`(세션 목록)는 **MCP 인벤토리**(`IDEMcpView`)로
//   대체됐다. 세션 목록은 탭 바(#17-5)와 세션 요약(#17-8)이 이미 두 벌로 보여 주고 있었다.

// §5.5 #17-19 v4.71 — 파일 뷰는 워크스페이스 탐색기(IDEExplorerView)로 대체됐다.
//   종전의 "이 에이전트가 만진 파일" 목록은 사라지지 않고 그 탐색기 안 접이식 구역으로 옮겨 갔다.

// §5.5 #17-28 v4.96 — 종전 Events 뷰(훅 이벤트 목록)는 **컨텍스트 주입원 통제**(`IDEContextView`)로
//   대체됐다. 이벤트 자체는 스트림·카드·목표창이 이미 보여 주므로 목록을 한 벌 더 두지 않는다.

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
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const setAgentSessionInputText = useGraphStore((s) => s.setAgentSessionInputText);
  // §4 v2.63 — CMD(interactive-terminal) 에이전트는 textarea 대신 임베디드 PTY 가 렌더된다.
  // 그 경우 스킬 클릭은 draft store 가 아니라 PTY stdin 으로 `/skill ` 을 직접 타이핑한다.
  const executionMode = useGraphStore((s) => s.agentConfigs[agentId]?.executionMode);
  const projectCounts = useGraphStore((s) =>
    projectName ? (s.skillUsageCounts[projectName] ?? null) : null,
  );

  // §5.5 #17-4 — 복사 대상 선택을 펼친 스킬(원본 자신을 대상에서 빼려면 지금 프로젝트 path 가 필요).
  const currentProjectPath = useGraphStore((s) => (projectName ? s.projects[projectName]?.path ?? null : null));
  const [copyFor, setCopyFor] = useState<string | null>(null);

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
      // ⚠ 인라인 height 직접 조작 금지 — field-sizing 지원 환경에서 명시 height 를 남기면
      //   자동 확장이 리마운트 전까지 죽는다. 반드시 공용 autosizeInput 경유.
      autosizeInput(ta);
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
    const copying = copyFor === s.name;
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
        onClick={() => { if (!confirming && !copying) { markSkillSeen(`${s.source}:${s.name}`); insertSkill(s); } }}
        title={confirming || copying ? undefined : s.description}
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
          <span className={`min-w-0 truncate font-mono text-[12px] font-semibold ${accentText}`}>
            /{s.name}
          </span>
          {s.source === 'plugin' && s.pluginName && (
            <span className="flex-shrink-0 rounded bg-purple-500/15 px-1 py-0.5 text-[12px] uppercase tracking-wide text-purple-400/80">
              {s.pluginName}
            </span>
          )}
          {count > 0 && (
            <span className="ml-auto flex-shrink-0 rounded bg-blue-500/15 px-1 py-0.5 font-mono text-[12px] font-semibold text-blue-300/90">
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
          {/* §5.5 #17-4 — 다른 프로젝트로 복사. 출처 무관(전역·플러그인은 "이 프로젝트로 가져오기"), hover 시 노출. */}
          {!confirming && (
            <button
              type="button"
              draggable={false}
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); setCopyFor(copying ? null : s.name); }}
              onMouseDown={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
              title={t('ide.sidebar.copySkillTitle')}
              aria-label={t('ide.sidebar.copySkillTitle')}
              className={`ml-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-opacity hover:bg-sky-500/20 hover:text-sky-300 ${copying ? 'text-sky-300 opacity-100' : 'text-gray-500 opacity-0 group-hover:opacity-100'}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
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
            <span className="truncate text-[12px] text-red-300/90">{t('ide.sidebar.deleteSkillConfirm')}</span>
            <button
              type="button"
              draggable={false}
              onClick={(e) => { e.stopPropagation(); handleDelete(s); }}
              className="ml-auto flex-shrink-0 rounded bg-red-500/20 px-1.5 py-0.5 text-[12px] font-semibold text-red-300 transition-colors hover:bg-red-500/30"
            >
              {t('ide.sidebar.deleteSkillYes')}
            </button>
            <button
              type="button"
              draggable={false}
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
              className="flex-shrink-0 rounded bg-gray-600/40 px-1.5 py-0.5 text-[12px] font-medium text-gray-300 transition-colors hover:bg-gray-600/60"
            >
              {t('ide.sidebar.deleteSkillNo')}
            </button>
          </div>
        ) : (
          s.description && (
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-tight text-gray-500">
              {s.description}
            </p>
          )
        )}
        {copying && (
          <IDESkillCopyPanel
            skill={s}
            agentId={agentId}
            currentProjectPath={currentProjectPath}
            onClose={() => setCopyFor(null)}
          />
        )}
      </li>
    );
  }, [insertSkill, projectCounts, confirmDelete, copyFor, agentId, currentProjectPath, handleDragStart, handleDragOver, handleDragEnd, handleDelete, t, favoriteSet, seenSkills, markSkillSeen, toggleFavorite]);

  const favoriteNames = useMemo(() => favoriteSkills.map((s) => s.name), [favoriteSkills]);
  const projectNames = useMemo(() => projectSkills.map((s) => s.name), [projectSkills]);
  const globalNames = useMemo(() => globalSkills.map((s) => s.name), [globalSkills]);
  const pluginNames = useMemo(() => pluginSkills.map((s) => s.name), [pluginSkills]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
      <div className="flex items-center gap-1 px-1">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
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
                <span className="px-1 text-[12px] font-medium uppercase tracking-wider text-amber-400/70">
                  {t('ide.sidebar.favoriteSkills', { count: favoriteSkills.length })}
                </span>
                <ul className="flex flex-col gap-0.5">{favoriteSkills.map((s) => renderSkill(s, favoriteNames, true))}</ul>
              </div>
            )}
            {projectSkills.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="px-1 text-[12px] font-medium uppercase tracking-wider text-emerald-400/60">
                  {t('ide.sidebar.projectSkills', { count: projectSkills.length })}
                </span>
                <ul className="flex flex-col gap-0.5">{projectSkills.map((s) => renderSkill(s, projectNames))}</ul>
              </div>
            )}
            {globalSkills.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="px-1 text-[12px] font-medium uppercase tracking-wider text-sky-400/60">
                  {t('ide.sidebar.globalSkills', { count: globalSkills.length })}
                </span>
                <ul className="flex flex-col gap-0.5">{globalSkills.map((s) => renderSkill(s, globalNames))}</ul>
              </div>
            )}
            {pluginSkills.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="px-1 text-[12px] font-medium uppercase tracking-wider text-purple-400/60">
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

// ─── §5.5 #17-17 v4.47 — 목표 뷰 (최종 목표 + todo 체크리스트) ───
//
// 스킬 뷰와 같은 자리(사이드바 `w-52`)에 뜬다 — 목표는 화면을 가로채는 것이 아니라 곁눈으로
// 보는 것이기 때문. 퍼센트는 서버가 체크리스트에서 계산한 값을 그대로 그린다(클라 계산 ❌).

function GoalView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const goal = useGraphStore((s) => (activeSessionId ? s.sessionGoals[activeSessionId] : undefined));
  const saveSessionGoal = useGraphStore((s) => s.saveSessionGoal);
  const setSessionGoalProgress = useGraphStore((s) => s.setSessionGoalProgress);
  const endSessionGoal = useGraphStore((s) => s.endSessionGoal);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [newStep, setNewStep] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  // 탭이 바뀌면 편집 상태·초안을 비운다 — 다른 세션 목표에 옛 초안이 남으면 그대로 저장돼 버린다.
  useEffect(() => { setEditing(false); setDraft(''); setNewStep(''); setHistoryOpen(false); }, [activeSessionId]);

  const steps = goal?.steps ?? [];
  const doneCount = steps.filter((s) => s.status === 'done').length;

  /** 단계 목록 전체를 진행 갱신 경로로 보낸다(서버가 본문 일치로 id 를 이어 붙인다). */
  const pushSteps = useCallback((next: { text: string; status: SessionGoalStepStatus }[]) => {
    if (!activeSessionId) return;
    void setSessionGoalProgress({ agentId, subAgentId: activeSessionId, steps: next });
  }, [activeSessionId, agentId, setSessionGoalProgress]);

  const toggleStep = useCallback((id: string) => {
    pushSteps(steps.map((s) => (s.id === id ? { text: s.text, status: s.status === 'done' ? 'pending' : 'done' } : { text: s.text, status: s.status })));
  }, [steps, pushSteps]);

  const removeStep = useCallback((id: string) => {
    pushSteps(steps.filter((s) => s.id !== id).map((s) => ({ text: s.text, status: s.status })));
  }, [steps, pushSteps]);

  const addStep = useCallback(() => {
    const text = newStep.trim();
    if (!text) return;
    pushSteps([...steps.map((s) => ({ text: s.text, status: s.status })), { text, status: 'pending' as SessionGoalStepStatus }]);
    setNewStep('');
  }, [newStep, steps, pushSteps]);

  const saveText = useCallback(() => {
    if (!activeSessionId || !draft.trim()) return;
    void saveSessionGoal({ agentId, subAgentId: activeSessionId, text: draft.trim() });
    setEditing(false);
  }, [activeSessionId, agentId, draft, saveSessionGoal]);

  if (!activeSessionId) {
    return (
      <div className="flex flex-col gap-1 p-2">
        <span className="px-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('ide.goal.title')}</span>
        <p className="px-1 py-2 text-[12px] leading-relaxed text-gray-500">{t('ide.goal.pickSession')}</p>
      </div>
    );
  }

  // 아직 목표가 없다 = 이 세션이 아직 일을 벌이지 않았다.
  // 사용자가 채워야 하는 빈 폼이 아니라 **기다리는 화면**이다 — 세션이 계획을 세우는 순간 자동으로 뜬다.
  // (그래도 먼저 방향을 주고 싶은 사용자를 위해 직접 적는 입구는 접어서 남겨 둔다.)
  if (!goal) {
    return (
      <div className="flex flex-col gap-2 p-2">
        <span className="px-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('ide.goal.title')}</span>
        <p className="px-1 text-[12px] leading-relaxed text-gray-500">{t('ide.goal.waiting')}</p>
        {editing ? (
          <>
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder={t('ide.goal.textPlaceholder')}
              className="scrollbar-thin w-full resize-none rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-[12px] leading-relaxed text-gray-100 placeholder-gray-600 outline-none focus:border-emerald-500/60"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={saveText}
                disabled={!draft.trim()}
                className="rounded bg-emerald-600 px-2 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('ide.goal.create')}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded border border-gray-600 px-2 py-1 text-[12px] text-gray-300 transition-colors hover:bg-gray-800"
              >
                {t('ide.goal.cancel')}
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => { setDraft(''); setEditing(true); }}
            className="self-start rounded border border-gray-700 px-2 py-1 text-[12px] text-gray-400 transition-colors hover:border-emerald-500/40 hover:text-gray-200"
          >
            {t('ide.goal.setManually')}
          </button>
        )}
      </div>
    );
  }

  // 목표 문장 편집 — 사용자가 세션이 쓴 문장을 손보는 경우(그 순간부터 자동 교체가 멈춘다).
  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 p-2">
        <span className="px-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('ide.goal.title')}</span>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder={t('ide.goal.textPlaceholder')}
          className="scrollbar-thin w-full resize-none rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-[12px] leading-relaxed text-gray-100 placeholder-gray-600 outline-none focus:border-emerald-500/60"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={saveText}
            disabled={!draft.trim()}
            className="rounded bg-emerald-600 px-2 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('ide.goal.update')}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded border border-gray-600 px-2 py-1 text-[12px] text-gray-300 transition-colors hover:bg-gray-800"
          >
            {t('ide.goal.cancel')}
          </button>
        </div>
        <p className="px-1 text-[12px] leading-relaxed text-gray-500">{t('ide.goal.textHint')}</p>
      </div>
    );
  }

  const isActive = goal.status === 'active';

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center justify-between gap-2 px-3 pt-2">
        <span className="min-w-0 truncate text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('ide.goal.title')}</span>
        <span className={`flex-shrink-0 text-[13px] font-bold tabular-nums ${isActive ? 'text-emerald-300' : 'text-gray-400'}`}>
          {goal.percent}%
        </span>
      </div>

      <ScrollFade fill className="min-h-0 flex-1">
        {/* break-words 는 상속되므로 여기 한 번이면 목표문·단계·메모 전부가 폭 안에서 접힌다
            (에이전트가 코드/URL 처럼 공백 없는 긴 토큰을 적어 넣어도 패널 밖으로 안 넘어간다). */}
        <div className="flex min-w-0 flex-col gap-2 overflow-x-hidden break-words p-2">
          {/* 최종 목표 한 문장 — 클릭하면 편집. */}
          <button
            type="button"
            onClick={() => { setDraft(goal.text); setEditing(true); }}
            title={t('ide.goal.editHint')}
            className="w-full min-w-0 overflow-hidden whitespace-pre-wrap break-words rounded border border-gray-700/70 bg-gray-900/60 px-2 py-1.5 text-left text-[12px] leading-relaxed text-gray-200 transition-colors hover:border-emerald-500/40 hover:bg-gray-800/60"
          >
            {goal.text}
          </button>

          {/* 진행 막대 — 체크가 늘면 여기가 찬다. */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700/70">
            <div
              className={`h-full rounded-full transition-all duration-300 ${isActive ? 'bg-emerald-500' : 'bg-gray-500'}`}
              style={{ width: `${goal.percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-1.5 px-0.5 text-[12px] text-gray-500">
            <span className="min-w-0 truncate">{steps.length > 0 ? t('ide.goal.stepCount', { done: doneCount, total: steps.length }) : t('ide.goal.noSteps')}</span>
            <span className={`flex-shrink-0 ${isActive ? 'text-emerald-400/80' : 'text-gray-500'}`}>{t(`ide.goal.status.${goal.status}`)}</span>
          </div>
          {/* 이 목표를 누가 썼는지 — 세션이 쓴 것이면 다음 명령에 자동으로 갈아탄다는 뜻이다. */}
          <span className="px-0.5 text-[12px] text-gray-600">
            {goal.authoredBy === 'user' ? t('ide.goal.byUser') : t('ide.goal.bySession')}
          </span>

          {/* 단계 체크리스트 — todo 와 같은 모양. */}
          {steps.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {steps.map((s) => (
                <li key={s.id} className="group flex items-start gap-1.5 rounded px-1 py-1 hover:bg-gray-800/60">
                  <button
                    type="button"
                    onClick={() => toggleStep(s.id)}
                    aria-label={t('ide.goal.toggleStep')}
                    title={t('ide.goal.toggleStep')}
                    className={`mt-[1px] flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
                      s.status === 'done'
                        ? 'border-emerald-500 bg-emerald-500/80 text-gray-950'
                        : s.status === 'in_progress'
                          ? 'border-amber-400 text-amber-300'
                          : 'border-gray-600 text-transparent hover:border-gray-400'
                    }`}
                  >
                    {s.status === 'done' ? (
                      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : s.status === 'in_progress' ? (
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                    ) : null}
                  </button>
                  <span className={`min-w-0 flex-1 break-words text-[12px] leading-snug ${
                    s.status === 'done' ? 'text-gray-500 line-through' : s.status === 'in_progress' ? 'text-amber-200' : 'text-gray-300'
                  }`}>
                    {s.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeStep(s.id)}
                    aria-label={t('ide.goal.removeStep')}
                    title={t('ide.goal.removeStep')}
                    tabIndex={-1}
                    className="mt-[1px] flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded text-gray-500 opacity-0 transition-[color,opacity] pointer-events-none hover:text-red-400 group-hover:pointer-events-auto group-hover:opacity-100"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* 단계 추가 — 사용자가 직접 적어 넣는 입구. */}
          <input
            value={newStep}
            onChange={(e) => setNewStep(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } }}
            placeholder={t('ide.goal.addStepPlaceholder')}
            className="w-full rounded border border-gray-700/70 bg-gray-900 px-2 py-1 text-[12px] text-gray-100 placeholder-gray-600 outline-none focus:border-emerald-500/60"
          />

          {/* 마지막 진행 메모 — 지금 어디쯤인지 한 줄. */}
          {goal.note && (
            <p className="break-words px-1 text-[12px] leading-relaxed text-gray-400">{goal.note}</p>
          )}

          {/* 진행 기록 — 기본 접힘(좁은 폭을 먹지 않게). */}
          {goal.history.length > 0 && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                className="flex items-center gap-1 px-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-300"
              >
                <svg className={`h-3 w-3 transition-transform ${historyOpen ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
                {t('ide.goal.historyLabel')}
              </button>
              {historyOpen && (
                <ul className="flex flex-col gap-0.5">
                  {[...goal.history].reverse().slice(0, 20).map((h, i) => (
                    <li key={`${h.at}-${i}`} className="flex items-start gap-1.5 px-1 text-[12px]">
                      <span className="w-7 flex-shrink-0 text-right font-bold tabular-nums text-emerald-400/80">{h.percent}%</span>
                      <span className="min-w-0 flex-1 break-words text-gray-400">{h.note ?? t(`ide.goal.source.${h.source}`)}</span>
                      <span className="flex-shrink-0 tabular-nums text-gray-600">{formatTime(h.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 마무리 — 달성/재개/해제. */}
          <div className="flex items-center gap-1.5 border-t border-gray-800 pt-2">
            {isActive ? (
              <button
                type="button"
                onClick={() => { void saveSessionGoal({ agentId, subAgentId: activeSessionId, text: goal.text, status: 'achieved' }); }}
                className="rounded border border-emerald-500/40 px-2 py-1 text-[12px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/10"
              >
                {t('ide.goal.achieve')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { void saveSessionGoal({ agentId, subAgentId: activeSessionId, text: goal.text, status: 'active' }); }}
                className="rounded border border-gray-600 px-2 py-1 text-[12px] font-semibold text-gray-300 transition-colors hover:bg-gray-800"
              >
                {t('ide.goal.resume')}
              </button>
            )}
            <button
              type="button"
              onClick={() => { void endSessionGoal(agentId, activeSessionId); }}
              className="ml-auto rounded border border-red-500/40 px-2 py-1 text-[12px] font-semibold text-red-300 transition-colors hover:bg-red-500/10"
            >
              {t('ide.goal.delete')}
            </button>
          </div>
        </div>
      </ScrollFade>
    </div>
  );
}

// ─── 뷰 라우터 ───

const VIEW_MAP: Record<IDEViewType, React.FC<{ agentId: string }>> = {
  // §5.5 #17-31 — 활동바 첫 항목: 이 프로젝트에서 쓸 수 있는 MCP(글로벌·프로젝트·로컬·프리셋).
  mcp: IDEMcpView,
  // §5.5 #17-32 — 이 세션에 적용되는 Claude Code 훅(글로벌·이 프로젝트·로컬·정책) + 발동 표시.
  hooks: IDEHooksView,
  // §5.5 #17-33 — Claude Code 자신의 플러그인(글로벌·이 프로젝트·다른 프로젝트) + 마켓플레이스.
  //   §5.11 의 우리 관측 플러그인과는 다른 물건이다.
  plugins: IDEPluginsView,
  // §5.5 #17-19 v4.71 — 이름 목록 → VS Code 톤 워크스페이스 탐색기(경로가 보이는 트리).
  files: IDEExplorerView,
  // §5.5 #17-28 v4.96 — 종전 `events`(훅 이벤트 목록) 자리를 컨텍스트 주입원 통제가 잇는다.
  context: IDEContextView,
  skills: SkillsView,
  goal: GoalView,
  // §5.5 #17-11 ⑨ v4.51 — 루프도 목표와 같은 곁눈 자리로. 뷰 본체는 자기 파일에 산다.
  loop: IDELoopView,
  // §5.5 #17-35 — 검증(Verify): `/verify` 를 우리 레시피·판정·이력에 물린 자리. 루프 바로 뒤.
  verify: IDEVerifyView,
  // §5.5 #17-20 v4.74 — 디버그·실행 런처(실행 구성 · MCP 연결 · 외부 디버거 위임).
  debug: IDEDebugView,
  // §5.5 #17-7·#17-8 v4.93 — 북마크·세션 요약도 덮개 패널을 벗고 루프와 같은 곁눈 자리로 왔다.
  bookmarks: IDEBookmarkView,
  summary: IDESessionSummaryView,
  // §5.5 #17-9 ③ v4.95 — 실행 중 서브에이전트도 덮개를 벗고 같은 자리로. 이 에이전트가 백단에
  //   자식을 띄운 동안에만 활동바 항목이 뜨므로, 평소에는 이 뷰로 들어올 입구 자체가 없다.
  subagents: IDERunningSubagentsView,
};

export const IDESidebar = memo(function IDESidebar({ agentId }: IDESidebarProps): React.JSX.Element {
  const activeView = useIDEPaneValue((o) => o.activeView);
  const collapsed = useIDEPaneValue((o) => o.sidebarCollapsed);
  // §4 v3.16 확장 — 자리를 뺏지 않고 **떠서** 뜰지의 판정. 종전에는 뷰포트 미디어 쿼리(`max-md`)
  //   하나였는데, IDE 창은 화면이 아니라 앱 안의 창이라 넓은 화면에서도 창만 좁을 수 있다
  //   (`ideResponsive` — 그 조합에서 종전 규칙은 아무것도 접지 않아 대화가 0px 로 찌부러졌다).
  const { sidebarDrawer } = useIDEBodyLayout();
  const View = VIEW_MAP[activeView];

  if (collapsed) return <></>;

  return (
    // §5.5 #17-28 v4.96 — 주입원 뷰에서만 한 칸 넓어진다(줄마다 토큰·통제 배지·토글이 함께 선다).
    //   서랍일 때는 활동바(48px) 옆에 떠서, 아래 대화의 폭을 건드리지 않는다. 폭 상한은 뷰포트가
    //   아니라 **이 창** 기준이다 — 좁은 창에서 서랍이 오른쪽 끝까지 차면 backdrop 을 눌러 닫을
    //   자리가 사라진다(활동바 3rem + 누를 자리 2rem 을 남긴다).
    <div className={`flex min-h-0 flex-shrink-0 flex-col border-r border-gray-700 ${
      sidebarDrawer
        ? 'absolute inset-y-0 left-12 z-40 w-64 max-w-[calc(100%-5rem)] bg-gray-900 shadow-2xl shadow-black/60'
        : `${activeView === 'context' ? 'w-72' : 'w-52'} bg-gray-900/50`
    }`}>
      <View agentId={agentId} />
    </div>
  );
});

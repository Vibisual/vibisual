/**
 * IDECodexViews.tsx — §5.25 (M) 코덱스 버블 사이드바의 MCP·훅·플러그인·스킬. 코덱스에는 다섯이 다 있어 §5.19 (G)(프로바이더 버블엔 안 띄움)를 적용하지 않는다 — 있는 것을 감추지 않는다.
 * ① 클로드 목록을 빌리지 않는다(코덱스 실물 `codex mcp`·`codex plugin`·`~/.codex/skills`·`~/.codex/hooks.json`·`AGENTS.md`)
 * ② 설치·켜고 끄기는 코덱스 소유(우리 훅 스위치는 옵션창에만) ③ `null`(못 읽음)과 빈 배열(없음)을 다르게 그린다.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodexInventory, CodexSkillEntry } from '@vibisual/shared';

import { useGraphStore, agentSessionInputKey } from '../../stores/graphStore.js';
import { useAvailableSkills, persistSkillFavorites } from '../../hooks/useAvailableSkills.js';
import { useIDEPaneValue } from './idePane.js';
import { ScrollFade } from '../ScrollFade.js';
import { autosizeInput } from './inputAutosize.js';
import { IDESkillSharingSection } from './IDESkillSharingSection.js';
import { useSkillSharing } from './useSkillSharing.js';
import { IDESkillProviderTabs, skillSharingCount, useSkillProviderTab } from './IDESkillProviderTabs.js';
import {
  codexFavoriteNames, codexSkillInsertText, codexSkillSourceOf, groupCodexSkills, toggleCodexFavorite,
} from './codexSkillList.js';

/** 켜짐/꺼짐 점 — MCP 서버·플러그인이 공유한다. */
const DOT_ON = 'bg-emerald-400';
const DOT_OFF = 'bg-gray-600';

/**
 * 네 칸이 같은 인벤토리 한 벌을 본다. 아직 안 읽었으면 **여기서 한 번 읽어 온다** —
 * 사용자가 칸을 여는 순간이 곧 "지금 무엇이 붙어 있나"를 묻는 순간이라, 그때가 읽을 때다.
 */
function useCodexInventory(): { inventory: CodexInventory | null; agentId: string | null } {
  const agentId = useIDEPaneValue((o) => o.agentId);
  const inventory = useGraphStore((s) => s.codexInventory);
  const refresh = useGraphStore((s) => s.refreshCodexInventory);
  useEffect(() => {
    if (inventory === null) refresh(agentId ?? undefined);
    // 한 번만 — 목록이 비어 있는 것은 정상 상태이므로 빈 배열을 보고 다시 부르지 않는다.
  }, [inventory, agentId, refresh]);
  return { inventory, agentId: agentId ?? null };
}

/** 네 칸이 공유하는 껍데기 — 제목 · [다시 읽기] · 스크롤 · 빈/미독 안내. */
function CodexPane({
  titleKey, count, inventory, agentId, emptyKey, children, toolbar, content, onReload, countInTitle = true, error,
}: {
  titleKey: string;
  count: number | null;
  inventory: CodexInventory | null;
  agentId: string | null;
  emptyKey: string;
  children: React.ReactNode;
  /** 이 갈래를 못 읽은 사유(`inventory.errors.*`). 있으면 빈 목록 안내 대신 이것을 적는다. */
  error?: string | undefined;
  /** 머리줄 아래 스크롤되지 않는 줄(스킬 칸의 엔진 탭·검색). */
  toolbar?: React.ReactNode;
  /** 있으면 인벤토리 목록 대신 이것을 그린다 — 공유 탭은 코덱스 인벤토리를 읽기 전에도 선다. */
  content?: React.ReactNode;
  /** [다시 읽기]가 인벤토리가 아닌 다른 목록을 보고 있을 때(공유 탭). */
  onReload?: () => void;
  /** 개수를 탭이 적는 칸에서는 제목 옆에 다시 적지 않는다. */
  countInTitle?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const refresh = useGraphStore((s) => s.refreshCodexInventory);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-gray-800 px-2 py-1.5">
        <span className="truncate text-[12px] font-semibold text-gray-300">
          {t(titleKey)}
          {countInTitle && count !== null && count > 0 && <span className="ml-1 font-normal text-gray-500">{count}</span>}
        </span>
        <button
          type="button"
          onClick={() => { if (onReload) onReload(); else refresh(agentId ?? undefined); }}
          className="app-nodrag flex-shrink-0 rounded px-1.5 py-0.5 text-[12px] text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100"
          title={t('ide.codex.reload')}
        >
          {t('ide.codex.reload')}
        </button>
      </div>
      {toolbar}
      {/* `fill` 이 있어야 래퍼가 flex 컨테이너로 서서 안쪽 스크롤 칸이 남은 높이를 받는다 —
          없으면 `scroll-fade relative` 로 서고 내용이 길어질 때 스크롤이 아니라 잘린다(§5.10 (N) (g)). */}
      <ScrollFade fill className="min-h-0 flex-1">
        {content ?? (inventory === null ? (
          /* 아직 못 읽었다 — 비어 있다와 다른 말이다. */
          <p className="px-2 py-3 text-[12px] text-gray-500">{t('ide.codex.loading')}</p>
        ) : (
          <>
            {/* 사유 줄은 빈 목록 판정보다 먼저 — 서버는 못 읽은 갈래를 "빈 목록 + 사유"로 보낸다(안에 두면 "없습니다"에 가린다). */}
            <CodexReadError reason={error} />
            {count === 0
              ? (error ? null : <p className="px-2 py-3 text-[12px] text-gray-500">{t(emptyKey)}</p>)
              : children}
          </>
        ))}
      </ScrollFade>
    </div>
  );
}

/** 한 갈래를 못 읽었을 때 그 칸 머리에 서는 줄. 사유는 서버가 준 그대로 적는다. */
function CodexReadError({ reason }: { reason: string | undefined }): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!reason) return null;
  return (
    <p className="border-b border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[12px] text-amber-300">
      {t('ide.codex.readFailed', { reason })}
    </p>
  );
}

/** MCP — `codex mcp list --json`. 켜고 끄기 ❌ — 그쪽 `config.toml` 은 고치지 않는다(§5.25 안전선). */
export const IDECodexMcpView = memo(function IDECodexMcpView(): React.JSX.Element {
  const { t } = useTranslation();
  const { inventory, agentId } = useCodexInventory();
  const servers = inventory?.mcpServers ?? [];
  return (
    <CodexPane
      titleKey="ide.codex.mcp.title" count={inventory ? servers.length : null}
      inventory={inventory} agentId={agentId} emptyKey="ide.codex.mcp.empty" error={inventory?.errors?.mcp}
    >
      <ul>
        {servers.map((s) => (
          <li key={s.name} className="border-b border-gray-800/60 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${s.enabled ? DOT_ON : DOT_OFF}`} />
              <span className="truncate text-[12px] font-medium text-gray-200">{s.name}</span>
              <span className="ml-auto flex-shrink-0 rounded bg-gray-700/50 px-1 text-[12px] text-gray-400">
                {s.transport}
              </span>
            </div>
            {s.target && (
              <p className="mt-0.5 truncate text-[12px] text-gray-500" title={s.target}>{s.target}</p>
            )}
            {/* 꺼진 사유는 코덱스가 준 그대로 — 우리가 해석해 다시 쓰지 않는다. */}
            {!s.enabled && s.disabledReason && (
              <p className="mt-0.5 text-[12px] text-amber-400/80">{s.disabledReason}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="px-2 py-2 text-[12px] text-gray-600">{t('ide.codex.mcp.readOnly')}</p>
    </CodexPane>
  );
});

/**
 * 스킬 — 코덱스는 폴더가 곧 스킬. §5.25 (M-1) 홈만 읽으면 대부분 빠진다(실측 2026-09-08 · `codex-cli 0.152.1`: 15개 중 홈 3 · 기본 5 · 플러그인 7).
 * 클로드 칸과 같은 조작(클릭 `$이름 ` 삽입·별·검색), 없는 권한(삭제·복사·순서·횟수) ❌. 첫째·기본 탭은 늘 Codex 스킬(`IDESkillProviderTabs`).
 */
export const IDECodexSkillsView = memo(function IDECodexSkillsView(): React.JSX.Element {
  const { t } = useTranslation();
  const { inventory, agentId } = useCodexInventory();
  const skills = useMemo(() => inventory?.skills ?? [], [inventory]);

  const [query, setQuery] = useState('');
  // 즐겨찾기는 클로드와 **같은 저장고**를 접두로 나눠 쓴다(새 영속 필드 ❌ — 기존 인프라 재사용).
  const { favorites } = useAvailableSkills(null, agentId);
  const favoriteNames = useMemo(() => codexFavoriteNames(favorites), [favorites]);
  const groups = useMemo(
    () => groupCodexSkills(skills, favoriteNames, query),
    [skills, favoriteNames, query],
  );
  const favoriteSet = useMemo(() => new Set(favoriteNames), [favoriteNames]);

  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const setAgentSessionInputText = useGraphStore((s) => s.setAgentSessionInputText);
  const executionMode = useGraphStore((s) => (agentId ? s.agentConfigs[agentId]?.executionMode : undefined));
  const refreshInventory = useGraphStore((s) => s.refreshCodexInventory);
  const refreshSharedSkills = useCallback(() => refreshInventory(agentId ?? undefined), [agentId, refreshInventory]);

  /**
   * 클릭 = 입력창에 `$이름 ` 넣기. **클로드 칸(`IDESidebar.insertSkill`)과 같은 입력 규약**이다 —
   * CMD(터미널) 에이전트면 draft store 가 아니라 PTY stdin 으로 직접 타이핑하고, 줄바꿈은 보내지
   * 않는다(보낼지는 사용자가 Enter 로 정한다).
   */
  const insertSkill = useCallback((name: string) => {
    if (!agentId) return;
    const insert = codexSkillInsertText(name);
    if (executionMode === 'interactive-terminal' && window.api?.terminal) {
      const termId = `term:${agentId}:${activeSessionId ?? 'main'}`;
      void window.api.terminal.write(termId, insert);
      return;
    }
    const key = agentSessionInputKey(agentId, activeSessionId);
    const existing = useGraphStore.getState().agentSessionInputs[key]?.text ?? '';
    const next = existing.length > 0 ? `${insert}\n${existing}` : insert;
    setAgentSessionInputText(agentId, activeSessionId, next);
    requestAnimationFrame(() => {
      const sessionAttr = activeSessionId ?? '';
      const ta = document.querySelector<HTMLTextAreaElement>(
        `textarea[data-ide-input="${agentId}"][data-ide-input-session="${sessionAttr}"]`,
      );
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      // ⚠ 인라인 height 직접 조작 금지 — 공용 autosizeInput 경유(클로드 칸과 같은 이유).
      autosizeInput(ta);
    });
  }, [agentId, activeSessionId, setAgentSessionInputText, executionMode]);

  // §5.25 (M-1) — 탭 하나에 목록 하나. 코덱스 에이전트의 칸이라 Codex 탭이 첫째·기본이고,
  // 에이전트를 바꾸면 다시 Codex 탭으로 돌아온다. 공유 목록은 탭 개수를 적으려고 여기서 쥔다.
  const [skillTab, setSkillTab] = useSkillProviderTab('codex', agentId ?? '');
  const sharing = useSkillSharing({
    agentId, activeSessionId, provider: 'codex', onUse: insertSkill, onShared: refreshSharedSkills,
  });
  const onSharingTab = skillTab !== 'codex';

  const toggleFavorite = useCallback((name: string) => {
    void persistSkillFavorites(toggleCodexFavorite(favorites, name));
  }, [favorites]);

  const renderSkill = useCallback((s: CodexSkillEntry): React.JSX.Element => {
    const source = codexSkillSourceOf(s);
    // 출처마다 다른 색 — 클로드 칸이 project/global/plugin 을 색으로 가르는 것과 같은 자리.
    const accent = source === 'user' ? 'text-emerald-400'
      : source === 'system' ? 'text-sky-400'
        : 'text-purple-400';
    const isFav = favoriteSet.has(s.name);
    return (
      <li
        key={s.path}
        onClick={() => { insertSkill(s.name); }}
        title={s.description ?? s.path}
        className="group cursor-pointer rounded px-2 py-1.5 transition-colors hover:bg-gray-700/60"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`min-w-0 truncate font-mono text-[12px] font-semibold ${accent}`}>
            ${s.name}
          </span>
          {source === 'plugin' && s.pluginName && (
            <span className="flex-shrink-0 rounded bg-purple-500/15 px-1 py-0.5 text-[12px] uppercase tracking-wide text-purple-400/80">
              {s.pluginName}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleFavorite(s.name); }}
            title={isFav ? t('ide.sidebar.favoriteRemove') : t('ide.sidebar.favoriteAdd')}
            aria-label={isFav ? t('ide.sidebar.favoriteRemove') : t('ide.sidebar.favoriteAdd')}
            // 터치에는 hover 가 없다 — 즐겨찾지 않은 별도 늘 보이고 손가락 크기로 선다.
            className={`app-nodrag ml-auto flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-opacity hover:bg-amber-500/20 pointer-coarse:h-8 pointer-coarse:w-8 ${isFav ? 'text-amber-400 opacity-100' : 'text-gray-500 opacity-0 hover:text-amber-300 group-hover:opacity-100 pointer-coarse:opacity-100'}`}
          >
            <svg viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
              <path d="M12 2.5l2.95 5.98 6.6.96-4.77 4.65 1.13 6.57L12 17.52 6.09 20.63l1.13-6.57L2.45 9.44l6.6-.96L12 2.5z" />
            </svg>
          </button>
        </div>
        {/* 설명이 없으면 줄 자체가 없다 — 지어낸 한 줄을 붙이지 않는다. */}
        {s.description && (
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-tight text-gray-500">{s.description}</p>
        )}
      </li>
    );
  }, [favoriteSet, insertSkill, toggleFavorite, t]);

  const section = (
    labelKey: string, tone: string, list: CodexSkillEntry[],
  ): React.JSX.Element | null => {
    if (list.length === 0) return null;
    return (
      <div className="flex flex-col gap-1">
        <span className={`px-1 text-[12px] font-medium uppercase tracking-wider ${tone}`}>
          {t(labelKey, { count: list.length })}
        </span>
        <ul className="flex flex-col gap-0.5">{list.map(renderSkill)}</ul>
      </div>
    );
  };

  return (
    <CodexPane
      titleKey="ide.codex.skills.title" count={inventory ? groups.total : null} countInTitle={false}
      inventory={inventory} agentId={agentId} emptyKey="ide.codex.skills.empty" error={inventory?.errors?.skills}
      onReload={onSharingTab ? sharing.refresh : undefined}
      toolbar={(
        <div className="flex flex-shrink-0 flex-col gap-1.5 px-2 pb-1 pt-1.5">
          {/* 못 읽었으면 개수를 모른다 — 서버는 그때 빈 목록을 보내므로 그대로 적으면 "Codex 0" 이 된다(③). */}
          <IDESkillProviderTabs
            own="codex" active={skillTab} onChange={setSkillTab}
            counts={{ codex: inventory && !inventory.errors?.skills ? groups.total : null, claude: skillSharingCount(sharing) }}
          />
          {/* 검색 — 15개가 넘어가면 눈으로 훑는 것이 목록을 읽는 가장 느린 방법이 된다.
              스크롤 밖에 서서 목록을 내려도 남고, 보고 있는 탭의 목록에 걸린다. */}
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            placeholder={t('ide.codex.skills.searchPlaceholder')}
            className="app-nodrag w-full rounded border border-gray-700 bg-gray-800/60 px-1.5 py-1 text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-gray-500 focus:outline-none"
          />
        </div>
      )}
      content={onSharingTab
        ? <IDESkillSharingSection sharing={sharing} provider="codex" agentId={agentId} query={query} />
        : undefined}
    >
      {/* 걸러 낸 결과가 0이면 "이 기계엔 없다"가 아니라 "이 검색어에 없다"를 말해야 한다. */}
      {groups.shown === 0 ? (
        <p className="px-2 py-3 text-[12px] text-gray-500">{t('ide.codex.skills.noMatch', { query })}</p>
      ) : (
        <div className="flex flex-col gap-2 px-1 pb-2">
          {section('ide.codex.skills.favorites', 'text-amber-400/70', groups.favorites)}
          {section('ide.codex.skills.groupUser', 'text-emerald-400/60', groups.user)}
          {section('ide.codex.skills.groupSystem', 'text-sky-400/60', groups.system)}
          {section('ide.codex.skills.groupPlugin', 'text-purple-400/60', groups.plugin)}
        </div>
      )}
      <p className="px-2 pb-2 text-[12px] text-gray-600">{t('ide.codex.skills.hint')}</p>
    </CodexPane>
  );
});

/** 플러그인 — `codex plugin list --json`. 깔린 것이 앞, 장터에만 있는 것이 뒤. */
export const IDECodexPluginsView = memo(function IDECodexPluginsView(): React.JSX.Element {
  const { t } = useTranslation();
  const { inventory, agentId } = useCodexInventory();
  const plugins = inventory?.plugins ?? [];
  const installedCount = useMemo(() => plugins.filter((p) => p.installed).length, [plugins]);
  return (
    <CodexPane
      titleKey="ide.codex.plugins.title" count={inventory ? plugins.length : null}
      inventory={inventory} agentId={agentId} emptyKey="ide.codex.plugins.empty" error={inventory?.errors?.plugins}
    >
      <p className="px-2 py-1 text-[12px] text-gray-500">
        {t('ide.codex.plugins.installedCount', { count: installedCount })}
      </p>
      <ul>
        {plugins.map((p) => (
          <li key={`${p.marketplace ?? ''}/${p.name}`} className="border-b border-gray-800/60 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${p.installed && p.enabled ? DOT_ON : DOT_OFF}`} />
              <span className={`truncate text-[12px] ${p.installed ? 'font-medium text-gray-200' : 'text-gray-500'}`}>
                {p.name}
              </span>
              {p.version && <span className="ml-auto flex-shrink-0 text-[12px] text-gray-600">{p.version}</span>}
            </div>
            <p className="mt-0.5 text-[12px] text-gray-500">
              {/* 깔림·켜짐은 다른 사실이다 — "깔렸지만 꺼둠"이 실제로 있다. */}
              {p.installed
                ? (p.enabled ? t('ide.codex.plugins.enabled') : t('ide.codex.plugins.disabled'))
                : t('ide.codex.plugins.notInstalled')}
              {p.marketplace && <span className="text-gray-600"> · {p.marketplace}</span>}
            </p>
          </li>
        ))}
      </ul>
    </CodexPane>
  );
});

/** 훅 — `~/.codex/hooks.json`. **남의 훅도 그대로 보여 준다**(우리 것만 그리면 사라진 줄 안다). */
export const IDECodexHooksView = memo(function IDECodexHooksView(): React.JSX.Element {
  const { t } = useTranslation();
  const { inventory, agentId } = useCodexInventory();
  const hooks = inventory?.hooks ?? [];
  return (
    <CodexPane
      titleKey="ide.codex.hooks.title" count={inventory ? hooks.length : null}
      inventory={inventory} agentId={agentId} emptyKey="ide.codex.hooks.empty"
    >
      <ul>
        {hooks.map((h, i) => (
          <li key={`${h.event}-${String(i)}`} className="border-b border-gray-800/60 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12px] font-medium text-gray-200">{h.event}</span>
              {h.ours && (
                <span className="ml-auto flex-shrink-0 rounded bg-sky-500/15 px-1 text-[12px] text-sky-300">
                  {t('ide.codex.hooks.ours')}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-gray-500" title={h.command}>{h.command}</p>
          </li>
        ))}
      </ul>
      {/* 옵션창 이름을 여기 박아 두면 로케일마다 어긋난다 — 화면에 실제로 뜨는 라벨을 그대로 받아 적는다. */}
      <p className="px-2 py-2 text-[12px] text-gray-600">
        {t('ide.codex.hooks.switchHint', {
          options: t('panel.options.title', { defaultValue: 'Options' }),
          engines: t('panel.options.engines.title', { defaultValue: 'Engines' }),
        })}
      </p>
    </CodexPane>
  );
});

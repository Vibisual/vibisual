/**
 * IDECodexViews.tsx — §5.25 (M): 코덱스 버블의 좌측 사이드바 다섯 칸.
 *
 * 이 파일이 생긴 이유는 §5.19 (G) 를 코덱스에 그대로 적용한 것이 틀렸기 때문이다. 그 규칙은
 * "클로드 CLI 에 매인 항목은 프로바이더 버블 IDE 에 뜨지 않는다"였고 근거는 **없는 기능의
 * 입구는 거짓말**이라는 것이었다. 로컬 모델에는 정말 없어 맞는 규칙이지만 **코덱스에는 다섯이
 * 전부 있다** — 그대로 감추면 사용자가 자기 코덱스에 깔아 둔 MCP·스킬·플러그인을 우리 창에서
 * 못 본다. 없는 것을 그리지 않는 규율과 **있는 것을 감추지 않는 규율은 같은 원칙의 양면**이다.
 *
 * 다섯 칸이 함께 지키는 것:
 *   ① **클로드 목록을 빌려 쓰지 않는다** — 전부 코덱스 쪽 실물(`codex mcp` · `codex plugin` ·
 *      `~/.codex/skills` · `~/.codex/hooks.json` · `AGENTS.md`)에서 읽은 값이다. 빌려 쓰면
 *      이 대화에 실리지도 않는 것이 뜬다.
 *   ② **읽기 전용이다** — 설치·제거·켜고 끄기는 코덱스가 할 일이라 손잡이를 만들지 않는다.
 *      우리 훅만 예외이고 그 스위치는 이미 옵션창 엔진 칸에 있다(같은 버튼을 두 곳에 두지 않는다).
 *   ③ **아직 못 읽은 것과 비어 있는 것을 구분한다** — `null` 이면 "읽어 보자", 빈 배열이면
 *      "이 기계엔 없다". 둘을 같은 화면으로 그리면 사용자는 고장과 정상을 구별할 수 없다.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodexInventory, CodexSkillEntry } from '@vibisual/shared';

import { useGraphStore, agentSessionInputKey } from '../../stores/graphStore.js';
import { useAvailableSkills, persistSkillFavorites } from '../../hooks/useAvailableSkills.js';
import { useIDEPaneValue } from './idePane.js';
import { ScrollFade } from '../ScrollFade.js';
import { autosizeInput } from './inputAutosize.js';
import {
  codexFavoriteNames, codexSkillInsertText, codexSkillSourceOf, groupCodexSkills, toggleCodexFavorite,
} from './codexSkillList.js';

/** 켜짐/꺼짐 점 — MCP 서버·플러그인이 공유한다. */
const DOT_ON = 'bg-emerald-400';
const DOT_OFF = 'bg-gray-600';

/**
 * 다섯 칸이 같은 인벤토리 한 벌을 본다. 아직 안 읽었으면 **여기서 한 번 읽어 온다** —
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

/** 다섯 칸이 공유하는 껍데기 — 제목 · [다시 읽기] · 스크롤 · 빈/미독 안내. */
function CodexPane({
  titleKey, count, inventory, agentId, emptyKey, children,
}: {
  titleKey: string;
  count: number | null;
  inventory: CodexInventory | null;
  agentId: string | null;
  emptyKey: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  const refresh = useGraphStore((s) => s.refreshCodexInventory);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-gray-800 px-2 py-1.5">
        <span className="truncate text-[12px] font-semibold text-gray-300">
          {t(titleKey)}
          {count !== null && count > 0 && <span className="ml-1 font-normal text-gray-500">{count}</span>}
        </span>
        <button
          type="button"
          onClick={() => { refresh(agentId ?? undefined); }}
          className="app-nodrag flex-shrink-0 rounded px-1.5 py-0.5 text-[12px] text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100"
          title={t('ide.codex.reload')}
        >
          {t('ide.codex.reload')}
        </button>
      </div>
      {/* `fill` 이 있어야 래퍼가 flex 컨테이너로 서서 안쪽 스크롤 칸이 남은 높이를 받는다 —
          없으면 `scroll-fade relative` 로 서고 내용이 길어질 때 스크롤이 아니라 잘린다(§5.10 (N) (g)). */}
      <ScrollFade fill className="min-h-0 flex-1">
        {inventory === null ? (
          /* 아직 못 읽었다 — 비어 있다와 다른 말이다. */
          <p className="px-2 py-3 text-[12px] text-gray-500">{t('ide.codex.loading')}</p>
        ) : count === 0 ? (
          <p className="px-2 py-3 text-[12px] text-gray-500">{t(emptyKey)}</p>
        ) : (
          children
        )}
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

/**
 * MCP — `codex mcp list --json`.
 *
 * 클로드 쪽 화면과 달리 **켜고 끄는 손잡이가 없다.** 코덱스의 MCP 는 그쪽 `config.toml` 이
 * 소유하고 우리는 그 파일을 고치지 않기로 했다(§5.25 안전선) — 없는 손잡이를 그리느니 읽기만 한다.
 */
export const IDECodexMcpView = memo(function IDECodexMcpView(): React.JSX.Element {
  const { t } = useTranslation();
  const { inventory, agentId } = useCodexInventory();
  const servers = inventory?.mcpServers ?? [];
  return (
    <CodexPane
      titleKey="ide.codex.mcp.title" count={inventory ? servers.length : null}
      inventory={inventory} agentId={agentId} emptyKey="ide.codex.mcp.empty"
    >
      <CodexReadError reason={inventory?.errors?.mcp} />
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
 * 스킬 — 코덱스의 스킬 칸. 코덱스는 **폴더가 곧 스킬**이다.
 *
 * §5.25 (M-1) — 이 칸은 한 번 다시 지어졌다. 종전에는 홈(`~/.codex/skills`) 하나만 읽는
 * **읽기 전용 정적 목록**이라 두 가지가 동시에 잘못돼 있었다:
 *   ① **대부분이 안 보였다** — 실측(2026-09-08 · `codex-cli 0.152.1`)에서 코덱스가 실제로 이
 *      대화에 싣는 스킬은 15개인데 화면에는 3개만 떴다(코덱스 기본 5 · 플러그인 7이 통째로 없었다).
 *   ② **쓸 수가 없었다** — 클로드 칸에는 클릭 삽입·즐겨찾기·검색이 있는데 여기엔 하나도 없어,
 *      스킬 이름을 눈으로 읽고 입력창에 손으로 옮겨 적어야 했다.
 *
 * 그래서 **클로드 칸과 같은 조작**을 준다(클릭하면 `/이름 ` 이 입력창에 들어가고, 별을 켜면 위로
 * 오고, 검색이 걸린다). 다만 **없는 권한의 손잡이는 만들지 않는다** — 삭제·복사·순서 끌기·사용
 * 횟수는 코덱스 몫이거나 우리가 모르는 값이라 그대로 뺐다(사유는 `codexSkillList.ts` 머리말).
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

  /**
   * 클릭 = 입력창에 `/이름 ` 넣기. **클로드 칸(`IDESidebar.insertSkill`)과 같은 규약**이다 —
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
            /{s.name}
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
            className={`app-nodrag ml-auto flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-opacity hover:bg-amber-500/20 ${isFav ? 'text-amber-400 opacity-100' : 'text-gray-500 opacity-0 hover:text-amber-300 group-hover:opacity-100'}`}
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
      titleKey="ide.codex.skills.title" count={inventory ? groups.total : null}
      inventory={inventory} agentId={agentId} emptyKey="ide.codex.skills.empty"
    >
      <CodexReadError reason={inventory?.errors?.skills} />
      {/* 검색 — 15개가 넘어가면 눈으로 훑는 것이 목록을 읽는 가장 느린 방법이 된다. */}
      <div className="px-2 pb-1 pt-1.5">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); }}
          placeholder={t('ide.codex.skills.searchPlaceholder')}
          className="app-nodrag w-full rounded border border-gray-700 bg-gray-800/60 px-1.5 py-1 text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-gray-500 focus:outline-none"
        />
      </div>
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
      inventory={inventory} agentId={agentId} emptyKey="ide.codex.plugins.empty"
    >
      <CodexReadError reason={inventory?.errors?.plugins} />
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

/**
 * 컨텍스트 — 코덱스의 `AGENTS.md`(클로드의 `CLAUDE.md` 자리). 홈과 이 프로젝트 두 곳.
 *
 * 클로드 쪽 주입원 목록처럼 **끄고 켜지 않는다** — 코덱스가 무엇을 싣는지는 그쪽 CLI 가 정하고,
 * 우리가 그 결정을 대신 뒤집을 문이 없다. 여기서 할 수 있는 정직한 말은 "무엇이 실려 있나"다.
 */
export const IDECodexContextView = memo(function IDECodexContextView(): React.JSX.Element {
  const { t } = useTranslation();
  const { inventory, agentId } = useCodexInventory();
  const docs = inventory?.agentsDocs ?? [];
  return (
    <CodexPane
      titleKey="ide.codex.context.title" count={inventory ? docs.length : null}
      inventory={inventory} agentId={agentId} emptyKey="ide.codex.context.empty"
    >
      <ul>
        {docs.map((d) => (
          <li key={d.path} className="border-b border-gray-800/60 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${d.exists ? DOT_ON : DOT_OFF}`} />
              <span className="truncate text-[12px] font-medium text-gray-200">
                {t(d.scope === 'home' ? 'ide.codex.context.scopeHome' : 'ide.codex.context.scopeProject')}
              </span>
              {d.exists && d.lines !== undefined && (
                <span className="ml-auto flex-shrink-0 text-[12px] text-gray-600">
                  {t('ide.codex.context.lines', { count: d.lines })}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-gray-500" title={d.path}>{d.path}</p>
            {/* 없다는 것도 정보다 — 자리를 지우면 "이 프로젝트엔 규칙이 없다"를 말할 수 없다. */}
            {!d.exists && <p className="mt-0.5 text-[12px] text-gray-600">{t('ide.codex.context.missing')}</p>}
          </li>
        ))}
      </ul>
      <p className="px-2 py-2 text-[12px] text-gray-600">{t('ide.codex.context.readOnly')}</p>
    </CodexPane>
  );
});

/**
 * IDEPluginsView.tsx — §5.5 #17-33: Claude Code 자신의 플러그인을 보고, 켜고, 마켓에서 가져온다.
 *
 * **우리 관측 플러그인(§5.11 `packages/plugins`)과 다른 물건이다.** 그쪽은 Vibisual 이 만든
 * 것이고 여기는 명령·에이전트·스킬·훅·MCP 를 한 묶음으로 배포하는 Claude Code 의 그 단위다.
 *
 * 화면이 지키는 것 넷:
 *   ① **어디에 매여 있는지 말한다** — 글로벌 / 이 프로젝트 / **다른 프로젝트**를 갈라 세운다.
 *      다른 프로젝트 것을 숨기면 "깔았는데 왜 없지" 가 되고, 섞으면 "왜 안 먹지" 가 된다.
 *   ② **켜짐과 깔림은 다르다** — 깔려 있어도 꺼져 있으면 아무 일도 안 한다(실측 7개가 전부 꺼져 있었다).
 *   ③ **마켓이 같은 창에 있다** — 없는 것을 찾으러 터미널로 나가지 않는다.
 *   ④ **바꾸는 일은 전부 CLI 에 위임한다** — 우리가 설치 상태 파일을 흉내 내면 CLI 와 두 갈래로 갈린다.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ClaudeMarketPlugin,
  ClaudeMarketplaceKind,
  ClaudePluginEntry,
  ClaudePluginInventory,
  ClaudePluginPlacement,
  ClaudePluginRefreshState,
  ClaudePluginScope,
} from '@vibisual/shared';
import { suggestedMarketplaces } from '@vibisual/shared';

import { formatSince } from '../../formatSince.js';

import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import { useIDEPaneValue } from './idePane.js';
import { ScrollFade } from '../ScrollFade.js';

import { useIDEProjectRoot } from './useIDEProjectRoot.js';

/** 묶음 순서 — 이 세션에 오는 것부터, 남의 프로젝트 것은 맨 뒤. */
const PLACEMENT_ORDER: ClaudePluginPlacement[] = ['global', 'this-project', 'other-project'];

/** 자리 칩 색 — #17-31·#17-32 의 출처 칩과 같은 규약. */
const PLACEMENT_TONE: Record<ClaudePluginPlacement, string> = {
  global: 'bg-sky-500/15 text-sky-300',
  'this-project': 'bg-emerald-500/15 text-emerald-300',
  'other-project': 'bg-gray-600/30 text-gray-400',
};

/** 마켓 목록에서 한 번에 그리는 수 — 277개를 통째로 그리면 사이드바가 굳는다. */
const MARKET_PAGE = 40;

/**
 * 갈래 칩 색(#17-42 ⑤) — 자리 칩과 같은 규약. `custom` 은 **칩을 달지 않는다**:
 * 사용자가 직접 붙인 곳은 아무도 보증하지 않으므로, 없는 보증을 색으로 주지 않는다.
 */
const MARKET_KIND_TONE: Record<Exclude<ClaudeMarketplaceKind, 'custom'>, string> = {
  official: 'bg-indigo-500/15 text-indigo-300',
  community: 'bg-amber-500/15 text-amber-300',
};

/** 마켓 필터에서 "전체" 를 뜻하는 값 — 빈 문자열은 CLI 가 주는 이름일 수 있어 쓰지 않는다. */
const ALL_MARKETS = null;

function RefreshIcon({ spinning }: { spinning: boolean }): React.JSX.Element {
  return (
    <svg
      className={`h-3.5 w-3.5 ${spinning ? 'animate-spin' : ''}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export const IDEPluginsView = memo(function IDEPluginsView({ agentId: _agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const rootPath = useIDEProjectRoot();
  const projectId = useIDEPaneValue((o) => o.projectId);

  const [inventory, setInventory] = useState<ClaudePluginInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'installed' | 'market'>('installed');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(MARKET_PAGE);
  /** 설치·추가가 어느 범위로 갈지 — 사용자가 고르게 둔다(기본은 CLI 와 같은 `user`). */
  const [installScope, setInstallScope] = useState<ClaudePluginScope>('user');
  const [marketSource, setMarketSource] = useState('');
  /**
   * 고른 마켓(#17-42 ①②) — `null` 이면 전체. 마켓이 하나뿐일 때는 이 값이 늘 `null` 이라
   * 예전 화면과 똑같이 보인다(붙이지 않은 사용자에게 없던 단계가 생기지 않는다).
   */
  const [marketFilter, setMarketFilter] = useState<string | null>(ALL_MARKETS);
  /**
   * §5.5 #17-33 ⑦ — 자동 갱신 설정. 서버 `AppState`(머신 단위)가 진실이고 여기서는 비추기만 한다.
   * `null` 이면 아직 못 읽은 상태 — 그때는 토글을 그리지 않는다(기본값을 화면이 지어내면
   * 사용자가 꺼 둔 것이 켜진 것처럼 보인다).
   */
  const [refresh, setRefresh] = useState<ClaudePluginRefreshState | null>(null);

  /** 목록 조회 — 서버가 매번 CLI 에 다시 묻는다. 이 호출 하나가 곧 새로고침이다. */
  const load = useCallback(() => {
    if (!rootPath) {
      setInventory(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/claude-plugins?root=${encodeURIComponent(rootPath)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: ClaudePluginInventory) => setInventory(data))
      .catch(() => {
        setInventory(null);
        setError(t('ide.plugins.loadFailed'));
      })
      .finally(() => setLoading(false));
  }, [rootPath, t]);

  useEffect(() => { load(); }, [load, projectId]);

  /** 자동 갱신 설정 읽기 — 머신 단위라 프로젝트가 바뀌어도 다시 물을 필요가 없다. */
  useEffect(() => {
    let cancelled = false;
    fetch('/api/claude-plugin-refresh')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ClaudePluginRefreshState) => { if (!cancelled) setRefresh(d); })
      .catch(() => { /* 설정을 못 읽어도 목록은 그대로 쓴다 — 토글만 안 그린다 */ });
    return () => { cancelled = true; };
  }, []);

  /** 자동 갱신 토글 — 서버가 정규화한 값을 그대로 되받아 화면에 싣는다(클라가 지어내지 않는다). */
  const setAuto = useCallback((patch: { market?: boolean; plugins?: boolean }) => {
    fetch('/api/claude-plugin-refresh', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ClaudePluginRefreshState) => setRefresh(d))
      .catch(() => setError(t('ide.plugins.actionFailed')));
  }, [t]);
  // 검색어·고른 마켓이 바뀌면 다시 처음부터 — 안 그러면 이전 페이지 수만큼만 걸러 보인다.
  useEffect(() => { setShown(MARKET_PAGE); }, [query, tab, marketFilter]);

  /**
   * 고른 마켓이 사라지면 선택을 푼다(#17-42 ②).
   * 그 마켓을 제거했는데 필터만 남으면 화면이 영영 비어 "플러그인이 없다" 고 거짓말한다.
   */
  useEffect(() => {
    if (marketFilter === ALL_MARKETS || !inventory) return;
    if (!inventory.marketplaces.some((m) => m.name === marketFilter)) setMarketFilter(ALL_MARKETS);
  }, [inventory, marketFilter]);

  /**
   * 바꾸는 일 — 다섯 동작이 전부 CLI 위임이라 창구도 하나다(④).
   * 설치는 git clone 을 타 몇십 초가 걸릴 수 있으므로 그동안 그 줄만 잠근다.
   */
  const act = useCallback(
    (busyKey: string, body: Record<string, unknown>) => {
      if (!rootPath) return;
      setBusyId(busyKey);
      setError(null);
      fetch('/api/claude-plugins/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: rootPath, ...body }),
      })
        .then(async (r) => {
          const data = (await r.json()) as { error?: string; inventory?: ClaudePluginInventory };
          // 실패해도 서버가 최신 목록을 함께 주므로 화면은 늘 지금 상태를 그린다.
          if (data.inventory) setInventory(data.inventory);
          if (!r.ok) setError(data.error ?? t('ide.plugins.actionFailed'));
        })
        .catch(() => setError(t('ide.plugins.actionFailed')))
        .finally(() => setBusyId(null));
    },
    [rootPath, t],
  );

  /** 자리별로 갈라 담되, 빈 묶음은 그리지 않는다. */
  const grouped = useMemo(() => {
    const list = inventory?.installed ?? [];
    return PLACEMENT_ORDER
      .map((placement) => ({ placement, items: list.filter((p) => p.placement === placement) }))
      .filter((g) => g.items.length > 0);
  }, [inventory]);

  /** 배지 = **이 세션에 실제로 실리는** 켜진 플러그인 수(남의 프로젝트 것은 세지 않는다). */
  const activeCount = useMemo(
    () => (inventory?.installed ?? []).filter((p) => p.enabled && p.placement !== 'other-project').length,
    [inventory],
  );
  const hereCount = useMemo(
    () => (inventory?.installed ?? []).filter((p) => p.placement !== 'other-project').length,
    [inventory],
  );

  /**
   * §5.5 #17-33 ⑦ — 뒤처진 설치본 수. **서버가 새긴 표식을 세기만 한다** — 판정은 shared
   * `pluginsNeedingUpdate` 한 곳이고, 화면이 따로 견주면 적어 둔 수와 실제로 올라가는 것이 어긋난다.
   */
  const outdated = useMemo(
    () => (inventory?.installed ?? []).filter((p) => p.updateAvailable && p.placement !== 'other-project'),
    [inventory],
  );

  /**
   * 고른 마켓 안의 전부(#17-42 ③) — 검색으로 좁히기 **전** 수다.
   * "몇 개 중 몇 개를 보는지" 를 적으려면 이 수가 있어야 한다.
   */
  const scopedMarket = useMemo(() => {
    const list = inventory?.market ?? [];
    return marketFilter === ALL_MARKETS ? list : list.filter((p) => p.marketplace === marketFilter);
  }, [inventory, marketFilter]);

  /** 마켓을 고른 뒤 그 안에서 다시 찾는다 — 둘은 곱해서 건다(#17-42 ②). */
  const filteredMarket = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scopedMarket;
    return scopedMarket.filter(
      (p) => p.name.toLowerCase().includes(q)
        || (p.description ?? '').toLowerCase().includes(q)
        || p.marketplace.toLowerCase().includes(q),
    );
  }, [scopedMarket, query]);

  /**
   * 아직 안 붙은 알려진 마켓(#17-42 ④) — 주소를 외워 치게 하지 않는다.
   * 실측상 Claude Code 가 스스로 붙이는 것은 공식 하나뿐이라, 커뮤니티는 늘 여기 뜬다.
   */
  const suggestions = useMemo(
    () => suggestedMarketplaces(inventory?.marketplaces ?? []),
    [inventory],
  );

  if (!rootPath) {
    return <div className="p-3 text-[12px] leading-relaxed text-gray-500">{t('ide.plugins.noProject')}</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 머리 — 제목 + 켜진 수/이 세션에 오는 수 + 새로고침 */}
      <div className="flex items-center gap-1 border-b border-gray-700/60 px-2 py-1.5">
        <span className="flex-1 truncate text-[12px] font-semibold uppercase tracking-wide text-gray-400">
          {t('ide.plugins.title')}
        </span>
        {inventory && !inventory.unavailable && (
          <span className="rounded bg-gray-700/60 px-1 text-[12px] font-bold tabular-nums text-gray-300">
            {activeCount}/{hereCount}
          </span>
        )}
        <button
          type="button"
          onClick={load}
          className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title={t('ide.plugins.refresh')}
          aria-label={t('ide.plugins.refresh')}
        >
          <RefreshIcon spinning={loading} />
        </button>
      </div>

      {/* 탭 — 설치됨 / 마켓(③ 없는 것을 찾으러 터미널로 나가지 않는다) */}
      <div className="flex flex-shrink-0 border-b border-gray-700/60">
        {(['installed', 'market'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 px-2 py-1 text-[12px] font-semibold transition-colors ${
              tab === k
                ? 'border-b-2 border-indigo-400 text-gray-100'
                : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
            }`}
          >
            {t(`ide.plugins.tab.${k}`)}
            {k === 'market' && inventory && inventory.market.length > 0 && (
              <span className="ml-1 text-gray-500 tabular-nums">({inventory.market.length})</span>
            )}
          </button>
        ))}
      </div>

      {/*
        §5.5 #17-33 ⑦ — 갱신 줄. **이 줄이 없어서 병목이 있었다.**
        마켓 클론은 누가 `marketplace update` 를 부르기 전까지 영영 그대로인데, 앱에는 그것을 부를
        자리도, 언제 끌어왔는지 적힌 자리도 없었다(실측 36일 정지). 그래서 여기 셋을 함께 세운다:
        **언제 끌어왔나 · 지금 끌어오기 · 앞으로 알아서 끌어오기**.
        머리의 새로고침(목록 다시 묻기)과는 다른 일이라 단추를 따로 둔다 — 새로고침은 461ms 이고
        이쪽은 git 을 타 몇십 초가 걸린다. 같은 단추에 묶으면 목록 한 번 보려다 몇십 초를 문다.
      */}
      {!inventory?.unavailable && (
        <div className="flex flex-col gap-1 border-b border-gray-700/60 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[12px] text-gray-500">
              {inventory?.marketRefreshedAt
                ? t('ide.plugins.marketUpdatedAt', { when: formatSince(inventory.marketRefreshedAt, t) })
                : t('ide.plugins.marketNeverUpdated')}
            </span>
            <button
              type="button"
              onClick={() => act('market-update', { action: 'marketplace-update' })}
              disabled={busyId !== null}
              className="flex-shrink-0 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[12px] font-semibold text-indigo-200 transition-colors hover:bg-indigo-500/30 disabled:opacity-50"
            >
              {busyId === 'market-update' ? t('ide.plugins.updatingMarket') : t('ide.plugins.updateMarket')}
            </button>
          </div>

          {/* 뒤처진 것이 있을 때만 선다 — 없는 날 "0개" 를 적어 두면 그건 소음이다. */}
          {outdated.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[12px] text-amber-300/90">
                {t('ide.plugins.outdatedCount', { count: outdated.length })}
              </span>
              <button
                type="button"
                onClick={() => act('update-all', { action: 'update-all' })}
                disabled={busyId !== null}
                className="flex-shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[12px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
              >
                {busyId === 'update-all' ? t('ide.plugins.updating') : t('ide.plugins.updateAll')}
              </button>
            </div>
          )}

          {/* 자동 갱신 — 켤 자리를 못 찾아 36일 멈추는 것보다, 끄고 싶은 사람이 끄는 편이 낫다. */}
          {refresh?.settings && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[12px] text-gray-600">{t('ide.plugins.autoRefresh')}</span>
              {([
                ['market', refresh.settings.market] as const,
                ['plugins', refresh.settings.plugins] as const,
              ]).map(([key, on]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setAuto({ [key]: !on })}
                  className={`rounded px-1.5 py-0.5 text-[12px] font-semibold transition-colors ${
                    on ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-700/50 text-gray-500 hover:bg-gray-600/50'
                  }`}
                  title={t(`ide.plugins.autoRefreshHint.${key}`)}
                >
                  {t(`ide.plugins.autoRefreshAxis.${key}`)}
                </button>
              ))}
              <span className="text-[12px] text-gray-600">
                {t('ide.plugins.autoRefreshEvery', { hours: refresh.settings.intervalHours })}
              </span>
            </div>
          )}

          {/* 마지막 자동 갱신이 막혔으면 조용히 넘어가지 않는다 — 그 침묵이 36일을 만들었다. */}
          {inventory?.marketRefreshError && (
            <p className="text-[12px] leading-snug text-amber-400/85" title={inventory.marketRefreshError}>
              {t('ide.plugins.marketRefreshFailed')}
            </p>
          )}
        </div>
      )}

      <ScrollFade fill className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-2">
          {error && <p className="px-1 text-[12px] leading-snug text-rose-400">{error}</p>}

          {/* CLI 에 못 물었으면 "없다" 가 아니라 그 사유를 적는다 — 둘은 다른 상태다. */}
          {inventory?.unavailable && (
            <p className="px-1 text-[12px] leading-relaxed text-amber-400/85">
              {t('ide.plugins.unavailable')}
              <code className="mt-1 block break-all rounded bg-gray-900/60 px-1 py-0.5 text-[12px] text-gray-500">
                {inventory.unavailable}
              </code>
            </p>
          )}

          {tab === 'installed' && !inventory?.unavailable && (
            <>
              {inventory && inventory.installed.length === 0 && (
                <p className="px-1 text-[12px] leading-relaxed text-gray-500">{t('ide.plugins.emptyInstalled')}</p>
              )}

              {grouped.map((group) => (
                <section key={group.placement}>
                  <h3 className="mb-1 flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
                    <span>{t(`ide.plugins.placement.${group.placement}`)}</span>
                    <span className="text-gray-600">({group.items.length})</span>
                  </h3>
                  <p className="mb-1 px-1 text-[12px] leading-snug text-gray-600">
                    {t(`ide.plugins.placementHint.${group.placement}`)}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {group.items.map((entry) => (
                      <InstalledRow
                        key={`${entry.id}-${entry.scope}-${entry.projectPath ?? ''}`}
                        entry={entry}
                        busy={busyId === entry.id}
                        onToggle={() => act(entry.id, {
                          action: entry.enabled ? 'disable' : 'enable',
                          id: entry.id,
                          scope: entry.scope,
                        })}
                        onUninstall={() => act(entry.id, { action: 'uninstall', id: entry.id, scope: entry.scope })}
                        onUpdate={() => act(entry.id, { action: 'update', id: entry.id, scope: entry.scope })}
                      />
                    ))}
                  </ul>
                </section>
              ))}

              {inventory && inventory.installed.length > 0 && (
                <p className="px-1 text-[12px] leading-snug text-gray-600">{t('ide.plugins.applyHint')}</p>
              )}
            </>
          )}

          {tab === 'market' && !inventory?.unavailable && (
            <>
              {/* 설치 범위 — 이 선택이 [설치] 가 글로벌로 갈지 이 프로젝트로 갈지를 정한다. */}
              <div className="flex items-center gap-1 px-1">
                <span className="text-[12px] text-gray-500">{t('ide.plugins.installScope')}</span>
                {(['user', 'project'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setInstallScope(s)}
                    className={`rounded px-1.5 py-0.5 text-[12px] font-semibold transition-colors ${
                      installScope === s
                        ? 'bg-indigo-500/25 text-indigo-200'
                        : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600/50'
                    }`}
                  >
                    {t(`ide.plugins.scope.${s}`)}
                  </button>
                ))}
              </div>

              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('ide.plugins.searchPlaceholder')}
                className="mx-1 rounded border border-gray-700 bg-gray-800/60 px-1.5 py-1 text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-indigo-500 focus:outline-none"
              />

              {/* 마켓플레이스 — 어디서 오는 목록인지 고르고(#17-42 ①), 없는 곳은 붙인다 */}
              <section>
                <h3 className="mb-1 px-1 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
                  {t('ide.plugins.marketplaces')}
                </h3>
                <ul className="mb-1 flex flex-col gap-0.5">
                  {/* 되돌아올 자리 — 걸어 놓고 푸는 길이 없으면 그 필터는 함정이 된다. */}
                  <li>
                    <button
                      type="button"
                      onClick={() => setMarketFilter(ALL_MARKETS)}
                      aria-pressed={marketFilter === ALL_MARKETS}
                      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition-colors ${
                        marketFilter === ALL_MARKETS ? 'bg-indigo-500/20' : 'hover:bg-gray-800/70'
                      }`}
                    >
                      <span className={`min-w-0 flex-1 truncate text-[12px] ${
                        marketFilter === ALL_MARKETS ? 'font-semibold text-indigo-200' : 'text-gray-300'
                      }`}>
                        {t('ide.plugins.marketAll')}
                      </span>
                      <span className="text-[12px] tabular-nums text-gray-600">{inventory?.market.length ?? 0}</span>
                    </button>
                  </li>
                  {(inventory?.marketplaces ?? []).map((m) => {
                    const picked = marketFilter === m.name;
                    return (
                      <li key={m.name} className="flex items-center gap-1">
                        {/* 고르는 자리와 지우는 자리를 나눈다 — 고르려다 지우면 목록이 통째로 사라진다. */}
                        <button
                          type="button"
                          onClick={() => setMarketFilter(picked ? ALL_MARKETS : m.name)}
                          aria-pressed={picked}
                          title={m.name}
                          className={`flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left transition-colors ${
                            picked ? 'bg-indigo-500/20' : 'hover:bg-gray-800/70'
                          }`}
                        >
                          <span className={`min-w-0 flex-1 truncate text-[12px] ${
                            picked ? 'font-semibold text-indigo-200' : 'text-gray-300'
                          }`}>
                            {m.name}
                          </span>
                          {m.kind !== 'custom' && (
                            <span className={`flex-shrink-0 rounded px-1 text-[12px] font-semibold ${MARKET_KIND_TONE[m.kind]}`}>
                              {t(`ide.plugins.marketKind.${m.kind}`)}
                            </span>
                          )}
                          <span className="flex-shrink-0 text-[12px] tabular-nums text-gray-600">{m.pluginCount}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => act(`mp-${m.name}`, { action: 'marketplace-remove', source: m.name })}
                          disabled={busyId === `mp-${m.name}`}
                          className="flex-shrink-0 rounded px-1 text-[12px] text-gray-500 transition-colors hover:bg-gray-800 hover:text-rose-300 disabled:opacity-50"
                          title={t('ide.plugins.marketplaceRemove')}
                        >
                          {t('ide.plugins.marketplaceRemove')}
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {/* 아직 안 붙은 알려진 마켓 — Anthropic 이 직접 운영하는 것만(#17-42 ④). */}
                {suggestions.length > 0 && (
                  <div className="mb-1 flex flex-col gap-0.5">
                    <p className="px-1 text-[12px] leading-snug text-gray-600">{t('ide.plugins.marketSuggestHint')}</p>
                    {suggestions.map((m) => (
                      <div key={m.source} className="flex items-center gap-1 px-1">
                        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-400" title={m.source}>
                          {t(`ide.plugins.marketKindName.${m.kind}`)}
                        </span>
                        <button
                          type="button"
                          onClick={() => act(`mp-add-${m.source}`, { action: 'marketplace-add', source: m.source })}
                          disabled={busyId === `mp-add-${m.source}`}
                          className="flex-shrink-0 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[12px] font-semibold text-indigo-200 transition-colors hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busyId === `mp-add-${m.source}`
                            ? t('ide.plugins.marketAdding')
                            : t('ide.plugins.marketplaceAdd')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-1 px-1">
                  <input
                    value={marketSource}
                    onChange={(e) => setMarketSource(e.target.value)}
                    placeholder={t('ide.plugins.marketplacePlaceholder')}
                    className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-800/60 px-1.5 py-0.5 text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!marketSource.trim()) return;
                      act('mp-add', { action: 'marketplace-add', source: marketSource });
                      setMarketSource('');
                    }}
                    disabled={busyId === 'mp-add' || !marketSource.trim()}
                    className="flex-shrink-0 rounded bg-gray-700/60 px-1.5 py-0.5 text-[12px] font-semibold text-gray-200 transition-colors hover:bg-gray-600/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('ide.plugins.marketplaceAdd')}
                  </button>
                </div>
              </section>

              {/* 몇 개 중 몇 개를 보는지(#17-42 ③) — 모르면 다 본 것인지 알 수 없다. */}
              {filteredMarket.length > 0 && (
                <p className="px-1 text-[12px] tabular-nums text-gray-600">
                  {t('ide.plugins.marketShowing', {
                    shown: Math.min(shown, filteredMarket.length),
                    total: filteredMarket.length,
                  })}
                  {marketFilter !== ALL_MARKETS && ` · ${marketFilter}`}
                </p>
              )}

              <ul className="flex flex-col gap-1">
                {filteredMarket.slice(0, shown).map((p) => (
                  <MarketRow
                    key={p.id}
                    plugin={p}
                    busy={busyId === p.id}
                    onInstall={() => act(p.id, { action: 'install', id: p.id, scope: installScope })}
                  />
                ))}
              </ul>

              {filteredMarket.length > shown && (
                <button
                  type="button"
                  onClick={() => setShown((n) => n + MARKET_PAGE)}
                  className="mx-1 rounded border border-gray-700 px-2 py-1 text-[12px] font-semibold text-gray-300 transition-colors hover:bg-gray-800"
                >
                  {t('ide.plugins.showMore', { count: filteredMarket.length - shown })}
                </button>
              )}

              {inventory && filteredMarket.length === 0 && (
                <p className="px-1 text-[12px] leading-relaxed text-gray-500">
                  {marketFilter === ALL_MARKETS
                    ? t('ide.plugins.emptyMarket')
                    : t('ide.plugins.emptyMarketFiltered', { marketplace: marketFilter })}
                </p>
              )}
            </>
          )}
        </div>
      </ScrollFade>
    </div>
  );
});

/** 설치된 한 줄 — 켜짐 점 + 이름 + 자리 칩 + 켜기/끄기 + 제거. */
function InstalledRow({
  entry, busy, onToggle, onUninstall, onUpdate,
}: {
  entry: ClaudePluginEntry;
  busy: boolean;
  onToggle: () => void;
  onUninstall: () => void;
  onUpdate: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  // 남의 프로젝트 것은 이 세션에 오지 않으므로 손잡이를 주지 않는다(여기서 켜도 아무 일이 없다).
  const actionable = entry.placement !== 'other-project';
  return (
    <li className="rounded border border-gray-700/50 bg-gray-800/30 px-1.5 py-1">
      <div className="flex items-start gap-1.5">
        <span
          className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${entry.enabled ? 'bg-emerald-400' : 'bg-gray-600'}`}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            {/* 이름은 설정에 적힌 원문 그대로(번역 ❌ — 이게 곧 CLI 인자다). */}
            <span
              className={`min-w-0 flex-1 truncate text-[12px] font-semibold ${entry.enabled ? 'text-gray-200' : 'text-gray-500'}`}
              title={entry.id}
            >
              {entry.name}
            </span>
            <span className={`flex-shrink-0 rounded px-1 text-[12px] font-semibold uppercase ${PLACEMENT_TONE[entry.placement]}`}>
              {t(`ide.plugins.placementShort.${entry.placement}`)}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-gray-500" title={entry.marketplace}>
            {entry.marketplace}
            {entry.version && entry.version !== 'unknown' && ` · v${entry.version}`}
            {/* §5.5 #17-33 ⑦ — 새 판이 있으면 **여기서 바로 보인다**. 종전에는 뒤처졌다는 사실이
                앱 어디에도 없어, 사용자가 터미널로 나가 `plugin update` 를 쳐 봐야 알 수 있었다. */}
            {entry.updateAvailable && entry.latestVersion && (
              <span className="ml-1 text-amber-300/90">{`→ v${entry.latestVersion}`}</span>
            )}
          </span>
        </span>
        {actionable && (
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              entry.enabled
                ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                : 'bg-gray-700/60 text-gray-300 hover:bg-gray-600/60'
            }`}
          >
            {/* 버튼은 지금 상태가 아니라 **누르면 벌어지는 일**을 적는다(#17-31·#17-32 와 같은 규약). */}
            {t(entry.enabled ? 'ide.plugins.turnOff' : 'ide.plugins.turnOn')}
          </button>
        )}
      </div>

      {/* 어느 프로젝트에 매여 있는지 — 남의 것이면 그 경로가 곧 "왜 안 먹는지" 의 답이다. */}
      {entry.projectPath && (
        <span className="mt-0.5 block truncate text-[12px] text-gray-600" title={entry.projectPath}>
          {entry.projectPath}
        </span>
      )}

      <div className="mt-0.5 flex items-center gap-2">
        <span className="flex-1" />
        {/* 뒤처진 것만 손잡이를 준다 — 최신인 줄에 [업데이트] 를 세우면 눌러도 아무 일이 없다. */}
        {actionable && entry.updateAvailable && (
          <button
            type="button"
            onClick={onUpdate}
            disabled={busy}
            className="flex-shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[12px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
          >
            {t('ide.plugins.update')}
          </button>
        )}
        <button
          type="button"
          onClick={onUninstall}
          disabled={busy}
          className="flex-shrink-0 rounded px-1 text-[12px] text-gray-600 transition-colors hover:bg-gray-800 hover:text-rose-300 disabled:opacity-50"
        >
          {t('ide.plugins.uninstall')}
        </button>
      </div>
    </li>
  );
}

/** 마켓 한 줄 — 이름 + 설명 + 설치 수 + [설치]. */
function MarketRow({
  plugin, busy, onInstall,
}: {
  plugin: ClaudeMarketPlugin;
  busy: boolean;
  onInstall: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <li className="rounded border border-gray-700/50 bg-gray-800/30 px-1.5 py-1">
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-gray-200" title={plugin.id}>
              {plugin.name}
            </span>
            {plugin.installCount !== undefined && (
              <span className="flex-shrink-0 text-[12px] tabular-nums text-gray-500" title={t('ide.plugins.installCount')}>
                {plugin.installCount.toLocaleString()}
              </span>
            )}
          </span>
          {plugin.description && (
            <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-gray-500">
              {plugin.description}
            </span>
          )}
          <span className="mt-0.5 block truncate text-[12px] text-gray-600">{plugin.marketplace}</span>
        </span>
        {plugin.installed ? (
          <span className="flex-shrink-0 rounded bg-gray-700/50 px-1.5 py-0.5 text-[12px] font-semibold text-gray-400">
            {t('ide.plugins.alreadyInstalled')}
          </span>
        ) : (
          <button
            type="button"
            onClick={onInstall}
            disabled={busy}
            className="flex-shrink-0 rounded bg-indigo-500/25 px-1.5 py-0.5 text-[12px] font-semibold text-indigo-200 transition-colors hover:bg-indigo-500/35 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {/* 설치는 git clone 을 타 몇십 초가 걸릴 수 있으므로 그동안 그렇게 적는다. */}
            {busy ? t('ide.plugins.installing') : t('ide.plugins.install')}
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * IDEHooksView.tsx — §5.5 #17-32: 지금 이 세션에 적용되는 훅을 보고, 그 자리에서 끄고, 울리는 걸 본다.
 *
 * 훅은 사용자 컴퓨터에서 **조용히 명령을 실행한다**. 그런데 앱 안에는 그 존재를 볼 자리가 없어,
 * 무엇이 걸려 있는지 알려면 설정 파일을 직접 열어야 했다. 이 뷰가 그 빈자리를 잇는다.
 *
 * 화면이 지키는 것 넷:
 *   ① **세션별이다** — 이 세션이 열린 프로젝트에서 읽은 것만 세운다(전 프로젝트 통합 목록 ❌).
 *   ② **어디서 왔는지 말한다** — 글로벌 / 이 프로젝트 / 로컬 / 정책을 묶어 세우고 파일 경로를 적는다.
 *   ③ **새로고침이 있다** — 자동으로도 다시 읽지만, 앱 밖에서 방금 추가한 훅이 안 보일 때를 위해.
 *   ④ **울리면 켜진다** — 발동한 줄이 몇 초 동안 반짝인다(어느 훅이 실제로 도는지가 곧 답이다).
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HookEntry, HookInventory, HookScope } from '@vibisual/shared';
import { hookMatcherMatches } from '@vibisual/shared';

import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import { useIDEPaneValue } from './idePane.js';
import { useHookFires, fireBelongsToSession, HOOK_FIRE_GLOW_MS } from '../../stores/hookFires.js';
import { ScrollFade } from '../ScrollFade.js';

import { useIDEProjectRoot } from './useIDEProjectRoot.js';

/** 묶음 순서 — 넓은 범위에서 좁은 범위로, 우리가 못 건드리는 정책은 맨 뒤(#17-31 과 같은 규약). */
const SCOPE_ORDER: HookScope[] = ['user', 'project', 'local', 'managed'];

/** 범위 칩 색 — "어디에 적혀 있는가" 를 색으로도 갈라 준다(#17-31 의 출처 칩과 같은 규약). */
const SCOPE_TONE: Record<HookScope, string> = {
  user: 'bg-sky-500/15 text-sky-300',
  project: 'bg-emerald-500/15 text-emerald-300',
  local: 'bg-violet-500/15 text-violet-300',
  managed: 'bg-rose-500/15 text-rose-300',
};

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

/** 발동 표시 글리프 — 울린 줄 앞에 선다(lucide zap 톤 stroke SVG, 이모지 ❌). */
function BoltIcon(): React.JSX.Element {
  return (
    <svg
      className="h-3.5 w-3.5 flex-shrink-0 animate-pulse"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M13 2L4.5 13H11l-1 9 8.5-11H12z" />
    </svg>
  );
}

export const IDEHooksView = memo(function IDEHooksView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const rootPath = useIDEProjectRoot();
  const projectId = useIDEPaneValue((o) => o.projectId);
  // ① 축은 세션이다 — 발동 표시는 **지금 열려 있는 탭**의 것만 켠다(사용자 명시: 통합 ❌).
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);

  const [inventory, setInventory] = useState<HookInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fires = useHookFires((s) => s.fires);
  const pruneFires = useHookFires((s) => s.prune);

  /** 목록 조회 — 서버가 매번 디스크를 다시 읽으므로 이 호출 하나가 곧 새로고침이다(③). */
  const load = useCallback(() => {
    if (!rootPath) {
      setInventory(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/hooks?root=${encodeURIComponent(rootPath)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: HookInventory) => setInventory(data))
      .catch(() => {
        setInventory(null);
        setError(t('ide.hooks.loadFailed'));
      })
      .finally(() => setLoading(false));
  }, [rootPath, t]);

  // 뷰를 열 때 · 프로젝트가 바뀔 때 다시 읽는다.
  useEffect(() => { load(); }, [load, projectId]);

  /**
   * 자동 감지 — 남이 훅을 추가해도 화면이 스스로 따라간다. 다만 설정 파일을 감시하는 새 통로를
   * 만들지는 않는다(파일 워처 하나를 더 얹을 만큼 급한 값이 아니다). 대신 **훅이 울릴 때마다**
   * 목록이 낡았는지 확인한다 — 새 훅이 걸렸다면 그 훅이 도는 순간이 곧 우리가 알 수 있는 시점이다.
   * 그래도 놓칠 수 있으니 머리에 새로고침 단추가 함께 있다(③ — 사용자가 짚은 바로 그 대비).
   */
  const lastFireAt = fires.length > 0 ? (fires[fires.length - 1]?.at ?? 0) : 0;
  useEffect(() => {
    if (!lastFireAt || !inventory) return;
    // 마지막 조회 뒤에 울린 발동 중 **목록에 없는 이벤트**가 있으면 설정이 바뀐 것이다.
    const known = new Set(inventory.hooks.map((h) => h.event));
    const unknown = fires.some((f) => f.at > inventory.scannedAt && !known.has(f.event));
    if (unknown) load();
  }, [lastFireAt, inventory, fires, load]);

  /** 만료된 불을 꺼 준다 — 발동이 멈춘 뒤에도 마지막 줄이 계속 빛나 있지 않도록. */
  useEffect(() => {
    if (fires.length === 0) return;
    const timer = setTimeout(() => pruneFires(), HOOK_FIRE_GLOW_MS + 200);
    return () => clearTimeout(timer);
  }, [fires, pruneFires]);

  /**
   * 지금 불이 켜져 있는 줄들. 서버는 (이벤트 · 도구) 두 값만 보내므로 어느 줄에 걸리는지는
   * 여기서 `hookMatcherMatches` 로 고른다 — 계측과 화면이 같은 규칙을 쓰게 shared 순수 함수다.
   * 꺼 둔 훅은 실제로 돌지 않았으므로 불도 켜지 않는다(화면이 거짓말을 하지 않게).
   */
  const firedIds = useMemo(() => {
    const out = new Set<string>();
    const entries = inventory?.hooks ?? [];
    if (entries.length === 0) return out;
    const cutoff = Date.now() - HOOK_FIRE_GLOW_MS;
    for (const fire of fires) {
      if (fire.at < cutoff) continue;
      if (!fireBelongsToSession(fire, agentId, activeSessionId)) continue;
      for (const entry of entries) {
        if (!entry.enabled) continue;
        if (entry.event !== fire.event) continue;
        if (!hookMatcherMatches(entry.matcher, fire.toolName)) continue;
        out.add(entry.id);
      }
    }
    return out;
  }, [fires, inventory, agentId, activeSessionId]);

  /** 켜기/끄기 — 서버가 명령 객체를 `hooks` ↔ `_vibisualDisabled` 사이로 옮긴다(지우지 않는다). */
  const handleToggle = useCallback(
    (entry: HookEntry) => {
      if (!rootPath || !entry.toggleable) return;
      setBusyId(entry.id);
      setError(null);
      fetch('/api/hooks/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: rootPath,
          scope: entry.scope,
          event: entry.event,
          matcher: entry.matcher,
          command: entry.command,
          enabled: !entry.enabled,
        }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: { inventory?: HookInventory }) => {
          // 서버가 갱신된 인벤토리를 함께 주므로 다시 묻지 않는다.
          if (data.inventory) setInventory(data.inventory);
          else load();
        })
        .catch(() => setError(t('ide.hooks.toggleFailed')))
        .finally(() => setBusyId(null));
    },
    [rootPath, load, t],
  );

  /** 범위별로 갈라 담되, 빈 묶음은 그리지 않는다. */
  const grouped = useMemo(() => {
    const hooks = inventory?.hooks ?? [];
    return SCOPE_ORDER
      .map((scope) => ({ scope, items: hooks.filter((h) => h.scope === scope) }))
      .filter((g) => g.items.length > 0);
  }, [inventory]);

  const enabledCount = useMemo(
    () => (inventory?.hooks ?? []).filter((h) => h.enabled).length,
    [inventory],
  );

  if (!rootPath) {
    return <div className="p-3 text-[12px] leading-relaxed text-gray-500">{t('ide.hooks.noProject')}</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 머리 — 제목 + 켜진 수/전체 + 새로고침(③) */}
      <div className="flex items-center gap-1 border-b border-gray-700/60 px-2 py-1.5">
        <span className="flex-1 truncate text-[12px] font-semibold uppercase tracking-wide text-gray-400">
          {t('ide.hooks.title')}
        </span>
        {inventory && (
          <span className="rounded bg-gray-700/60 px-1 text-[12px] font-bold tabular-nums text-gray-300">
            {enabledCount}/{inventory.hooks.length}
          </span>
        )}
        <button
          type="button"
          onClick={load}
          className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title={t('ide.hooks.refresh')}
          aria-label={t('ide.hooks.refresh')}
        >
          <RefreshIcon spinning={loading} />
        </button>
      </div>

      <ScrollFade fill className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-2">
          {error && <p className="px-1 text-[12px] leading-snug text-rose-400">{error}</p>}

          {inventory && inventory.hooks.length === 0 && (
            <p className="px-1 text-[12px] leading-relaxed text-gray-500">{t('ide.hooks.empty')}</p>
          )}

          {grouped.map((group) => (
            <section key={group.scope}>
              <h3 className="mb-1 flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
                <span>{t(`ide.hooks.scope.${group.scope}`)}</span>
                <span className="text-gray-600">({group.items.length})</span>
              </h3>
              <p className="mb-1 px-1 text-[12px] leading-snug text-gray-600">{t(`ide.hooks.scopeHint.${group.scope}`)}</p>
              <ul className="flex flex-col gap-1">
                {group.items.map((entry) => {
                  const busy = busyId === entry.id;
                  const fired = firedIds.has(entry.id);
                  return (
                    <li
                      key={entry.id}
                      /* ④ 발동 — 테두리·배경이 옅게 물들고 글리프와 이벤트 이름이 깜빡인다.
                         전환(transition)을 함께 걸어 불이 켜질 때가 아니라 **꺼질 때** 부드럽게
                         빠진다(깜빡임이 끝나는 자리가 튀지 않게). */
                      className={`rounded border px-1.5 py-1 transition-colors duration-700 ${
                        fired
                          ? 'border-amber-400/70 bg-amber-500/10 shadow-[0_0_8px_rgba(251,191,36,0.25)]'
                          : 'border-gray-700/50 bg-gray-800/30'
                      }`}
                    >
                      <div className="flex items-start gap-1.5">
                        {/* 발동 중에는 글리프가, 평소에는 켜짐/꺼짐 점이 선다(자리는 하나). */}
                        {fired ? (
                          <span className="mt-0.5 text-amber-300"><BoltIcon /></span>
                        ) : (
                          <span
                            className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                              entry.enabled ? 'bg-emerald-400' : 'bg-gray-600'
                            }`}
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1">
                            {/* 이벤트 이름은 설정에 적힌 원문 그대로(번역 ❌ — 이게 곧 키다). */}
                            <span
                              className={`min-w-0 flex-1 truncate text-[12px] font-semibold ${
                                fired ? 'animate-pulse text-amber-300' : entry.enabled ? 'text-gray-200' : 'text-gray-500'
                              }`}
                              title={entry.event}
                            >
                              {entry.event}
                            </span>
                            <span className={`flex-shrink-0 rounded px-1 text-[12px] font-semibold uppercase ${SCOPE_TONE[entry.scope]}`}>
                              {t(`ide.hooks.scopeShort.${entry.scope}`)}
                            </span>
                          </span>
                          {/* 어느 도구에 걸리는가 — 비어 있으면 그 이벤트 전부에 걸린다. */}
                          <span className="mt-0.5 block truncate text-[12px] text-gray-500">
                            {entry.matcher && entry.matcher !== '*'
                              ? t('ide.hooks.matcher', { matcher: entry.matcher })
                              : t('ide.hooks.matcherAll')}
                            {entry.timeout !== undefined && ` · ${t('ide.hooks.timeout', { seconds: entry.timeout })}`}
                          </span>
                        </span>
                        {/* 켜기/끄기 — 못 끄는 줄(우리 훅·정책)은 버튼 대신 아래 이유만 남는다. */}
                        {entry.toggleable && (
                          <button
                            type="button"
                            onClick={() => handleToggle(entry)}
                            disabled={busy}
                            className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                              entry.enabled
                                ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                                : 'bg-gray-700/60 text-gray-300 hover:bg-gray-600/60'
                            }`}
                            title={t(entry.enabled ? 'ide.hooks.state.enabled' : 'ide.hooks.state.disabled')}
                          >
                            {/* 버튼은 **지금 상태**가 아니라 **누르면 벌어지는 일**을 적는다(#17-31 과 같은 규약). */}
                            {t(entry.enabled ? 'ide.hooks.turnOff' : 'ide.hooks.turnOn')}
                          </button>
                        )}
                      </div>

                      {/* 실제로 실행되는 명령 — 이 한 줄이 이 화면의 존재 이유다(무엇이 도는가). */}
                      <code
                        className={`mt-1 block break-all rounded bg-gray-900/60 px-1 py-0.5 text-[12px] leading-snug ${
                          entry.enabled ? 'text-gray-400' : 'text-gray-600 line-through'
                        }`}
                        title={entry.command}
                      >
                        {entry.command}
                      </code>

                      {/* 왜 못 끄는지 — 이유가 없으면 이 줄 자체가 없다. */}
                      {entry.lockReason && (
                        <p className="mt-0.5 text-[12px] leading-snug text-amber-400/85">
                          {t(`ide.hooks.lock.${entry.lockReason}`)}
                        </p>
                      )}

                      <span className="mt-0.5 block truncate text-[12px] text-gray-600" title={entry.sourceFile}>
                        {entry.sourceFile}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {/* 발치 — 켜고 끈 것이 언제 적용되는지 한 번만 말한다(줄마다 반복하지 않는다). */}
          {inventory && inventory.hooks.length > 0 && (
            <p className="px-1 text-[12px] leading-snug text-gray-600">{t('ide.hooks.applyHint')}</p>
          )}
        </div>
      </ScrollFade>
    </div>
  );
});

/**
 * 활동바가 쓰는 점등 신호 — **이 세션에서** 지금 울리고 있는 훅이 있는가.
 *
 * 목록(인벤토리)을 읽지 않는다: 활동바는 사이드바가 닫혀 있어도 떠 있어야 하는데, 그때마다
 * 훅 목록을 조회하면 뷰를 열지도 않은 채 디스크를 긁게 된다. "무엇이 울렸나" 가 아니라
 * "울리고 있나" 만 필요하므로 발동 신호 하나로 충분하다.
 */
export function useHookFiring(agentId: string | null): boolean {
  const fires = useHookFires((s) => s.fires);
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const prune = useHookFires((s) => s.prune);

  // 마지막 불이 만료될 때 활동바도 함께 꺼지도록 한 번 깨운다.
  useEffect(() => {
    if (fires.length === 0) return;
    const timer = setTimeout(() => prune(), HOOK_FIRE_GLOW_MS + 200);
    return () => clearTimeout(timer);
  }, [fires, prune]);

  return useMemo(() => {
    const cutoff = Date.now() - HOOK_FIRE_GLOW_MS;
    return fires.some((f) => f.at >= cutoff && fireBelongsToSession(f, agentId, activeSessionId));
  }, [fires, agentId, activeSessionId]);
}

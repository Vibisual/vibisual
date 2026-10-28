/**
 * §5.11 — Plugins 창(File › Plugins). OptionsWindow 와 같은 모달 셸, 토글 즉시 적용(Apply ❌).
 * SSOT 는 서버 `UserDefaults.enabledPluginsByProject`(PUT + 응답 전 낙관 반영). 켬/끔은 프로젝트별이라 창 머리에 대상 프로젝트를 늘 보이고, 없으면 토글을 막는다.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { PLUGIN_API_PREFIX } from '@vibisual/shared';
import type { PluginManifest } from '@vibisual/shared';
import {
  PLUGIN_MANIFESTS,
  resolveEnabledPluginsFor,
  hasOwnToggle,
  resolveProjectKey,
  unsupportedContributions,
  withProjectEnabled,
} from '@vibisual/plugins';
import { getClientModule } from '@vibisual/plugins/client';
import { useGraphStore, selectActivePluginProjectPath } from '../../stores/graphStore.js';
import { setCanvasCover } from '../../stores/canvasVisibility.js';
import { usePluginTranslate } from '../../plugins/host.js';
import { clientPathPlatform } from '../../utils/platform.js';
import { groupPlugins, isProjectEnforcing, resolveSelection } from '../../plugins/pluginList.js';
import { PluginErrorBoundary } from '../../plugins/PluginErrorBoundary.js';
import { PluginUsage } from './PluginUsage.js';
import { tryBuild } from '../../plugins/isolate.js';

const API_BASE = '';

interface PluginsWindowProps {
  open: boolean;
  onClose: () => void;
}

export function PluginsWindow({ open, onClose }: PluginsWindowProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const pluginT = usePluginTranslate();
  const userDefaults = useGraphStore((s) => s.userDefaults);
  const applyUserDefaults = useGraphStore((s) => s.applyUserDefaults);
  // 이 창이 손대는 대상 = 지금 보고 있는 프로젝트 한 곳. 경로는 저장 키, 이름은 화면 표시용.
  const projectPath = useGraphStore(selectActivePluginProjectPath);
  const projectName = useGraphStore((s) => s.activeProject);
  // §5.11 노출 게이트 — §5.14·§5.15·§5.18·§5.20 넷이 쓰는 그 디버그 모드를 **그대로** 쓴다.
  //   여기에 별도 스위치를 두면 캔버스의 ` 키와 두 벌이 되어 어긋난다.
  const debugMode = useGraphStore((s) => s.debugMode);
  const toggleDebug = useGraphStore((s) => s.toggleDebug);

  const [selectedId, setSelectedId] = useState<string>(PLUGIN_MANIFESTS[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showUsage, setShowUsage] = useState(false);

  const enabledSet = useMemo(
    () => resolveEnabledPluginsFor(userDefaults, projectPath, clientPathPlatform()),
    [userDefaults, projectPath],
  );

  /** 노출 게이트를 지난 카드. 켠 것은 늘 넣는다 — 목록에 없는데 프롬프트에 실리는 카드가 없게(끄려면 보여야 한다). */
  const gated = useMemo(
    // §5.5 #17-44 ⑧(d) — 손잡이가 자기 화면에 있는 카드(`ownToggle`)는 디버그 모드에서도 세우지 않는다.
    //   여기 서면 그 칸이 두 번째 관문이 되어, 뷰에서 켠 것이 왜 안 도는지가 이 목록 안에 숨는다.
    () => PLUGIN_MANIFESTS.filter((m) => !hasOwnToggle(m) && (debugMode || isProjectEnforcing(m) || enabledSet.has(m.id))),
    [debugMode, enabledSet],
  );
  /** 이 창이 관리하는 카드 전체 — `ownToggle` 은 애초에 이 창의 소관이 아니라 분모에서 뺀다. */
  const managed = useMemo(() => PLUGIN_MANIFESTS.filter((m) => !hasOwnToggle(m)), []);
  /** 아직 안 만들어져 지금 숨어 있는 카드 수 — 스위치에 그대로 세운다(몇 장이 잠겨 있는지 말한다). */
  const hiddenCount = managed.length - gated.length;
  /** 켠 수는 관리 대상만 센다 — `enabledSet` 엔 `ownToggle` 카드 id 가 남아 있어(끄면 안 지운다) 분자만 커진다. */
  const enabledCount = useMemo(() => managed.filter((m) => enabledSet.has(m.id)).length, [managed, enabledSet]);

  // 목록을 거르고 묶는 판단은 `pluginList.ts` 가 한다 — 여기서는 결과를 그리기만 한다.
  const groups = useMemo(
    () => groupPlugins(gated, {
      query,
      onlyEnabled,
      enabled: enabledSet,
      describe: (manifest) => t(manifest.descriptionKey),
      // `gated` 가 이미 게이트를 통과시켰으므로 여기서는 다시 거르지 않는다.
      showDraft: true,
    }),
    [gated, query, onlyEnabled, enabledSet, t],
  );

  // 찾다가 선택이 걸러져 사라지면 오른쪽이 빈 화면이 된다 — 첫 항목으로 옮긴다.
  const visibleId = resolveSelection(groups, selectedId);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // 캔버스 렌더 정지 — 모달이 덮고 있는 동안은 그릴 이유가 없다(가시성 LOD 와 같은 축).
  useEffect(() => {
    setCanvasCover('plugins-window', open);
    return () => setCanvasCover('plugins-window', false);
  }, [open]);

  const backdrop = useBackdropDismiss(onClose);

  /** §5.11 — 설정 슬롯용 플러그인 창구: 접두사(`/api/plugins/<id>`)와 지금 프로젝트를 붙인다 — 생 `fetch` 를 주면 남의 라우트로 간다("슬롯 경유만"). */
  const callPlugin = useCallback(
    async (id: string, path: string, init?: { method?: string; body?: unknown }): Promise<unknown> => {
      const qs = projectPath ? `?projectId=${encodeURIComponent(projectPath)}` : '';
      const res = await fetch(`${API_BASE}${PLUGIN_API_PREFIX}/${id}/${path}${qs}`, {
        method: init?.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          // 서버가 문서 뼈대를 만들 때 쓸 언어 — 화면과 같은 말로 된 문서가 나오게 한다.
          'x-vibisual-locale': i18n.language,
        },
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
      // fetch 는 4xx·5xx 에도 resolve 한다 — 여기서 안 던지면 설정 화면이 "저장됨"으로 거짓말한다.
      if (!res.ok) throw new Error(`plugin api ${res.status}`);
      return res.json();
    },
    [projectPath, i18n.language],
  );

  const toggle = useCallback(async (id: string) => {
    // 프로젝트가 없으면 매달 칸이 없다 — 전역으로 흘려 저장하면 프로젝트별 켬/끔이 조용히 깨진다.
    if (!projectPath) return;

    const prev = useGraphStore.getState().userDefaults;
    const next = new Set(resolveEnabledPluginsFor(prev, projectPath, clientPathPlatform()));
    if (next.has(id)) next.delete(id); else next.add(id);
    const list = [...next];

    // 낙관적 반영 — 서버 broadcast 가 곧 같은 값으로 확정한다. 다른 프로젝트 칸은 건드리지 않는다.
    applyUserDefaults({
      ...(prev ?? {}),
      enabledPluginsByProject: withProjectEnabled(prev, projectPath, list, clientPathPlatform()),
      updatedAt: Date.now(),
    });

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/user-defaults`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // **방금 바꾼 한 칸만** 보낸다 — 서버가 프로젝트 키 단위로 머지하므로, 맵 전체를 보내면
        // 그 사이 다른 창이 바꾼 프로젝트를 이 창의 옛 값으로 되돌려 놓는다.
        body: JSON.stringify({
          enabledPluginsByProject: { [resolveProjectKey(prev, projectPath, clientPathPlatform())]: list },
        }),
      });
      // fetch 는 4xx·5xx 에도 resolve 한다 — 상태를 안 보면 **저장에 실패했는데 화면만 켜진 채로 남고**,
      // 다음에 앱을 켜면 조용히 꺼져 있다("켰는데 왜 안 켜져 있냐"가 여기서 난다).
      if (!res.ok) throw new Error(`user-defaults PUT ${res.status}`);
    } catch {
      // 저장 실패 시 되돌린다 — 화면만 켜져 있고 실제로는 꺼진 상태를 만들지 않는다.
      if (prev) applyUserDefaults(prev);
    } finally {
      setSaving(false);
    }
  }, [applyUserDefaults, projectPath]);

  const selected: PluginManifest | undefined = useMemo(
    () => PLUGIN_MANIFESTS.find((m) => m.id === visibleId),
    [visibleId],
  );

  if (!open) return null;

  const selectedEnabled = selected ? enabledSet.has(selected.id) : false;
  const settingsSection = selected ? getClientModule(selected.id)?.settingsSection : undefined;
  const unsupported = selected ? unsupportedContributions(selected) : [];

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      {...backdrop}
    >
      <div className="flex h-[640px] max-h-[92dvh] w-[860px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl max-md:h-dvh max-md:max-h-dvh max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-gray-100">
            <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h4v3a2 2 0 1 0 4 0V3h4a1 1 0 0 1 1 1v4h-3a2 2 0 1 0 0 4h3v4a1 1 0 0 1-1 1h-4v-3a2 2 0 1 0-4 0v3H6a1 1 0 0 1-1-1v-4H2a2 2 0 1 0 0-4h3V4a1 1 0 0 1 1-1z" />
            </svg>
            {t('panel.plugins.title')}
            {/* 켠 수를 창 머리에 둔다 — 111종 중 무엇이 켜져 있는지가 가장 먼저 궁금한 정보다. */}
            <span className="text-[12px] font-normal text-gray-500">
              {t('panel.plugins.enabledCount', { on: enabledCount, total: gated.length })}
            </span>
            {saving && <span className="text-xs font-normal text-gray-500">{t('panel.plugins.saving')}</span>}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200 pointer-coarse:h-9 pointer-coarse:w-9"
            aria-label={t('panel.plugins.close')}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* 적용 범위 — 이 창이 어느 프로젝트를 손대는지. 켬/끔이 프로젝트별이므로 상시 표시한다. */}
        <div
          className={`flex shrink-0 items-center gap-2 border-b px-4 py-2 text-[12px] ${
            projectPath
              ? 'border-gray-700/50 bg-white/[0.03] text-gray-400'
              : 'border-amber-500/20 bg-amber-500/[0.07] text-amber-300/90'
          }`}
        >
          <svg
            className="h-3.5 w-3.5 shrink-0"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          {projectPath ? (
            <>
              {/* 이름은 문장 밖의 라벨로 둔다 — 어순이 다른 언어에서도 자리가 흔들리지 않는다. */}
              {/* 폰 폭에서는 이름 칩이 줄 폭의 40% 를 넘지 않는다 — 넘으면 옆 문장이 0 으로 눌린다. */}
              <span className="max-w-[200px] shrink-0 truncate rounded bg-white/[0.07] px-1.5 py-0.5 font-semibold text-gray-200 max-md:max-w-[40%]" title={projectPath}>
                {projectName}
              </span>
              <span className="min-w-0 truncate">{t('panel.plugins.scopeProject')}</span>
            </>
          ) : (
            <span className="min-w-0">{t('panel.plugins.scopeNone')}</span>
          )}
        </div>

        {/* Body — 폰 폭에서는 목록을 위, 상세를 아래로 쌓는다. 옆에 두면 160px 목록 + 160px 상세로 둘 다 짓눌렸다.
            목록은 높이의 45% 까지만 쓰고 그 안에서 스크롤한다(상세가 남은 자리를 쓴다). */}
        <div className="flex flex-1 overflow-hidden max-md:flex-col">
          {/* 좌측 — 플러그인 목록 */}
          <div className="flex w-56 shrink-0 flex-col border-r border-gray-700/50 bg-gray-900/40 max-md:max-h-[45%] max-md:w-full max-md:border-b max-md:border-r-0">
            {/* 찾기 — 이름·id·설명 본문을 함께 본다. 사람은 이름이 아니라 하려는 일로 찾는다. */}
            <div className="shrink-0 border-b border-gray-700/50 p-2">
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('panel.plugins.searchPlaceholder')}
                  aria-label={t('panel.plugins.searchPlaceholder')}
                  className="w-full rounded border border-gray-700 bg-gray-800/60 py-1 pl-7 pr-6 text-xs text-gray-200 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none pointer-coarse:py-2 pointer-coarse:pr-9"
                />
                {query !== '' && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label={t('panel.plugins.clearSearch')}
                    className="absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-gray-500 hover:bg-gray-700 hover:text-gray-300 pointer-coarse:h-7 pointer-coarse:w-7"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOnlyEnabled((v) => !v)}
                className={`mt-1.5 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[12px] pointer-coarse:py-2 ${
                  onlyEnabled ? 'bg-emerald-500/15 text-emerald-300' : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${onlyEnabled ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                {t('panel.plugins.onlyEnabled')}
              </button>
              {/* §5.11 노출 게이트 스위치 — 모달이라 캔버스 단축키를 모르면 갇힌다. 같은 칸(§7.7 `debugMode` — 새 상태 ❌)을 뒤집는다. 숨은 것이 없으면 안 그린다. */}
              {(hiddenCount > 0 || debugMode) && (
                <button
                  type="button"
                  onClick={toggleDebug}
                  className={`mt-1 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[12px] pointer-coarse:py-2 ${
                    debugMode ? 'bg-amber-500/15 text-amber-300' : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'
                  }`}
                >
                  <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                  </svg>
                  <span className="min-w-0 truncate text-left">
                    {debugMode ? t('panel.plugins.hideDrafts') : t('panel.plugins.showDrafts', { n: hiddenCount })}
                  </span>
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto py-1">
              {groups.length === 0 ? (
                <p className="px-3 py-4 text-[12px] leading-relaxed text-gray-600">{t('panel.plugins.noMatch')}</p>
              ) : (
                groups.map((group) => {
                  const folded = collapsed.has(group.category);
                  const onCount = group.items.filter((m) => enabledSet.has(m.id)).length;
                  return (
                  <div key={group.category}>
                    {/* 분류 머리글 = 접기 버튼. 개수는 "켠 것 / 전체" 로 보여 준다. */}
                    <button
                      type="button"
                      onClick={() => setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.category)) next.delete(group.category); else next.add(group.category);
                        return next;
                      })}
                      aria-expanded={!folded}
                      className="flex w-full items-center gap-1 px-3 pb-1 pt-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-gray-600 hover:text-gray-400"
                    >
                      <svg
                        className={`h-3 w-3 shrink-0 transition-transform ${folded ? '-rotate-90' : ''}`}
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                      <span className="truncate">{t(`panel.plugins.category.${group.category}`)}</span>
                      <span className={`ml-auto shrink-0 tabular-nums ${onCount > 0 ? 'text-emerald-500/80' : 'text-gray-700'}`}>
                        {onCount}/{group.items.length}
                      </span>
                    </button>
                    {!folded && group.items.map((m) => {
                      const on = enabledSet.has(m.id);
                      // 디버그 모드에서만 함께 서는 카드 — 켠 것과 헷갈리지 않게 점 모양을 달리한다.
                      const draft = !isProjectEnforcing(m);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSelectedId(m.id)}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs pointer-coarse:py-2.5 ${
                            visibleId === m.id
                              ? 'border-l-2 border-blue-500 bg-blue-500/10 text-white'
                              : 'border-l-2 border-transparent text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              on ? 'bg-emerald-400' : draft ? 'border border-gray-600 bg-transparent' : 'bg-gray-600'
                            }`}
                            title={draft ? t('panel.plugins.draftBadge') : undefined}
                          />
                          <span className={`truncate ${draft && !on ? 'text-gray-500' : ''}`}>{m.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 우측 — 상세 + 토글 */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5 max-md:p-4">
            {!selected ? (
              <p className="text-sm text-gray-500">{t('panel.plugins.empty')}</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4 border-b border-gray-700/50 pb-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-gray-200">{selected.name}</h4>
                    <p className="mt-0.5 text-[12px] text-gray-500">
                      v{selected.version} · {t(`panel.plugins.category.${selected.category}`)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggle(selected.id)}
                    // 매달 프로젝트가 없으면 저장할 칸이 없다 — 눌리는데 아무 일도 안 일어나는 버튼을 두지 않는다.
                    disabled={!projectPath}
                    title={projectPath ? undefined : t('panel.plugins.scopeNone')}
                    className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:py-2.5 ${
                      selectedEnabled
                        ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                        : 'bg-white/[0.06] text-gray-400 hover:bg-white/[0.1] hover:text-gray-200'
                    }`}
                  >
                    {selectedEnabled ? t('panel.plugins.enabled') : t('panel.plugins.disabled')}
                  </button>
                </div>

                {/* §5.11 — 아직 프로젝트를 훑지 않는 카드: 켤 수는 있지만(개발 시험) 고정 문장만 실린다고 먼저 적는다. */}
                {!isProjectEnforcing(selected) && (
                  <div className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-[12px] leading-relaxed text-amber-300/90">
                    <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span className="min-w-0">{t('panel.plugins.draftNote')}</span>
                  </div>
                )}

                {/* 설명을 누르면 "켜면 뭘 보게 되는가"가 펴진다. */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowUsage((v) => !v)}
                    aria-expanded={showUsage}
                    className="group w-full text-left"
                  >
                    <p className="text-[13px] leading-relaxed text-gray-300 group-hover:text-gray-100">
                      {t(selected.descriptionKey)}
                    </p>
                    <span className="mt-1 inline-flex items-center gap-1 text-[12px] text-gray-500 group-hover:text-gray-300">
                      <svg
                        className={`h-3 w-3 transition-transform ${showUsage ? 'rotate-180' : ''}`}
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                      {showUsage ? t('panel.plugins.usage.hide') : t('panel.plugins.usage.show')}
                    </span>
                  </button>
                  {showUsage && (
                    <div className="mt-2">
                      <PluginUsage manifest={selected} enabled={selectedEnabled} />
                    </div>
                  )}
                </div>

                <div>
                  <h5 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-500">
                    {t('panel.plugins.contributes')}
                  </h5>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.contributes.map((c) => {
                      const off = unsupported.includes(c);
                      return (
                        <span
                          key={c}
                          className={`rounded px-1.5 py-0.5 text-[12px] ${
                            off ? 'bg-white/[0.04] text-gray-600 line-through' : 'bg-white/[0.06] text-gray-300'
                          }`}
                          title={off ? t('panel.plugins.unsupported') : undefined}
                        >
                          {t(`panel.plugins.contribution.${c}`)}
                        </span>
                      );
                    })}
                  </div>
                  {unsupported.length > 0 && (
                    <p className="mt-1.5 text-[12px] text-gray-600">{t('panel.plugins.unsupported')}</p>
                  )}
                </div>

                {settingsSection && selectedEnabled && (
                  // 설정 섹션도 플러그인 코드다 — 여기서 던지면 창 전체가 사라진다.
                  <PluginErrorBoundary pluginId={selected.id}>
                    <div>{tryBuild(selected.id, () => settingsSection({
                      enabled: selectedEnabled,
                      t: pluginT,
                      // 설정도 켬/끔과 같은 프로젝트 칸에 매인다 — 안 넘기면 어디 저장되는지 모르는 저장 버튼이 된다.
                      projectPath,
                      call: (path, init) => callPlugin(selected.id, path, init),
                    }))}</div>
                  </PluginErrorBoundary>
                )}

                <p className="mt-1 rounded-md bg-white/[0.03] p-2.5 text-[12px] leading-relaxed text-gray-500">
                  {t('panel.plugins.offNote')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * §5.11 v3.88 — Plugins 창 (File › Plugins).
 *
 * OptionsWindow·GuideWindow 와 **동형 모달 셸**(portal + 좌측 목록 + 우측 패널)을 그대로 쓴다.
 * 다른 점은 Apply/Cancel 이 없다는 것 — 토글은 즉시 적용된다(재시작 불필요, §5.11).
 *
 * 활성 상태 SSOT 는 서버 `UserDefaults.enabledPlugins` 다. 여기서는 PUT 하고, 화면은 스토어를 따른다
 * (PUT 응답을 기다리는 동안만 낙관적으로 먼저 반영해 토글이 굼떠 보이지 않게 한다).
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { PluginManifest } from '@vibisual/shared';
import { PLUGIN_MANIFESTS, resolveEnabledPlugins, unsupportedContributions } from '@vibisual/plugins';
import { getClientModule } from '@vibisual/plugins/client';
import { useGraphStore } from '../../stores/graphStore.js';
import { setCanvasCover } from '../../stores/canvasVisibility.js';
import { usePluginTranslate } from '../../plugins/host.js';
import { groupPlugins, resolveSelection } from '../../plugins/pluginList.js';
import { PluginErrorBoundary } from '../../plugins/PluginErrorBoundary.js';
import { PluginUsage } from './PluginUsage.js';
import { tryBuild } from '../../plugins/isolate.js';

const API_BASE = '';

interface PluginsWindowProps {
  open: boolean;
  onClose: () => void;
}

export function PluginsWindow({ open, onClose }: PluginsWindowProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const pluginT = usePluginTranslate();
  const overlayRef = useRef<HTMLDivElement>(null);
  const userDefaults = useGraphStore((s) => s.userDefaults);
  const applyUserDefaults = useGraphStore((s) => s.applyUserDefaults);

  const [selectedId, setSelectedId] = useState<string>(PLUGIN_MANIFESTS[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showUsage, setShowUsage] = useState(false);

  const enabledSet = useMemo(
    () => resolveEnabledPlugins(userDefaults?.enabledPlugins),
    [userDefaults?.enabledPlugins],
  );

  // 목록을 거르고 묶는 판단은 `pluginList.ts` 가 한다 — 여기서는 결과를 그리기만 한다.
  const groups = useMemo(
    () => groupPlugins(PLUGIN_MANIFESTS, {
      query,
      onlyEnabled,
      enabled: enabledSet,
      describe: (manifest) => t(manifest.descriptionKey),
    }),
    [query, onlyEnabled, enabledSet, t],
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

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  }, [onClose]);

  const toggle = useCallback(async (id: string) => {
    const next = new Set(resolveEnabledPlugins(useGraphStore.getState().userDefaults?.enabledPlugins));
    if (next.has(id)) next.delete(id); else next.add(id);
    const list = [...next];

    // 낙관적 반영 — 서버 broadcast 가 곧 같은 값으로 확정한다.
    const prev = useGraphStore.getState().userDefaults;
    applyUserDefaults({ ...(prev ?? {}), enabledPlugins: list, updatedAt: Date.now() });

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/user-defaults`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledPlugins: list }),
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
  }, [applyUserDefaults]);

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
      ref={overlayRef}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={handleOverlayClick}
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
            <span className="text-[11px] font-normal text-gray-500">
              {t('panel.plugins.enabledCount', { on: enabledSet.size, total: PLUGIN_MANIFESTS.length })}
            </span>
            {saving && <span className="text-xs font-normal text-gray-500">{t('panel.plugins.saving')}</span>}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            aria-label={t('panel.plugins.close')}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* 좌측 — 플러그인 목록 */}
          <div className="flex w-56 shrink-0 flex-col border-r border-gray-700/50 bg-gray-900/40 max-md:w-40">
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
                  className="w-full rounded border border-gray-700 bg-gray-800/60 py-1 pl-7 pr-6 text-xs text-gray-200 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
                />
                {query !== '' && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label={t('panel.plugins.clearSearch')}
                    className="absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-gray-500 hover:bg-gray-700 hover:text-gray-300"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOnlyEnabled((v) => !v)}
                className={`mt-1.5 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[11px] ${
                  onlyEnabled ? 'bg-emerald-500/15 text-emerald-300' : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${onlyEnabled ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                {t('panel.plugins.onlyEnabled')}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-1">
              {groups.length === 0 ? (
                <p className="px-3 py-4 text-[11px] leading-relaxed text-gray-600">{t('panel.plugins.noMatch')}</p>
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
                      className="flex w-full items-center gap-1 px-3 pb-1 pt-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-600 hover:text-gray-400"
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
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setSelectedId(m.id)}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                            visibleId === m.id
                              ? 'border-l-2 border-blue-500 bg-blue-500/10 text-white'
                              : 'border-l-2 border-transparent text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                          <span className="truncate">{m.name}</span>
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
          <div className="flex-1 overflow-y-auto p-5">
            {!selected ? (
              <p className="text-sm text-gray-500">{t('panel.plugins.empty')}</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4 border-b border-gray-700/50 pb-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-gray-200">{selected.name}</h4>
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      v{selected.version} · {t(`panel.plugins.category.${selected.category}`)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggle(selected.id)}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      selectedEnabled
                        ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                        : 'bg-white/[0.06] text-gray-400 hover:bg-white/[0.1] hover:text-gray-200'
                    }`}
                  >
                    {selectedEnabled ? t('panel.plugins.enabled') : t('panel.plugins.disabled')}
                  </button>
                </div>

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
                    <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-500 group-hover:text-gray-300">
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
                  <h5 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    {t('panel.plugins.contributes')}
                  </h5>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.contributes.map((c) => {
                      const off = unsupported.includes(c);
                      return (
                        <span
                          key={c}
                          className={`rounded px-1.5 py-0.5 text-[11px] ${
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
                    <p className="mt-1.5 text-[11px] text-gray-600">{t('panel.plugins.unsupported')}</p>
                  )}
                </div>

                {settingsSection && selectedEnabled && (
                  // 설정 섹션도 플러그인 코드다 — 여기서 던지면 창 전체가 사라진다.
                  <PluginErrorBoundary pluginId={selected.id}>
                    <div>{tryBuild(selected.id, () => settingsSection({ enabled: selectedEnabled, t: pluginT }))}</div>
                  </PluginErrorBoundary>
                )}

                <p className="mt-1 rounded-md bg-white/[0.03] p-2.5 text-[11px] leading-relaxed text-gray-500">
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

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { LocalModelCatalogEntry, LocalModelCatalogRepo } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';
import { formatBytes, useLocalLlm } from '../../hooks/useLocalLlm.js';

/**
 * §5.19 (B) — All Model 설치 창.
 *
 * 버블은 이미 캔버스에 있다(우클릭으로 고른 순간 생겼다). 이 창은 **그 버블의 준비 과정 그 자체**다 —
 * 엔진 받기 → 모델 받기 → 고르기가 한 창에서 차례로 흐르고, **끝나는 순간 그 버블의 IDE 가 열린다.**
 * 사용자가 "이제 뭘 눌러야 하나"를 다시 묻게 두지 않는 것이 이 창의 유일한 임무다.
 *
 * 목록·상태는 전부 서버가 디스크를 읽어 내려준 것이다. 여기서 가공하지 않는다.
 */
export function LocalModelWindow(): React.JSX.Element | null {
  const { t } = useTranslation();
  const target = useGraphStore((s) => s.localModelWindow);
  const close = useGraphStore((s) => s.closeLocalModelWindow);
  const local = useGraphStore((s) => s.localLlm);
  const bindLocalModel = useGraphStore((s) => s.bindLocalModel);
  const agentLabel = useGraphStore((s) => (target ? s.nodeMap[target.agentId]?.label : undefined));
  const {
    installEngine, uninstallEngine, searchRepos, listRepoFiles,
    downloadModel, cancelDownload, deleteModel, busy, error,
  } = useLocalLlm();

  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState<LocalModelCatalogRepo[]>([]);
  const [openRepo, setOpenRepo] = useState('');
  const [files, setFiles] = useState<LocalModelCatalogEntry[]>([]);
  const [searching, setSearching] = useState(false);
  // 이 창에서 사용자가 "받기"를 누른 모델. 받기가 끝나면 **묻지 않고** 그 모델로 시작한다 —
  // 준비의 끝이 곧 대화의 시작이라는 것이 이 창의 약속이다(§5.19 (B)).
  const [pendingModelId, setPendingModelId] = useState('');

  const runSearch = useCallback(async (q: string): Promise<void> => {
    setSearching(true);
    setOpenRepo('');
    setFiles([]);
    setRepos(await searchRepos(q));
    setSearching(false);
  }, [searchRepos]);

  const engineInstalled = local?.engine.installed ?? false;
  const models = local?.models ?? [];

  // 창을 열면 인기 목록을 한 번 채워 둔다 — 빈 화면에서 무엇을 쳐야 할지 모르는 상태를 없앤다.
  useEffect(() => {
    if (target && engineInstalled && repos.length === 0 && !searching) void runSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, engineInstalled]);

  // 받기가 끝나는 순간이 이 창의 끝이다 — 그 모델을 버블에 매고, IDE 가 열린다(bindLocalModel).
  useEffect(() => {
    if (!target || !pendingModelId) return;
    const done = models.find((m) => m.id === pendingModelId);
    if (!done) return;
    setPendingModelId('');
    bindLocalModel(target.agentId, done.id, done.name);
  }, [target, pendingModelId, models, bindLocalModel]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, close]);

  if (!target) return null;

  const engine = local?.engine;
  const progress = engine?.progress;
  const installing = progress?.status === 'starting' || progress?.status === 'downloading'
    || progress?.status === 'extracting' || progress?.status === 'verifying';
  const downloads = (local?.downloads ?? []).filter((d) => d.status !== 'done');
  const loaded = new Set(local?.loaded ?? []);

  const pct = (received: number, total: number): number =>
    total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;

  const openFiles = async (repo: string): Promise<void> => {
    if (openRepo === repo) {
      setOpenRepo('');
      setFiles([]);
      return;
    }
    setOpenRepo(repo);
    setFiles(await listRepoFiles(repo));
  };

  /** 고른 모델을 이 버블에 매고 IDE 로 넘어간다(창은 bindLocalModel 이 닫는다). */
  const pick = (modelId: string, modelName: string): void => {
    bindLocalModel(target.agentId, modelId, modelName);
  };

  /** 받기 시작 — 끝나는 것을 지켜보다가 위 effect 가 이어받는다. */
  const startDownload = (entry: LocalModelCatalogEntry): void => {
    setPendingModelId(entry.id);
    void downloadModel(entry.repo, entry.file);
  };

  /** 두 단계(엔진 → 모델) 중 어디까지 왔는지. 창이 스스로 진행을 말한다. */
  const step = (index: number, labelText: string, state: 'done' | 'current' | 'todo'): React.JSX.Element => (
    <span
      className={`flex items-center gap-1.5 ${
        state === 'current' ? 'text-violet-300' : state === 'done' ? 'text-emerald-400' : 'text-gray-600'
      }`}
    >
      {state === 'done' ? (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[12px] leading-none ${
          state === 'current' ? 'border-violet-400' : 'border-gray-700'
        }`}>{index}</span>
      )}
      {labelText}
    </span>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60"
      onMouseDown={close}
    >
      <div
        className="flex max-h-[82vh] w-[680px] flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/60"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 헤더 — 어떤 버블을 준비하는 중인지 이름으로 말한다. */}
        <div className="flex items-center gap-2.5 border-b border-gray-800 px-4 py-3">
          <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8" />
            <path d="M12 16v4" />
            <path d="M7.5 10h3l1.5-2.5L13.5 13l1-3h2" />
          </svg>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm text-gray-100">{t('localModel.title', { defaultValue: 'All Model' })}</span>
            <span className="truncate text-xs text-gray-500">
              {agentLabel
                ? t('localModel.preparingFor', { name: agentLabel, defaultValue: `${agentLabel} 이(가) 쓸 모델을 준비합니다` })
                : t('localModel.subtitle', { defaultValue: '내 PC 에서 도는 모델을 골라 버블에 매답니다' })}
            </span>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
            aria-label={t('common.close', { defaultValue: '닫기' })}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 진행 단계 — 엔진 → 모델 → IDE. 지금 어디인지 창이 먼저 말한다. */}
        <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-2 text-xs">
          {step(1, t('localModel.stepEngine', { defaultValue: '엔진' }), engineInstalled ? 'done' : 'current')}
          <span className="text-gray-700">›</span>
          {step(2, t('localModel.stepModel', { defaultValue: '모델' }), !engineInstalled ? 'todo' : models.length > 0 ? 'done' : 'current')}
          <span className="text-gray-700">›</span>
          <span className="text-gray-600">{t('localModel.stepIde', { defaultValue: 'IDE' })}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {!engineInstalled ? (
            /* ── 엔진이 아직 없다 — 받아서 설치가 먼저다 ── */
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-gray-300">
                {t('localModel.installIntro', {
                  defaultValue: '로컬 모델을 돌리려면 추론 엔진이 필요합니다. 앱 설치 파일을 무겁게 만들지 않으려고 기본 번들에 넣지 않았고, 지금 한 번만 받아 두면 됩니다.',
                })}
              </p>
              <div className="rounded border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs leading-relaxed text-gray-400">
                <div>{t('localModel.installWhat', { defaultValue: '받는 것 — GPU(Vulkan)·CPU 두 벌. 대부분의 그래픽카드가 Vulkan 한 벌로 커버되고, 안 되면 CPU 로 돕니다.' })}</div>
                <div className="mt-1 break-all text-gray-500">
                  {t('localModel.installWhere', { defaultValue: '받는 곳' })}: {engine?.dir ?? ''}
                </div>
              </div>

              {installing ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span className="truncate">{progress?.asset ?? t('localModel.preparing', { defaultValue: '준비 중' })}</span>
                    <span className="shrink-0 tabular-nums">
                      {progress?.stepCount ? `${progress.step ?? 0}/${progress.stepCount} · ` : ''}
                      {formatBytes(progress?.receivedBytes ?? 0)}
                      {progress?.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ''}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded bg-gray-800">
                    <div
                      className="h-full bg-violet-500 transition-all"
                      style={{ width: `${pct(progress?.receivedBytes ?? 0, progress?.totalBytes ?? 0)}%` }}
                    />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void installEngine()}
                  className="self-start rounded bg-violet-600/90 px-3 py-1.5 text-sm text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
                >
                  {t('localModel.install', { defaultValue: '엔진 받아서 설치' })}
                </button>
              )}

              {progress?.status === 'error' && (
                <p className="text-xs leading-relaxed text-red-400">{progress.error}</p>
              )}
            </div>
          ) : (
            /* ── 엔진 준비됨 — 모델을 고른다 ── */
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{t('localModel.engineReady', { defaultValue: '엔진 준비됨' })}</span>
                {engine?.build && <span className="text-gray-600">{engine.build}</span>}
                {engine?.backends.length ? <span className="text-gray-600">{engine.backends.join(' · ')}</span> : null}
                <span className="flex-1" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void uninstallEngine()}
                  className="rounded px-2 py-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300 disabled:opacity-40"
                >
                  {t('localModel.uninstall', { defaultValue: '엔진 삭제' })}
                </button>
              </div>

              {/* 받아 둔 모델 */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-gray-500">{t('localModel.myModels', { defaultValue: '받아 둔 모델' })}</span>
                {models.length === 0 && (
                  <p className="rounded border border-dashed border-gray-800 px-3 py-3 text-xs text-gray-600">
                    {t('localModel.noModels', { defaultValue: '아직 받아 둔 모델이 없습니다. 아래에서 검색해 하나 받아 보세요.' })}
                  </p>
                )}
                {models.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/40 px-3 py-2">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-gray-200">{m.name}</span>
                      <span className="truncate text-xs text-gray-600">
                        {[m.quant, formatBytes(m.sizeBytes), loaded.has(m.id) ? t('localModel.loaded', { defaultValue: '메모리에 올라감' }) : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => pick(m.id, m.name)}
                      className="shrink-0 rounded bg-violet-600/90 px-2.5 py-1 text-xs text-white transition-colors hover:bg-violet-500"
                    >
                      {t('localModel.useModelStart', { defaultValue: '이 모델로 시작' })}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteModel(m.id)}
                      className="shrink-0 rounded px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300 disabled:opacity-40"
                    >
                      {t('localModel.deleteModel', { defaultValue: '삭제' })}
                    </button>
                  </div>
                ))}
              </div>

              {/* 진행 중인 내려받기 */}
              {downloads.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-gray-500">{t('localModel.downloading', { defaultValue: '받는 중' })}</span>
                  {downloads.map((d) => (
                    <div key={d.downloadId} className="flex flex-col gap-1 rounded border border-gray-800 bg-gray-950/40 px-3 py-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate text-gray-300">{d.name}</span>
                        <span className="shrink-0 tabular-nums text-gray-500">
                          {formatBytes(d.receivedBytes)}{d.totalBytes ? ` / ${formatBytes(d.totalBytes)}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (d.modelId === pendingModelId) setPendingModelId('');
                            void cancelDownload(d.downloadId);
                          }}
                          className="shrink-0 rounded px-1.5 py-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
                        >
                          {t('localModel.cancel', { defaultValue: '중단' })}
                        </button>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded bg-gray-800">
                        <div className="h-full bg-violet-500 transition-all" style={{ width: `${pct(d.receivedBytes, d.totalBytes)}%` }} />
                      </div>
                      {d.modelId === pendingModelId && !d.error && (
                        <span className="text-xs text-violet-300">
                          {t('localModel.opensIdeHint', { defaultValue: '받기가 끝나면 이 버블의 IDE 가 바로 열립니다.' })}
                        </span>
                      )}
                      {d.error && <span className="text-xs text-red-400">{d.error}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* 카탈로그 */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-gray-500">{t('localModel.catalog', { defaultValue: '모델 받기' })}</span>
                <div className="flex gap-1.5">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void runSearch(query);
                    }}
                    placeholder={t('localModel.searchPlaceholder', { defaultValue: '모델 이름으로 검색 (예: qwen coder)' })}
                    className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-sm text-gray-200 outline-none placeholder:text-gray-600 focus:border-gray-600"
                  />
                  <button
                    type="button"
                    onClick={() => void runSearch(query)}
                    className="shrink-0 rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800"
                  >
                    {t('localModel.search', { defaultValue: '검색' })}
                  </button>
                </div>

                {searching && <span className="text-xs text-gray-600">{t('localModel.searching', { defaultValue: '찾는 중…' })}</span>}

                {repos.map((r) => (
                  <div key={r.repo} className="rounded border border-gray-800 bg-gray-950/40">
                    <button
                      type="button"
                      onClick={() => void openFiles(r.repo)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-800/50"
                    >
                      <svg
                        className={`h-3.5 w-3.5 shrink-0 text-gray-600 transition-transform ${openRepo === r.repo ? 'rotate-90' : ''}`}
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-300">{r.repo}</span>
                      {r.downloads > 0 && (
                        <span className="shrink-0 text-xs tabular-nums text-gray-600">{r.downloads.toLocaleString()}</span>
                      )}
                    </button>
                    {openRepo === r.repo && (
                      <div className="border-t border-gray-800 px-2 py-1">
                        {files.length === 0 && (
                          <span className="block px-1.5 py-1.5 text-xs text-gray-600">
                            {t('localModel.noFiles', { defaultValue: '이 저장소에서 받을 수 있는 GGUF 를 찾지 못했습니다.' })}
                          </span>
                        )}
                        {files.map((f) => (
                          <div key={f.id} className="flex items-center gap-2 px-1.5 py-1">
                            <span className="min-w-0 flex-1 truncate text-xs text-gray-400">{f.file}</span>
                            {f.quant && <span className="shrink-0 text-xs text-gray-600">{f.quant}</span>}
                            <span className="shrink-0 text-xs tabular-nums text-gray-600">
                              {formatBytes(f.sizeBytes) || t('localModel.sizeUnknown', { defaultValue: '크기 미상' })}
                            </span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => startDownload(f)}
                              className="shrink-0 rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 transition-colors hover:bg-gray-800 disabled:opacity-40"
                            >
                              {t('localModel.download', { defaultValue: '받기' })}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        </div>

        <div className="border-t border-gray-800 px-4 py-2">
          <p className="text-xs leading-relaxed text-gray-600">
            {t('localModel.footerHint', {
              defaultValue: '고른 모델은 이 PC 의 자원으로 돕니다. 준비가 끝나면 이 버블의 IDE 가 열리고, 기존 Claude 버블은 그대로입니다.',
            })}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

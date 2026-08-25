import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  classifyModelFit,
  LOCAL_CONTEXT_MAX,
  LOCAL_CONTEXT_MIN,
  LOCAL_DEFAULT_CONTEXT_SIZE,
  LOCAL_MODEL_CATALOG_SORTS,
  LOCAL_MODEL_TOP_QUANT_COUNT,
  type LocalModelCatalogEntry,
  type LocalModelCatalogRepo,
  type LocalModelCatalogSort,
} from '@vibisual/shared';

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
  const setLocalContextSize = useGraphStore((s) => s.setLocalContextSize);
  const provider = useGraphStore((s) => (target ? s.agentConfigs[target.agentId]?.provider : undefined));
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
  // §5.19 (E) — 목록을 줄 세우는 축. 바꾸면 **다시 물어본다**(우리가 받아 둔 것을 다시
  //   정렬하는 것이 아니다 — 그러면 "하트순 1위"가 이 스무 건 안에서만 1위가 된다).
  const [sort, setSort] = useState<LocalModelCatalogSort>('downloads');
  // §5.19 (E) — 이 PC 로는 무리인 양자화를 아예 빼고 볼지. 판정은 `classifyModelFit` 한 곳.
  const [runnableOnly, setRunnableOnly] = useState(false);
  // §5.19 (E) — 펼친 저장소에서 인기 셋 말고 나머지까지 볼지(저장소를 바꾸면 다시 접힌다).
  const [showAllFiles, setShowAllFiles] = useState(false);
  // 이 창에서 사용자가 "받기"를 누른 모델. 받기가 끝나면 **묻지 않고** 그 모델로 시작한다 —
  // 준비의 끝이 곧 대화의 시작이라는 것이 이 창의 약속이다(§5.19 (B)).
  const [pendingModelId, setPendingModelId] = useState('');
  // 대화 창 크기 — 입력 중인 값은 화면 것이고, 적용을 눌러야 설정으로 간다.
  const boundModelId = provider?.modelId ?? '';
  const savedContext = provider?.contextSize ?? LOCAL_DEFAULT_CONTEXT_SIZE;
  const [contextDraft, setContextDraft] = useState(String(savedContext));
  // 다른 버블을 열거나 서버가 값을 바꾸면 입력칸도 따라간다(내가 고치는 중이 아닐 때만).
  useEffect(() => { setContextDraft(String(savedContext)); }, [savedContext, boundModelId]);
  const contextDirty = contextDraft.trim() !== String(savedContext);

  const runSearch = useCallback(async (q: string, by: LocalModelCatalogSort): Promise<void> => {
    setSearching(true);
    setOpenRepo('');
    setFiles([]);
    setShowAllFiles(false);
    setRepos(await searchRepos(q, by));
    setSearching(false);
  }, [searchRepos]);

  const engineInstalled = local?.engine.installed ?? false;
  const models = local?.models ?? [];
  const hardware = local?.hardware ?? null;

  /**
   * 이 크기가 이 PC 에서 어떻게 돌지 한 조각으로 말한다. 판정은 shared 한 곳에서 하고
   * 여기서는 색과 말만 붙인다 — 화면과 서버가 다르게 말하면 사용자는 둘 다 안 믿는다.
   */
  const fitBadge = (sizeBytes: number): React.JSX.Element | null => {
    const fit = classifyModelFit(sizeBytes, hardware);
    if (fit === 'unknown') return null;
    const label =
      fit === 'gpu'
        ? t('localModel.fitGpu', { defaultValue: 'GPU 로 빠르게' })
        : fit === 'ram'
          ? t('localModel.fitRam', { defaultValue: '메모리로 느리게' })
          : t('localModel.fitTooBig', { defaultValue: '이 PC 로는 무리' });
    const tone = fit === 'gpu' ? 'text-emerald-400' : fit === 'ram' ? 'text-amber-400' : 'text-red-400';
    return <span className={`shrink-0 text-xs ${tone}`}>{label}</span>;
  };

  /** 큰 수는 줄여 적는다 — `12,737,285` 가 통째로 앉으면 저장소 이름이 설 자리를 잃는다. */
  const compact = (n: number): string =>
    new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

  /**
   * §5.19 (E) — 저장소가 스스로 말하는 세 숫자. **0 이면 아예 적지 않는다** — 0 은 "인기가
   * 없다"가 아니라 대개 "카탈로그가 안 줬다"이고, 둘을 같은 얼굴로 보이면 사용자가 오해한다.
   * 줄여 적은 값 뒤의 전체 숫자는 마우스를 올리면 나온다.
   */
  const repoStat = (kind: LocalModelCatalogSort, value: number): React.JSX.Element | null => {
    if (value <= 0) return null;
    const label =
      kind === 'likes'
        ? t('localModel.statLikes', { defaultValue: '하트' })
        : kind === 'trending'
          ? t('localModel.statTrending', { defaultValue: '요즘 인기' })
          : t('localModel.statDownloads', { defaultValue: '내려받기' });
    const icon =
      kind === 'likes' ? (
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      ) : kind === 'trending' ? (
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      ) : (
        <>
          <path d="M12 3v12" />
          <path d="m7 12 5 5 5-5" />
          <path d="M5 21h14" />
        </>
      );
    return (
      <span
        className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-gray-600"
        title={`${label} ${value.toLocaleString()}`}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
        {compact(value)}
      </span>
    );
  };

  // 창을 열면 인기 목록을 한 번 채워 둔다 — 빈 화면에서 무엇을 쳐야 할지 모르는 상태를 없앤다.
  useEffect(() => {
    if (target && engineInstalled && repos.length === 0 && !searching) void runSearch('', sort);
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
    // 저장소를 바꾸면 펼쳐 두었던 나머지는 다시 접는다 — 새 저장소의 첫 화면도 셋이어야 한다.
    setShowAllFiles(false);
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
    void downloadModel(entry.repo, entry.file, entry.partFiles);
  };

  /**
   * §5.19 (E) — 펼친 저장소에서 화면에 세울 양자화들.
   *
   * 걸러 내기가 켜져 있으면 **이 PC 로는 무리인 것**과 **이 엔진이 못 돌리는 구조**를 뺀다.
   * 잴 수 없어 `unknown` 인 것은 빼지 않는다 — 넘겨짚어 감추는 쪽이 늘 더 나쁘다.
   * 순서는 서버가 이미 많이 쓰이는 순으로 세워 보냈으므로 여기서 다시 줄 세우지 않는다.
   */
  const shownFiles = runnableOnly
    ? files.filter((f) => classifyModelFit(f.sizeBytes, hardware) !== 'too-big' && f.archVerdict !== 'broken')
    : files;
  const listedFiles = showAllFiles ? shownFiles : shownFiles.slice(0, LOCAL_MODEL_TOP_QUANT_COUNT);
  const foldedCount = shownFiles.length - listedFiles.length;

  /** 정렬 축의 이름. 축이 늘면 여기 한 곳만 는다. */
  const sortLabel = (by: LocalModelCatalogSort): string =>
    by === 'likes'
      ? t('localModel.sortLikes', { defaultValue: '하트순' })
      : by === 'trending'
        ? t('localModel.sortTrending', { defaultValue: '요즘 뜨는 순' })
        : by === 'recent'
          ? t('localModel.sortRecent', { defaultValue: '최근 갱신순' })
          : t('localModel.sortDownloads', { defaultValue: '많이 받은 순' });

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

              {/* §5.19 (D) — 대화 창 크기. 이 버블이 한 번에 들고 갈 수 있는 말의 양이다. */}
              {boundModelId && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-gray-500">
                    {t('localModel.contextTitle', { defaultValue: '대화 창 크기' })}
                  </span>
                  <div className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/40 px-3 py-2">
                    <input
                      type="number"
                      min={LOCAL_CONTEXT_MIN}
                      max={LOCAL_CONTEXT_MAX}
                      step={1024}
                      value={contextDraft}
                      onChange={(e) => setContextDraft(e.target.value)}
                      className="w-28 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 outline-none focus:border-gray-500"
                    />
                    <span className="text-xs text-gray-500">
                      {t('localModel.contextUnit', { defaultValue: '토큰' })}
                    </span>
                    <span className="flex-1" />
                    <button
                      type="button"
                      disabled={!contextDirty}
                      onClick={() => {
                        const next = Number(contextDraft);
                        if (!Number.isFinite(next)) return;
                        const clamped = Math.min(LOCAL_CONTEXT_MAX, Math.max(LOCAL_CONTEXT_MIN, Math.round(next)));
                        setContextDraft(String(clamped));
                        setLocalContextSize(target.agentId, clamped);
                      }}
                      className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-40"
                    >
                      {t('localModel.contextApply', { defaultValue: '적용' })}
                    </button>
                  </div>
                  <p className="text-[12px] leading-relaxed text-gray-600">
                    {t('localModel.contextHint', {
                      defaultValue:
                        '길수록 더 오래 기억하지만 메모리를 더 쓰고 느려집니다. 모델이 학습된 길이보다 크게 잡으면 그 길이로 낮춰서 씁니다. 바꾼 값은 이 모델을 다음에 올릴 때부터 적용됩니다.',
                    })}
                  </p>
                </div>
              )}

              {/* §5.19 (D) — 이 대화가 지금까지 쓴 토큰. 청구는 0이지만 양·속도의 감각은 필요하다. */}
              {boundModelId && (provider?.tokensIn ?? 0) > 0 && (
                <div className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/40 px-3 py-2 text-xs text-gray-500">
                  <span>{t('localModel.usageTitle', { defaultValue: '이 대화에서 쓴 토큰' })}</span>
                  <span className="text-gray-300">
                    {t('localModel.usageLine', {
                      defaultValue: '읽음 {{in}} · 씀 {{out}}',
                      in: (provider?.tokensIn ?? 0).toLocaleString(),
                      out: (provider?.tokensOut ?? 0).toLocaleString(),
                    })}
                  </span>
                </div>
              )}

              {/* 받아 둔 모델 */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-gray-500">{t('localModel.myModels', { defaultValue: '받아 둔 모델' })}</span>
                {models.length === 0 && (
                  <p className="rounded border border-dashed border-gray-800 px-3 py-3 text-xs text-gray-600">
                    {t('localModel.noModels', { defaultValue: '아직 받아 둔 모델이 없습니다. 아래에서 검색해 하나 받아 보세요.' })}
                  </p>
                )}
                {models.map((m) => {
                  // 조각이 빠졌거나 부속 파일이면 고를 수 없다 — 고르면 엔진이 죽는 것
                  //   말고는 사용자가 알 길이 없다.
                  const missing = m.missingParts?.length ?? 0;
                  const blocked = missing > 0 || m.companion === true;
                  return (
                  <div key={m.id} className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/40 px-3 py-2">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-gray-200">{m.name}</span>
                      <span className="truncate text-xs text-gray-600">
                        {[
                          m.quant,
                          formatBytes(m.sizeBytes),
                          m.partCount && m.partCount > 1
                            ? t('localModel.partCount', { defaultValue: '{{count}}조각', count: m.partCount })
                            : '',
                          loaded.has(m.id) ? t('localModel.loaded', { defaultValue: '메모리에 올라감' }) : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {missing > 0 && (
                        <span className="truncate text-xs text-amber-400">
                          {t('localModel.missingParts', {
                            defaultValue: '조각 {{total}}개 중 {{missing}}개가 없어 쓸 수 없습니다 — 다시 받아 주세요',
                            total: m.partCount ?? 0,
                            missing,
                          })}
                        </span>
                      )}
                      {m.companion === true && (
                        <span className="truncate text-xs text-amber-400">
                          {t('localModel.companionFile', {
                            defaultValue: '본체 모델이 아니라 부속 파일입니다 — 혼자서는 돌지 않습니다',
                          })}
                        </span>
                      )}
                      {/* 받자마자 한 번 말을 시켜 본 결과. 막지 않고 알리기만 한다. */}
                      {m.outputCheck === 'broken' && (
                        <span className="truncate text-xs text-red-400">
                          {t('localModel.outputBroken', {
                            defaultValue: '지금 엔진으로는 뜻 있는 말을 내지 못했습니다 — 다른 모델을 권합니다',
                          })}
                        </span>
                      )}
                    </div>
                    {missing === 0 && m.companion !== true && fitBadge(m.sizeBytes)}
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => pick(m.id, m.name)}
                      className="shrink-0 rounded bg-violet-600/90 px-2.5 py-1 text-xs text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
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
                  );
                })}
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
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{t('localModel.catalog', { defaultValue: '모델 받기' })}</span>
                  <span className="flex-1" />
                  {/* 무엇을 기준으로 "돌아갑니다"라고 말하는지 그 근거를 같이 보여 준다. */}
                  {hardware && hardware.measuredAt > 0 && (
                    <span className="truncate text-xs text-gray-600">
                      {hardware.devices[0]
                        ? t('localModel.hardwareGpu', {
                            defaultValue: '{{device}} · 여유 {{vram}} · 램 {{ram}}',
                            device: hardware.devices[0].name,
                            vram: formatBytes(hardware.vramFreeBytes),
                            ram: formatBytes(hardware.totalRamBytes),
                          })
                        : t('localModel.hardwareCpu', {
                            defaultValue: '가속 장치 없음 · 램 {{ram}}',
                            ram: formatBytes(hardware.totalRamBytes),
                          })}
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void runSearch(query, sort);
                    }}
                    placeholder={t('localModel.searchPlaceholder', { defaultValue: '모델 이름으로 검색 (예: qwen coder)' })}
                    className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-sm text-gray-200 outline-none placeholder:text-gray-600 focus:border-gray-600"
                  />
                  <button
                    type="button"
                    onClick={() => void runSearch(query, sort)}
                    className="shrink-0 rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800"
                  >
                    {t('localModel.search', { defaultValue: '검색' })}
                  </button>
                </div>

                {/* §5.19 (E) — 줄 세우는 축(카탈로그에 그대로 넘긴다) + 이 PC 에서 되는 것만 보기. */}
                <div className="flex flex-wrap items-center gap-1">
                  {LOCAL_MODEL_CATALOG_SORTS.map((by) => (
                    <button
                      key={by}
                      type="button"
                      onClick={() => {
                        setSort(by);
                        void runSearch(query, by);
                      }}
                      className={`rounded px-2 py-0.5 text-xs transition-colors ${
                        sort === by ? 'bg-violet-600/80 text-white' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
                      }`}
                    >
                      {sortLabel(by)}
                    </button>
                  ))}
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => setRunnableOnly((v) => !v)}
                    className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
                      runnableOnly ? 'bg-emerald-600/80 text-white' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
                    }`}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 5h18l-7 8v6l-4 2v-8Z" />
                    </svg>
                    {t('localModel.runnableOnly', { defaultValue: '이 PC 에서 되는 것만' })}
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
                      {/* 이 저장소가 스스로 말하는 것들 — 우리가 매긴 점수는 하나도 없다. */}
                      {repoStat('downloads', r.downloads)}
                      {repoStat('likes', r.likes)}
                      {repoStat('trending', r.trending)}
                      {r.updatedAt > 0 && (
                        <span className="shrink-0 text-xs tabular-nums text-gray-600">
                          {new Date(r.updatedAt).toLocaleDateString()}
                        </span>
                      )}
                    </button>
                    {openRepo === r.repo && (
                      <div className="border-t border-gray-800 px-2 py-1">
                        {files.length === 0 && (
                          <span className="block px-1.5 py-1.5 text-xs text-gray-600">
                            {t('localModel.noFiles', { defaultValue: '이 저장소에서 받을 수 있는 GGUF 를 찾지 못했습니다.' })}
                          </span>
                        )}
                        {/* 걸러 내기 때문에 한 줄도 안 남은 것과 애초에 없는 것은 다른 사정이다. */}
                        {files.length > 0 && shownFiles.length === 0 && (
                          <span className="block px-1.5 py-1.5 text-xs text-amber-400">
                            {t('localModel.noRunnableFiles', {
                              defaultValue: '이 저장소에는 이 PC 에서 돌릴 수 있는 것이 없습니다 — 위의 걸러 내기를 끄면 전부 보입니다.',
                            })}
                          </span>
                        )}
                        {/* 왜 몇 줄만 보이는지 먼저 말한다 — 설명 없는 빈자리는 고장으로 읽힌다. */}
                        {!showAllFiles && foldedCount > 0 && (
                          <span className="block px-1.5 py-1 text-xs text-gray-600">
                            {t('localModel.topQuantHint', { defaultValue: '많이 쓰이는 순' })}
                          </span>
                        )}
                        {listedFiles.map((f) => (
                          <div key={f.id} className="flex items-center gap-2 px-1.5 py-1">
                            <span className="min-w-0 flex-1 truncate text-xs text-gray-400">{f.file}</span>
                            {f.partFiles && f.partFiles.length > 1 && (
                              <span className="shrink-0 text-xs text-gray-600">
                                {t('localModel.partCount', { defaultValue: '{{count}}조각', count: f.partFiles.length })}
                              </span>
                            )}
                            {f.quant && <span className="shrink-0 text-xs text-gray-600">{f.quant}</span>}
                            <span className="shrink-0 text-xs tabular-nums text-gray-600">
                              {formatBytes(f.sizeBytes) || t('localModel.sizeUnknown', { defaultValue: '크기 미상' })}
                            </span>
                            {/* 이 엔진이 못 돌리는 구조면 받기 자체를 막는다 — 받아 봐야 못 쓴다. */}
                            {f.archVerdict === 'broken' ? (
                              <span className="shrink-0 text-xs text-red-400" title={f.archReason ?? ''}>
                                {t('localModel.archUnsupported', { defaultValue: '지금 엔진으로는 안 됩니다' })}
                              </span>
                            ) : (
                              fitBadge(f.sizeBytes)
                            )}
                            <button
                              type="button"
                              disabled={busy || f.archVerdict === 'broken'}
                              onClick={() => startDownload(f)}
                              className="shrink-0 rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {t('localModel.download', { defaultValue: '받기' })}
                            </button>
                          </div>
                        ))}
                        {/* 나머지는 숨긴 것이 아니라 미뤄 둔 것이다 — 한 번 누르면 전부 선다. */}
                        {foldedCount > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowAllFiles(true)}
                            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
                          >
                            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="5" cy="12" r="1" />
                              <circle cx="12" cy="12" r="1" />
                              <circle cx="19" cy="12" r="1" />
                            </svg>
                            {t('localModel.showAllQuants', { defaultValue: '나머지 {{count}}개 모두 보기', count: foldedCount })}
                          </button>
                        )}
                        {showAllFiles && shownFiles.length > LOCAL_MODEL_TOP_QUANT_COUNT && (
                          <button
                            type="button"
                            onClick={() => setShowAllFiles(false)}
                            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
                          >
                            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="m18 15-6-6-6 6" />
                            </svg>
                            {t('localModel.showFewerQuants', { defaultValue: '많이 쓰이는 것만 보기' })}
                          </button>
                        )}
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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AVAILABLE_PERMISSION_MODES,
  LAB_MAX_VARIANTS,
  LAB_RULES_APPEND_MAX,
  listEffortLevels,
  listModelFamilies,
} from '@vibisual/shared';
import type { LabResult, LabVariant, LabVariantConfig } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';

/**
 * §5.18 / §7.17 — 에이전트 랩 패널.
 *
 * 랩 버블 더블클릭으로 열리는 전체 화면 오버레이(§7.14 `SpecBoardPanel` 과 같은 골격).
 * 위는 모든 변형에 **똑같이** 나가는 과제, 아래는 변형별 결과 비교 표다 — 그리고 거기서
 * **이긴 줄의 설정을 기본값으로 승격**한다. 상태·성공 여부·비용은 전부 서버가 판정한 값이고
 * 이 화면은 그리기만 한다(§3.1).
 */

function CloseGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function TrashGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

function PlayGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M6 4l14 8-14 8z" />
    </svg>
  );
}

function TrophyGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
    </svg>
  );
}

/** 값이 없으면 `—`. 0 으로 채우면 "공짜로 끝났다"는 거짓말이 된다(§5.18). */
const EMPTY = '—';

function fmtNumber(n: number | undefined): string {
  if (n === undefined) return EMPTY;
  return n.toLocaleString();
}

function fmtCost(usd: number | undefined): string {
  if (usd === undefined) return EMPTY;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtDuration(ms: number | undefined): string {
  if (ms === undefined) return EMPTY;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

function fmtTokens(result: LabResult | undefined): string {
  if (!result) return EMPTY;
  const { inputTokens, outputTokens } = result;
  if (inputTokens === undefined && outputTokens === undefined) return EMPTY;
  return `${fmtNumber(inputTokens)} / ${fmtNumber(outputTokens)}`;
}

export function LabPanel(): React.JSX.Element | null {
  const { t } = useTranslation();
  const openId = useGraphStore((s) => s.labPanelOpenId);
  const close = useGraphStore((s) => s.closeLabPanel);
  const labRuns = useGraphStore((s) => s.labRuns);
  const agents = useGraphStore((s) => s.agents);
  const modelRegistry = useGraphStore((s) => s.modelRegistry);
  const updateLabRun = useGraphStore((s) => s.updateLabRun);
  const setLabVariants = useGraphStore((s) => s.setLabVariants);
  const addLabVariant = useGraphStore((s) => s.addLabVariant);
  const removeLabVariant = useGraphStore((s) => s.removeLabVariant);
  const startLabRun = useGraphStore((s) => s.startLabRun);
  const promoteLabVariant = useGraphStore((s) => s.promoteLabVariant);
  const selectNode = useGraphStore((s) => s.selectNode);

  const run = useMemo(() => labRuns.find((r) => r.id === openId) ?? null, [labRuns, openId]);

  /** 제목·과제는 타이핑 동안 로컬에 두고 blur 에서만 서버로(매 글자 왕복 ❌). */
  const [titleDraft, setTitleDraft] = useState('');
  const [taskDraft, setTaskDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitleDraft(run?.title ?? '');
    setTaskDraft(run?.task ?? '');
  }, [run?.id]);

  useEffect(() => {
    if (!openId) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId, close]);

  // 모델·effort 목록은 설치된 CLI 가 실제로 받는 값에서 온다(하드코딩 ❌ — AgentConfigPopup 과 같은 규율).
  const modelOptions = useMemo(() => listModelFamilies(modelRegistry), [modelRegistry]);
  const effortOptions = useMemo(() => listEffortLevels(modelRegistry), [modelRegistry]);

  const isRunning = run?.status === 'running';

  /**
   * 기준·승격 대상 후보 — **커스텀 에이전트만**. 훅 버블은 `AgentConfig` 자체가 없어
   * 설정을 물려주지도, 승격을 받지도 못한다(서버가 404 로 거절한다).
   */
  const baseAgentOptions = useMemo(
    () => agents.filter((a) => a.customCreated === true && a.trashed !== true),
    [agents],
  );

  const counts = useMemo(() => {
    if (!run) return { total: 0, finished: 0, running: 0 };
    let finished = 0;
    let running = 0;
    for (const v of run.variants) {
      if (!v.result) continue;
      if (v.result.status === 'running') running += 1;
      else finished += 1;
    }
    return { total: run.variants.length, finished, running };
  }, [run]);

  const commitTitle = useCallback((): void => {
    if (!run) return;
    const next = titleDraft.trim();
    if (next === run.title) return;
    void updateLabRun(run.id, { title: next });
  }, [run, titleDraft, updateLabRun]);

  const commitTask = useCallback((): void => {
    if (!run) return;
    if (taskDraft === run.task) return;
    void updateLabRun(run.id, { task: taskDraft });
  }, [run, taskDraft, updateLabRun]);

  /** 변형 한 줄의 설정을 고친다 — 목록 전체를 보낸다(서버가 id 로 무엇이 달라졌는지 판정). */
  const patchVariant = useCallback((variantId: string, patch: Partial<LabVariantConfig> & { label?: string }): void => {
    if (!run) return;
    const next = run.variants.map((v) => {
      if (v.id !== variantId) return { id: v.id, label: v.label, config: v.config };
      const { label, ...cfg } = patch;
      return {
        id: v.id,
        label: label ?? v.label,
        config: { ...v.config, ...cfg },
      };
    });
    void setLabVariants(run.id, next);
  }, [run, setLabVariants]);

  const startAll = useCallback((): void => {
    if (!run) return;
    setBusy(true);
    void startLabRun(run.id).finally(() => setBusy(false));
  }, [run, startLabRun]);

  const startOne = useCallback((variantId: string): void => {
    if (!run) return;
    setBusy(true);
    void startLabRun(run.id, [variantId]).finally(() => setBusy(false));
  }, [run, startLabRun]);

  const promote = useCallback((variantId: string): void => {
    if (!run) return;
    setBusy(true);
    void promoteLabVariant(run.id, variantId).finally(() => setBusy(false));
  }, [run, promoteLabVariant]);

  if (!openId || !run) return null;

  const statusChip = (variant: LabVariant): React.JSX.Element => {
    const status = variant.result?.status;
    const map: Record<string, { text: string; cls: string }> = {
      running: { text: t('canvas.lab.status.running', { defaultValue: '도는 중' }), cls: 'bg-sky-900/60 text-sky-200' },
      success: { text: t('canvas.lab.status.success', { defaultValue: '성공' }), cls: 'bg-emerald-900/60 text-emerald-200' },
      failed: { text: t('canvas.lab.status.failed', { defaultValue: '실패' }), cls: 'bg-rose-900/60 text-rose-200' },
      stopped: { text: t('canvas.lab.status.stopped', { defaultValue: '중단' }), cls: 'bg-amber-900/60 text-amber-200' },
      pending: { text: t('canvas.lab.status.pending', { defaultValue: '대기' }), cls: 'bg-gray-800 text-gray-400' },
    };
    const entry = map[status ?? 'pending'] ?? map['pending']!;
    return <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${entry.cls}`}>{entry.text}</span>;
  };

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-gray-950/95 backdrop-blur-sm">
      {/* 헤더 — 제목 인라인 편집 + 상태 + 전부 실행 + 닫기 */}
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-800 px-4 py-3">
        <span className="rounded bg-orange-900/60 px-2 py-1 text-[12px] font-semibold uppercase tracking-wide text-orange-200">
          {t('canvas.lab.title', { defaultValue: '랩' })}
        </span>
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          placeholder={t('canvas.lab.untitled', { defaultValue: '제목 없는 랩' })}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-gray-100 outline-none transition-colors hover:border-gray-700 focus:border-orange-600"
        />
        <span className="shrink-0 rounded bg-gray-800 px-2 py-1 text-[12px] text-gray-400">
          {isRunning
            ? t('canvas.lab.progressRunning', {
              done: counts.finished,
              total: counts.total,
              defaultValue: '실행 중 {{done}}/{{total}}',
            })
            : t('canvas.lab.progressIdle', {
              done: counts.finished,
              total: counts.total,
              defaultValue: '완료 {{done}}/{{total}}',
            })}
        </span>
        <button
          type="button"
          onClick={startAll}
          disabled={busy || counts.total === 0 || run.task.trim() === ''}
          title={run.task.trim() === ''
            ? t('canvas.lab.startNoTaskHint', { defaultValue: '먼저 과제를 적으세요' })
            : undefined}
          className="flex shrink-0 items-center gap-1.5 rounded bg-orange-600 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-orange-500 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
        >
          <PlayGlyph />
          {t('canvas.lab.startAll', { defaultValue: '전부 실행' })}
        </button>
        <button
          type="button"
          onClick={close}
          className="shrink-0 rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          aria-label={t('common.close', { defaultValue: '닫기' })}
        >
          <CloseGlyph />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* 과제 — 모든 변형에 똑같이 나가는 문장. 도는 중에는 잠긴다. */}
        <div className="shrink-0 px-4 pt-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <span>{t('canvas.lab.taskLabel', { defaultValue: '과제 (모든 변형에 같은 문장)' })}</span>
            {isRunning ? (
              <span className="normal-case text-amber-300">
                {t('canvas.lab.taskLocked', { defaultValue: '실행 중에는 과제를 바꿀 수 없습니다' })}
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-1.5 normal-case text-gray-400">
              {t('canvas.lab.baseAgentLabel', { defaultValue: '기준 설정' })}
              <select
                value={run.baseAgentId ?? ''}
                onChange={(e) => { void updateLabRun(run.id, { baseAgentId: e.target.value }); }}
                title={t('canvas.lab.baseAgentHint', { defaultValue: '변형이 물려받을 설정, 그리고 승격이 저장될 대상 에이전트입니다.' })}
                className="rounded border border-gray-800 bg-gray-950 px-2 py-1 text-[13px] text-gray-200 outline-none focus:border-orange-700"
              >
                <option value="">{t('canvas.lab.baseAgentNone', { defaultValue: '(고르지 않음 — 새 카드 기본 설정)' })}</option>
                {baseAgentOptions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </span>
          </div>
          <textarea
            value={taskDraft}
            onChange={(e) => setTaskDraft(e.target.value)}
            onBlur={commitTask}
            disabled={isRunning}
            spellCheck={false}
            rows={4}
            placeholder={t('canvas.lab.taskPlaceholder', { defaultValue: '무엇을 시킬지 한 벌만 적습니다. 변형끼리 다른 것은 설정뿐이어야 비교가 성립합니다.' })}
            className="mt-2 w-full resize-none rounded-lg border border-gray-800 bg-gray-900 p-3 font-mono text-[13px] leading-relaxed text-gray-200 outline-none transition-colors focus:border-orange-700 disabled:opacity-60"
          />
        </div>

        {/* 비교 표 — 한 줄 = 한 변형 */}
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500">
                <th className="border-b border-gray-800 px-2 py-2 font-semibold">{t('canvas.lab.col.variant', { defaultValue: '변형' })}</th>
                <th className="border-b border-gray-800 px-2 py-2 font-semibold">{t('canvas.lab.col.model', { defaultValue: '모델' })}</th>
                <th className="border-b border-gray-800 px-2 py-2 font-semibold">{t('canvas.lab.col.effort', { defaultValue: 'Effort' })}</th>
                <th className="border-b border-gray-800 px-2 py-2 font-semibold">{t('canvas.lab.col.permission', { defaultValue: '권한' })}</th>
                <th className="border-b border-gray-800 px-2 py-2 font-semibold">{t('canvas.lab.col.status', { defaultValue: '상태' })}</th>
                <th className="border-b border-gray-800 px-2 py-2 font-semibold">{t('canvas.lab.col.duration', { defaultValue: '소요' })}</th>
                <th className="border-b border-gray-800 px-2 py-2 font-semibold">{t('canvas.lab.col.files', { defaultValue: '파일' })}</th>
                <th className="border-b border-gray-800 px-2 py-2 font-semibold">{t('canvas.lab.col.lines', { defaultValue: '±줄' })}</th>
                <th className="border-b border-gray-800 px-2 py-2 font-semibold">{t('canvas.lab.col.tokens', { defaultValue: '토큰 (입/출)' })}</th>
                <th className="border-b border-gray-800 px-2 py-2 font-semibold">{t('canvas.lab.col.cost', { defaultValue: '비용' })}</th>
                <th className="border-b border-gray-800 px-2 py-2 font-semibold">{t('canvas.lab.col.actions', { defaultValue: '동작' })}</th>
              </tr>
            </thead>
            <tbody>
              {run.variants.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-2 py-6 text-center text-gray-500">
                    {t('canvas.lab.noVariants', { defaultValue: '변형이 없습니다. 아래에서 설정 조합을 더하세요.' })}
                  </td>
                </tr>
              ) : run.variants.map((v) => {
                const r = v.result;
                const promoted = run.promotedVariantId === v.id;
                return (
                  <tr key={v.id} className="align-top text-gray-300 odd:bg-gray-900/40">
                    <td className="border-b border-gray-800/60 px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-gray-100">{v.label}</span>
                        {promoted ? (
                          <span className="flex items-center gap-1 rounded bg-amber-900/60 px-1.5 py-0.5 text-[12px] font-semibold text-amber-200">
                            <TrophyGlyph />
                            {t('canvas.lab.promotedBadge', { defaultValue: '기본값' })}
                          </span>
                        ) : null}
                      </div>
                      {r?.summary ? (
                        <div className="mt-1 line-clamp-2 max-w-[240px] text-[12px] text-gray-500">{r.summary}</div>
                      ) : null}
                    </td>
                    <td className="border-b border-gray-800/60 px-2 py-2 text-gray-400">{r?.model ?? v.config.model ?? EMPTY}</td>
                    <td className="border-b border-gray-800/60 px-2 py-2 text-gray-400">{v.config.effort ?? EMPTY}</td>
                    <td className="border-b border-gray-800/60 px-2 py-2 text-gray-400">{v.config.permissionMode ?? EMPTY}</td>
                    <td className="border-b border-gray-800/60 px-2 py-2">{statusChip(v)}</td>
                    <td className="border-b border-gray-800/60 px-2 py-2 text-gray-400">{fmtDuration(r?.durationMs)}</td>
                    <td className="border-b border-gray-800/60 px-2 py-2 text-gray-400">{fmtNumber(r?.filesChanged)}</td>
                    <td className="border-b border-gray-800/60 px-2 py-2 text-gray-400">
                      {r?.additions === undefined && r?.deletions === undefined
                        ? EMPTY
                        : `+${r?.additions ?? 0} / -${r?.deletions ?? 0}`}
                    </td>
                    <td className="border-b border-gray-800/60 px-2 py-2 text-gray-400">{fmtTokens(r)}</td>
                    <td className="border-b border-gray-800/60 px-2 py-2 text-gray-400">{fmtCost(r?.costUsd)}</td>
                    <td className="border-b border-gray-800/60 px-2 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => startOne(v.id)}
                          disabled={busy || r?.status === 'running' || run.task.trim() === ''}
                          className="rounded bg-gray-800 px-2 py-1 text-[12px] text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-600"
                        >
                          {r ? t('canvas.lab.rerun', { defaultValue: '다시 실행' }) : t('canvas.lab.runOne', { defaultValue: '실행' })}
                        </button>
                        <button
                          type="button"
                          onClick={() => promote(v.id)}
                          disabled={busy || r?.status !== 'success'}
                          title={r?.status !== 'success'
                            ? t('canvas.lab.promoteHint', { defaultValue: '성공한 변형만 승격할 수 있습니다' })
                            : undefined}
                          className="rounded bg-orange-900/60 px-2 py-1 text-[12px] font-semibold text-orange-200 transition-colors hover:bg-orange-800/60 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-600"
                        >
                          {t('canvas.lab.promote', { defaultValue: '기본값으로 승격' })}
                        </button>
                        {v.agentId ? (
                          <button
                            type="button"
                            onClick={() => { if (v.agentId) selectNode(v.agentId); close(); }}
                            className="rounded px-2 py-1 text-[12px] text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
                          >
                            {t('canvas.lab.openCard', { defaultValue: '카드 보기' })}
                          </button>
                        ) : null}
                      </div>
                      {r?.error && r.status !== 'success' ? (
                        <div className="mt-1 line-clamp-2 max-w-[220px] text-[12px] text-rose-300">{r.error}</div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 변형 편집 — 이름·모델·effort·권한·최대 턴·덧말 */}
        <div className="max-h-[38%] shrink-0 overflow-y-auto border-t border-gray-800 px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <span>{t('canvas.lab.variantEditor', { defaultValue: '변형 설정' })}</span>
            <span className="text-gray-400">{run.variants.length}/{LAB_MAX_VARIANTS}</span>
            <button
              type="button"
              onClick={() => { void addLabVariant(run.id); }}
              disabled={run.variants.length >= LAB_MAX_VARIANTS}
              className="ml-auto rounded bg-gray-800 px-2 py-1 text-[12px] normal-case text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-600"
            >
              {t('canvas.lab.addVariant', { defaultValue: '변형 추가' })}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {run.variants.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/60 px-2 py-2">
                <input
                  value={v.label}
                  onChange={(e) => patchVariant(v.id, { label: e.target.value })}
                  className="w-28 rounded border border-gray-800 bg-gray-950 px-2 py-1 text-[13px] text-gray-200 outline-none focus:border-orange-700"
                />
                <select
                  value={v.config.model ?? ''}
                  onChange={(e) => patchVariant(v.id, { model: e.target.value })}
                  className="rounded border border-gray-800 bg-gray-950 px-2 py-1 text-[13px] text-gray-200 outline-none focus:border-orange-700"
                >
                  <option value="">{t('canvas.lab.inherit', { defaultValue: '(기준 설정 그대로)' })}</option>
                  {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select
                  value={v.config.effort ?? ''}
                  onChange={(e) => patchVariant(v.id, { effort: e.target.value })}
                  className="rounded border border-gray-800 bg-gray-950 px-2 py-1 text-[13px] text-gray-200 outline-none focus:border-orange-700"
                >
                  <option value="">{t('canvas.lab.inherit', { defaultValue: '(기준 설정 그대로)' })}</option>
                  {effortOptions.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
                <select
                  value={v.config.permissionMode ?? ''}
                  onChange={(e) => patchVariant(v.id, { permissionMode: e.target.value })}
                  className="rounded border border-gray-800 bg-gray-950 px-2 py-1 text-[13px] text-gray-200 outline-none focus:border-orange-700"
                >
                  <option value="">{t('canvas.lab.inherit', { defaultValue: '(기준 설정 그대로)' })}</option>
                  {AVAILABLE_PERMISSION_MODES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input
                  type="number"
                  min={1}
                  value={v.config.maxTurns ?? ''}
                  onChange={(e) => patchVariant(v.id, { maxTurns: e.target.value === '' ? undefined : Number(e.target.value) })}
                  placeholder={t('canvas.lab.maxTurns', { defaultValue: '최대 턴' })}
                  className="w-24 rounded border border-gray-800 bg-gray-950 px-2 py-1 text-[13px] text-gray-200 outline-none focus:border-orange-700"
                />
                <input
                  value={v.config.rulesAppend ?? ''}
                  onChange={(e) => patchVariant(v.id, { rulesAppend: e.target.value.slice(0, LAB_RULES_APPEND_MAX) })}
                  placeholder={t('canvas.lab.rulesAppend', { defaultValue: '이 변형에만 붙일 덧말(선택)' })}
                  className="min-w-[180px] flex-1 rounded border border-gray-800 bg-gray-950 px-2 py-1 text-[13px] text-gray-200 outline-none focus:border-orange-700"
                />
                <button
                  type="button"
                  onClick={() => { void removeLabVariant(run.id, v.id); }}
                  className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-rose-300"
                  aria-label={t('canvas.lab.removeVariant', { defaultValue: '변형 삭제' })}
                >
                  <TrashGlyph />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

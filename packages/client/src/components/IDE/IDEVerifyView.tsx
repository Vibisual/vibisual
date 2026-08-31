import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VerificationRun, VerificationDemo, VerificationRecipeSource } from '@vibisual/shared';
import { isReadOnlyHookAgent, VERIFICATION_FOCUS_MAX } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useCapturePlaytestStore } from '../../stores/capturePlaytest.js';
import { useVerifyDemoStore, verifyRecorderKey } from '../../stores/verifyDemo.js';
import { useIDEPaneValue } from './idePane.js';
import { ScrollFade } from '../ScrollFade.js';
import { demoHasContent, demoSummaryParts, formatDemoTime } from './verifyDemo.js';

// §5.5 #17-35 ⑦⑨-5 — 검증(Verify) 사이드바 뷰.
//
// 스킬(#17-4)·목표(#17-17 ④)·루프(#17-11 ⑨)와 **같은 자리**(`w-52`)에 뜬다 — 검증은 화면을
// 가로채는 것이 아니라 세션이 지금 무엇을 하는지 보면서 곁눈으로 돌리는 것이기 때문이다.
//
// 단위는 **지금 열려 있는 IDE 세션 탭 하나**다. 탭을 바꾸면 그 탭의 검증 이력이 보인다.
//
// 실행·판정·정리는 전부 서버(SSOT)가 한다. 이 컴포넌트는 시작 요청을 보내고, 되돌아오는
// `graph_snapshot` 의 `verificationRuns`·`verificationDemos` 를 **그대로** 그린다(낙관적 판정 표시 ❌ —
// 통과했다고 먼저 칠해 놓고 뒤집히면 그 화면은 거짓말을 한 것이 된다).
//
// ⑨ 시연은 **여기서 시작하고 여기서 고른다.** 다만 실제 스트림·녹화기는 `VerifyRecorderHost` 가
// 쥔다 — 이 뷰가 접혀도 녹화가 끊기지 않아야 하기 때문이다(⑩ 은 몇 분씩 돈다).

/** 통합 앱은 같은 오리진에서 서빙된다 — 형제 IDE 컴포넌트와 같은 규약. */
const API_BASE = '';

const EMPTY_RUNS: VerificationRun[] = [];
const EMPTY_DEMOS: VerificationDemo[] = [];

/** kebab 코드(`play-recipe`·`already-running`) → camelCase i18n 키(docs/rules/i18n.md 네이밍). */
function toKey(code: string): string {
  return code.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** 판정 칩 색 — 통과/실패/보류/모름. 로직 분기가 아니라 테이블이다(§3.3). */
const VERDICT_TONE: Record<string, string> = {
  pass: 'bg-emerald-500/20 text-emerald-300',
  fail: 'bg-rose-500/20 text-rose-300',
  held: 'bg-amber-500/20 text-amber-300',
  unknown: 'bg-gray-700/70 text-gray-300',
};

/** 소요(ms)를 사람이 읽는 한 줄로. */
function formatDuration(ms: number | undefined): string {
  if (!ms || ms < 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

/** 찍은 시각을 짧게(로케일 기본 시:분). */
function formatAt(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

interface Props {
  agentId: string;
}

export const IDEVerifyView = memo(function IDEVerifyView({ agentId }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);

  // 세션 탭 하나의 이력만 본다. 선택자에서 새 배열을 만들지 않는다 — 만들면 매 렌더가
  // "캐시 안 된 스냅샷"이 되어 무한 리렌더로 간다(zustand 파생 선택자 함정).
  const runs = useGraphStore((s) => (activeSessionId ? s.verificationRuns[activeSessionId] : undefined)) ?? EMPTY_RUNS;
  const demos = useGraphStore((s) => (activeSessionId ? s.verificationDemos[activeSessionId] : undefined)) ?? EMPTY_DEMOS;
  const startVerification = useGraphStore((s) => s.startVerification);
  const stopVerification = useGraphStore((s) => s.stopVerification);
  const reworkVerification = useGraphStore((s) => s.reworkVerification);
  const deleteVerificationRun = useGraphStore((s) => s.deleteVerificationRun);
  const deleteVerificationDemo = useGraphStore((s) => s.deleteVerificationDemo);
  // §5.5 #17-29 — 훅 버블은 전면 읽기 전용. 검증은 명령을 넣는 입력구라 실행 손잡이를 잠근다.
  const isReadOnlyAgent = useGraphStore((s) => isReadOnlyHookAgent(s.nodeMap[agentId]));

  // ⑨⑩ 녹화 — 상태만 읽고, 실제 녹화기는 `VerifyRecorderHost` 가 쥔다.
  const source = useVerifyDemoStore((s) => (activeSessionId ? s.source[activeSessionId] : undefined));
  const recordingFor = useVerifyDemoStore((s) => s.recordingFor);
  const liveStream = useVerifyDemoStore((s) => s.stream);
  const streamError = useVerifyDemoStore((s) => s.streamError);
  const openPicker = useVerifyDemoStore((s) => s.openPicker);
  const startRecordingTarget = useVerifyDemoStore((s) => s.startRecording);
  const stopRecordingTarget = useVerifyDemoStore((s) => s.stopRecording);
  const openWindow = useVerifyDemoStore((s) => s.openWindow);
  const recordRun = useVerifyDemoStore((s) => (activeSessionId ? s.recordRun[activeSessionId] === true : false));
  const setRecordRun = useVerifyDemoStore((s) => s.setRecordRun);
  const pickedDemoId = useVerifyDemoStore((s) => (activeSessionId ? s.pickedDemo[activeSessionId] : undefined));
  const setPickedDemo = useVerifyDemoStore((s) => s.setPickedDemo);
  const runClip = useVerifyDemoStore((s) => s.runClip);

  const recorderKey = activeSessionId ? verifyRecorderKey(activeSessionId) : '';
  const isRecording = useCapturePlaytestStore((s) => (recorderKey ? s.recording[recorderKey] !== undefined : false));
  const recordingStartedAt = useCapturePlaytestStore((s) => (recorderKey ? s.recording[recorderKey]?.startedAt : undefined));

  const [focus, setFocus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recipe, setRecipe] = useState<{ source: VerificationRecipeSource; label?: string } | null>(null);

  const active = useMemo(() => runs.find((r) => r.status === 'running' || r.status === 'queued'), [runs]);

  // 이 탭이 녹화 중인지(다른 탭이 찍고 있으면 여기서는 손잡이를 잠근다 — 한 번에 하나).
  const recordingHere = !!recordingFor && recordingFor.subAgentId === activeSessionId;
  const recordingElsewhere = !!recordingFor && recordingFor.subAgentId !== activeSessionId;
  const demoRecording = recordingHere && recordingFor?.purpose === 'demo';

  // 경과 표시 — 스토어의 시작 시각으로 1초마다 다시 그린다(녹화기 자체는 호스트가 쥔다).
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!isRecording || !recordingStartedAt) { setElapsedMs(0); return; }
    setElapsedMs(Date.now() - recordingStartedAt);
    const iv = setInterval(() => setElapsedMs(Date.now() - recordingStartedAt), 500);
    return () => clearInterval(iv);
  }, [isRecording, recordingStartedAt]);

  // 라이브 미리보기 — "지금 무엇이 찍히는지"를 보지 못하면 엉뚱한 창을 녹화한 줄도 모른다.
  const previewRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    el.srcObject = demoRecording ? liveStream : null;
    if (demoRecording && liveStream) void el.play().catch(() => { /* 자동재생 거부는 표시에만 영향 */ });
  }, [demoRecording, liveStream]);

  // 고른 시연이 사라졌으면(삭제·상한에 밀림) 선택을 놓는다 — 없는 것을 고른 채로 두지 않는다.
  useEffect(() => {
    if (!activeSessionId || !pickedDemoId) return;
    if (!demos.some((d) => d.id === pickedDemoId)) setPickedDemo(activeSessionId, null);
  }, [activeSessionId, demos, pickedDemoId, setPickedDemo]);

  // 보내기 전에 **무엇이 실릴지** 먼저 보여 준다. 판정은 서버가 하므로 여기서 만들지 않고 물어본다.
  useEffect(() => {
    if (!agentId) return;
    let alive = true;
    fetch(`${API_BASE}/api/verification-recipe/${encodeURIComponent(agentId)}`)
      .then((r) => r.json() as Promise<{ ok?: boolean; source?: VerificationRecipeSource; label?: string }>)
      .then((d) => {
        if (!alive || !d.ok || !d.source) return;
        setRecipe({ source: d.source, ...(d.label ? { label: d.label } : {}) });
      })
      .catch(() => undefined);
    return () => { alive = false; };
    // 검증이 하나 끝날 때마다(레시피가 새로 기록됐을 수 있다) 다시 물어본다.
  }, [agentId, runs.length]);

  // 고른 시연이 검증 프롬프트에 실을 내용을 갖고 있는가(⑨). 서버가 같은 판정을 하므로 화면도 같은
  // 답을 보여야 한다 — 안 그러면 "함께 보냅니다" 라고 해 놓고 실제로는 아무것도 안 나간다.
  const pickedEmptyDemo = useMemo(() => {
    if (!pickedDemoId) return false;
    const picked = demos.find((d) => d.id === pickedDemoId);
    return !!picked && !demoHasContent(picked);
  }, [demos, pickedDemoId]);

  const handleStart = useCallback(() => {
    if (!activeSessionId || busy) return;
    setBusy(true);
    setError(null);
    void startVerification({
      agentId,
      subAgentId: activeSessionId,
      ...(focus.trim() ? { focus: focus.trim() } : {}),
      ...(pickedDemoId ? { demoId: pickedDemoId } : {}),
    }).then((res) => {
      setBusy(false);
      // 조용한 무동작 ❌ — 안 됐으면 왜 안 됐는지 한 줄로 남긴다.
      if (!res.ok) { setError(res.error); return; }
      setFocus('');
      // ⑩ — 켜져 있으면 이 검증이 도는 동안을 찍는다. 그 줄에 [화면 보기] 가 붙는다.
      if (recordRun && source && !recordingFor) {
        startRecordingTarget({ agentId, subAgentId: activeSessionId, purpose: 'run', runId: res.runId });
      }
    });
  }, [activeSessionId, agentId, busy, focus, pickedDemoId, recordRun, recordingFor, source, startRecordingTarget, startVerification]);

  const handleRecordDemo = useCallback(() => {
    if (!activeSessionId) return;
    if (demoRecording) { stopRecordingTarget(); return; }
    // 찍을 대상을 아직 안 골랐으면 먼저 고르게 한다(고르면 피커가 바로 녹화를 시작한다).
    if (!source) { openPicker(agentId, activeSessionId, 'demo'); return; }
    startRecordingTarget({ agentId, subAgentId: activeSessionId, purpose: 'demo' });
  }, [activeSessionId, agentId, demoRecording, openPicker, source, startRecordingTarget, stopRecordingTarget]);

  if (!activeSessionId) {
    return (
      <div className="flex flex-col gap-1 p-2">
        <span className="px-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('ide.verify.title')}</span>
        <p className="px-1 py-2 text-[12px] leading-relaxed text-gray-500">{t('ide.verify.pickSession')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center justify-between gap-1 px-3 pt-2">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('ide.verify.title')}</span>
        {active && (
          <span className="flex flex-shrink-0 items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[12px] font-semibold text-amber-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            {t('ide.verify.running')}
          </span>
        )}
      </div>

      <ScrollFade fill className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-2">
          <p className="break-words px-0.5 text-[12px] leading-relaxed text-gray-500">{t('ide.verify.about')}</p>

          {/* ── ⑨ 시연 — 사람이 한 번 해 보이면 그것이 절차가 된다 ── */}
          <div className="flex flex-col gap-1.5 rounded border border-gray-700 bg-gray-800/40 p-1.5">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[12px] font-medium text-gray-400">{t('ide.verify.demo.sectionTitle')}</span>
              {source && !isRecording && (
                <button
                  type="button"
                  onClick={() => openPicker(agentId, activeSessionId, 'demo')}
                  className="truncate text-[12px] text-gray-500 transition-colors hover:text-gray-300"
                  title={source.sourceName}
                >
                  {source.sourceName}
                </button>
              )}
            </div>
            <p className="break-words text-[12px] leading-relaxed text-gray-500">{t('ide.verify.demo.about')}</p>

            {/* 녹화 중 — 무엇이 찍히는지 보여 준다 */}
            {demoRecording && (
              <div className="flex flex-col gap-1">
                <div className="overflow-hidden rounded bg-black">
                  <video ref={previewRef} className="h-20 w-full object-contain" muted playsInline />
                </div>
                {streamError && (
                  <p className="break-words text-[12px] leading-relaxed text-rose-400">
                    {t('ide.verify.demo.error.noStream')}
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleRecordDemo}
              disabled={isReadOnlyAgent || recordingElsewhere}
              className={`flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500 ${
                demoRecording ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-white/[0.08] text-gray-200 hover:bg-white/[0.14] hover:text-white'
              }`}
            >
              {demoRecording ? (
                <>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                  {t('ide.verify.demo.stopRecording', { time: formatDemoTime(elapsedMs) })}
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" />
                  </svg>
                  {t('ide.verify.demo.record')}
                </>
              )}
            </button>

            {/* 저장된 시연 — 라디오로 하나만 고른다(한 검증은 한 절차다) */}
            {demos.length > 0 && (
              <div className="flex flex-col gap-1">
                {demos.map((demo) => {
                  const parts = demoSummaryParts(demo);
                  const picked = pickedDemoId === demo.id;
                  return (
                    <div
                      key={demo.id}
                      className={`flex items-start gap-1.5 rounded border px-1.5 py-1 ${picked ? 'border-sky-500/60 bg-sky-500/10' : 'border-gray-700 bg-gray-900/40'}`}
                    >
                      <button
                        type="button"
                        onClick={() => setPickedDemo(activeSessionId, picked ? null : demo.id)}
                        className="mt-0.5 flex-shrink-0"
                        aria-label={demo.label}
                        aria-pressed={picked}
                      >
                        <span className={`block h-3 w-3 rounded-full border ${picked ? 'border-sky-400 bg-sky-400' : 'border-gray-600'}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPickedDemo(activeSessionId, picked ? null : demo.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-[12px] text-gray-200">{demo.label}</p>
                        <p className="text-[12px] text-gray-500">
                          {t('ide.verify.demo.summary', { steps: parts.steps, frames: parts.frames })}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteVerificationDemo(demo.id)}
                        className="mt-0.5 flex-shrink-0 text-gray-600 transition-colors hover:text-rose-400"
                        aria-label={t('common.delete', { defaultValue: 'Delete' })}
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 무엇을 확인할지 — 비워도 된다(그러면 `/verify` 가 평소대로 판단한다). */}
          <label className="flex flex-col gap-1">
            <span className="px-0.5 text-[12px] font-medium text-gray-400">{t('ide.verify.focusLabel')}</span>
            <textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value.slice(0, VERIFICATION_FOCUS_MAX))}
              rows={2}
              placeholder={t('ide.verify.focusPlaceholder')}
              className="w-full resize-none rounded border border-gray-700 bg-gray-900 px-2 py-1 text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-sky-500 focus:outline-none"
            />
          </label>

          {/* 무엇이 실릴지 — 보내기 전에 사용자가 먼저 읽는다. */}
          {recipe && (
            <div className="rounded border border-gray-700 bg-gray-800/60 px-2 py-1.5">
              <p className="text-[12px] font-medium text-gray-300">{t(`ide.verify.recipe.${toKey(recipe.source)}`)}</p>
              {recipe.label && (
                <p className="mt-0.5 break-all text-[12px] leading-relaxed text-gray-500">{recipe.label}</p>
              )}
              {/*
                고른 시연에 실을 내용이 하나도 없으면 그렇다고 말한다 — 서버 `buildVerifyPrompt` 도
                같은 판정으로 그 블록을 통째로 빼므로, 여기서 "함께 보냅니다" 라고만 하면 화면이
                없는 것을 있다고 말하는 셈이 된다(⑨ `demoHasContent` 가 있던 이유).
              */}
              <p className={`mt-0.5 text-[12px] leading-relaxed ${pickedEmptyDemo ? 'text-amber-400' : 'text-gray-500'}`}>
                {!pickedDemoId
                  ? t('ide.verify.demo.willNotSend')
                  : pickedEmptyDemo
                    ? t('ide.verify.demo.emptyDemo')
                    : t('ide.verify.demo.willSend', { name: demos.find((d) => d.id === pickedDemoId)?.label ?? '' })}
              </p>
            </div>
          )}

          {/* ⑩ — 이번 검증이 도는 동안의 화면을 증거로 남긴다(판정에는 영향 없음). */}
          <label className={`flex items-center gap-1.5 px-0.5 text-[12px] ${source ? 'text-gray-400' : 'text-gray-600'}`}>
            <input
              type="checkbox"
              checked={recordRun}
              disabled={!source || isReadOnlyAgent}
              onChange={(e) => setRecordRun(activeSessionId, e.target.checked)}
              className="h-3 w-3 accent-sky-500"
            />
            <span className="min-w-0 flex-1 break-words leading-relaxed">
              {source ? t('ide.verify.demo.recordRun') : t('ide.verify.demo.recordRunNeedsSource')}
            </span>
          </label>

          <button
            type="button"
            onClick={handleStart}
            disabled={isReadOnlyAgent || busy || !!active}
            className="flex items-center justify-center gap-1.5 rounded bg-sky-600 px-2 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            {t('ide.verify.start')}
          </button>

          {isReadOnlyAgent && (
            <p className="px-0.5 text-[12px] leading-relaxed text-gray-500">{t('ide.verify.readOnly')}</p>
          )}
          {error && (
            <p className="break-words px-0.5 text-[12px] leading-relaxed text-rose-400">
              {t(`ide.verify.error.${toKey(error)}`, { defaultValue: error })}
            </p>
          )}

          {/* 최근 실행 — 서버가 준 순서(최신 우선) 그대로. */}
          {runs.length === 0 ? (
            <p className="px-0.5 pt-1 text-[12px] leading-relaxed text-gray-600">{t('ide.verify.empty')}</p>
          ) : (
            <div className="flex flex-col gap-1.5 pt-1">
              {runs.map((run) => {
                const clipId = runClip[run.id];
                return (
                <div key={run.id} className="rounded border border-gray-700 bg-gray-800/60 px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[12px] font-bold ${VERDICT_TONE[run.verdict] ?? VERDICT_TONE.unknown}`}>
                      {t(`ide.verify.verdict.${run.verdict}`)}
                    </span>
                    <span className="truncate text-[12px] text-gray-500">
                      {formatAt(run.startedAt)} · {formatDuration(run.durationMs)}
                    </span>
                  </div>

                  {run.focus && (
                    <p className="mt-1 break-words text-[12px] leading-relaxed text-gray-400">{run.focus}</p>
                  )}
                  {/* 무엇을 실어 보냈는지 — 그 시연이 나중에 지워져도 이 줄은 남는다. */}
                  {run.demoLabel && (
                    <p className="mt-1 flex items-center gap-1 truncate text-[12px] text-sky-400/80">
                      <svg className="h-3 w-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 4l14 8-14 8V4z" />
                      </svg>
                      {run.demoLabel}
                    </p>
                  )}
                  {run.reason && (
                    <p className="mt-1 break-words text-[12px] leading-relaxed text-gray-300">{run.reason}</p>
                  )}

                  {/* 실제로 돌린 것 — 이게 통과의 유일한 근거다. */}
                  {run.attempts.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {run.attempts.map((a, i) => (
                        <li key={`${run.id}-${i}`} className="flex items-start gap-1 text-[12px] leading-relaxed">
                          {a.exitCode === 0 ? (
                            <svg className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          ) : a.exitCode === undefined ? (
                            <svg className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="9" /><path d="M12 8v4" /><path d="M12 16h.01" />
                            </svg>
                          ) : (
                            <span className="flex-shrink-0 font-bold text-rose-400 tabular-nums">{a.exitCode}</span>
                          )}
                          <span className="break-all text-gray-400">{a.command}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-1.5 flex items-center gap-1">
                    {(run.status === 'running' || run.status === 'queued') && (
                      <button
                        type="button"
                        onClick={() => void stopVerification(run.id)}
                        className="rounded border border-gray-600 px-1.5 py-0.5 text-[12px] text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
                      >
                        {t('ide.verify.stop')}
                      </button>
                    )}
                    {/* ⑩ — 그 검증이 도는 동안 찍힌 화면. 앱을 다시 켜면 손잡이만 사라진다. */}
                    {clipId && (
                      <button
                        type="button"
                        onClick={() => openWindow({ agentId, subAgentId: activeSessionId, clipId, mode: 'view' })}
                        className="flex items-center gap-1 rounded border border-sky-500/50 px-1.5 py-0.5 text-[12px] text-sky-300 transition-colors hover:border-sky-400 hover:text-sky-200"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 4l14 8-14 8V4z" />
                        </svg>
                        {t('ide.verify.demo.watch')}
                      </button>
                    )}
                    {(run.verdict === 'fail' || run.verdict === 'held') && !isReadOnlyAgent && (
                      <button
                        type="button"
                        onClick={() => void reworkVerification(run.id)}
                        className="rounded border border-rose-500/50 px-1.5 py-0.5 text-[12px] text-rose-300 transition-colors hover:border-rose-400 hover:text-rose-200"
                      >
                        {t('ide.verify.rework')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void deleteVerificationRun(run.id)}
                      className="ml-auto rounded px-1.5 py-0.5 text-[12px] text-gray-500 transition-colors hover:text-gray-300"
                    >
                      {t('ide.verify.delete')}
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollFade>
    </div>
  );
});

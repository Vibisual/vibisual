import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VerificationRun, VerificationRecipeSource } from '@vibisual/shared';
import { isReadOnlyHookAgent, VERIFICATION_FOCUS_MAX } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useIDEPaneValue } from './idePane.js';
import { ScrollFade } from '../ScrollFade.js';

// §5.5 #17-35 ⑦ — 검증(Verify) 사이드바 뷰.
//
// 스킬(#17-4)·목표(#17-17 ④)·루프(#17-11 ⑨)와 **같은 자리**(`w-52`)에 뜬다 — 검증은 화면을
// 가로채는 것이 아니라 세션이 지금 무엇을 하는지 보면서 곁눈으로 돌리는 것이기 때문이다.
//
// 단위는 **지금 열려 있는 IDE 세션 탭 하나**다. 탭을 바꾸면 그 탭의 검증 이력이 보인다.
//
// 실행·판정·정리는 전부 서버(SSOT)가 한다. 이 컴포넌트는 시작 요청을 보내고, 되돌아오는
// `graph_snapshot` 의 `verificationRuns` 를 **그대로** 그린다(낙관적 판정 표시 ❌ — 통과했다고
// 먼저 칠해 놓고 뒤집히면 그 화면은 거짓말을 한 것이 된다).

/** 통합 앱은 같은 오리진에서 서빙된다 — 형제 IDE 컴포넌트와 같은 규약. */
const API_BASE = '';

const EMPTY_RUNS: VerificationRun[] = [];

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
  const startVerification = useGraphStore((s) => s.startVerification);
  const stopVerification = useGraphStore((s) => s.stopVerification);
  const reworkVerification = useGraphStore((s) => s.reworkVerification);
  const deleteVerificationRun = useGraphStore((s) => s.deleteVerificationRun);
  // §5.5 #17-29 — 훅 버블은 전면 읽기 전용. 검증은 명령을 넣는 입력구라 실행 손잡이를 잠근다.
  const isReadOnlyAgent = useGraphStore((s) => isReadOnlyHookAgent(s.nodeMap[agentId]));

  const [focus, setFocus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recipe, setRecipe] = useState<{ source: VerificationRecipeSource; label?: string } | null>(null);

  const active = useMemo(() => runs.find((r) => r.status === 'running' || r.status === 'queued'), [runs]);

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

  const handleStart = useCallback(() => {
    if (!activeSessionId || busy) return;
    setBusy(true);
    setError(null);
    void startVerification({
      agentId,
      subAgentId: activeSessionId,
      ...(focus.trim() ? { focus: focus.trim() } : {}),
    }).then((err) => {
      setBusy(false);
      // 조용한 무동작 ❌ — 안 됐으면 왜 안 됐는지 한 줄로 남긴다.
      if (err) setError(err);
      else setFocus('');
    });
  }, [activeSessionId, agentId, busy, focus, startVerification]);

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
            </div>
          )}

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
              {runs.map((run) => (
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
              ))}
            </div>
          )}
        </div>
      </ScrollFade>
    </div>
  );
});

/**
 * §5.3 #10-3 v4.98 — 검증 런 뷰 (AutoAgentPanel 안에 들어가는 구획).
 *
 * 종전 패널에서 "완료"의 근거는 초록 배지와 에이전트가 쓴 문장 하나뿐이었다. 그 배지는 사실
 * **빌더가 하네스를 다 짰다**는 뜻이었고, 증거는 화면에 한 줄도 없었다. 여기가 그 자리를 대신한다:
 *
 *   - 지표 3줄  — 무개입 완료율 / 에스컬레이션 사유 / 재작업 회차
 *   - [게이트 점검] — 일부러 실패시켜 게이트가 정말 막는지 증명한다(통과 화면으로는 증명이 안 된다)
 *   - 런 목록  — 요청별 1줄, 펼치면 증거 표(명령 · exit code · revision · 시각)
 *
 * 판정은 전부 서버가 한다. 이 컴포넌트는 서버가 내려준 것을 **표시만** 한다.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AutoAgentRun, VerificationAttempt } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { computeRunMetrics, summarizeSelfTest, type SelfTestCheck } from './autoAgentRunMetrics.js';

const EMPTY_RUNS: AutoAgentRun[] = [];

interface AutoAgentRunViewProps {
  /** auto-agent 버블의 sessionId */
  sessionId: string;
}

/** 상태별 색 — 초록은 오직 `verified`(통과 증거 있음) 에만 준다. */
const STATUS_TONE: Record<AutoAgentRun['status'], string> = {
  running: 'border-blue-800 bg-blue-950/30 text-blue-300',
  verified: 'border-emerald-800 bg-emerald-950/30 text-emerald-300',
  escalated: 'border-amber-800 bg-amber-950/30 text-amber-300',
  abandoned: 'border-gray-700 bg-gray-950/40 text-gray-400',
};

export const AutoAgentRunView = memo(function AutoAgentRunView({ sessionId }: AutoAgentRunViewProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const runs = useGraphStore((s) => s.autoAgentRuns[sessionId]) ?? EMPTY_RUNS;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selfTest, setSelfTest] = useState<{ running: boolean; checks: SelfTestCheck[] } | null>(null);

  const metrics = useMemo(() => computeRunMetrics(runs), [runs]);
  // 최신 런이 위로.
  const ordered = useMemo(() => [...runs].reverse(), [runs]);

  const runSelfTest = useCallback(async () => {
    setSelfTest({ running: true, checks: [] });
    try {
      const res = await fetch(`/api/auto-agent/${encodeURIComponent(sessionId)}/self-test`, { method: 'POST' });
      const json = (await res.json()) as { checks?: SelfTestCheck[] };
      setSelfTest({ running: false, checks: Array.isArray(json.checks) ? json.checks : [] });
    } catch {
      setSelfTest({ running: false, checks: [] });
    }
  }, [sessionId]);

  const selfTestSummary = selfTest && !selfTest.running ? summarizeSelfTest(selfTest.checks) : null;

  return (
    <div className="flex flex-col gap-2">
      {/* 머리 — 제목 + 게이트 점검 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ShieldIcon />
          <span className="text-xs font-semibold text-gray-300">{t('panel.autoAgent.run.title')}</span>
        </div>
        <button
          type="button"
          onClick={runSelfTest}
          disabled={selfTest?.running}
          className="flex items-center gap-1 rounded border border-gray-700 px-2 py-0.5 text-[10px] text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200 disabled:opacity-50"
          title={t('panel.autoAgent.run.selfTestTip')}
        >
          <BeakerIcon />
          <span>{selfTest?.running ? t('panel.autoAgent.run.selfTestRunning') : t('panel.autoAgent.run.selfTest')}</span>
        </button>
      </div>

      {/* 자가진단 결과 — 게이트가 정말 막는지에 대한 유일한 증거 */}
      {selfTestSummary && (
        <div className={`rounded border px-2.5 py-1.5 text-[11px] ${
          selfTestSummary.allPassed
            ? 'border-emerald-800 bg-emerald-950/20 text-emerald-200'
            : 'border-red-800 bg-red-950/20 text-red-200'
        }`}>
          <div className="mb-1 font-semibold">
            {selfTestSummary.allPassed
              ? t('panel.autoAgent.run.selfTestPass', { count: selfTestSummary.passed })
              : t('panel.autoAgent.run.selfTestFail', { count: selfTestSummary.failed })}
          </div>
          <ul className="flex flex-col gap-0.5">
            {selfTest?.checks.map((c) => (
              <li key={c.id} className="flex items-center gap-1.5 font-mono text-[10px]">
                {c.pass ? <CheckIcon /> : <CrossIcon />}
                <span className="text-gray-400">{c.id}</span>
                <span className="text-gray-600">→ {c.actual}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 지표 3줄 — 개입이 줄었는지는 느낌이 아니라 숫자로 본다 */}
      {metrics.total > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          <MetricCell
            label={t('panel.autoAgent.run.metricHandsOff')}
            value={metrics.handsOffRate === null ? '—' : `${metrics.handsOffRate}%`}
            hint={t('panel.autoAgent.run.metricHandsOffHint', { verified: metrics.verified, total: metrics.total })}
          />
          <MetricCell
            label={t('panel.autoAgent.run.metricEscalated')}
            value={String(metrics.escalated)}
            hint={topReason(metrics.escalationByReason)}
          />
          <MetricCell
            label={t('panel.autoAgent.run.metricEvidence')}
            value={`${metrics.passedAttempts}/${metrics.passedAttempts + metrics.failedAttempts}`}
            hint={t('panel.autoAgent.run.metricEvidenceHint')}
          />
        </div>
      )}

      {/* 런 목록 */}
      {ordered.length === 0 ? (
        <div className="rounded border border-gray-800 bg-gray-950/40 px-2.5 py-2 text-[11px] text-gray-500">
          {t('panel.autoAgent.run.empty')}
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {ordered.map((run) => {
            const isOpen = expanded === run.runId;
            const passed = run.attempts.filter((a) => a.ok).length;
            return (
              <li key={run.runId} className={`rounded border ${STATUS_TONE[run.status]}`}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : run.runId)}
                  className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left"
                >
                  <ChevronIcon open={isOpen} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide">
                        {t(`panel.autoAgent.run.status.${run.status}`)}
                      </span>
                      {run.selfTest && (
                        <span className="rounded bg-gray-800 px-1 text-[9px] text-gray-400">
                          {t('panel.autoAgent.run.selfTestBadge')}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-500">
                        {t('panel.autoAgent.run.evidenceCount', { passed, total: run.attempts.length })}
                      </span>
                      {run.reworkUsed > 0 && (
                        <span className="text-[10px] text-gray-500">
                          {t('panel.autoAgent.run.reworkCount', { used: run.reworkUsed, budget: run.reworkBudget })}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-gray-400">{run.userRequest}</div>
                    {run.status === 'escalated' && run.escalation && (
                      <div className="mt-0.5 text-[10px] text-amber-400/90">
                        {t(`panel.autoAgent.run.escalation.${run.escalation}`)}
                      </div>
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-800/70 px-2.5 py-2">
                    {run.attempts.length === 0 ? (
                      <div className="text-[10px] text-gray-500">{t('panel.autoAgent.run.noEvidence')}</div>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {run.attempts.map((a) => <EvidenceRow key={a.id} attempt={a} />)}
                      </ul>
                    )}
                    {run.lastVerdict && (
                      <div className="mt-1.5 text-[10px] text-gray-500">
                        {t('panel.autoAgent.run.lastVerdict', { verdict: t(`panel.autoAgent.run.verdict.${run.lastVerdict}`) })}
                        {run.lastVerdictReason ? ` — ${run.lastVerdictReason}` : ''}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});

/** 증거 한 줄 — 명령 · exit code · revision · 시각. 이 네 개가 "완료"의 근거 전부다. */
const EvidenceRow = memo(function EvidenceRow({ attempt }: { attempt: VerificationAttempt }): React.JSX.Element {
  return (
    <li className="flex items-start gap-1.5 font-mono text-[10px]">
      {attempt.ok ? <CheckIcon /> : <CrossIcon />}
      <span className={attempt.ok ? 'text-emerald-300' : 'text-red-300'}>exit {attempt.exitCode}</span>
      <span className="min-w-0 flex-1 truncate text-gray-400" title={attempt.command}>{attempt.command}</span>
      {attempt.revision && <span className="text-gray-600">{attempt.revision.slice(0, 7)}</span>}
      <span className="text-gray-600">{new Date(attempt.startedAt).toLocaleTimeString()}</span>
    </li>
  );
});

function MetricCell({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div className="rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5" title={hint}>
      <div className="text-[9px] uppercase tracking-wide text-gray-600">{label}</div>
      <div className="text-sm font-semibold text-gray-200">{value}</div>
    </div>
  );
}

function topReason(byReason: Record<string, number>): string | undefined {
  const entries = Object.entries(byReason).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return entries.length > 0 ? `${entries[0]![0]} ×${entries[0]![1]}` : undefined;
}

// ── 아이콘 (lucide 톤 stroke SVG — 이모지 금지) ────────────────────────────────

function ShieldIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-gray-400">
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function BeakerIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
      <path d="M9 3v6L4 19a2 2 0 0 0 1.8 2h12.4A2 2 0 0 0 20 19L15 9V3" />
      <path d="M8 3h8" />
      <path d="M6.5 14h11" />
    </svg>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 shrink-0 text-emerald-400">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function CrossIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 shrink-0 text-red-400">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={`h-3 w-3 shrink-0 translate-y-0.5 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeUsageLimit, UsageCollectorStatus } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import {
  clampUsagePct,
  usageBarToneClass,
  usageTextToneClass,
} from '../../utils/usageLimits.js';
import { ScrollFade } from '../ScrollFade.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { CostPill } from './CostPill.js';

// SCENARIO.md §4 v1.50 / v3.60 — 사용량 팝업.
//
// 헤더 사용량 필을 클릭하면 열린다. 값의 원천은 **statusLine 수집기 하나**다(§4 v3.60) —
// Claude Code 가 플랜 한도를 외부에 주는 공식 경로가 그것뿐이라, 수집기를 켜지 않았으면
// 서버가 오류를 실어 보내고 이 팝업이 그 자리에서 설치 스위치를 노출한다.
//
// 구 v3.62 의 OAuth 직접 조회(모델별 주간 한도·사용 크레딧까지 담았다)는 약관 문제로
// 걷어냈다. 그래서 `claudeUsage.limits` 에는 세션(5시간)과 주간 전체 두 줄만 온다.

const API_BASE = '';

interface UsagePopupProps {
  onClose: () => void;
}

/** 남은 시간 → "4시간 28분" / "12분". 초 단위는 버린다(1초마다 숫자가 튀지 않게 분 단위 표기). */
function useCountdownLabel(resetAt: number | undefined, now: number): string | null {
  const { t } = useTranslation();
  if (!resetAt) return null;
  const remainMs = resetAt - now;
  if (remainMs <= 0) return t('panel.usage.resettingNow');
  const totalMinutes = Math.floor(remainMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const span = days > 0
    ? t('panel.usage.spanDh', { d: days, h: hours })
    : hours > 0
      ? t('panel.usage.spanHm', { h: hours, m: minutes })
      : t('panel.usage.spanM', { m: minutes });
  return t('panel.usage.resetsIn', { span });
}

/** 한도 게이지 한 줄 — 큰 퍼센트 + 굵은 바 + 리셋 카운트다운. */
function LimitGauge({
  label,
  used,
  resetAt,
  now,
  subdued,
}: {
  label: string;
  used: number | undefined;
  resetAt: number | undefined;
  now: number;
  /** 모델별 한도처럼 부차적인 줄은 한 단계 작게 그린다. */
  subdued?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const countdown = useCountdownLabel(resetAt, now);
  const pct = typeof used === 'number' ? clampUsagePct(used) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`min-w-0 truncate font-semibold ${subdued ? 'text-[12px] text-gray-400' : 'text-xs text-gray-200'}`}>
          {label}
        </span>
        <span className={`font-mono font-bold tabular-nums ${subdued ? 'text-sm' : 'text-lg'} ${
          pct === null ? 'text-gray-600' : usageTextToneClass(pct)
        }`}>
          {pct === null ? t('panel.usage.noValue') : `${pct.toFixed(0)}%`}
        </span>
      </div>
      <div className={`overflow-hidden rounded-full bg-gray-700/70 ${subdued ? 'h-1.5' : 'h-2'}`}>
        {pct !== null && (
          <div className={`h-full transition-all duration-500 ${usageBarToneClass(pct)}`} style={{ width: `${pct}%` }} />
        )}
      </div>
      {countdown && <div className="text-[12px] text-gray-500">{countdown}</div>}
    </div>
  );
}

/** 직접 조회가 막혔을 때만 뜨는 안내 + statusLine 폴백 스위치 자리. */
function ErrorNotice({ error }: { error: string }): React.JSX.Element {
  const { t } = useTranslation();
  const msg =
    error === 'no-credentials' ? t('panel.usage.errNoCredentials')
      : error === 'unauthorized' ? t('panel.usage.errUnauthorized')
        : t('panel.usage.errNetwork');
  return (
    <div className="flex gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[12px] leading-relaxed text-amber-200">
      <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
      <span>{msg}</span>
    </div>
  );
}

interface CollectorSectionProps {
  status: UsageCollectorStatus | null;
  failed: boolean;
  busy: boolean;
  onToggle: (enable: boolean) => void;
}

/** statusLine 폴백 스위치 — 직접 조회가 안 될 때만 노출한다(§4 v3.62 이후 부차 경로). */
function CollectorSection({ status, failed, busy, onToggle }: CollectorSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const installed = status?.installed === true;

  return (
    <div className="flex flex-col gap-2 border-t border-gray-700 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-semibold text-gray-200">{t('panel.usage.collectorTitle')}</span>
          <span className="text-[12px] text-gray-500">
            {installed ? t('panel.usage.collectorOnHint') : t('panel.usage.collectorOffHint')}
          </span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggle(!installed)}
          className={`flex-shrink-0 rounded px-3 py-1.5 text-[12px] font-semibold transition-colors duration-150 disabled:opacity-50 ${
            installed
              ? 'border border-gray-700 text-gray-300 hover:bg-gray-800'
              : 'bg-blue-600 text-white hover:bg-blue-500'
          }`}
        >
          {installed ? t('panel.usage.collectorDisable') : t('panel.usage.collectorEnable')}
        </button>
      </div>

      {installed && status?.passthroughCommand && (
        <div className="rounded border border-gray-700 bg-gray-800/40 px-2.5 py-1.5 text-[12px] leading-relaxed text-gray-400">
          {t('panel.usage.collectorPassthrough')}
        </div>
      )}
      {!installed && status?.foreign && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[12px] leading-relaxed text-amber-200">
          {t('panel.usage.collectorForeign')}
        </div>
      )}
      {(failed || status?.error) && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[12px] leading-relaxed text-red-300">
          {status?.error ?? t('panel.usage.collectorFailed')}
        </div>
      )}
      {installed && (
        <div className="text-[12px] leading-relaxed text-gray-600">
          {t('panel.usage.collectorRestartHint')}
        </div>
      )}
    </div>
  );
}

export const UsagePopup = memo(function UsagePopup({ onClose }: UsagePopupProps): React.JSX.Element {
  const { t } = useTranslation();
  const claudeUsage = useGraphStore((s) => s.claudeUsage);
  const rateLimits = useGraphStore((s) => s.rateLimits);
  const agents = useGraphStore((s) => s.agents);
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const activeProject = useGraphStore((s) => s.activeProject);

  // 리셋 카운트다운용 1초 틱 — 팝업이 열려 있는 동안만 돈다.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // §7.19 — 하단 비용 줄이 여는 비용·토큰 지도. 상태를 **여기서** 드는 이유는 Esc 때문이다:
  //   위에 비용 팝업이 떠 있으면 Esc 는 그것부터 닫아야 하는데, 그 사실을 이 팝업이 알아야
  //   자기 차례를 비켜설 수 있다(전역 플래그로 두면 이 팝업이 닫힌 뒤에도 켜진 채 남는다).
  const [costOpen, setCostOpen] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      // 위에 있는 것부터 닫는다 — 비용 팝업이 자기 Esc 로 먼저 닫히고, 그다음 차례가 이 팝업.
      if (e.key === 'Escape' && !costOpen) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, costOpen]);

  // 열 때 한 번 최신값을 받아온다(스냅샷으로도 오지만, 팝업을 연 순간이 가장 보고 싶은 시점).
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refresh = useCallback((): void => {
    setRefreshing(true);
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/claude-usage/refresh`, { method: 'POST' });
        setRefreshFailed(!res.ok);
      } catch {
        // 스냅샷에 남아 있는 직전 값으로 계속 보여주되, 실패 사실은 숨기지 않는다.
        setRefreshFailed(true);
      } finally {
        setRefreshing(false);
      }
    })();
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const limits = claudeUsage?.limits ?? [];
  const sessionLimit = useMemo(
    () => limits.find((l) => l.kind === 'session' || l.group === 'session'),
    [limits],
  );
  const weeklyAll = useMemo(
    () => limits.find((l) => l.kind === 'weekly_all') ?? limits.find((l) => l.group === 'weekly' && !l.scopeLabel),
    [limits],
  );
  const scopedWeekly = useMemo(
    () => limits.filter((l): l is ClaudeUsageLimit & { scopeLabel: string } => Boolean(l.scopeLabel)),
    [limits],
  );

  // 직접 조회가 비어 있으면 statusLine 이 밀어준 §4 v1.50 값으로 대체한다.
  const usingFallback = limits.length === 0;
  const sessionPct = usingFallback ? rateLimits?.used5h : sessionLimit?.percent;
  const sessionReset = usingFallback ? rateLimits?.resetAt5h : sessionLimit?.resetsAt;
  const weeklyPct = usingFallback ? rateLimits?.used7d : weeklyAll?.percent;
  const weeklyReset = usingFallback ? rateLimits?.resetAt7d : weeklyAll?.resetsAt;

  const updatedAt = claudeUsage?.fetchedAt ?? rateLimits?.updatedAt;
  const showCollector = usingFallback || Boolean(claudeUsage?.error);

  /**
   * §4 v3.63 — 카운트다운이 0 을 지나면 그 자리에서 한 번 다시 받아온다.
   *
   * 리셋 직후에도 화면이 100% 로 남아 있던 문제(사용자 보고)의 클라 쪽 안전망이다. 서버도
   * 리셋 시각에 일회성 갱신을 걸지만, 그 타이머가 어떤 이유로 못 돌아도 팝업을 보고 있으면
   * 스스로 복구된다. 같은 리셋 시각에 두 번 요청하지 않도록 반응한 시각을 기억한다.
   */
  const reactedResets = useRef<Set<number>>(new Set());
  useEffect(() => {
    for (const target of [sessionReset, weeklyReset]) {
      if (typeof target !== 'number') continue;
      if (now <= target + 2_000) continue;
      if (reactedResets.current.has(target)) continue;
      reactedResets.current.add(target);
      refresh();
    }
  }, [now, sessionReset, weeklyReset, refresh]);

  // statusLine 폴백 스위치 상태 — 직접 조회가 막혔을 때만 쓰인다.
  const [collector, setCollector] = useState<UsageCollectorStatus | null>(null);
  const [collectorBusy, setCollectorBusy] = useState(false);
  const [collectorFailed, setCollectorFailed] = useState(false);

  useEffect(() => {
    if (!showCollector) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/usage-collector`);
        if (!alive) return;
        if (!res.ok) { setCollectorFailed(true); return; }
        setCollector(await res.json() as UsageCollectorStatus);
        setCollectorFailed(false);
      } catch {
        if (alive) setCollectorFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [showCollector]);

  const handleToggle = useCallback((enable: boolean): void => {
    setCollectorBusy(true);
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/usage-collector`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enable }),
        });
        if (!res.ok) { setCollectorFailed(true); return; }
        setCollector(await res.json() as UsageCollectorStatus);
        setCollectorFailed(false);
      } catch {
        setCollectorFailed(true);
      } finally {
        setCollectorBusy(false);
      }
    })();
  }, []);

  // Vibisual 자신이 굴린 몫 — 활성 탭 스코프(헤더 배지와 같은 집계 기준).
  const local = useMemo(() => {
    const inProject = activeProject
      ? agents.filter((a) => agentProjects[a.id] === activeProject)
      : [];
    let input = 0;
    let output = 0;
    for (const a of inProject) {
      input += a.totalInputTokens ?? 0;
      output += a.totalOutputTokens ?? 0;
    }
    return { count: inProject.length, input, output };
  }, [agents, agentProjects, activeProject]);

  const credits = claudeUsage?.extraCredits;

  const backdrop = useBackdropDismiss(onClose);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        className="mx-4 flex max-h-[80vh] w-full max-w-md flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — 제목 + 플랜 배지 + 새로고침 + 닫기 */}
        <div className="flex items-center gap-2 border-b border-gray-700 px-4 py-3">
          <svg className="h-4 w-4 flex-shrink-0 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20v-6" />
            <path d="M6 20V10" />
            <path d="M18 20V4" />
          </svg>
          <span className="text-sm font-semibold text-gray-100">{t('panel.usage.title')}</span>
          {claudeUsage?.plan && (
            <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[12px] font-semibold text-violet-300">
              {claudeUsage.plan}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            title={t('panel.usage.refresh')}
            aria-label={t('panel.usage.refresh')}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200 disabled:opacity-40"
          >
            <svg className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <polyline points="21 3 21 9 15 9" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            aria-label={t('panel.usage.close')}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <ScrollFade fill className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 px-4 py-4">
            {claudeUsage?.error && <ErrorNotice error={claudeUsage.error} />}

            <LimitGauge
              label={t('panel.usage.session5h')}
              used={sessionPct}
              resetAt={sessionReset}
              now={now}
            />
            <LimitGauge
              label={t('panel.usage.weekly7d')}
              used={weeklyPct}
              resetAt={weeklyReset}
              now={now}
            />

            {/* 모델별 주간 한도 — Claude 앱 /usage 의 모델 행과 같은 자리 */}
            {scopedWeekly.map((l) => (
              <LimitGauge
                key={`${l.kind}-${l.scopeLabel}`}
                label={t('panel.usage.weeklyScoped', { model: l.scopeLabel })}
                used={l.percent}
                resetAt={l.resetsAt}
                now={now}
                subdued
              />
            ))}

            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-gray-600">
                {updatedAt
                  ? t('panel.usage.lastUpdated', { time: new Date(updatedAt).toLocaleTimeString() })
                  : t('panel.usage.neverUpdated')}
              </span>
              {refreshFailed && <span className="text-red-400">{t('panel.usage.refreshFailed')}</span>}
            </div>
          </div>

          {/* 사용 크레딧 */}
          {credits && (
            <div className="flex flex-col gap-1.5 border-t border-gray-700 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-200">{t('panel.usage.creditsTitle')}</span>
                <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${
                  credits.enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-600/30 text-gray-400'
                }`}>
                  {credits.enabled ? t('panel.usage.creditsOn') : t('panel.usage.creditsOff')}
                </span>
              </div>
              <span className="text-[12px] leading-relaxed text-gray-500">
                {credits.enabled && typeof credits.utilization === 'number'
                  ? t('panel.usage.creditsUsed', { percent: Math.round(credits.utilization) })
                  : t('panel.usage.creditsHint')}
              </span>
            </div>
          )}

          {/* statusLine 폴백 — 직접 조회가 막혔을 때만 */}
          {showCollector && (
            <CollectorSection
              status={collector}
              failed={collectorFailed}
              busy={collectorBusy}
              onToggle={handleToggle}
            />
          )}

          {/* Vibisual 자신이 굴린 몫 */}
          <div className="flex flex-col gap-1.5 border-t border-gray-700 px-4 py-3">
            <span className="text-xs font-semibold text-gray-200">{t('panel.usage.localTitle')}</span>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-gray-500">{t('panel.usage.localAgents')}</span>
              <span className="font-mono text-gray-300">{local.count}</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-gray-500">{t('panel.usage.localInput')}</span>
              <span className="font-mono text-gray-300">{local.input.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-gray-500">{t('panel.usage.localOutput')}</span>
              <span className="font-mono text-emerald-400">{local.output.toLocaleString()}</span>
            </div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-gray-600">
              {t('panel.usage.localHint')}
            </div>
          </div>
        </ScrollFade>

        {/* §5.21 / §7.19 — 오늘 비용. 헤더에서 옮겨 온 자리이고, 스크롤 **밖** 바닥에 고정한다
            (아래로 내려야 보이는 입구는 없는 입구와 같다). 누르면 비용·토큰 지도가 이 위에 겹친다. */}
        <CostPill open={costOpen} onOpenChange={setCostOpen} />
      </div>
    </div>
  );
});

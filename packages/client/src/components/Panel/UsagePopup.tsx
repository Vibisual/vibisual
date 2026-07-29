import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageCollectorStatus } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import {
  normalizeUsagePct,
  usageBarToneClass,
  usageTextToneClass,
} from '../../utils/usageLimits.js';
import { ScrollFade } from '../ScrollFade.js';

// SCENARIO.md §4 v1.50 / v3.60 — 사용량 팝업.
//
// 헤더 사용량 필(§4 v3.60)을 클릭하면 열린다. Claude.ai 플랜 한도(5시간 세션 창 / 7일 주간)를
// 게이지 + 리셋 카운트다운으로 보여주고, 값을 채우는 수집기(statusLine) 스위치를 함께 둔다.
// DetailPanel 루트 게이지(§4 v1.50)는 그대로 유지 — 이 팝업은 그 위에 얹는 확장이다.
//
// 표시 못 하는 것: 플랜명(Max 20x)·모델별 주간 한도·사용 크레딧. Claude Code 가 statusLine 으로
// 내보내지 않는 값이라(오직 `/usage` 화면 내부에만 존재) 정직하게 빼둔다.

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
}: {
  label: string;
  used: number | undefined;
  resetAt: number | undefined;
  now: number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const countdown = useCountdownLabel(resetAt, now);
  const pct = typeof used === 'number' ? normalizeUsagePct(used) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-gray-200">{label}</span>
        <span className={`font-mono text-lg font-bold tabular-nums ${pct === null ? 'text-gray-600' : usageTextToneClass(pct)}`}>
          {pct === null ? t('panel.usage.noValue') : `${pct.toFixed(0)}%`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-700/70">
        {pct !== null && (
          <div className={`h-full transition-all duration-500 ${usageBarToneClass(pct)}`} style={{ width: `${pct}%` }} />
        )}
      </div>
      <div className="text-[10px] text-gray-500">
        {countdown ?? t('panel.usage.resetUnknown')}
      </div>
    </div>
  );
}

/** 수집기 스위치 — statusLine opt-in. 꺼져 있으면 왜 값이 비는지 여기서만 설명한다. */
function CollectorSection(): React.JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UsageCollectorStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${API_BASE}/api/usage-collector`);
      if (!res.ok) { setFailed(true); return; }
      setStatus(await res.json() as UsageCollectorStatus);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (enable: boolean): Promise<void> => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/usage-collector`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable }),
      });
      if (!res.ok) { setFailed(true); return; }
      setStatus(await res.json() as UsageCollectorStatus);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  const installed = status?.installed === true;

  return (
    <div className="flex flex-col gap-2 border-t border-gray-700 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-semibold text-gray-200">{t('panel.usage.collectorTitle')}</span>
          <span className="text-[10px] text-gray-500">
            {installed ? t('panel.usage.collectorOnHint') : t('panel.usage.collectorOffHint')}
          </span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggle(!installed)}
          className={`flex-shrink-0 rounded px-3 py-1.5 text-[11px] font-semibold transition-colors duration-150 disabled:opacity-50 ${
            installed
              ? 'border border-gray-700 text-gray-300 hover:bg-gray-800'
              : 'bg-blue-600 text-white hover:bg-blue-500'
          }`}
        >
          {installed ? t('panel.usage.collectorDisable') : t('panel.usage.collectorEnable')}
        </button>
      </div>

      {/* 사용자가 이미 쓰던 statusLine 은 지우지 않고 감싼다 — 그 사실을 명시한다. */}
      {installed && status?.passthroughCommand && (
        <div className="rounded border border-gray-700 bg-gray-800/40 px-2.5 py-1.5 text-[10px] leading-relaxed text-gray-400">
          {t('panel.usage.collectorPassthrough')}
        </div>
      )}
      {!installed && status?.foreign && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
          {t('panel.usage.collectorForeign')}
        </div>
      )}
      {(failed || status?.error) && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-red-300">
          {status?.error ?? t('panel.usage.collectorFailed')}
        </div>
      )}
      {installed && (
        <div className="text-[10px] leading-relaxed text-gray-600">
          {t('panel.usage.collectorRestartHint')}
        </div>
      )}
    </div>
  );
}

export const UsagePopup = memo(function UsagePopup({ onClose }: UsagePopupProps): React.JSX.Element {
  const { t } = useTranslation();
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

  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

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

  const updatedLabel = rateLimits
    ? new Date(rateLimits.updatedAt).toLocaleTimeString()
    : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[80vh] w-full max-w-md flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20v-6" />
              <path d="M6 20V10" />
              <path d="M18 20V4" />
            </svg>
            <span className="text-sm font-semibold text-gray-100">{t('panel.usage.title')}</span>
          </div>
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
          {/* 플랜 한도 */}
          <div className="flex flex-col gap-4 px-4 py-4">
            <LimitGauge
              label={t('panel.usage.session5h')}
              used={rateLimits?.used5h}
              resetAt={rateLimits?.resetAt5h}
              now={now}
            />
            <LimitGauge
              label={t('panel.usage.weekly7d')}
              used={rateLimits?.used7d}
              resetAt={rateLimits?.resetAt7d}
              now={now}
            />
            <div className="text-[10px] text-gray-600">
              {updatedLabel
                ? t('panel.usage.lastUpdated', { time: updatedLabel })
                : t('panel.usage.neverUpdated')}
            </div>
          </div>

          {/* 수집기 스위치 */}
          <CollectorSection />

          {/* Vibisual 자신이 굴린 몫 */}
          <div className="flex flex-col gap-1.5 border-t border-gray-700 px-4 py-3">
            <span className="text-xs font-semibold text-gray-200">{t('panel.usage.localTitle')}</span>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-500">{t('panel.usage.localAgents')}</span>
              <span className="font-mono text-gray-300">{local.count}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-500">{t('panel.usage.localInput')}</span>
              <span className="font-mono text-gray-300">{local.input.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-500">{t('panel.usage.localOutput')}</span>
              <span className="font-mono text-emerald-400">{local.output.toLocaleString()}</span>
            </div>
            <div className="mt-0.5 text-[10px] leading-relaxed text-gray-600">
              {t('panel.usage.localHint')}
            </div>
          </div>
        </ScrollFade>
      </div>
    </div>
  );
});

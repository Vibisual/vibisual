import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditEntry, AuditRiskKind, RetentionSettings } from '@vibisual/shared';
import {
  AUDIT_RISK_KINDS,
  AUDIT_TIMELINE_PAGE_SIZE,
  DEFAULT_AUDIT_BOUNDARY,
  DEFAULT_RETENTION_SETTINGS,
  RETENTION_LIMITS,
} from '@vibisual/shared';
import { NumberStepper } from '../Options/NumberStepper.js';
import { useGraphStore } from '../../stores/graphStore.js';
import {
  decisionToneClass,
  findAuditLog,
  formatAuditTime,
  matchesAuditFilter,
  riskLabelKey,
  riskToneClass,
} from '../../utils/auditLog.js';
import { ScrollFade } from '../ScrollFade.js';
import { AuditShieldGlyph } from '../AuditShieldGlyph.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';

// SCENARIO.md §5.22 / §7.20 — 감사 타임라인 팝업. 서버가 접은 것을 그대로 그린다(§3.1). 경계 스위치는 묻기만 끈다(기록 끄기 ❌).
// 관계 설명이 먼저다 — 권한 모드와 별개로 도는 두 번째 검문소라는 말이 없으면 "전부 허용인데 왜 뜨나"가 된다.

interface AuditTimelinePopupProps {
  onClose: () => void;
}

type AuditFilter = 'all' | 'risky' | 'denied';

const FILTERS: readonly AuditFilter[] = ['all', 'risky', 'denied'] as const;

/** §3.2.3 B축 — 감사 원장 보관 줄 수. 값은 `AppState.retention` 한 곳 — 저장소 탭과 같은 값이다. */
const RETENTION_KEY = 'auditEntryMaxPerProject' as const;

/** 스테퍼 PUT 유예(ms) — 디스크 줄 수라 손이 멈춘 뒤 한 번만 보낸다. */
const RETENTION_PUT_DEBOUNCE_MS = 500;

/** 무제한(0)은 체크박스가 갖는다 — 스테퍼 하한 1(0 을 허용하면 체크와 뜻이 어긋난다). */
const RETENTION_STEPPER_MIN = 1;

/** 관계 설명 세 줄 — 순서가 뜻이다: 켜면 / 끄면(기본) / 붙잡히는 범위. */
const ROUTE_POINTS: readonly string[] = [
  'panel.audit.routeOn',
  'panel.audit.routeOff',
  'panel.audit.routeScope',
] as const;

/** 위험 배지 한 장. */
function RiskBadge({ kind }: { kind: AuditRiskKind }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[12px] font-semibold ${riskToneClass(kind)}`}>
      {t(riskLabelKey(kind))}
    </span>
  );
}

/** 타임라인 한 줄 — 시각 · 에이전트 dot · 도구 · 대상 요약 · 위험 · 결정. */
function TimelineRow({ entry }: { entry: AuditEntry }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 border-b border-gray-800/70 px-3 py-1.5 last:border-b-0">
      <span className="w-16 flex-shrink-0 pt-0.5 font-mono text-[12px] tabular-nums text-gray-500">
        {formatAuditTime(entry.at)}
      </span>
      <span
        className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
        style={{ backgroundColor: entry.agentColor ?? '#64748B' }}
        title={entry.agentLabel ?? entry.sessionId}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[12px] font-semibold text-gray-300">
            {entry.toolName}
          </span>
          {entry.riskKinds.map((k) => <RiskBadge key={k} kind={k} />)}
          {entry.escalated && (
            <span className="rounded border border-violet-500/50 bg-violet-500/15 px-1.5 py-0.5 text-[12px] font-semibold text-violet-300">
              {t('panel.audit.escalated')}
            </span>
          )}
          {entry.decision && (
            <span className={`rounded border px-1.5 py-0.5 text-[12px] font-semibold ${decisionToneClass(entry.decision, entry.decisionSource)}`}>
              {t(entry.decision === 'allow' ? 'panel.audit.decisionAllow' : 'panel.audit.decisionDeny')}
              {entry.decisionSource === 'timeout' ? ` · ${t('panel.audit.sourceTimeout')}` : ''}
              {entry.decisionSource === 'policy' ? ` · ${t('panel.audit.sourcePolicy')}` : ''}
              {entry.decisionSource === 'cancelled' ? ` · ${t('panel.audit.sourceCancelled', { defaultValue: 'cancelled' })}` : ''}
            </span>
          )}
        </div>
        <span className="truncate font-mono text-[12px] text-gray-400" title={entry.summary}>
          {entry.summary}
        </span>
        {entry.decisionReason && (
          <span className="truncate text-[12px] text-gray-500">
            {t('panel.audit.reason')}: {entry.decisionReason}
          </span>
        )}
      </div>
      <span className="w-24 flex-shrink-0 truncate pt-0.5 text-right text-[12px] text-gray-500" title={entry.agentLabel}>
        {entry.agentLabel ?? '—'}
      </span>
    </div>
  );
}

export function AuditTimelinePopup({ onClose }: AuditTimelinePopupProps): React.JSX.Element {
  const { t } = useTranslation();
  const backdrop = useBackdropDismiss(onClose);
  const auditLogs = useGraphStore((s) => s.auditLogs);
  const activeProject = useGraphStore((s) => s.activeProject);
  const setBoundary = useGraphStore((s) => s.setAuditBoundary);
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [limit, setLimit] = useState(AUDIT_TIMELINE_PAGE_SIZE);

  // §3.2.3 — 보관 상한. `null` 은 "아직 못 읽음"이고 `0` 은 무제한이다(둘을 같은 값으로 두면
  //   설정을 못 읽은 화면이 "무제한"이라고 거짓말한다).
  const [retentionMax, setRetentionMax] = useState<number | null>(null);
  /** 체크를 껐다가 다시 켤 때 되돌릴 값 — 껐다고 사용자가 정한 숫자를 잊지 않는다. */
  const lastLimitRef = useRef<number>(DEFAULT_RETENTION_SETTINGS[RETENTION_KEY]);
  const putTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/retention-settings');
        if (!res.ok) return;
        const data = await res.json() as { settings: RetentionSettings };
        if (!alive) return;
        const value = data.settings[RETENTION_KEY];
        if (typeof value !== 'number') return;
        setRetentionMax(value);
        if (value > 0) lastLimitRef.current = value;
      } catch {
        // 설정을 못 읽어도 타임라인은 그대로 보여 준다 — 원장과 보존 설정은 다른 축이다.
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => () => {
    if (putTimerRef.current !== undefined) window.clearTimeout(putTimerRef.current);
  }, []);

  const pushRetention = useCallback((next: number): void => {
    setRetentionMax(next);
    if (next > 0) lastLimitRef.current = next;
    if (putTimerRef.current !== undefined) window.clearTimeout(putTimerRef.current);
    putTimerRef.current = window.setTimeout(() => {
      void fetch('/api/retention-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [RETENTION_KEY]: next }),
      }).catch(() => undefined);
    }, RETENTION_PUT_DEBOUNCE_MS);
  }, []);

  const log = findAuditLog(auditLogs, activeProject);
  const boundary = log?.boundary;
  // 원장이 아직 없는 프로젝트도 **기본값 하나**를 따른다(§5.22 — 기본 꺼짐).
  const escalateRisky = boundary?.escalateRisky ?? DEFAULT_AUDIT_BOUNDARY.escalateRisky;

  const filtered = useMemo(
    () => (log?.entries ?? []).filter((e) => matchesAuditFilter(e, filter)),
    [log, filter],
  );
  const shown = filtered.slice(0, limit);
  const empty = !log || log.entries.length === 0;

  const toggleKind = (kind: AuditRiskKind, next: boolean): void => {
    if (!activeProject) return;
    void setBoundary(activeProject, { kinds: { [kind]: next } });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        className="mx-4 flex max-h-[80dvh] w-full max-w-2xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-700 px-4 py-3">
          {/* 제목 옆 방패도 지금 상태를 그대로 말한다 — 꺼져 있으면 헤더 필과 **같은 사선**. */}
          <AuditShieldGlyph
            off={!escalateRisky}
            className={escalateRisky ? 'h-4 w-4 text-amber-400' : 'h-4 w-4 text-gray-500'}
          />
          <span className="text-sm font-semibold text-gray-100">{t('panel.audit.title')}</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            title={t('panel.audit.close')}
            aria-label={t('panel.audit.close')}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-200 pointer-coarse:p-2"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* 폰 폭에서는 머리줄 아래 **전체**가 한 번에 구른다 — 설명·스위치·필터가 고정이면 낮은 화면에서
            그것만으로 창이 차서 목록 자리가 손가락 한 마디만 남았다. 머리줄(닫기)은 늘 보인다.
            넓은 화면에서는 이 묶음이 `contents` 로 사라져 종전대로 목록만 구른다. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:contents">
        {/* §7.20 관계 설명 — 스위치보다 **먼저** 온다. 사용자가 자기 권한 모드를 의심하기 전에
            "이건 그 모드와 별개로 도는 두 번째 검문소"라는 사실이 먼저 눈에 들어와야 한다. */}
        <div className="flex flex-col gap-2 border-b border-gray-700 bg-gray-800/40 px-4 py-3">
          <div className="flex items-center gap-1.5 text-gray-200">
            <svg
              className="h-3.5 w-3.5 flex-shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="6" cy="19" r="3" />
              <circle cx="18" cy="5" r="3" />
              <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
            </svg>
            <span className="text-xs font-semibold">{t('panel.audit.routeTitle')}</span>
          </div>
          <p className="text-[12px] leading-relaxed text-gray-400">{t('panel.audit.routeBody')}</p>
          <div className="flex flex-col gap-1">
            {ROUTE_POINTS.map((key) => (
              <div key={key} className="flex items-start gap-1.5">
                <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-gray-600" />
                <span className="text-[12px] leading-relaxed text-gray-400">{t(key)}</span>
              </div>
            ))}
          </div>
          <div
            className={`flex items-center gap-1.5 self-start rounded border px-2 py-1 text-[12px] font-semibold ${
              escalateRisky
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-gray-600/60 bg-gray-700/40 text-gray-400'
            }`}
          >
            <AuditShieldGlyph off={!escalateRisky} />
            <span>{t(escalateRisky ? 'panel.audit.routeStateOn' : 'panel.audit.routeStateOff')}</span>
          </div>
        </div>

        {/* 경계 스위치 — 실행 전에 물을지만 정한다(기록은 항상 남는다). */}
        <div className="flex flex-col gap-2 border-b border-gray-700 px-4 py-2.5">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={escalateRisky}
              onChange={(e) => activeProject && void setBoundary(activeProject, { escalateRisky: e.target.checked })}
              className="h-3.5 w-3.5 accent-amber-500"
            />
            <span className="text-xs font-semibold text-gray-200">{t('panel.audit.boundaryOn')}</span>
            <span className="text-[12px] text-gray-500">{t('panel.audit.boundaryHint')}</span>
          </label>
          <div className="flex flex-wrap gap-3 pl-5">
            {AUDIT_RISK_KINDS.map((kind) => (
              <label
                key={kind}
                className={`flex items-center gap-1.5 ${escalateRisky ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
              >
                <input
                  type="checkbox"
                  disabled={!escalateRisky}
                  checked={boundary?.kinds?.[kind] !== false}
                  onChange={(e) => toggleKind(kind, e.target.checked)}
                  className="h-3.5 w-3.5 accent-amber-500"
                />
                <span className="text-[12px] text-gray-300">{t(riskLabelKey(kind))}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 필터 탭 + 보관 상한 — 집계 숫자가 "계속 쌓이나"를 묻게 만드는 자리라 그 답을 옆에 둔다(§7.20). */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-gray-700 px-4 py-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => { setFilter(f); setLimit(AUDIT_TIMELINE_PAGE_SIZE); }}
              className={`rounded px-2 py-1 text-[12px] font-semibold transition-colors pointer-coarse:min-h-8 pointer-coarse:px-3 ${
                f === filter
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
              }`}
            >
              {t(f === 'all' ? 'panel.audit.filterAll' : f === 'risky' ? 'panel.audit.filterRisky' : 'panel.audit.filterDenied')}
            </button>
          ))}
          <div className="flex-1" />

          {/* §3.2.3 B축 — 체크박스가 "무제한(0)"을, 숫자가 "얼마나"를 소유한다. */}
          {retentionMax !== null && (
            <label
              className="flex items-center gap-1.5"
              title={t('panel.audit.retentionHint')}
            >
              <input
                type="checkbox"
                checked={retentionMax > 0}
                onChange={(e) => pushRetention(e.target.checked ? lastLimitRef.current : 0)}
                className="h-3.5 w-3.5 accent-amber-500"
              />
              <span className="text-[12px] text-gray-400">{t('panel.audit.retentionLabel')}</span>
              {retentionMax > 0 ? (
                <>
                  <NumberStepper
                    value={retentionMax}
                    onChange={pushRetention}
                    min={RETENTION_STEPPER_MIN}
                    max={RETENTION_LIMITS[RETENTION_KEY].max}
                    step={RETENTION_LIMITS[RETENTION_KEY].step}
                    widthClassName="w-16"
                    ariaLabel={t('panel.audit.retentionLabel')}
                  />
                  <span className="text-[12px] text-gray-500">{t('panel.audit.retentionUnit')}</span>
                </>
              ) : (
                <span className="text-[12px] text-gray-500">{t('panel.audit.retentionUnlimited')}</span>
              )}
            </label>
          )}

          {log && (
            <span className="font-mono text-[12px] tabular-nums text-gray-500">
              {t('panel.audit.countSummary', {
                total: log.counts.total,
                risky: log.counts.risky,
                denied: log.counts.denied,
              })}
            </span>
          )}
        </div>

        <ScrollFade fill className="min-h-0 flex-1 max-md:flex-none">
          <div className="flex flex-col">
            {empty ? (
              <div className="m-4 flex flex-col gap-1.5 rounded border border-gray-700 bg-gray-800/40 px-3 py-4 text-center">
                <span className="text-xs font-semibold text-gray-300">{t('panel.audit.empty')}</span>
                <span className="text-[12px] leading-relaxed text-gray-500">{t('panel.audit.emptyHint')}</span>
              </div>
            ) : (
              <>
                {shown.map((e) => <TimelineRow key={e.id} entry={e} />)}
                {filtered.length > shown.length && (
                  <button
                    type="button"
                    onClick={() => setLimit((n) => n + AUDIT_TIMELINE_PAGE_SIZE)}
                    className="px-3 py-2 text-[12px] font-semibold text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
                  >
                    {t('panel.audit.showMore', { count: filtered.length - shown.length })}
                  </button>
                )}
                {shown.length === 0 && (
                  <div className="px-3 py-4 text-center text-[12px] text-gray-500">{t('panel.audit.noMatch')}</div>
                )}
                {/* 화면에 없는 몫 — 전선은 최근 줄만 싣고(§9) 캡에 밀린 줄은 합계로만 남는다.
                    둘 다 "숫자에는 있는데 내역이 없다"는 같은 상태라 한 줄로 말한다. */}
                {log.counts.total > log.entries.length && (
                  <div className="px-3 py-2 text-center text-[12px] text-gray-600">
                    {t('panel.audit.retired', { count: log.counts.total - log.entries.length })}
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollFade>
        </div>
      </div>
    </div>
  );
}

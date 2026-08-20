import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditEntry, AuditRiskKind } from '@vibisual/shared';
import { AUDIT_RISK_KINDS, AUDIT_TIMELINE_PAGE_SIZE, DEFAULT_AUDIT_BOUNDARY } from '@vibisual/shared';
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

// SCENARIO.md §5.22 / §7.20 — 감사 타임라인 팝업.
//
// 줄과 집계는 전부 서버가 접어 실어 준 것을 **그대로** 그린다(§3.1). 여기서 원장을 다시 세거나
// 위험을 다시 판정하지 않는다 — 필터 탭은 "무엇을 보여줄까"를 고르는 일이지 값을 만드는 일이 아니다.
//
// 경계 스위치는 **묻는 일만** 끈다. 기록을 끄는 스위치는 두지 않는다 — 감사의 값은 다 남는 데 있다.
//
// 스위치보다 **먼저** 오는 것은 관계 설명이다(§7.20). "권한 모드를 전부 허용으로 뒀는데 왜
// 승인 팝업이 뜨나"는 스위치를 못 찾아서 생기는 물음이 아니라, 이 경계가 권한 모드와 **별개로
// 도는 두 번째 검문소**라는 사실이 화면 어디에도 없어서 생기는 물음이다.

interface AuditTimelinePopupProps {
  onClose: () => void;
}

type AuditFilter = 'all' | 'risky' | 'denied';

const FILTERS: readonly AuditFilter[] = ['all', 'risky', 'denied'] as const;

/**
 * 관계 설명의 세 줄 — 켜면 / 끄면(기본) / 붙잡히는 범위.
 *
 * 순서가 뜻이다: 사용자가 겪은 일(켜면 bypass 여도 카드가 뜬다)이 먼저고, 그 다음이 지금의
 * 기본 상태이며, 마지막이 "내 에디터 세션은 왜 안 걸리나"에 대한 답이다.
 */
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
            <span className={`rounded border px-1.5 py-0.5 text-[12px] font-semibold ${decisionToneClass(entry.decision)}`}>
              {t(entry.decision === 'allow' ? 'panel.audit.decisionAllow' : 'panel.audit.decisionDeny')}
              {entry.decisionSource === 'timeout' ? ` · ${t('panel.audit.sourceTimeout')}` : ''}
              {entry.decisionSource === 'policy' ? ` · ${t('panel.audit.sourcePolicy')}` : ''}
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
        className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-gray-700 px-4 py-3">
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
            className="rounded p-1 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

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

        {/* 필터 탭 */}
        <div className="flex items-center gap-1 border-b border-gray-700 px-4 py-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => { setFilter(f); setLimit(AUDIT_TIMELINE_PAGE_SIZE); }}
              className={`rounded px-2 py-1 text-[12px] font-semibold transition-colors ${
                f === filter
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
              }`}
            >
              {t(f === 'all' ? 'panel.audit.filterAll' : f === 'risky' ? 'panel.audit.filterRisky' : 'panel.audit.filterDenied')}
            </button>
          ))}
          <div className="flex-1" />
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

        <ScrollFade fill className="min-h-0 flex-1">
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
  );
}

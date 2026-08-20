import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CostAgentTotal, CostPeriod, CostSessionEntry, CostTotals } from '@vibisual/shared';
import {
  COST_PERIODS,
  costPeriodStart,
  costTokenTotal,
  formatCostUsd,
  formatTokenCount,
} from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { costTextToneClass, findCostMap, toneOf } from '../../utils/costMap.js';
import { ScrollFade } from '../ScrollFade.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';

// SCENARIO.md §5.21 / §7.19 — 비용·토큰 지도 팝업.
//
// 값은 전부 서버가 접어서 실어 준 것을 **그대로** 그린다(§3.1). 여기서 턴을 다시 더하거나
// 기간을 다시 자르지 않는다 — 세션 표만 `lastAt` 으로 거르는데, 그건 "그 기간에 움직인
// 세션"을 고르는 일이지 금액을 다시 계산하는 일이 아니다(줄의 금액은 세션 누적이다).

interface CostMapPopupProps {
  onClose: () => void;
}

/** 토큰 한 칸 — 라벨 + 값. 캐시 읽기를 접지 않는 이유는 청구액의 대부분이 거기서 나오기 때문이다. */
function TokenCell({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] text-gray-500">{label}</span>
      <span className="font-mono text-xs font-semibold tabular-nums text-gray-300">{formatTokenCount(value)}</span>
    </div>
  );
}

/** 합계 카드 — 그 기간의 비용 한 값 + 토큰 4종. */
function TotalsCard({ totals, measured }: { totals: CostTotals; measured: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const tone = costTextToneClass(toneOf(totals.costUsd, measured));

  return (
    <div className="flex flex-col gap-3 rounded border border-gray-700 bg-gray-800/40 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-gray-300">{t('panel.cost.totalCost')}</span>
        <span className={`font-mono text-2xl font-bold tabular-nums ${tone}`}>
          {measured ? formatCostUsd(totals.costUsd) : t('panel.cost.notMeasured')}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <TokenCell label={t('panel.cost.inputTokens')} value={totals.inputTokens} />
        <TokenCell label={t('panel.cost.outputTokens')} value={totals.outputTokens} />
        <TokenCell label={t('panel.cost.cacheReadTokens')} value={totals.cacheReadTokens} />
        <TokenCell label={t('panel.cost.cacheCreateTokens')} value={totals.cacheCreateTokens} />
      </div>
    </div>
  );
}

/** 표 한 줄 — 이름·모델·토큰·비용. 에이전트 표와 세션 표가 같은 골격을 쓴다. */
function CostRow({
  name,
  model,
  tokens,
  costUsd,
  measured,
  onClick,
}: {
  name: string;
  model?: string;
  tokens: number;
  costUsd: number;
  measured: boolean;
  onClick?: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tone = costTextToneClass(toneOf(costUsd, measured));
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-xs text-gray-200">{name}</span>
      <span className="w-24 flex-shrink-0 truncate text-right text-[12px] text-gray-500">{model ?? '—'}</span>
      <span className="w-16 flex-shrink-0 text-right font-mono text-[12px] tabular-nums text-gray-400">
        {measured ? formatTokenCount(tokens) : '—'}
      </span>
      <span className={`w-20 flex-shrink-0 text-right font-mono text-xs font-semibold tabular-nums ${tone}`}>
        {measured ? formatCostUsd(costUsd) : t('panel.cost.notMeasured')}
      </span>
    </>
  );

  if (!onClick) {
    return <div className="flex items-center gap-2 px-3 py-1.5">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
    >
      {body}
    </button>
  );
}

/** 표 머리 — 이름·모델·토큰·비용. */
function TableHead(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 border-b border-gray-700/70 px-3 py-1 text-[12px] font-semibold text-gray-500">
      <span className="min-w-0 flex-1">{t('panel.cost.colName')}</span>
      <span className="w-24 flex-shrink-0 text-right">{t('panel.cost.colModel')}</span>
      <span className="w-16 flex-shrink-0 text-right">{t('panel.cost.colTokens')}</span>
      <span className="w-20 flex-shrink-0 text-right">{t('panel.cost.colCost')}</span>
    </div>
  );
}

export function CostMapPopup({ onClose }: CostMapPopupProps): React.JSX.Element {
  const { t } = useTranslation();
  const backdrop = useBackdropDismiss(onClose);
  const costMaps = useGraphStore((s) => s.costMaps);
  const activeProject = useGraphStore((s) => s.activeProject);
  const selectNode = useGraphStore((s) => s.selectNode);
  const [period, setPeriod] = useState<CostPeriod>('today');

  // §7.19 — 이 팝업은 사용량 팝업 **위**에 겹쳐 뜨므로 Esc 를 자기가 받아야 한다. 아래 팝업은
  //   자기 위에 이것이 떠 있는 동안 Esc 를 비켜서므로, 한 번 누르면 위에 있는 이것만 닫힌다.
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const map = findCostMap(costMaps, activeProject);
  const totals = map ? map.periods[period] : undefined;

  // 에이전트 표 — 서버가 미리 접어 둔 기간 값을 골라 쓰고, 그 기간에 움직임이 없는 줄은 뺀다.
  const agents = useMemo((): CostAgentTotal[] => {
    if (!map) return [];
    return map.agents
      .filter((a) => a.periods[period].costUsd > 0 || costTokenTotal(a.periods[period]) > 0 || !a.measured)
      .sort((a, b) => b.periods[period].costUsd - a.periods[period].costUsd);
  }, [map, period]);

  // 세션 표 — 마지막 활동이 그 기간 안인 줄만. 금액은 세션 누적이며 그 사실을 아래 각주가 말한다.
  const sessions = useMemo((): CostSessionEntry[] => {
    if (!map) return [];
    const from = costPeriodStart(period, Date.now());
    return map.sessions.filter((s) => s.lastAt >= from);
  }, [map, period]);

  const empty = !map || !map.measured;

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
          <svg className="h-4 w-4 flex-shrink-0 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2v20" />
            <path d="M17 7.5c0-1.9-2.2-3-5-3s-5 1-5 3 2.2 2.7 5 3.2 5 1.3 5 3.3-2.2 3-5 3-5-1.1-5-3" />
          </svg>
          <span className="text-sm font-semibold text-gray-100">{t('panel.cost.title')}</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            title={t('panel.cost.close')}
            aria-label={t('panel.cost.close')}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* 기간 탭 — 고른 기간이 아래 전부를 지배한다. */}
        <div className="flex gap-1 border-b border-gray-700 px-4 py-2">
          {COST_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded px-2 py-1 text-[12px] font-semibold transition-colors ${
                p === period
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
              }`}
            >
              {t(
                p === 'today' ? 'panel.cost.periodToday'
                  : p === 'week' ? 'panel.cost.periodWeek'
                    : p === 'month' ? 'panel.cost.periodMonth'
                      : 'panel.cost.periodAll',
              )}
            </button>
          ))}
        </div>

        <ScrollFade fill className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 px-4 py-3">
            {empty ? (
              <div className="flex flex-col gap-1.5 rounded border border-gray-700 bg-gray-800/40 px-3 py-4 text-center">
                <span className="text-xs font-semibold text-gray-300">{t('panel.cost.empty')}</span>
                <span className="text-[12px] leading-relaxed text-gray-500">{t('panel.cost.emptyHint')}</span>
              </div>
            ) : (
              <>
                <TotalsCard totals={totals ?? map.periods.all} measured={map.measured} />

                {/* 에이전트 표 */}
                <div className="flex flex-col rounded border border-gray-700 bg-gray-800/30">
                  <div className="px-3 py-1.5 text-xs font-semibold text-gray-300">{t('panel.cost.agentsTitle')}</div>
                  <TableHead />
                  {agents.map((a) => (
                    <CostRow
                      key={a.agentId}
                      name={a.label ?? a.agentId}
                      model={a.model}
                      tokens={costTokenTotal(a.periods[period])}
                      costUsd={a.periods[period].costUsd}
                      measured={a.measured}
                      onClick={() => {
                        selectNode(a.agentId);
                        onClose();
                      }}
                    />
                  ))}
                </div>

                {/* 세션 표 */}
                <div className="flex flex-col rounded border border-gray-700 bg-gray-800/30">
                  <div className="px-3 py-1.5 text-xs font-semibold text-gray-300">{t('panel.cost.sessionsTitle')}</div>
                  <TableHead />
                  {sessions.map((s) => (
                    <CostRow
                      key={s.sessionId}
                      name={s.label ?? s.sessionId}
                      model={s.model}
                      tokens={costTokenTotal(s)}
                      costUsd={s.costUsd}
                      measured={s.measured}
                    />
                  ))}
                  <div className="px-3 py-1.5 text-[12px] leading-relaxed text-gray-500">
                    {t('panel.cost.sessionCumulativeNote')}
                  </div>
                </div>

                <div className="flex flex-col gap-1 text-[12px] leading-relaxed text-gray-500">
                  <span>{t('panel.cost.estimateNote')}</span>
                  {map.retired && map.retired.costUsd > 0 && (
                    <span>{t('panel.cost.retiredNote', { cost: formatCostUsd(map.retired.costUsd) })}</span>
                  )}
                </div>
              </>
            )}
          </div>
        </ScrollFade>
      </div>
    </div>
  );
}

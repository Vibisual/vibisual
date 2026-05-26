import { memo, useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionTokenData, TurnTokenUsage, TokenCategoryEstimate } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';

const API_BASE = '';

/** 팝업 모드: turn = 이 프롬프트만, session = 세션 종합 */
type PopupMode = 'turn' | 'session';

interface TokenUsagePopupProps {
  sessionId: string;
  /** 서브에이전트 세션 ID 목록 (자체 세션이 없을 때 이것들로 조회) */
  subSessionIds?: string[];
  /** turn 모드일 때 매칭할 타임스탬프 */
  eventTimestamp?: number;
  mode: PopupMode;
  onClose: () => void;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}:${ss}`;
}

function findClosestTurn(turns: TurnTokenUsage[], targetTs: number): TurnTokenUsage | null {
  if (turns.length === 0) return null;
  let closest = turns[0]!;
  let minDiff = Math.abs(closest.timestamp - targetTs);
  for (const t of turns) {
    const diff = Math.abs(t.timestamp - targetTs);
    if (diff < minDiff) { closest = t; minDiff = diff; }
  }
  return closest;
}

const CATEGORY_COLORS: Record<string, string> = {
  claude_md: '#F59E0B',
  system_prompt: '#3B82F6',
  tool_schemas: '#8B5CF6',
  git_status: '#10B981',
  memory: '#EC4899',
  conversation: '#6366F1',
};

function getCategoryColor(key: string): string {
  return CATEGORY_COLORS[key] ?? '#64748B';
}

/** 토큰 수치 그리드 (턴 / 세션 공용) */
function TokenStatsGrid({ items }: {
  items: { label: string; value: number; color: string; actual?: number }[];
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">{item.label}</span>
          <div className="flex items-center gap-1.5">
            <span className={`font-mono text-xs font-semibold ${item.color}`}>
              {formatNumber(item.value)}
            </span>
            {item.actual !== undefined && (
              <span className="font-mono text-[10px] text-gray-600">
                ({t('panel.tokenUsage.actualSuffix', { count: formatNumber(item.actual) })})
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 이번 턴 사용량 섹션 */
function CurrentTurnSection({ turn }: { turn: TurnTokenUsage }): React.JSX.Element {
  const { t } = useTranslation();
  const cacheReadEffective = Math.round(turn.cacheReadTokens * 0.1);
  const billable = turn.inputTokens + turn.outputTokens + cacheReadEffective + turn.cacheCreateTokens;

  return (
    <div className="border-b border-gray-700 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-100">{t('panel.tokenUsage.thisPrompt')}</span>
        {turn.model && (
          <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-400">
            {turn.model}
          </span>
        )}
        {turn.tools.length > 0 && (
          <span className="text-[10px] text-gray-500">
            {turn.tools.join(', ')}
          </span>
        )}
      </div>
      {/* 이 턴 청구 기준 */}
      <div className="mb-2 flex items-center justify-between rounded bg-gray-800/50 px-2.5 py-1.5">
        <span className="text-[11px] text-gray-400">{t('panel.tokenUsage.billable')}</span>
        <span className="font-mono text-sm font-bold text-amber-400">{formatNumber(billable)}</span>
      </div>
      <TokenStatsGrid items={[
        { label: t('panel.tokenUsage.input'), value: turn.inputTokens, color: 'text-gray-300' },
        { label: t('panel.tokenUsage.output'), value: turn.outputTokens, color: 'text-emerald-400' },
        { label: t('panel.tokenUsage.cacheRead'), value: cacheReadEffective, color: 'text-amber-400', actual: turn.cacheReadTokens },
        { label: t('panel.tokenUsage.cacheCreate'), value: turn.cacheCreateTokens, color: 'text-violet-400' },
      ]} />
    </div>
  );
}

/** 세션 종합 섹션 — 청구 기준 종합 */
function SessionSummarySection({ turns }: { turns: TurnTokenUsage[] }): React.JSX.Element {
  const { t } = useTranslation();
  const totals = useMemo(() => {
    let input = 0, output = 0, cacheRead = 0, cacheCreate = 0;
    for (const t of turns) {
      input += t.inputTokens;
      output += t.outputTokens;
      cacheRead += t.cacheReadTokens;
      cacheCreate += t.cacheCreateTokens;
    }
    // 청구 기준: cache_read는 10%만 반영
    const cacheReadEffective = Math.round(cacheRead * 0.1);
    const billableTotal = input + output + cacheReadEffective + cacheCreate;
    return { input, output, cacheRead, cacheReadEffective, cacheCreate, billableTotal };
  }, [turns]);

  const lastTurn = turns.length > 0 ? turns[turns.length - 1]! : null;
  const lastModel = lastTurn?.model;

  return (
    <div className="border-b border-gray-700 px-4 py-4">
      {/* 큰 숫자: 청구 기준 종합 */}
      <div className="mb-3 text-center">
        <div className="font-mono text-3xl font-bold text-amber-400">
          {formatNumber(totals.billableTotal)}
        </div>
        <div className="mt-0.5 text-[11px] text-gray-500">{t('panel.tokenUsage.billableTokens')}</div>
      </div>

      {/* 메타 */}
      <div className="mb-3 flex items-center justify-center gap-3">
        <span className="rounded bg-gray-600/30 px-2 py-0.5 text-[10px] text-gray-400">
          {t('panel.tokenUsage.turns', { count: turns.length })}
        </span>
        {lastModel && (
          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] text-blue-400">
            {lastModel}
          </span>
        )}
        {lastTurn && (
          <span className="rounded bg-gray-600/30 px-2 py-0.5 text-[10px] text-gray-400">
            {t('panel.tokenUsage.nowContext', { count: formatNumber(lastTurn.totalContext) })}
          </span>
        )}
      </div>

      {/* 세부 내역 */}
      <TokenStatsGrid items={[
        { label: t('panel.tokenUsage.input'), value: totals.input, color: 'text-gray-300' },
        { label: t('panel.tokenUsage.output'), value: totals.output, color: 'text-emerald-400' },
        { label: t('panel.tokenUsage.cacheRead'), value: totals.cacheReadEffective, color: 'text-amber-400', actual: totals.cacheRead },
        { label: t('panel.tokenUsage.cacheCreate'), value: totals.cacheCreate, color: 'text-violet-400' },
      ]} />
    </div>
  );
}

/** 토큰 로그 섹션 */
function TokenLogSection({ turns }: { turns: TurnTokenUsage[] }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="border-b border-gray-700 px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold text-gray-400">
        {t('panel.tokenUsage.tokenLog', { count: turns.length })}
      </h3>
      <ScrollFade maxHeight={200}>
        <div className="flex flex-col gap-0.5">
          {turns.map((t) => (
            <div
              key={t.turnIndex}
              className="flex items-center gap-2 rounded px-2 py-1 text-[11px] hover:bg-gray-800/50"
            >
              <span className="w-6 shrink-0 text-right font-mono text-gray-600">
                {t.turnIndex + 1}
              </span>
              <span className="w-20 shrink-0 text-gray-500">{formatDate(t.timestamp)}</span>
              <span className="flex-1 font-mono text-gray-300">{formatNumber(t.totalContext)}</span>
              <span className="font-mono text-emerald-400/70">+{formatNumber(t.outputTokens)}</span>
            </div>
          ))}
        </div>
      </ScrollFade>
    </div>
  );
}

/** 카테고리 그래프 섹션 */
function CategoryGraphSection({ categories }: { categories: TokenCategoryEstimate[] }): React.JSX.Element {
  const { t } = useTranslation();
  const maxTokens = categories.length > 0 ? categories[0]!.estimatedTokens : 1;

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold text-gray-400">{t('panel.tokenUsage.categoryBreakdown')}</h3>
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
          {t('panel.tokenUsage.estimate')}
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        {categories.map((cat) => {
          const barWidth = maxTokens > 0 ? Math.max(2, (cat.estimatedTokens / maxTokens) * 100) : 0;
          const color = getCategoryColor(cat.key);
          return (
            <div key={cat.key}>
              <div className="mb-0.5 flex items-center justify-between">
                <span className="text-[11px] text-gray-300">{cat.label}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-gray-400">
                    {formatNumber(cat.estimatedTokens)}
                  </span>
                  <span className="w-8 text-right text-[10px] text-gray-600">
                    {cat.percentage}%
                  </span>
                </div>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-800">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${barWidth}%`, backgroundColor: color }}
                />
              </div>
              {cat.detail && (
                <div className="mt-0.5 text-[10px] text-gray-600">
                  ({cat.detail})
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const TokenUsagePopup = memo(function TokenUsagePopup({
  sessionId,
  subSessionIds,
  eventTimestamp,
  mode,
  onClose,
}: TokenUsagePopupProps): React.JSX.Element {
  const { t } = useTranslation();
  const [data, setData] = useState<SessionTokenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/tokens/${sessionId}`);
      if (!res.ok) { setError(`HTTP ${res.status}`); return; }
      const primary = await res.json() as SessionTokenData;

      // 자체 데이터가 비어있고 서브에이전트 세션이 있으면 합산
      const ids = subSessionIds ?? [];
      if (primary.turns.length === 0 && ids.length > 0) {
        const allTurns: TurnTokenUsage[] = [];
        const allCategories: TokenCategoryEstimate[] = [];
        for (const subSid of ids) {
          try {
            const subRes = await fetch(`${API_BASE}/api/tokens/${subSid}`);
            if (!subRes.ok) continue;
            const subData = await subRes.json() as SessionTokenData;
            allTurns.push(...subData.turns);
            if (subData.categories.length > 0) {
              allCategories.length = 0;
              allCategories.push(...subData.categories);
            }
          } catch { /* skip */ }
        }
        if (allTurns.length > 0) {
          allTurns.sort((a, b) => a.timestamp - b.timestamp);
          allTurns.forEach((t, i) => { t.turnIndex = i; });
          setData({ sessionId, turns: allTurns, categories: allCategories });
          return;
        }
      }

      setData(primary);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId, subSessionIds]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const currentTurn = useMemo(() => {
    if (!data || !eventTimestamp) return null;
    return findClosestTurn(data.turns, eventTimestamp);
  }, [data, eventTimestamp]);

  /** Turn 모드: 해당 턴 기준 카테고리 (세션 누적을 턴 수로 나눔 + 이 턴의 도구 정보) */
  const turnCategories = useMemo((): TokenCategoryEstimate[] => {
    if (!data || !currentTurn) return [];
    const turnCount = data.turns.length;
    if (turnCount === 0) return [];

    const totalContext = currentTurn.totalContext;
    const perTurn: TokenCategoryEstimate[] = [];
    let fixedSum = 0;

    for (const cat of data.categories) {
      if (cat.key === 'conversation') continue;
      const perTurnEst = Math.round(cat.estimatedTokens / turnCount);
      fixedSum += perTurnEst;

      // detail: tool_schemas uses this turn's tools
      let detail: string | undefined;
      if (cat.key === 'tool_schemas' && currentTurn.tools.length > 0) {
        detail = currentTurn.tools.join(', ');
      }

      perTurn.push({
        key: cat.key,
        label: cat.label,
        estimatedTokens: perTurnEst,
        percentage: totalContext > 0 ? Math.round((perTurnEst / totalContext) * 100) : 0,
        detail,
      });
    }

    // Conversation = this turn's context - fixed overhead
    const convTokens = Math.max(0, totalContext - fixedSum);
    perTurn.push({
      key: 'conversation',
      label: t('panel.tokenUsage.conversationHistory'),
      estimatedTokens: convTokens,
      percentage: totalContext > 0 ? Math.round((convTokens / totalContext) * 100) : 0,
    });

    return perTurn.sort((a, b) => b.estimatedTokens - a.estimatedTokens);
  }, [data, currentTurn, t]);

  const title = mode === 'turn' ? t('panel.tokenUsage.titleTurn') : t('panel.tokenUsage.titleSession');

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span className="text-sm font-semibold text-gray-100">{title}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            aria-label={t('panel.tokenUsage.closePopup')}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <ScrollFade fill className="min-h-0 flex-1">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
              <span className="ml-2 text-xs text-gray-500">{t('panel.tokenUsage.loading')}</span>
            </div>
          )}

          {error && (
            <div className="p-4 text-center text-xs text-red-400">{error}</div>
          )}

          {/* Turn 모드: 이 프롬프트만 */}
          {data && mode === 'turn' && currentTurn && (
            <>
              <CurrentTurnSection turn={currentTurn} />
              <CategoryGraphSection categories={turnCategories} />
            </>
          )}

          {data && mode === 'turn' && !currentTurn && (
            <div className="p-4 text-center text-xs text-gray-500">{t('panel.tokenUsage.noMatchingTurn')}</div>
          )}

          {/* Session 모드: 세션 종합 */}
          {data && mode === 'session' && (
            <>
              <SessionSummarySection turns={data.turns} />
              <TokenLogSection turns={data.turns} />
              <CategoryGraphSection categories={data.categories} />
            </>
          )}
        </ScrollFade>
      </div>
    </div>
  );
});

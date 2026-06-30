import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent } from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import type { SessionSummaryEntry } from '../../stores/graphStore.js';

// §5.5 #17-8 v2.95 — 세션 요약 보드.
//
// 쌓인 세션을 하나씩 열어보지 않아도 한눈에 파악하도록, 세션별 요약 카드 1장씩을 모아 보여준다.
//  - 카드(작업/검수/질문/목록 신고)가 있는 세션 → 그 카드를 subAgentId 로 필터해 색구분 집계.
//  - 카드가 없는 세션 → 그 세션의 claude 대화를 헤드리스 `--resume` 해 한 줄 자기요약을 받아온다.
// 자동 닫기는 비활성화(status!=='active')되고 검수 끝난(ack=회색 점) 세션만 대상 — History 로 보존되어 복원 가능.
// 닫혀도 요약은 캐시(closed:true)로 보드에 남아 "요약해서 건네주고 세션은 닫기" 흐름을 완성한다.

const EMPTY_SUBS: SubAgent[] = [];

function formatStamp(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** 색구분 섹션 한 줄 묶음 — 항목이 없으면 렌더 안 함. */
function SummarySection({ label, items, dotClass, textClass }: {
  label: string; items: string[]; dotClass: string; textClass: string;
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 first:mt-0">
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotClass}`} />
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-200">{label}</span>
        <span className="rounded bg-gray-700/60 px-1.5 text-[10px] font-semibold tabular-nums text-gray-300">{items.length}</span>
      </div>
      <ul className="flex flex-col gap-1 pl-4">
        {items.map((it, i) => (
          <li key={i} className={`line-clamp-3 break-words text-[13px] leading-relaxed ${textClass}`}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

/** 상태 점 색 — IDETabBar 와 동일 규약(미확인=녹색, 확인=회색, 실행=파랑). */
function statusDot(sub: SubAgent, acked: boolean): string {
  if (sub.status === 'active') return 'bg-blue-400 animate-pulse';
  if (sub.status === 'error') return 'bg-red-400';
  if (sub.status === 'idle' && !acked) return 'bg-emerald-400';
  return 'bg-gray-500';
}

interface CardData {
  did: string[];
  userActions: string[];
  nextSteps: string[];
  changes: string[];
  checkpoints: string[];
  questions: string[];
  listItems: string[];
}

/**
 * 세션 요약 보드 — 세션창(IDE 메인 영역) 전체를 덮는 패널. AgentIDEOverlay 가 활동바 우측 영역에
 * 절대배치로 띄운다(북마크 패널과 동형).
 */
export const IDESessionSummaryView = memo(function IDESessionSummaryView({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  const rawSubAgents = useGraphStore((s) => s.subAgents[agentId] ?? EMPTY_SUBS);
  const pendingRemovals = useGraphStore((s) => s.pendingSubAgentRemovals);
  const subAgentLabels = useGraphStore((s) => s.subAgentLabels);
  const acknowledgedSubAgents = useGraphStore((s) => s.acknowledgedSubAgents);
  const agentReports = useGraphStore((s) => s.agentReports[agentId]);
  const agentReviews = useGraphStore((s) => s.agentReviews[agentId]);
  const agentQuestions = useGraphStore((s) => s.agentQuestions[agentId]);
  const agentLists = useGraphStore((s) => s.agentLists[agentId]);
  const sessionSummaries = useGraphStore((s) => s.sessionSummaries);
  const setSession = useGraphStore((s) => s.setIDEActiveSession);

  // 세션별 자기요약 진행 상태(로컬 휘발).
  const [busy, setBusy] = useState<Record<string, 'loading' | 'error'>>({});

  const labelOf = useCallback(
    (sub: SubAgent): string => subAgentLabels[sub.id] ?? sub.label,
    [subAgentLabels],
  );

  // 펜딩 제거를 반영한 살아있는 세션 목록(최근 활동 순).
  const openSubs = useMemo(() => {
    const list = rawSubAgents.filter((sa) => pendingRemovals[sa.id] !== agentId);
    return [...list].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }, [rawSubAgents, pendingRemovals, agentId]);

  // 세션별 카드 집계.
  const cardsBySub = useMemo(() => {
    const map = new Map<string, CardData>();
    const ensure = (id: string): CardData => {
      let d = map.get(id);
      if (!d) { d = { did: [], userActions: [], nextSteps: [], changes: [], checkpoints: [], questions: [], listItems: [] }; map.set(id, d); }
      return d;
    };
    for (const r of agentReports ?? []) {
      if (!r.subAgentId) continue;
      const d = ensure(r.subAgentId);
      d.did.push(...r.did);
      d.userActions.push(...r.userActions);
      if (r.nextSteps) d.nextSteps.push(...r.nextSteps);
    }
    for (const rv of agentReviews ?? []) {
      if (!rv.subAgentId) continue;
      const d = ensure(rv.subAgentId);
      d.changes.push(...rv.changes);
      d.checkpoints.push(...rv.checkpoints);
    }
    for (const q of agentQuestions ?? []) {
      if (!q.subAgentId) continue;
      const d = ensure(q.subAgentId);
      for (const it of q.items) d.questions.push(it.question);
    }
    for (const l of agentLists ?? []) {
      if (!l.subAgentId) continue;
      const d = ensure(l.subAgentId);
      const prefix = l.title ? `${l.title}: ` : '';
      d.listItems.push(...l.items.map((x, i) => (i === 0 ? prefix + x : x)));
    }
    return map;
  }, [agentReports, agentReviews, agentQuestions, agentLists]);

  const hasCards = useCallback((subId: string): boolean => {
    const d = cardsBySub.get(subId);
    if (!d) return false;
    return d.did.length + d.userActions.length + d.nextSteps.length + d.changes.length + d.checkpoints.length + d.questions.length + d.listItems.length > 0;
  }, [cardsBySub]);

  const closeable = useCallback(
    (sub: SubAgent): boolean => sub.status !== 'active' && !!acknowledgedSubAgents[sub.id],
    [acknowledgedSubAgents],
  );

  // 카드/캐시에서 짧은 보존 텍스트 합성(닫을 때 보드에 카드를 남기기 위함).
  // 캐시는 라이브 state 에서 읽는다 — 자기요약 직후 자동 닫기에서 방금 받은 텍스트가 클로저 stale 로 누락되지 않게.
  const buildRetainText = useCallback((sub: SubAgent): string => {
    const cached = useGraphStore.getState().sessionSummaries[sub.id]?.text;
    if (cached) return cached;
    const d = cardsBySub.get(sub.id);
    if (d) {
      const lines = [...d.did, ...d.changes, ...d.userActions.map((u) => `→ ${u}`)].slice(0, 3);
      if (lines.length > 0) return lines.join('\n');
    }
    return sub.lastResult ?? '';
  }, [cardsBySub]);

  // 단일 세션 닫기(IDETabBar.deleteSubAgent 와 동일 절차: PTY 종료 + 낙관적 제거 + 핀/Default 해제 + active 재배정 + DELETE).
  const closeSession = useCallback((sub: SubAgent) => {
    const store = useGraphStore.getState();
    void window.api?.terminal?.kill(`term:${agentId}:${sub.id}`);
    store.optimisticRemoveSubAgent(agentId, sub.id);
    store.setTabPin(`subagent:${sub.id}`, false);
    if (store.defaultSubAgents[agentId] === sub.id) store.setDefaultSubAgent(agentId, null);
    if (selectIDEOverlay(store).activeSessionId === sub.id) {
      const remaining = (store.subAgents[agentId] ?? []).filter(
        (s) => s.id !== sub.id && store.pendingSubAgentRemovals[s.id] !== agentId,
      );
      store.setIDEActiveSession(remaining[0]?.id ?? null);
    }
    fetch(`/api/subagents/${agentId}/${sub.id}`, { method: 'DELETE' }).catch(() => { /* snapshot 권위 */ });
  }, [agentId]);

  // 요약을 보드에 남기고 세션 닫기.
  const retainAndClose = useCallback((sub: SubAgent) => {
    const store = useGraphStore.getState();
    store.setSessionSummary({
      subId: sub.id, agentId, label: labelOf(sub), text: buildRetainText(sub), at: Date.now(), closed: true,
    });
    closeSession(sub);
  }, [agentId, labelOf, buildRetainText, closeSession]);

  // 카드 없는 세션 자기요약 받기.
  const fetchSummary = useCallback(async (sub: SubAgent) => {
    setBusy((b) => ({ ...b, [sub.id]: 'loading' }));
    try {
      const r = await fetch(`/api/subagents/${agentId}/${sub.id}/summary`, { method: 'POST' });
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; text?: string };
      if (r.ok && data.ok && data.text) {
        useGraphStore.getState().setSessionSummary({
          subId: sub.id, agentId, label: labelOf(sub), text: data.text, at: Date.now(),
        });
        setBusy((b) => { const n = { ...b }; delete n[sub.id]; return n; });
        // 검수 끝난 비활성 세션이면 요약 직후 자동 닫기(요약은 보드에 잔류).
        if (closeable(sub)) retainAndClose(sub);
      } else {
        setBusy((b) => ({ ...b, [sub.id]: 'error' }));
      }
    } catch {
      setBusy((b) => ({ ...b, [sub.id]: 'error' }));
    }
  }, [agentId, labelOf, closeable, retainAndClose]);

  // 비활성·검수완료 세션 일괄 닫기(요약 보존).
  const closeableOpen = useMemo(() => openSubs.filter(closeable), [openSubs, closeable]);
  const handleCloseAllTidied = useCallback(() => {
    for (const sub of closeableOpen) retainAndClose(sub);
  }, [closeableOpen, retainAndClose]);

  const jumpTo = useCallback((subId: string) => {
    setSession(subId);
    onClose();
  }, [setSession, onClose]);

  // 닫힌 세션 요약(캐시) — 살아있는 세션에 없는 closed 항목.
  const closedEntries = useMemo(() => {
    const openIds = new Set(openSubs.map((s) => s.id));
    return Object.values(sessionSummaries)
      .filter((e) => e.agentId === agentId && e.closed && !openIds.has(e.subId))
      .sort((a, b) => b.at - a.at);
  }, [sessionSummaries, agentId, openSubs]);

  const totalCount = openSubs.length + closedEntries.length;

  return (
    <div className="flex h-full w-full flex-col bg-gray-950">
      {/* 헤더 */}
      <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-gray-700 bg-gray-900/80 px-4">
        <span className="flex items-center gap-2 text-[14px] font-bold text-gray-100">
          <svg className="h-4 w-4 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="13" height="13" rx="2" />
            <path d="M8 21h10a2 2 0 0 0 2-2V9" />
          </svg>
          {t('ide.sessionSummary.title')}
          {totalCount > 0 && <span className="text-gray-500">({totalCount})</span>}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCloseAllTidied}
            disabled={closeableOpen.length === 0}
            title={t('ide.sessionSummary.closeTidiedHint')}
            className="flex items-center gap-1.5 rounded border border-gray-700 px-2 py-1 text-[11px] font-medium text-gray-300 transition-colors enabled:hover:border-violet-500/50 enabled:hover:bg-violet-500/10 enabled:hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" /><path d="M14 11v6" />
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            </svg>
            {t('ide.sessionSummary.closeTidied', { count: closeableOpen.length })}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ide.sessionSummary.close')}
            title={t('ide.sessionSummary.close')}
            className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* 본문 */}
      {totalCount === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] leading-relaxed text-gray-400">
          {t('ide.sessionSummary.empty')}
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 scrollbar-thin">
          {openSubs.map((sub) => {
            const acked = !!acknowledgedSubAgents[sub.id];
            const d = cardsBySub.get(sub.id);
            const withCards = hasCards(sub.id);
            const cached = sessionSummaries[sub.id];
            const state = busy[sub.id];
            const canClose = closeable(sub);
            return (
              <div key={sub.id} className="rounded-lg border border-gray-600/80 bg-gray-800 px-4 py-3.5 shadow-md">
                {/* 헤더: 상태점 + 라벨 + 시각 + 이동/닫기 */}
                <div className="mb-2.5 flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${statusDot(sub, acked)}`} />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-white">{labelOf(sub)}</span>
                  <span className="flex-shrink-0 text-[11px] font-medium text-gray-400">{formatStamp(sub.lastActivityAt)}</span>
                  <button
                    type="button"
                    onClick={() => jumpTo(sub.id)}
                    title={t('ide.sessionSummary.jump')}
                    aria-label={t('ide.sessionSummary.jump')}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-blue-400 transition-colors hover:bg-blue-500/20 hover:text-blue-300"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => retainAndClose(sub)}
                    disabled={!canClose}
                    title={canClose ? t('ide.sessionSummary.closeSession') : t('ide.sessionSummary.closeBlocked')}
                    aria-label={t('ide.sessionSummary.closeSession')}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-400 transition-colors enabled:hover:bg-red-600/80 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                {/* 본문: 카드 집계 또는 자기요약 */}
                {withCards && d ? (
                  <div className="border-t border-gray-600/60 pt-2.5">
                    <SummarySection label={t('ide.sessionSummary.secDid')} items={d.did} dotClass="bg-cyan-400" textClass="text-cyan-100" />
                    <SummarySection label={t('ide.sessionSummary.secChanges')} items={d.changes} dotClass="bg-violet-400" textClass="text-violet-100" />
                    <SummarySection label={t('ide.sessionSummary.secUserActions')} items={d.userActions} dotClass="bg-amber-400" textClass="text-amber-100" />
                    <SummarySection label={t('ide.sessionSummary.secCheckpoints')} items={d.checkpoints} dotClass="bg-violet-300" textClass="text-violet-100" />
                    <SummarySection label={t('ide.sessionSummary.secQuestions')} items={d.questions} dotClass="bg-blue-400" textClass="text-blue-100" />
                    <SummarySection label={t('ide.sessionSummary.secList')} items={d.listItems} dotClass="bg-slate-400" textClass="text-slate-100" />
                    <SummarySection label={t('ide.sessionSummary.secNext')} items={d.nextSteps} dotClass="bg-gray-400" textClass="text-gray-200" />
                  </div>
                ) : cached ? (
                  <div className="border-t border-gray-600/60 pt-2.5">
                    <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-100">{cached.text}</div>
                    <button
                      type="button"
                      onClick={() => fetchSummary(sub)}
                      disabled={state === 'loading'}
                      className="mt-2 flex items-center gap-1 text-[11px] text-gray-500 transition-colors hover:text-gray-300 disabled:opacity-50"
                    >
                      <svg className={`h-3 w-3 ${state === 'loading' ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
                      </svg>
                      {t('ide.sessionSummary.resummarize')}
                    </button>
                  </div>
                ) : (
                  <div className="border-t border-gray-600/60 pt-2.5">
                    {state === 'error' ? (
                      <p className="mb-2 text-[12px] text-amber-300">{t('ide.sessionSummary.summaryError')}</p>
                    ) : (
                      <p className="mb-2 text-[12px] text-gray-400">{t('ide.sessionSummary.noCards')}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => fetchSummary(sub)}
                      disabled={state === 'loading'}
                      className="flex items-center gap-1.5 rounded border border-gray-700 px-2 py-1 text-[11px] font-medium text-violet-300 transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 disabled:opacity-50"
                    >
                      <svg className={`h-3.5 w-3.5 ${state === 'loading' ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                        {state === 'loading'
                          ? (<><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>)
                          : (<><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></>)}
                      </svg>
                      {state === 'loading' ? t('ide.sessionSummary.summarizing') : t('ide.sessionSummary.getSummary')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* 닫힌 세션 요약(잔류) */}
          {closedEntries.map((e: SessionSummaryEntry) => (
            <div key={e.subId} className="rounded-lg border border-gray-700 bg-gray-900/70 px-4 py-3.5">
              <div className="mb-2.5 flex items-center gap-2">
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-gray-500" />
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-gray-200">{e.label}</span>
                <span className="flex-shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
                  {t('ide.sessionSummary.closedBadge')}
                </span>
                <span className="flex-shrink-0 text-[11px] font-medium text-gray-400">{formatStamp(e.at)}</span>
                <button
                  type="button"
                  onClick={() => useGraphStore.getState().removeSessionSummary(e.subId)}
                  title={t('ide.sessionSummary.dismiss')}
                  aria-label={t('ide.sessionSummary.dismiss')}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-300"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              {e.text && (
                <div className="whitespace-pre-wrap break-words border-t border-gray-700/70 pt-2.5 text-[13px] leading-relaxed text-gray-300">{e.text}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

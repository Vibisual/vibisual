import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent } from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import type { SessionSummaryEntry } from '../../stores/graphStore.js';
import { ThumbsUpIcon, ThumbsDownIcon } from './FeedbackButtons.js';
import { ScrollFade } from '../ScrollFade.js';
import { SESSION_STATUS_DOT, sessionRunStateOf, serializeBusySubIds, parseBusySubIds } from '../../utils/sessionStatus.js';

// §5.5 #17-8 v2.95 — 세션 요약 보드.
//
// 쌓인 세션을 하나씩 열어보지 않아도 한눈에 파악하도록, 세션별 요약 카드 1장씩을 모아 보여준다.
//  - 카드(작업/검수/질문/목록 신고)가 있는 세션 → 그 카드를 subAgentId 로 필터해 색구분 집계.
//  - 카드가 없는 세션 → 그 세션의 claude 대화를 헤드리스 `--resume` 해 한 줄 자기요약을 받아온다.
// 자동 닫기는 비활성화(status!=='active')되고 검수 끝난(ack=회색 점) 세션만 대상 — History 로 보존되어 복원 가능.
// 닫혀도 요약은 캐시(closed:true)로 보드에 남아 "요약해서 건네주고 세션은 닫기" 흐름을 완성한다.
//
// v4.93 — 자리를 옮겼다: 세션창 전체를 덮던 패널에서 **사이드바 뷰**(`VIEW_MAP['summary']`, 스킬·목표·
// 루프와 같은 자리)로. 요약은 대화를 가리고 읽는 것이 아니라 본문을 보면서 곁눈으로 훑는 것이기 때문.
// 집계·자기요약·자동 닫기 로직은 종전 그대로고, 좁은 폭(`w-52`)에 맞게 표시 규약만 다시 짰다:
// 카드 헤더 한 줄(점+라벨+시각, 액션은 hover) · 섹션 제목 9px + 항목 2줄 클램프 · 일괄 닫기는 아이콘 버튼.

const EMPTY_SUBS: SubAgent[] = [];

/** 좁은 칸용 짧은 시각 — 오늘이면 `HH:MM`, 그 전이면 `M/D`. 전체 시각은 툴팁이 말한다. */
function formatShort(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : `${d.getMonth() + 1}/${d.getDate()}`;
}

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
    <div className="mt-1.5 first:mt-0">
      <div className="flex items-center gap-1">
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotClass}`} />
        <span className="min-w-0 truncate text-[9px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
        <span className="flex-shrink-0 rounded bg-gray-700/60 px-1 text-[9px] font-semibold tabular-nums text-gray-300">{items.length}</span>
      </div>
      <ul className="mt-0.5 flex flex-col gap-0.5 pl-2.5">
        {items.map((it, i) => (
          <li key={i} className={`line-clamp-2 break-words text-[10.5px] leading-snug ${textClass}`}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

/** 상태 점 색 — IDETabBar 와 **같은 함수·같은 표**를 쓴다(사본 ❌). */
function statusDot(sub: SubAgent, acked: boolean, busy: boolean): string {
  return SESSION_STATUS_DOT[sessionRunStateOf(sub, acked, busy)];
}

interface CardData {
  did: string[];
  userActions: string[];
  nextSteps: string[];
  changes: string[];
  checkpoints: string[];
  questions: string[];
  listItems: string[];
  /** §4 v3.21 — 이 세션에서 사용자가 남긴 좋아요/싫어요 수. */
  feedUp: number;
  feedDown: number;
}

/**
 * 세션 요약 보드 — `IDESidebar` 의 `VIEW_MAP['summary']`. 활동바 세션 요약 항목을 누르면 여기로 바뀌고,
 * 같은 항목을 다시 누르면 사이드바가 접힌다(다른 항목과 같은 규약).
 */
export const IDESessionSummaryView = memo(function IDESessionSummaryView({
  agentId,
}: {
  agentId: string;
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
  const agentFeedbacks = useGraphStore((s) => s.agentFeedbacks[agentId]);
  const sessionSummaries = useGraphStore((s) => s.sessionSummaries);
  // 탭바와 같은 규약 — 백단 작업을 가진 세션은 도트가 켜진다.
  const busySubKey = useGraphStore((s) => serializeBusySubIds(s.runningSubagentTasks[agentId]));
  const busySubIds = useMemo(() => parseBusySubIds(busySubKey), [busySubKey]);
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
      if (!d) { d = { did: [], userActions: [], nextSteps: [], changes: [], checkpoints: [], questions: [], listItems: [], feedUp: 0, feedDown: 0 }; map.set(id, d); }
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
    // §4 v3.21 — 좋아요/싫어요 집계 (세션 귀속분만 — 메인 탭 피드백은 subAgentId 없음).
    for (const f of agentFeedbacks ?? []) {
      if (!f.subAgentId) continue;
      const d = ensure(f.subAgentId);
      if (f.verdict === 'up') d.feedUp++;
      else d.feedDown++;
    }
    return map;
  }, [agentReports, agentReviews, agentQuestions, agentLists, agentFeedbacks]);

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

  // 사이드바 뷰라 이동해도 목록이 닫히지 않는다 — 세션 탭만 바꾸고 보드는 그대로 곁에 남는다.
  const jumpTo = useCallback((subId: string) => {
    setSession(subId);
  }, [setSession]);

  // 닫힌 세션 요약(캐시) — 살아있는 세션에 없는 closed 항목.
  const closedEntries = useMemo(() => {
    const openIds = new Set(openSubs.map((s) => s.id));
    return Object.values(sessionSummaries)
      .filter((e) => e.agentId === agentId && e.closed && !openIds.has(e.subId))
      .sort((a, b) => b.at - a.at);
  }, [sessionSummaries, agentId, openSubs]);

  const totalCount = openSubs.length + closedEntries.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
      {/* 헤더 — 제목 + 개수 + 일괄 닫기(아이콘 + 대상 수). 폭이 좁아 라벨은 툴팁이 맡는다. */}
      <div className="flex items-center gap-1.5 px-1">
        <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          {t('ide.sessionSummary.title')}
        </span>
        {totalCount > 0 && (
          <span className="flex-shrink-0 rounded bg-gray-700/60 px-1 text-[9px] font-semibold tabular-nums text-gray-300">
            {totalCount}
          </span>
        )}
        <button
          type="button"
          onClick={handleCloseAllTidied}
          disabled={closeableOpen.length === 0}
          title={t('ide.sessionSummary.closeTidiedHint')}
          aria-label={t('ide.sessionSummary.closeTidied', { count: closeableOpen.length })}
          className="ml-auto flex flex-shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-gray-500 transition-colors enabled:hover:bg-violet-500/15 enabled:hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" /><path d="M14 11v6" />
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
          </svg>
          {closeableOpen.length > 0 && (
            <span className="text-[9px] font-bold tabular-nums">{closeableOpen.length}</span>
          )}
        </button>
      </div>

      {totalCount === 0 ? (
        <p className="px-2 py-4 text-center text-[11px] leading-relaxed text-gray-600">
          {t('ide.sessionSummary.empty')}
        </p>
      ) : (
        <ScrollFade fill className="flex-1">
          <div className="flex flex-col gap-1.5">
            {openSubs.map((sub) => {
              const acked = !!acknowledgedSubAgents[sub.id];
              const d = cardsBySub.get(sub.id);
              const withCards = hasCards(sub.id);
              const cached = sessionSummaries[sub.id];
              const state = busy[sub.id];
              const canClose = closeable(sub);
              return (
                <div key={sub.id} className="group rounded border border-gray-700/70 bg-gray-800/40 px-2 py-1.5 transition-colors hover:border-gray-600">
                  {/* 헤더: 상태점 + 라벨 + 시각 + (hover) 이동/닫기 */}
                  <div className="flex items-center gap-1">
                    <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${statusDot(sub, acked, busySubIds.has(sub.id))}`} />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-gray-200" title={labelOf(sub)}>
                      {labelOf(sub)}
                    </span>
                    {/* §4 v3.21 — 이 세션 좋아요/싫어요 집계 칩 */}
                    {d && (d.feedUp > 0 || d.feedDown > 0) && (
                      <span className="flex flex-shrink-0 items-center gap-1 text-[9px] font-medium" title={t('ide.feedback.statsTitle')}>
                        {d.feedUp > 0 && (
                          <span className="flex items-center gap-px text-emerald-400"><ThumbsUpIcon className="h-2.5 w-2.5" />{d.feedUp}</span>
                        )}
                        {d.feedDown > 0 && (
                          <span className="flex items-center gap-px text-rose-400"><ThumbsDownIcon className="h-2.5 w-2.5" />{d.feedDown}</span>
                        )}
                      </span>
                    )}
                    <span className="flex-shrink-0 text-[9px] tabular-nums text-gray-600" title={formatStamp(sub.lastActivityAt)}>
                      {formatShort(sub.lastActivityAt)}
                    </span>
                    <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => jumpTo(sub.id)}
                        title={t('ide.sessionSummary.jump')}
                        aria-label={t('ide.sessionSummary.jump')}
                        className="flex h-4 w-4 items-center justify-center rounded text-blue-400 transition-colors hover:bg-blue-500/20 hover:text-blue-300"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => retainAndClose(sub)}
                        disabled={!canClose}
                        title={canClose ? t('ide.sessionSummary.closeSession') : t('ide.sessionSummary.closeBlocked')}
                        aria-label={t('ide.sessionSummary.closeSession')}
                        className="flex h-4 w-4 items-center justify-center rounded text-gray-500 transition-colors enabled:hover:bg-red-600/80 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* 본문: 카드 집계 또는 자기요약 */}
                  {withCards && d ? (
                    <div className="mt-1.5 border-t border-gray-700/60 pt-1.5">
                      <SummarySection label={t('ide.sessionSummary.secDid')} items={d.did} dotClass="bg-cyan-400" textClass="text-cyan-100/90" />
                      <SummarySection label={t('ide.sessionSummary.secChanges')} items={d.changes} dotClass="bg-violet-400" textClass="text-violet-100/90" />
                      <SummarySection label={t('ide.sessionSummary.secUserActions')} items={d.userActions} dotClass="bg-amber-400" textClass="text-amber-100/90" />
                      <SummarySection label={t('ide.sessionSummary.secCheckpoints')} items={d.checkpoints} dotClass="bg-violet-300" textClass="text-violet-100/90" />
                      <SummarySection label={t('ide.sessionSummary.secQuestions')} items={d.questions} dotClass="bg-blue-400" textClass="text-blue-100/90" />
                      <SummarySection label={t('ide.sessionSummary.secList')} items={d.listItems} dotClass="bg-slate-400" textClass="text-slate-100/90" />
                      <SummarySection label={t('ide.sessionSummary.secNext')} items={d.nextSteps} dotClass="bg-gray-400" textClass="text-gray-300" />
                    </div>
                  ) : cached ? (
                    <div className="mt-1.5 border-t border-gray-700/60 pt-1.5">
                      <div className="whitespace-pre-wrap break-words text-[10.5px] leading-snug text-gray-300">{cached.text}</div>
                      <button
                        type="button"
                        onClick={() => fetchSummary(sub)}
                        disabled={state === 'loading'}
                        className="mt-1 flex items-center gap-1 text-[10px] text-gray-500 transition-colors hover:text-gray-300 disabled:opacity-50"
                      >
                        <svg className={`h-3 w-3 ${state === 'loading' ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
                        </svg>
                        {t('ide.sessionSummary.resummarize')}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1.5 border-t border-gray-700/60 pt-1.5">
                      {state === 'error' ? (
                        <p className="mb-1 text-[10.5px] leading-snug text-amber-300/90">{t('ide.sessionSummary.summaryError')}</p>
                      ) : (
                        <p className="mb-1 text-[10.5px] leading-snug text-gray-500">{t('ide.sessionSummary.noCards')}</p>
                      )}
                      <button
                        type="button"
                        onClick={() => fetchSummary(sub)}
                        disabled={state === 'loading'}
                        className="flex items-center gap-1 rounded border border-gray-700 px-1.5 py-0.5 text-[10px] font-medium text-violet-300 transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 disabled:opacity-50"
                      >
                        <svg className={`h-3 w-3 ${state === 'loading' ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
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
              <div key={e.subId} className="group rounded border border-gray-700/50 bg-gray-900/50 px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-500" />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-gray-400" title={e.label}>{e.label}</span>
                  <span className="flex-shrink-0 rounded bg-gray-700/70 px-1 text-[8.5px] font-semibold uppercase tracking-wide text-gray-400">
                    {t('ide.sessionSummary.closedBadge')}
                  </span>
                  <span className="flex-shrink-0 text-[9px] tabular-nums text-gray-600" title={formatStamp(e.at)}>
                    {formatShort(e.at)}
                  </span>
                  <button
                    type="button"
                    onClick={() => useGraphStore.getState().removeSessionSummary(e.subId)}
                    title={t('ide.sessionSummary.dismiss')}
                    aria-label={t('ide.sessionSummary.dismiss')}
                    className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-gray-500 opacity-0 transition-opacity hover:bg-gray-700 hover:text-gray-300 group-hover:opacity-100"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                {e.text && (
                  <div className="mt-1.5 whitespace-pre-wrap break-words border-t border-gray-700/50 pt-1.5 text-[10.5px] leading-snug text-gray-400">{e.text}</div>
                )}
              </div>
            ))}
          </div>
        </ScrollFade>
      )}
    </div>
  );
});

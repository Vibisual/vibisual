/**
 * §5.10 v3.49 — Project Brain 기억 피드 오버레이(유튜브 홈 방식).
 *
 * 우더블클릭(Brain 버블·커스텀 에이전트 버블) 또는 __brain__ 좌더블클릭으로 열린다(store.brainFeed).
 * memory 카드 버블 폐기의 대체 — 기억은 "읽는 것"이므로 버블 산개 대신 랭킹된 소수를 섹션별로 보여준다.
 *
 * - 서버 SSOT: GET /api/brain/feed(섹션 랭킹) / GET /api/brain/search(검색). 클라는 TTL/상태 로직 없음.
 * - 검색어가 있으면 섹션 대신 단일 검색 결과 리스트(300ms 디바운스).
 * - 행 클릭 → selectBrainCard → 우측 pane 에 BrainCardDetail(스토어 selectedBrainCard 재사용).
 * - 👍 도움됨: 낙관적 helpfulCount++ 후 POST /api/brain/cards/:id/helpful.
 * - 미확인 카드는 렌더 시 자동 seen 신고(디바운스, 중복 방지).
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { BrainCard, BrainCardType, BrainFeed, BrainFeedSectionKey } from '@vibisual/shared';
import { BUBBLE_STYLES } from '@vibisual/shared';
import { useGraphStore, selectEffectiveProject } from '../../stores/graphStore.js';
import { setCanvasCover } from '../../stores/canvasVisibility.js';
import { BRAIN_TYPE_COLORS } from '../../hooks/useBubbleLayout.js';
import { BrainCardDetail } from './BrainCardDetail.js';
import { ScrollFade } from '../ScrollFade.js';

const API_BASE = '';

/** 5종 카드 타입 순서(필터 칩). */
const CARD_TYPES: BrainCardType[] = ['decision', 'mistake', 'lesson', 'rule', 'fact'];

/** 타입별 stroke SVG glyph(라벨 옆 작은 아이콘). lucide 톤. */
const TYPE_ICON_D: Record<BrainCardType, string> = {
  decision: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  mistake: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  lesson: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z',
  rule: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  fact: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01',
};

/** 섹션 키 → i18n(제목) + fallback. 스펙 순서 유지. */
const SECTION_ORDER: { key: BrainFeedSectionKey; labelKey: string; fallback: string }[] = [
  { key: 'related', labelKey: 'brain.feed.sectionRelated', fallback: '지금 작업과 관련' },
  { key: 'recent', labelKey: 'brain.feed.sectionRecent', fallback: '최근 배운 것' },
  { key: 'frequent', labelKey: 'brain.feed.sectionFrequent', fallback: '자주 쓰는 기억' },
  { key: 'resurface', labelKey: 'brain.feed.sectionResurface', fallback: '오랜만에 다시 볼 기억' },
];

/** 상대 시각(신선도). 서버 시간 값을 그대로 표시(계산은 표시용 포맷뿐 — 상태 판정 아님). */
function formatAgo(ts: number | undefined, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return t('brain.feed.agoNow', { defaultValue: '방금' });
  const min = Math.round(sec / 60);
  if (min < 60) return t('brain.feed.agoMin', { defaultValue: '{{n}}분 전', n: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t('brain.feed.agoHour', { defaultValue: '{{n}}시간 전', n: hr });
  const day = Math.round(hr / 24);
  if (day < 30) return t('brain.feed.agoDay', { defaultValue: '{{n}}일 전', n: day });
  const mon = Math.round(day / 30);
  return t('brain.feed.agoMonth', { defaultValue: '{{n}}개월 전', n: mon });
}

/** 본문 첫 줄 요약. */
function firstLine(body: string): string {
  const line = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line;
}

interface FeedRowProps {
  card: BrainCard;
  feedScope: 'project' | 'agent';
  helpfulOverride: number | undefined;
  selected: boolean;
  onOpen: (card: BrainCard) => void;
  onHelpful: (card: BrainCard) => void;
}

function FeedRow({ card, feedScope, helpfulOverride, selected, onOpen, onHelpful }: FeedRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const accent = BRAIN_TYPE_COLORS[card.type];
  const unseen = card.seen === false;
  const helpful = helpfulOverride ?? card.helpfulCount ?? 0;
  const fresh = formatAgo(Math.max(card.updatedAt ?? 0, card.lastHelpfulAt ?? 0, card.lastReferencedAt ?? 0) || card.createdAt, t);
  const scopeDiffers = card.scope !== feedScope;
  const summary = firstLine(card.body);

  return (
    <div
      className={`group relative flex items-start gap-2.5 rounded-md border py-2 pl-3 pr-2 transition-colors ${
        selected ? 'border-pink-500/60 bg-pink-500/10' : 'border-gray-800 bg-gray-800/30 hover:bg-gray-800/60'
      }`}
    >
      {/* 타입 액센트 바(좌측 3px) */}
      <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full" style={{ backgroundColor: accent }} />
      {/* 미확인 강조 점 */}
      {unseen && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />}

      {/* 타입 아이콘 */}
      <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={TYPE_ICON_D[card.type]} />
      </svg>

      {/* 본문(클릭 → 상세) */}
      <button type="button" onClick={() => onOpen(card)} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-gray-100" title={card.title}>{card.title}</span>
          {card.pinned && (
            <svg className="h-3 w-3 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
            </svg>
          )}
          {scopeDiffers && (
            card.scope === 'project' ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[#EC4899]/15 px-1.5 py-px text-[10px] font-medium text-pink-300 ring-1 ring-inset ring-[#EC4899]/30">
                <span className="h-1 w-1 rounded-full bg-[#EC4899]" />
                {t('brain.feed.scopeTagProject', { defaultValue: '프로젝트' })}
              </span>
            ) : (
              <span className="shrink-0 rounded bg-gray-700 px-1.5 py-px text-[10px] text-gray-300">
                {t('brain.feed.scopeTagAgent', { defaultValue: '이 에이전트' })}
              </span>
            )
          )}
        </div>
        {summary && <div className="mt-0.5 truncate text-xs text-gray-500" title={summary}>{summary}</div>}
        <div className="mt-1 flex items-center gap-2.5 text-[11px] text-gray-500">
          <span title={t('brain.feed.refShort', { defaultValue: '참조' })}>{t('brain.feed.refShort', { defaultValue: '참조' })} {card.refCount}</span>
          <span title={t('brain.feed.helpfulShort', { defaultValue: '도움' })}>{t('brain.feed.helpfulShort', { defaultValue: '도움' })} {helpful}</span>
          {fresh && <span>{fresh}</span>}
        </div>
      </button>

      {/* 👍 도움됨 */}
      <button
        type="button"
        onClick={() => onHelpful(card)}
        className="mt-0.5 flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs text-gray-400 hover:bg-pink-500/15 hover:text-pink-300"
        title={t('brain.feed.helpful', { defaultValue: '도움됨' })}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z" />
        </svg>
      </button>
    </div>
  );
}

export function BrainFeedOverlay(): React.JSX.Element | null {
  const { t } = useTranslation();
  const brainFeed = useGraphStore((s) => s.brainFeed);
  const closeBrainFeed = useGraphStore((s) => s.closeBrainFeed);
  const selectBrainCard = useGraphStore((s) => s.selectBrainCard);
  const markBrainCardSeen = useGraphStore((s) => s.markBrainCardSeen);
  const selectedBrainCard = useGraphStore((s) => s.selectedBrainCard);
  const selectedBrainCardId = useGraphStore((s) => s.selectedBrainCardId);
  const project = useGraphStore(selectEffectiveProject);
  const nodeMap = useGraphStore((s) => s.nodeMap);
  const agentConfigs = useGraphStore((s) => s.agentConfigs);

  const [feed, setFeed] = useState<BrainFeed | null>(null);
  const [searchResults, setSearchResults] = useState<BrainCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<BrainCardType>>(new Set());
  const [helpfulOverrides, setHelpfulOverrides] = useState<Record<string, number>>({});
  const [refetchNonce, setRefetchNonce] = useState(0);

  const overlayRef = useRef<HTMLDivElement>(null);
  const seenPostedRef = useRef<Set<string>>(new Set());
  const seenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = brainFeed !== null;
  const scope = brainFeed?.scope ?? 'project';
  const agentId = brainFeed?.agentId;

  // 오버레이 열릴 때마다 상태 초기화.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDebouncedQuery('');
    setTypeFilter(new Set());
    setHelpfulOverrides({});
    seenPostedRef.current = new Set();
  }, [open, scope, agentId]);

  // ESC 닫기.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeBrainFeed(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, closeBrainFeed]);

  // 검색어 300ms 디바운스.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  // 상세 카드가 닫히면(승격/삭제 등) 피드 재조회.
  const prevSelIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSelIdRef.current !== null && selectedBrainCardId === null) setRefetchNonce((n) => n + 1);
    prevSelIdRef.current = selectedBrainCardId;
  }, [selectedBrainCardId]);

  // 피드/검색 fetch.
  useEffect(() => {
    if (!open || !project) { setFeed(null); setSearchResults(null); return; }
    const q = debouncedQuery.trim();
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        if (q) {
          const p = new URLSearchParams({ q, scope, project });
          if (scope === 'agent' && agentId) p.set('agentId', agentId);
          const res = await fetch(`${API_BASE}/api/brain/search?${p.toString()}`);
          if (!res.ok) { if (!cancelled) { setSearchResults([]); setLoading(false); } return; }
          const data = await res.json() as { results?: BrainCard[] };
          if (!cancelled) { setSearchResults(data.results ?? []); setFeed(null); setLoading(false); }
        } else {
          const p = new URLSearchParams({ scope, project });
          if (scope === 'agent' && agentId) p.set('agentId', agentId);
          const res = await fetch(`${API_BASE}/api/brain/feed?${p.toString()}`);
          if (!res.ok) { if (!cancelled) { setFeed(null); setLoading(false); } return; }
          const data = await res.json() as { feed?: BrainFeed };
          if (!cancelled) { setFeed(data.feed ?? null); setSearchResults(null); setLoading(false); }
        }
      } catch { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open, project, scope, agentId, debouncedQuery, refetchNonce]);

  // 타입 필터 적용.
  const filterByType = useCallback((cards: BrainCard[]): BrainCard[] => {
    if (typeFilter.size === 0) return cards;
    return cards.filter((c) => typeFilter.has(c.type));
  }, [typeFilter]);

  // 화면에 보이는 카드들의 미확인분 자동 seen 신고(디바운스 + 중복 방지).
  const visibleCards = useMemo<BrainCard[]>(() => {
    if (searchResults) return filterByType(searchResults);
    if (!feed) return [];
    const out: BrainCard[] = [];
    for (const { key } of SECTION_ORDER) out.push(...filterByType(feed.sections[key] ?? []));
    return out;
  }, [searchResults, feed, filterByType]);

  // §4 v3.71 가시성 LOD — 열려 있는 동안 캔버스를 전면으로 덮으므로 덮개로 등록한다.
  useEffect(() => {
    setCanvasCover('brain-feed', open);
    return () => setCanvasCover('brain-feed', false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const unseen = visibleCards.filter((c) => c.seen === false && !seenPostedRef.current.has(c.id));
    if (unseen.length === 0) return;
    if (seenTimerRef.current) clearTimeout(seenTimerRef.current);
    seenTimerRef.current = setTimeout(() => {
      for (const c of unseen) {
        seenPostedRef.current.add(c.id);
        markBrainCardSeen(c.id);
      }
    }, 500);
    return () => { if (seenTimerRef.current) clearTimeout(seenTimerRef.current); };
  }, [open, visibleCards, markBrainCardSeen]);

  const handleOpenCard = useCallback((card: BrainCard) => {
    selectBrainCard(card.id, scope === 'agent' && agentId ? { agentId } : undefined);
  }, [selectBrainCard, scope, agentId]);

  const handleHelpful = useCallback((card: BrainCard) => {
    setHelpfulOverrides((prev) => ({ ...prev, [card.id]: (prev[card.id] ?? card.helpfulCount ?? 0) + 1 }));
    void fetch(`${API_BASE}/api/brain/cards/${card.id}/helpful`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project }),
    }).catch(() => {});
  }, [project]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) closeBrainFeed();
  }, [closeBrainFeed]);

  const toggleType = useCallback((tp: BrainCardType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tp)) next.delete(tp); else next.add(tp);
      return next;
    });
  }, []);

  if (!open) return null;

  const totalCount = feed?.totalCount ?? searchResults?.length ?? 0;
  const isSearch = debouncedQuery.trim().length > 0;
  const title = scope === 'agent'
    ? t('brain.feed.agentTitle', { defaultValue: '이 에이전트의 기억' })
    : t('brain.feed.title', { defaultValue: '프로젝트 두뇌' });

  // 에이전트 스코프 — "누구의 기억"인지 헤더에 표기(캔버스와 동일 소스: BubbleData.label / AgentConfig.color 폴백 BUBBLE_STYLES.agent.color).
  const agentLabel = scope === 'agent' && agentId ? nodeMap[agentId]?.label : undefined;
  const agentColor = scope === 'agent' && agentId ? (agentConfigs[agentId]?.color ?? BUBBLE_STYLES.agent.color) : undefined;

  // 섹션 1개 렌더(제목 + 행들). 스코프 재구성 양쪽에서 공용.
  const renderSection = (sectionKey: string, heading: string, cards: BrainCard[]): React.JSX.Element | null => {
    if (cards.length === 0) return null;
    return (
      <section key={sectionKey} className="space-y-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{heading}</h4>
        {cards.map((c) => (
          <FeedRow
            key={c.id}
            card={c}
            feedScope={scope}
            helpfulOverride={helpfulOverrides[c.id]}
            selected={selectedBrainCardId === c.id}
            onOpen={handleOpenCard}
            onHelpful={handleHelpful}
          />
        ))}
      </section>
    );
  };

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={handleOverlayClick}
    >
      <div className="flex h-[660px] max-h-[92dvh] w-[980px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl max-md:h-dvh max-md:max-h-dvh max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-0">
        {/* Header */}
        <div
          className="border-b border-gray-700 px-4 py-3"
          style={scope === 'agent' && agentColor ? { borderLeft: `3px solid ${agentColor}` } : undefined}
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-gray-100">
              <svg className="h-4 w-4 shrink-0 text-pink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5a3 3 0 0 0-5.6-1.5A2.5 2.5 0 0 0 4 6a2.5 2.5 0 0 0 0 5 2.5 2.5 0 0 0 2 4 3 3 0 0 0 6 .5 3 3 0 0 0 6-.5 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 0-2.4-2.5A3 3 0 0 0 12 5Z" />
              </svg>
              <span className="shrink-0">{title}</span>
              {scope === 'agent' && agentLabel && (
                <span
                  className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{ backgroundColor: `${agentColor}22`, color: agentColor }}
                  title={agentLabel}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: agentColor }} />
                  <span className="truncate">{agentLabel}</span>
                </span>
              )}
              <span className="shrink-0 text-xs font-normal text-gray-500">
                {t('brain.feed.total', { defaultValue: '{{n}}장', n: totalCount })}
              </span>
            </h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <svg className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('brain.feed.searchPlaceholder', { defaultValue: '기억 검색…' })}
                  className="w-56 rounded border border-gray-700 bg-gray-800 py-1 pl-7 pr-2 text-xs text-gray-100 outline-none focus:border-pink-500 max-md:w-40"
                />
              </div>
              <button type="button" onClick={closeBrainFeed} className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </div>
          {/* 타입 필터 칩 */}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {CARD_TYPES.map((tp) => {
              const active = typeFilter.has(tp);
              const color = BRAIN_TYPE_COLORS[tp];
              return (
                <button
                  key={tp}
                  type="button"
                  onClick={() => toggleType(tp)}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    active ? 'border-transparent text-gray-900' : 'border-gray-700 text-gray-400 hover:text-gray-200'
                  }`}
                  style={active ? { backgroundColor: color } : undefined}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: active ? '#1f2937' : color }} />
                  {t(`brain.type.${tp}`, { defaultValue: tp })}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body — 좌 피드 + 우 상세 pane */}
        <div className="flex flex-1 overflow-hidden">
          <ScrollFade fill className="flex-1">
            <div className="space-y-4 p-4">
              {loading && visibleCards.length === 0 && (
                <div className="py-10 text-center text-sm text-gray-500">{t('brain.feed.loading', { defaultValue: '불러오는 중…' })}</div>
              )}
              {!loading && visibleCards.length === 0 && (
                <div className="py-10 text-center text-sm text-gray-500">{t('brain.feed.empty', { defaultValue: '표시할 기억이 없습니다.' })}</div>
              )}

              {isSearch && searchResults && searchResults.length > 0 && (
                <div className="space-y-1.5">
                  {filterByType(searchResults).map((c) => (
                    <FeedRow
                      key={c.id}
                      card={c}
                      feedScope={scope}
                      helpfulOverride={helpfulOverrides[c.id]}
                      selected={selectedBrainCardId === c.id}
                      onOpen={handleOpenCard}
                      onHelpful={handleHelpful}
                    />
                  ))}
                </div>
              )}

              {/* Brain(프로젝트) 스코프 — 서버 섹션 순서 그대로. */}
              {!isSearch && feed && scope === 'project' && SECTION_ORDER.map(({ key, labelKey, fallback }) =>
                renderSection(key, t(labelKey, { defaultValue: fallback }), filterByType(feed.sections[key] ?? [])),
              )}

              {/* 에이전트 스코프 — related 를 카드 scope 로 갈라 두 층이 섞이지 않게 재구성.
                  agent-own(=이 에이전트가 배운 것)은 위, 프로젝트 공용(참고)은 맨 아래. */}
              {!isSearch && feed && scope === 'agent' && (() => {
                const related = feed.sections['related'] ?? [];
                const relatedOwn = filterByType(related.filter((c) => c.scope !== 'project'));
                const relatedProject = filterByType(related.filter((c) => c.scope === 'project'));
                return (
                  <>
                    {renderSection('agentOwn', t('brain.feed.sectionAgentOwn', { defaultValue: '이 에이전트가 배운 것' }), relatedOwn)}
                    {renderSection('recent', t('brain.feed.sectionRecent', { defaultValue: '최근 배운 것' }), filterByType(feed.sections['recent'] ?? []))}
                    {renderSection('frequent', t('brain.feed.sectionFrequent', { defaultValue: '자주 쓰는 기억' }), filterByType(feed.sections['frequent'] ?? []))}
                    {renderSection('resurface', t('brain.feed.sectionResurface', { defaultValue: '오랜만에 다시 볼 기억' }), filterByType(feed.sections['resurface'] ?? []))}
                    {renderSection('projectRef', t('brain.feed.sectionProjectRef', { defaultValue: '프로젝트 공용(참고)' }), relatedProject)}
                  </>
                );
              })()}
            </div>
          </ScrollFade>

          {/* 우측 상세 pane — 카드 선택 시 */}
          {selectedBrainCard && (
            <aside className="flex w-[380px] shrink-0 flex-col border-l border-gray-700 bg-gray-900 max-md:hidden">
              <ScrollFade fill className="flex-1">
                <BrainCardDetail card={selectedBrainCard} />
              </ScrollFade>
            </aside>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

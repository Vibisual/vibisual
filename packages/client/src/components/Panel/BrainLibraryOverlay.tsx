/**
 * §5.10 v3.75 — 기억 라이브러리(주제 목록 + 문서 뷰).
 * §5.10 v3.77 — 전면 모달 → **앱 내부 IDE식 창**.
 *
 * v3.49~v3.52 의 4섹션 랭킹 피드(`BrainFeedOverlay`)를 대체한다. 주입이 색인 방식으로 바뀐 이상
 * (v3.74) 사람이 보는 화면도 **같은 지도**를 써야 AI 와 사람이 같은 것을 읽는다. 랭킹 섹션은
 * "지금 뭐가 뜰지" 예측할 수 없어 찾아보기에 부적합했고, 주제 목록은 자리가 고정돼 학습된다.
 *
 * - 좌측: 주제 목록(서버 `/api/brain/topics` = 스폰 브리핑 색인과 동일 데이터).
 * - 우측: 선택한 주제의 카드들이 이어진 문서 뷰(`/api/brain/topics/:slug?format=json`).
 * - 검색어가 있으면 주제를 가로질러 단일 결과 목록(`/api/brain/search`, 300ms 디바운스).
 * - 디자인: zinc 뉴트럴 베이스 + 단일 액센트 indigo. 타입 색은 뮤트 팔레트로 액센트 바·글리프에만.
 * - 서버가 SSOT — 클라는 TTL·상태 전환·랭킹 계산을 하지 않는다(표시와 조회만).
 *
 * v3.77 창 거동(§5.9 v3.34 캡처 창과 같은 문법 — 좌표는 공용 훅 `useFloatingWindow` 한 곳):
 * 가운데 팝업으로 뜨고 타이틀바 드래그로 이동, 우하단 핸들로 리사이즈, 최대화↔복원, 최소화는
 * 타이틀바만 남기는 셰이드. 백드롭 ❌(뒤 캔버스가 계속 보이고 조작된다 — 닫기는 X·Esc).
 * 반응형 기준은 뷰포트가 아니라 **창 자기 폭**(창이 리사이즈되므로 미디어쿼리로는 못 잡는다):
 * 좁아지면 좌측 주제 레일이 상단 가로 칩 행으로 접힌다(종전처럼 통째로 숨겨 주제 전환을 막지 ❌).
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { BrainCard, BrainCardType, BrainTopicIndexEntry } from '@vibisual/shared';
import { BUBBLE_STYLES } from '@vibisual/shared';
import { useGraphStore, selectEffectiveProject } from '../../stores/graphStore.js';
import { setCanvasCover } from '../../stores/canvasVisibility.js';
import { BRAIN_TYPE_COLORS } from '../../hooks/useBubbleLayout.js';
import { useFloatingWindow, type FloatingWindowSnapshot } from '../../hooks/useFloatingWindow.js';
import { useIsNarrowViewport } from '../../hooks/useIsMobile.js';
import { ScrollFade } from '../ScrollFade.js';
import { BRAIN_ACCENT, CARD_TYPES, DocEntry, TYPE_LABEL_KEY } from './BrainLibraryDocEntry.js';

const API_BASE = '';

/** Brain 액센트(v3.75 indigo). 버블 색과 한 곳에서 나온다. */
const ACCENT = BUBBLE_STYLES.brain.color;

/** 창 치수·전환점 — 매직넘버 산개 ❌(coding.md). */
const LIB_WINDOW = {
  /** floating 기본 크기 = 뷰포트 × 비율. */
  SIZE_RATIO: { w: 0.68, h: 0.76 },
  MIN_SIZE: { w: 380, h: 260 },
  /** 넓은 모니터에서의 상한 — v3.75 모달의 max-w/max-h 를 그대로 계승(첫 인상 유지). */
  MAX_DEFAULT_SIZE: { w: 1180, h: 860 },
  /** 타이틀바 높이(= 헤더의 `h-11`) — 최소화(셰이드) 시 남는 높이와 같아야 한다. */
  TITLE_BAR_H: 44,
  /** 창 폭이 이 값 미만이면 좌측 주제 레일을 상단 가로 칩 행으로 접는다. */
  COMPACT_W: 720,
} as const;

/** 창 위치·크기·모드를 앱이 켜져 있는 동안 기억 — 다시 열면 그 자리(디스크 영속 ❌). */
let lastWindowSnapshot: FloatingWindowSnapshot | null = null;

/**
 * §5.10 v3.78 — 주제 레일 맨 위에 상주하는 **특수 항목 2종**(주제가 아니라 상태로 모은 묶음).
 * 주제 slug 와 충돌하지 않도록 `__` 접두사를 쓴다(`BRAIN_TOPICS` 는 전부 kebab-case).
 */
const SPECIAL_NEEDS_CHECK = '__needs-check';
const SPECIAL_ARCHIVE = '__archive';
/** §5.10 v3.81 — 사람의 판단을 기다리는 카드(후보·충돌). SSOT 로 올라가려면 여기를 거친다. */
const SPECIAL_REVIEW = '__review';
type SpecialSlug = typeof SPECIAL_NEEDS_CHECK | typeof SPECIAL_ARCHIVE | typeof SPECIAL_REVIEW;

function isSpecial(slug: string | null): slug is SpecialSlug {
  return slug === SPECIAL_NEEDS_CHECK || slug === SPECIAL_ARCHIVE || slug === SPECIAL_REVIEW;
}

export function BrainLibraryOverlay(): React.JSX.Element | null {
  const { t } = useTranslation();
  const view = useGraphStore((s) => s.brainFeed);
  const closeLibrary = useGraphStore((s) => s.closeBrainFeed);
  const markBrainCardSeen = useGraphStore((s) => s.markBrainCardSeen);
  const verifyBrainCard = useGraphStore((s) => s.verifyBrainCard);
  const markBrainCardStale = useGraphStore((s) => s.markBrainCardStale);
  const restoreBrainCard = useGraphStore((s) => s.restoreBrainCard);
  const confirmBrainCard = useGraphStore((s) => s.confirmBrainCard);
  const rejectBrainCard = useGraphStore((s) => s.rejectBrainCard);
  const project = useGraphStore(selectEffectiveProject);
  const agents = useGraphStore((s) => s.agents);
  const agentConfigs = useGraphStore((s) => s.agentConfigs);

  const open = view !== null;
  const scope = view?.scope ?? 'project';
  const agentId = view?.agentId;

  const [topics, setTopics] = useState<BrainTopicIndexEntry[] | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [cards, setCards] = useState<BrainCard[] | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BrainCard[] | null>(null);
  const [typeFilter, setTypeFilter] = useState<Set<BrainCardType>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [helpfulOverrides, setHelpfulOverrides] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [refetchNonce, setRefetchNonce] = useState(0);
  /** §5.10 v3.78 — 특수 항목 2종의 카드(주제와 별개로 상태로 모은 묶음). */
  const [needsCheck, setNeedsCheck] = useState<BrainCard[]>([]);
  const [archived, setArchived] = useState<BrainCard[]>([]);
  /** §5.10 v3.81 — 검토 큐(후보·충돌·확인 필요 중 키가 있는 카드). */
  const [reviewQueue, setReviewQueue] = useState<BrainCard[]>([]);
  /** 창 자기 폭 기준 좁은 레이아웃(뷰포트 미디어쿼리 ❌ — 창이 리사이즈된다). */
  const [compact, setCompact] = useState(false);

  const seenPostedRef = useRef<Set<string>>(new Set());
  const seenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 좁은 뷰포트(모바일 웹 접속)에서는 창을 띄우지 않고 전체 화면 — 이동·리사이즈를 잠근다.
  const narrowViewport = useIsNarrowViewport();

  const fw = useFloatingWindow({
    sizeRatio: LIB_WINDOW.SIZE_RATIO,
    minSize: LIB_WINDOW.MIN_SIZE,
    maxDefaultSize: LIB_WINDOW.MAX_DEFAULT_SIZE,
    shadeH: LIB_WINDOW.TITLE_BAR_H,
    lockFullScreen: narrowViewport,
    initial: lastWindowSnapshot,
    onChange: useCallback((snapshot: FloatingWindowSnapshot) => { lastWindowSnapshot = snapshot; }, []),
  });
  const { setMode } = fw;

  /** 에이전트 스코프 헤더 — 그 버블의 색·라벨로 "누구의 기억"인지 표기(v3.52 취지 유지). */
  const agentMeta = useMemo(() => {
    if (scope !== 'agent' || !agentId) return null;
    const a = agents.find((x) => x.id === agentId);
    return { label: a?.label ?? agentId, color: agentConfigs[agentId]?.color ?? BUBBLE_STYLES.agent.color };
  }, [scope, agentId, agents, agentConfigs]);

  // ESC 로 닫기.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeLibrary(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeLibrary]);

  // §4 v3.71 가시성 LOD — **캔버스를 실제로 덮을 때만** 덮개로 등록한다.
  // floating 창은 캔버스가 옆으로 보이고 조작도 되므로 등록 ❌(IDE 오버레이의 floating 과 같은 규칙).
  useEffect(() => {
    const covering = open && fw.fullScreen;
    setCanvasCover('brain-library', covering);
    return () => setCanvasCover('brain-library', false);
  }, [open, fw.fullScreen]);

  // 열릴 때 상태 초기화. 최소화(셰이드)로 닫아 뒀으면 다시 펼친다 — 열었는데 타이틀바만 뜨면 혼란.
  useEffect(() => {
    if (!open) return;
    setActiveSlug(null);
    setQuery('');
    setDebouncedQuery('');
    setExpandedId(null);
    seenPostedRef.current = new Set();
    setMode((m) => (m === 'minimized' ? 'floating' : m));
  }, [open, scope, agentId, setMode]);

  // 창 자기 폭 관측 — 레이아웃 전환점(주제 레일 ↔ 가로 칩 행).
  useEffect(() => {
    if (!open) return undefined;
    const el = fw.windowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const apply = (): void => setCompact(el.getBoundingClientRect().width < LIB_WINDOW.COMPACT_W);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, fw.windowRef]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  // 주제 목록 조회.
  useEffect(() => {
    if (!open || !project) { setTopics(null); return undefined; }
    let cancelled = false;
    void (async () => {
      try {
        const p = new URLSearchParams({ project });
        if (scope === 'agent' && agentId) p.set('agentId', agentId);
        const res = await fetch(`${API_BASE}/api/brain/topics?${p.toString()}`);
        if (!res.ok) { if (!cancelled) setTopics([]); return; }
        const data = await res.json() as { topics?: BrainTopicIndexEntry[] };
        if (cancelled) return;
        const list = data.topics ?? [];
        setTopics(list);
        setActiveSlug((prev) => prev ?? list[0]?.slug ?? null);
      } catch { if (!cancelled) setTopics([]); }
    })();
    return () => { cancelled = true; };
  }, [open, project, scope, agentId, refetchNonce]);

  // §5.10 v3.78 — 특수 항목(확인 필요 · 정리됨) 조회. 주제 목록과 같은 주기로 새로 받는다.
  useEffect(() => {
    if (!open || !project) { setNeedsCheck([]); setArchived([]); setReviewQueue([]); return undefined; }
    let cancelled = false;
    void (async () => {
      const p = new URLSearchParams({ project });
      if (scope === 'agent' && agentId) p.set('agentId', agentId);
      else p.set('scope', 'project');
      const grab = async (route: string): Promise<BrainCard[]> => {
        try {
          const res = await fetch(`${API_BASE}/api/brain/${route}?${p.toString()}`);
          if (!res.ok) return [];
          return ((await res.json()) as { cards?: BrainCard[] }).cards ?? [];
        } catch { return []; }
      };
      const [nc, ar, rv] = await Promise.all([grab('needs-check'), grab('archive'), grab('review-queue')]);
      if (cancelled) return;
      setNeedsCheck(nc);
      setArchived(ar);
      setReviewQueue(rv);
    })();
    return () => { cancelled = true; };
  }, [open, project, scope, agentId, refetchNonce]);

  // 선택한 주제의 카드 조회(검색 중·특수 항목 선택 중에는 건너뛴다 — 위에서 이미 받아 뒀다).
  useEffect(() => {
    if (!open || !project || !activeSlug || isSpecial(activeSlug) || debouncedQuery.trim()) { return undefined; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const p = new URLSearchParams({ project, format: 'json' });
        if (scope === 'agent' && agentId) p.set('agentId', agentId);
        const res = await fetch(`${API_BASE}/api/brain/topics/${encodeURIComponent(activeSlug)}?${p.toString()}`);
        if (!res.ok) { if (!cancelled) { setCards([]); setLoading(false); } return; }
        const data = await res.json() as { cards?: BrainCard[] };
        if (!cancelled) { setCards(data.cards ?? []); setLoading(false); }
      } catch { if (!cancelled) { setCards([]); setLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [open, project, activeSlug, scope, agentId, debouncedQuery, refetchNonce]);

  // 검색(주제를 가로지른다).
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!open || !project || !q) { setSearchResults(null); return undefined; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        // §5.10 v3.81 — 사람이 자기 기록을 보는 화면이므로 저장고 전체를 검색한다(`all=1`).
        //   에이전트의 능동 검색은 이 플래그가 없어 기본이 "현재 진실만"이다.
        const p = new URLSearchParams({ q, scope, project, all: '1' });
        if (scope === 'agent' && agentId) p.set('agentId', agentId);
        const res = await fetch(`${API_BASE}/api/brain/search?${p.toString()}`);
        if (!res.ok) { if (!cancelled) { setSearchResults([]); setLoading(false); } return; }
        const data = await res.json() as { results?: BrainCard[] };
        if (!cancelled) { setSearchResults(data.results ?? []); setLoading(false); }
      } catch { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open, project, scope, agentId, debouncedQuery]);

  const shown = useMemo<BrainCard[]>(() => {
    let base: BrainCard[];
    if (debouncedQuery.trim()) base = searchResults ?? [];
    else if (activeSlug === SPECIAL_NEEDS_CHECK) base = needsCheck;
    else if (activeSlug === SPECIAL_ARCHIVE) base = archived;
    else if (activeSlug === SPECIAL_REVIEW) base = reviewQueue;
    else base = cards ?? [];
    return typeFilter.size === 0 ? base : base.filter((c) => typeFilter.has(c.type));
  }, [debouncedQuery, searchResults, cards, typeFilter, activeSlug, needsCheck, archived, reviewQueue]);

  // 화면에 보이는 미확인 카드 자동 seen 신고(디바운스 + 중복 방지). 셰이드 중엔 보이지 않으므로 ❌.
  useEffect(() => {
    if (!open || fw.minimized) return undefined;
    const unseen = shown.filter((c) => c.seen === false && !seenPostedRef.current.has(c.id));
    if (unseen.length === 0) return undefined;
    if (seenTimerRef.current) clearTimeout(seenTimerRef.current);
    seenTimerRef.current = setTimeout(() => {
      for (const c of unseen) { seenPostedRef.current.add(c.id); markBrainCardSeen(c.id); }
    }, 600);
    return () => { if (seenTimerRef.current) clearTimeout(seenTimerRef.current); };
  }, [open, fw.minimized, shown, markBrainCardSeen]);

  const handleHelpful = useCallback((card: BrainCard) => {
    setHelpfulOverrides((prev) => ({ ...prev, [card.id]: (prev[card.id] ?? card.helpfulCount ?? 0) + 1 }));
    void fetch(`${API_BASE}/api/brain/cards/${card.id}/helpful`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }),
    }).catch(() => {});
  }, [project]);

  // §5.10 v3.78 — 재검증 1비트(사용자 채널). 낙관적으로 목록에서 빼고 서버 재조회로 확정한다.
  const handleVerify = useCallback((card: BrainCard) => {
    setNeedsCheck((prev) => prev.filter((c) => c.id !== card.id));
    void verifyBrainCard(card.id).then(() => setRefetchNonce((n) => n + 1));
  }, [verifyBrainCard]);

  const handleStale = useCallback((card: BrainCard) => {
    setNeedsCheck((prev) => prev.filter((c) => c.id !== card.id));
    void markBrainCardStale(card.id).then(() => setRefetchNonce((n) => n + 1));
  }, [markBrainCardStale]);

  const handleRestore = useCallback((card: BrainCard) => {
    setArchived((prev) => prev.filter((c) => c.id !== card.id));
    void restoreBrainCard(card.id).then(() => setRefetchNonce((n) => n + 1));
  }, [restoreBrainCard]);

  const toggleType = useCallback((tp: BrainCardType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tp)) next.delete(tp); else next.add(tp);
      return next;
    });
  }, []);

  /** §5.10 v3.81 — 승인/거부. 서버가 상태를 바꾸므로 클라는 다시 받아 오기만 한다(§3.1). */
  const handleConfirm = useCallback((card: BrainCard) => {
    void confirmBrainCard(card.id);
    setRefetchNonce((n) => n + 1);
  }, [confirmBrainCard]);

  const handleReject = useCallback((card: BrainCard) => {
    void rejectBrainCard(card.id);
    setRefetchNonce((n) => n + 1);
  }, [rejectBrainCard]);

  const handleToggleDetail = useCallback((id: string) => {
    setExpandedId((prev) => {
      if (prev === id) { setRefetchNonce((n) => n + 1); return null; }
      return id;
    });
  }, []);

  const selectTopic = useCallback((slug: string) => {
    setQuery('');
    setActiveSlug(slug);
    setExpandedId(null);
  }, []);

  if (!open) return null;

  const topicList = topics ?? [];
  const activeTopic = topicList.find((x) => x.slug === activeSlug) ?? null;
  const searching = debouncedQuery.trim().length > 0;

  /**
   * §5.10 v3.78 — 주제 레일 맨 위의 특수 항목. **카드가 있을 때만** 나타난다(빈 항목은 잡음).
   * 확인 필요는 amber(주의), 정리됨은 zinc(중립) — 액센트 indigo 는 주제 선택에만 쓴다.
   */
  const specials: Array<{ slug: SpecialSlug; title: string; hint: string; count: number; color: string }> = [];
  if (needsCheck.length > 0) {
    specials.push({
      slug: SPECIAL_NEEDS_CHECK,
      title: t('brain.library.needsCheck', { defaultValue: '확인 필요' }),
      hint: t('brain.library.needsCheckHint', { defaultValue: '연결된 파일이 그 뒤 수정돼 지금 코드와 어긋날 수 있는 기억' }),
      count: needsCheck.length,
      color: '#D97706',
    });
  }
  if (reviewQueue.length > 0) {
    specials.push({
      slug: SPECIAL_REVIEW,
      title: t('brain.library.review', { defaultValue: '검토 대기' }),
      hint: t('brain.library.reviewHint', { defaultValue: '아직 현재 진실이 아닌 후보 — 확인해야 AI 에게 전달됩니다' }),
      count: reviewQueue.length,
      color: ACCENT,
    });
  }
  if (archived.length > 0) {
    specials.push({
      slug: SPECIAL_ARCHIVE,
      title: t('brain.library.archived', { defaultValue: '정리됨' }),
      hint: t('brain.library.archivedHint', { defaultValue: '정원을 넘겨 보관된 기억 — 지워진 게 아니라 되돌릴 수 있습니다' }),
      count: archived.length,
      color: '#71717A',
    });
  }
  const activeSpecial = specials.find((s) => s.slug === activeSlug) ?? null;
  /** 창 이동·리사이즈가 가능한 상태(좁은 뷰포트에선 잠긴다). */
  const movable = !narrowViewport;

  return createPortal(
    <div
      ref={fw.windowRef}
      className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60 max-md:rounded-none"
      style={fw.style}
    >
      {/* 타이틀바 — 드래그 이동 + 더블클릭 최대화(§5.9 캡처 창과 같은 문법). */}
      <header
        {...fw.titleBarProps}
        className={`flex h-11 shrink-0 select-none items-center gap-2 border-b border-zinc-800 px-3 ${movable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${ACCENT}1F` }}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
            <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
          </svg>
        </span>
        <h2 className="shrink-0 text-[14px] font-semibold tracking-tight text-zinc-100">
          {t('brain.library.title', { defaultValue: '기억' })}
        </h2>
        <span className="h-1 w-1 shrink-0 rounded-full bg-zinc-700" aria-hidden="true" />
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-zinc-500">
          {agentMeta ? (
            <>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: agentMeta.color }} />
              <span className="truncate">{agentMeta.label}</span>
            </>
          ) : (
            <span className="truncate">{project ?? ''}</span>
          )}
        </div>

        <span className="flex-1" />

        {/* 창 버튼 — 최소화(셰이드) · 최대화/복원 · 닫기. 좁은 뷰포트에선 닫기만. */}
        {movable && (
          <>
            <button
              type="button"
              onClick={fw.toggleMinimized}
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              title={fw.minimized
                ? t('brain.library.expand', { defaultValue: '펼치기' })
                : t('brain.library.minimize', { defaultValue: '최소화' })}
              aria-label={fw.minimized
                ? t('brain.library.expand', { defaultValue: '펼치기' })
                : t('brain.library.minimize', { defaultValue: '최소화' })}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {fw.minimized ? <path d="m6 15 6-6 6 6" /> : <path d="M5 12h14" />}
              </svg>
            </button>
            <button
              type="button"
              onClick={fw.toggleMaximized}
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              title={fw.maximized
                ? t('brain.library.restore', { defaultValue: '원래 크기로' })
                : t('brain.library.maximize', { defaultValue: '최대화' })}
              aria-label={fw.maximized
                ? t('brain.library.restore', { defaultValue: '원래 크기로' })
                : t('brain.library.maximize', { defaultValue: '최대화' })}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {fw.maximized ? (
                  <>
                    <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                    <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                    <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                    <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
                  </>
                ) : (
                  <>
                    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                  </>
                )}
              </svg>
            </button>
          </>
        )}
        <button
          type="button"
          onClick={closeLibrary}
          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-rose-500/80 hover:text-white"
          title={t('brain.library.close', { defaultValue: '닫기' })}
          aria-label={t('brain.library.close', { defaultValue: '닫기' })}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      {/* 최소화(셰이드) 중에는 타이틀바만 남는다 — 창은 그 자리에 있고 다시 펼 수 있다. */}
      {!fw.minimized && (
        <>
          {/* 툴바 — 검색 + 타입 필터(좁아지면 가로 스크롤로 살아남는다, 숨김 ❌). */}
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/80 px-3 py-2">
            <div className="relative shrink-0">
              <svg className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('brain.library.searchPlaceholder', { defaultValue: '기억 검색' })}
                className={`rounded-md border border-zinc-800 bg-zinc-900 py-1.5 pl-7 pr-2 text-xs text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-500/70 ${compact ? 'w-36' : 'w-52'}`}
              />
            </div>
            <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {CARD_TYPES.map((tp) => {
                const on = typeFilter.has(tp);
                const c = BRAIN_TYPE_COLORS[tp];
                return (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => toggleType(tp)}
                    className="shrink-0 rounded-md px-2 py-1 text-[12px] transition-colors"
                    style={on ? { backgroundColor: `${c}26`, color: c } : { color: '#71717A' }}
                  >
                    {t(TYPE_LABEL_KEY[tp].key, { defaultValue: TYPE_LABEL_KEY[tp].fallback })}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 좁은 창 — 좌측 주제 레일을 가로 스크롤 칩 행으로 접는다(주제 전환을 잃지 않는다). */}
          {compact && (topicList.length > 0 || specials.length > 0) && (
            <div className="scrollbar-thin flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-zinc-800/80 px-3 py-2">
              {specials.map((sp) => {
                const on = sp.slug === activeSlug && !searching;
                return (
                  <button
                    key={sp.slug}
                    type="button"
                    onClick={() => selectTopic(sp.slug)}
                    title={sp.hint}
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                      on ? 'border-transparent font-semibold' : 'border-zinc-800 hover:brightness-125'
                    }`}
                    style={on ? { backgroundColor: `${sp.color}26`, color: sp.color } : { color: sp.color }}
                  >
                    {sp.title}
                    <span className="ml-1.5 tabular-nums opacity-70">{sp.count}</span>
                  </button>
                );
              })}
              {topicList.map((tp) => {
                const on = tp.slug === activeSlug && !searching;
                return (
                  <button
                    key={tp.slug}
                    type="button"
                    onClick={() => selectTopic(tp.slug)}
                    title={tp.whenToRead}
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                      on ? 'border-transparent font-semibold' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                    style={on ? { backgroundColor: `${ACCENT}26`, color: '#C7D2FE' } : undefined}
                  >
                    {t(`brain.topic.${tp.slug}`, { defaultValue: tp.title })}
                    <span className="ml-1.5 tabular-nums text-zinc-500">{tp.cardCount}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex min-h-0 flex-1">
            {/* 좌측 — 주제 목록(넓은 창에서만). 자기 스크롤을 갖는다. */}
            {!compact && (
              <nav className="flex w-[268px] shrink-0 flex-col border-r border-zinc-800">
                <ScrollFade fill className="flex-1">
                  <div className="px-2 py-3">
                    {/* §5.10 v3.78 — 상태로 모은 특수 항목(확인 필요 · 정리됨). 주제보다 위에 상주. */}
                    {specials.length > 0 && (
                      <div className="mb-2 border-b border-zinc-800/70 pb-2">
                        {specials.map((sp) => {
                          const on = sp.slug === activeSlug && !searching;
                          return (
                            <button
                              key={sp.slug}
                              type="button"
                              onClick={() => selectTopic(sp.slug)}
                              className={`relative mb-0.5 flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                                on ? 'bg-zinc-800/80' : 'hover:bg-zinc-900'
                              }`}
                            >
                              {on && <span className="absolute inset-y-2 left-0 w-[2px] rounded-full" style={{ backgroundColor: sp.color }} />}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-semibold" style={{ color: sp.color }}>{sp.title}</span>
                                <span className="mt-0.5 block truncate text-[12px] text-zinc-600" title={sp.hint}>{sp.hint}</span>
                              </span>
                              <span className="mt-px shrink-0 text-[12px] tabular-nums" style={{ color: sp.color }}>{sp.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="px-2 pb-2 text-[12px] font-medium uppercase tracking-wider text-zinc-600">
                      {t('brain.library.topics', { defaultValue: '주제' })}
                    </div>
                    {topicList.map((tp) => {
                      const on = tp.slug === activeSlug && !searching;
                      return (
                        <button
                          key={tp.slug}
                          type="button"
                          onClick={() => selectTopic(tp.slug)}
                          className={`relative mb-0.5 flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                            on ? 'bg-zinc-800/80' : 'hover:bg-zinc-900'
                          }`}
                        >
                          {on && <span className="absolute inset-y-2 left-0 w-[2px] rounded-full" style={{ backgroundColor: ACCENT }} />}
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-[13px] ${on ? 'font-semibold text-zinc-100' : 'text-zinc-300'}`}>
                              {t(`brain.topic.${tp.slug}`, { defaultValue: tp.title })}
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] text-zinc-600" title={tp.whenToRead}>{tp.whenToRead}</span>
                          </span>
                          <span className="mt-px shrink-0 text-[12px] tabular-nums text-zinc-600">{tp.cardCount}</span>
                        </button>
                      );
                    })}
                    {topics !== null && topicList.length === 0 && (
                      <p className="px-3 py-6 text-center text-xs text-zinc-600">
                        {t('brain.library.emptyTopics', { defaultValue: '아직 쌓인 기억이 없습니다' })}
                      </p>
                    )}
                  </div>
                </ScrollFade>
              </nav>
            )}

            {/* 우측 — 문서 뷰. 좌측 레일과 독립된 자기 스크롤. */}
            <ScrollFade fill className="min-w-0 flex-1">
              <div className={compact ? 'px-4 py-4' : 'px-6 py-5'}>
                {searching ? (
                  <div className="mb-4">
                    <h3 className="text-[17px] font-semibold tracking-tight text-zinc-100">
                      {t('brain.library.searchTitle', { defaultValue: '검색 결과' })}
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t('brain.library.searchHint', { defaultValue: '주제를 가로질러 찾았습니다 · {{n}}장', n: shown.length })}
                    </p>
                  </div>
                ) : activeSpecial ? (
                  <div className="mb-4">
                    <h3 className="text-[17px] font-semibold tracking-tight" style={{ color: activeSpecial.color }}>
                      {activeSpecial.title}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-500">{activeSpecial.hint}</p>
                  </div>
                ) : activeTopic ? (
                  <div className="mb-4">
                    <h3 className="text-[17px] font-semibold tracking-tight text-zinc-100">
                      {t(`brain.topic.${activeTopic.slug}`, { defaultValue: activeTopic.title })}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-500">{activeTopic.whenToRead}</p>
                    <p className="mt-1.5 truncate font-mono text-[12px] text-zinc-700" title={activeTopic.docPath}>{activeTopic.docPath}</p>
                  </div>
                ) : null}

                {loading && shown.length === 0 && (
                  <p className="py-10 text-center text-xs text-zinc-600">{t('brain.library.loading', { defaultValue: '읽는 중…' })}</p>
                )}

                {!loading && shown.length === 0 && (
                  <p className="py-10 text-center text-xs text-zinc-600">
                    {searching
                      ? t('brain.library.noResults', { defaultValue: '찾는 기억이 없습니다' })
                      : t('brain.library.emptyTopic', { defaultValue: '이 주제에는 아직 기억이 없습니다' })}
                  </p>
                )}

                {shown.map((card) => (
                  <DocEntry
                    key={card.id}
                    card={card}
                    helpfulOverride={helpfulOverrides[card.id]}
                    expanded={expandedId === card.id}
                    onToggle={handleToggleDetail}
                    onHelpful={handleHelpful}
                    onVerify={handleVerify}
                    onStale={handleStale}
                    onRestore={handleRestore}
                    onConfirm={handleConfirm}
                    onReject={handleReject}
                  />
                ))}
              </div>
            </ScrollFade>
          </div>
        </>
      )}

      {/* 우하단 리사이즈 핸들 — 최대화·셰이드·좁은 뷰포트에서는 숨김. */}
      {movable && !fw.fullScreen && !fw.minimized && (
        <div
          {...fw.resizeProps}
          className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-1 text-zinc-700 transition-colors hover:text-zinc-400"
          aria-hidden="true"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15 15 21" />
            <path d="M21 9 9 21" />
          </svg>
        </div>
      )}
    </div>,
    document.body,
  );
}

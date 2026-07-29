import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * §5.5 — "놓친 카드" 점프 pill 스택.
 *
 * 배경(사용자 보고): 에이전트가 카드(작업 신고·질문·검수·목록)를 IDE 에 보내면 스트림 바닥에 잠깐 깔리지만,
 *   그 뒤로 생각·대화가 계속 쌓이며 카드가 화면 위로 밀려 올라가 사용자가 **놓친다**. 카드가 지금 사용자
 *   눈앞(뷰포트)에 실제로 머물러 있으면 "봤다(확인)"로 치고 아무것도 안 띄우지만, 잠깐 스쳐 지나가
 *   버렸거나 사용자가 위를 읽는 사이 바닥에 도착해 못 본 카드는 **채팅 입력창 위에 pill** 로 쌓아
 *   눌러서 그 카드 위치로 이동하게 한다. 이동(또는 뷰포트 체류)으로 확인되면 그 pill 은 사라진다.
 *
 * "봤다" 판정 = IntersectionObserver 로 카드 엘리먼트가 뷰포트에 `DWELL_MS` 이상 **머무르면** 확정.
 *   빠른 스트리밍 추종 중 바닥에서 순간 스쳐 지나가는 건(체류 X) 놓친 것으로 남긴다. 화면 밖(위/아래 버퍼)
 *   카드는 애초에 intersecting=false 라 pill 대상. pill 클릭(onJump)은 즉시 seen 처리해 바로 사라진다.
 *
 * 스크롤 중 잦은 visibility state 변경은 이 컴포넌트 내부에 가둬(부모 IDEMainArea 재렌더 유발 X) 입력 지연 회귀를 막는다.
 */

export type UnseenCardKind = 'report' | 'question' | 'review' | 'list';
export interface UnseenCardMeta {
  id: string;
  kind: UnseenCardKind;
  createdAt: number;
}

// 카드가 뷰포트에 이만큼(ms) 연속 머무르면 "사용자가 봤다"로 확정(스쳐 지나감과 실제 체류를 구분).
const DWELL_MS = 900;
// 카드 등장 직후 잠깐은 pill 을 억제 — 막 뜬 카드가 아직 seen 처리되기 전 1~2프레임 깜빡이는 걸 막는다.
const GRACE_MS = 350;
// pill 스택에 한 번에 보일 최대 개수(더 많으면 "+N").
const MAX_VISIBLE = 6;

interface KindStyle {
  label: string; // i18n key
  text: string;
  border: string;
  dot: string;
  icon: React.JSX.Element;
}

const KIND_STYLES: Record<UnseenCardKind, KindStyle> = {
  report: {
    label: 'ide.report.title',
    text: 'text-emerald-300',
    border: 'border-emerald-500/40 hover:border-emerald-400/70',
    dot: 'bg-emerald-400',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" />
      </svg>
    ),
  },
  question: {
    label: 'ide.question.title',
    text: 'text-sky-300',
    border: 'border-sky-500/40 hover:border-sky-400/70',
    dot: 'bg-sky-400',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M9.2 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.6 2.5-2.6 3.5" /><path d="M12 17.5h.01" />
      </svg>
    ),
  },
  review: {
    label: 'ide.review.title',
    text: 'text-violet-300',
    border: 'border-violet-500/40 hover:border-violet-400/70',
    dot: 'bg-violet-400',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" />
      </svg>
    ),
  },
  list: {
    label: 'ide.list.title',
    text: 'text-teal-300',
    border: 'border-teal-500/40 hover:border-teal-400/70',
    dot: 'bg-teal-400',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
      </svg>
    ),
  },
};

interface Props {
  /** 현재 탭의 스크롤러 DOM(메인=Virtuoso scrollerRef, sub=StreamRenderer onScrollerRef). */
  scrollEl: HTMLElement | null;
  /** createdAt 오름차순 카드 메타. 새 카드가 생기거나 사라질 때만 정체성이 바뀌게(부모 useMemo). */
  cards: UnseenCardMeta[];
  /** pill 클릭 시 그 카드로 스크롤(부모가 메인/서브 탭에 맞춰 처리). */
  onJump: (card: UnseenCardMeta) => void;
}

export const UnseenCardPills = memo(function UnseenCardPills({ scrollEl, cards, onJump }: Props): React.JSX.Element | null {
  const { t } = useTranslation();
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [visible, setVisible] = useState<Set<string>>(() => new Set());
  const seenRef = useRef(seen);
  seenRef.current = seen;
  const firstAppearRef = useRef<Map<string, number>>(new Map());
  // 마운트(=사용자가 이 화면을 보기 시작한) 시각. 그 이전에 이미 존재하던 카드(복원/기존 세션의 과거 카드)는
  //   사용자가 이미 다뤘다고 보고 pill 대상에서 제외한다 — pill 은 "보는 도중 새로 생겨(밀려 올라가) 놓친" 카드만
  //   잡는다. 서버가 로컬 loopback 이라 카드 createdAt(서버)과 Date.now()(클라)는 같은 시계라 skew 없음.
  const mountAtRef = useRef<number>(Date.now());
  const [, tick] = useState(0);

  const markSeen = useCallback((id: string) => {
    setSeen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  // 카드 엘리먼트(`[data-card-id]`) 의 뷰포트 교차를 관측 — 체류(DWELL_MS)로 seen 확정 + 현재 가시성 추적.
  useEffect(() => {
    if (!scrollEl) { setVisible(new Set()); return; }
    setVisible(new Set()); // 스크롤러 교체(탭 전환) 시 이전 가시성은 무효.
    const dwellTimers = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          let next: Set<string> | null = null;
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.cardId;
            if (!id) continue;
            if (e.isIntersecting) {
              if (!prev.has(id)) (next ??= new Set(prev)).add(id);
              if (!seenRef.current.has(id) && !dwellTimers.has(id)) {
                dwellTimers.set(id, window.setTimeout(() => { dwellTimers.delete(id); markSeen(id); }, DWELL_MS));
              }
            } else {
              if (prev.has(id)) (next ??= new Set(prev)).delete(id);
              const tm = dwellTimers.get(id);
              if (tm !== undefined) { clearTimeout(tm); dwellTimers.delete(id); }
            }
          }
          return next ?? prev;
        });
      },
      { root: scrollEl, threshold: 0.01 },
    );
    const observeAll = (): void => {
      scrollEl.querySelectorAll<HTMLElement>('[data-card-id]').forEach((el) => io.observe(el));
    };
    observeAll();
    // 카드 래퍼가 실제로 DOM 에 붙을 때(신규 카드 or 가상화 마운트)만 재관측 — 스트리밍 텍스트 델타로는 트리거하지 않는다.
    let raf = 0;
    const mo = new MutationObserver((muts) => {
      let hit = false;
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const el = node as HTMLElement;
          if (el.matches?.('[data-card-id]') || el.querySelector?.('[data-card-id]')) { hit = true; break; }
        }
        if (hit) break;
      }
      if (hit && !raf) raf = requestAnimationFrame(() => { raf = 0; observeAll(); });
    });
    mo.observe(scrollEl, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
      dwellTimers.forEach((tm) => clearTimeout(tm));
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollEl, markSeen]);

  // 등장 시각 기록 + GRACE 경과 시점에 재평가 예약(막 뜬 카드 억제 창을 넘기면 pill 로 승격).
  useEffect(() => {
    const now = performance.now();
    const map = firstAppearRef.current;
    const present = new Set(cards.map((c) => c.id));
    for (const c of cards) if (!map.has(c.id)) map.set(c.id, now);
    for (const id of [...map.keys()]) if (!present.has(id)) map.delete(id);
    const pendingGrace = cards.filter(
      (c) => c.createdAt > mountAtRef.current && !seen.has(c.id) && !visible.has(c.id) && now - (map.get(c.id) ?? now) < GRACE_MS,
    );
    if (pendingGrace.length === 0) return;
    const soonest = Math.max(16, Math.min(...pendingGrace.map((c) => GRACE_MS - (now - (map.get(c.id) ?? now)))));
    const tm = window.setTimeout(() => tick((v) => v + 1), soonest);
    return () => clearTimeout(tm);
  }, [cards, seen, visible]);

  const handleJump = useCallback((card: UnseenCardMeta) => {
    markSeen(card.id); // 이동하면 곧 교차로도 seen 되지만, pill 이 즉시 사라지도록 선처리.
    onJump(card);
  }, [markSeen, onJump]);

  const now = performance.now();
  const unseen = cards.filter(
    (c) => c.createdAt > mountAtRef.current && !seen.has(c.id) && !visible.has(c.id) && now - (firstAppearRef.current.get(c.id) ?? now) >= GRACE_MS,
  );
  if (unseen.length === 0) return null;

  // 최신(놓쳤을 가능성 큰) 카드를 위에 쌓는다("개수가 많으면 그 위로 스택").
  const ordered = [...unseen].reverse();
  const shown = ordered.slice(0, MAX_VISIBLE);
  const overflow = ordered.length - shown.length;

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex max-w-[min(320px,60%)] flex-col items-start gap-1.5">
      {overflow > 0 && (
        <span className="pointer-events-none select-none rounded-full bg-gray-800/80 px-2 py-0.5 text-[10px] font-medium text-gray-400 shadow backdrop-blur-sm">
          +{overflow}
        </span>
      )}
      {shown.map((card) => {
        const s = KIND_STYLES[card.kind];
        return (
          <div
            key={card.id}
            className={`pointer-events-auto flex w-full items-center gap-2 rounded-full border ${s.border} bg-gray-900/90 py-1 pl-2.5 pr-1.5 shadow-lg backdrop-blur-sm transition-colors`}
          >
            <button
              type="button"
              onClick={() => handleJump(card)}
              title={t('ide.unseenCards.jump')}
              aria-label={`${t(s.label)} — ${t('ide.unseenCards.jump')}`}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span className={`relative flex h-4 w-4 flex-shrink-0 items-center justify-center ${s.text}`}>
                {s.icon}
                <span className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${s.dot} ring-2 ring-gray-900`} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-200">
                {t(s.label)}
              </span>
              {/* 위치로 이동 힌트(방향 무관 — 스크롤이 카드 위치로 데려간다). */}
              <svg className="h-3 w-3 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => markSeen(card.id)}
              title={t('ide.unseenCards.dismiss')}
              aria-label={t('ide.unseenCards.dismiss')}
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-700/60 hover:text-gray-200"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
});

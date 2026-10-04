/**
 * §5.5 #17-48 — 내 입력 레일. IDE 출력 우하단, [맨 아래로] 위에 선다.
 *
 * [맨 위] · [이전 입력] · 입력 눈금 트랙 · [다음 입력] 을 세로 레일 하나로 묶고, 그 아래 칸에 종전
 * [맨 아래로]가 종전 조건으로 나타났다 사라진다(칸은 비워 두어 레일이 출렁이지 않는다).
 * 눈금·[이전]·[다음]에 마우스를 올리면 그 입력의 글이 레일 왼쪽 팝업으로 뜬다(길면 일부 생략).
 *
 * 판정·배치·생략은 순수 모듈 `promptRail.ts` 가 한다. 이 컴포넌트는 스크롤마다 다시 재서 자리를 그리고,
 * 레일로 옮긴 직후 그 입력을 붙들었다가 사용자가 스크롤러를 직접 만지면 놓는 일만 한다.
 * 입력이 하나도 없으면 레일 없이 종전 [맨 아래로] 하나뿐이다.
 */
import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { visualClientRect } from '../../utils/inspector.js';
import { formatPromptStamp } from './promptStamp.js';
import {
  EMPTY_PROMPT_RAIL_PLACE,
  nearestPromptMarker,
  placePromptRailPopup,
  promptMarkerRatio,
  promptPreviewText,
  resolvePromptRailPlace,
  samePromptRailPlace,
  type PromptProbe,
  type PromptRailEntry,
  type PromptRailPlace,
} from './promptRail.js';

/** 트랙 높이(px) — 입력 수만큼 자라되 이 사이에 머문다. 창이 낮으면 그보다 더 줄어든다(flex). */
const TRACK_MIN_PX = 40;
const TRACK_MAX_PX = 192;
const TRACK_PX_PER_PROMPT = 14;

interface PromptRailProps {
  /** 이 목록의 내 입력(위→아래). */
  prompts: readonly PromptRailEntry[];
  /** 지금 화면을 재 입력 단위로 돌려준다(Sub 탭 = 렌더러 핸들, 메인 탭 = 타임라인 측정). */
  probe: () => PromptProbe | null;
  /** 스크롤러 DOM — 스크롤마다 다시 재고, 사용자 제스처에 붙든 자리를 놓는다. */
  scrollEl: HTMLElement | null;
  /** 입력 하나로 즉시 옮긴다(추종 해제는 부르는 쪽 몫). */
  onJumpToPrompt: (itemId: string) => void;
  onJumpToTop: () => void;
  onJumpToBottom: () => void;
  /** [맨 아래로] 노출 — 종전 조건(바닥에서 240px 넘게 떨어졌을 때). */
  showJumpBottom: boolean;
}

/** 팝업을 띄운 자리 — 트랙은 포인터 아래 눈금, 버튼은 그 버튼이 갈 입력(자리가 바뀌면 따라 바뀐다). */
type HoverSource = { source: 'track'; index: number } | { source: 'prev' } | { source: 'next' };

const RAIL_BUTTON_CLASS =
  'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-gray-300 transition-colors hover:bg-gray-700/70 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-300';

const RailButton = forwardRef<HTMLButtonElement, {
  label: string;
  /** 네이티브 툴팁 — [이전]·[다음]은 팝업이 대신 말하므로 주지 않는다(둘이 겹쳐 뜨지 않게). */
  title?: string;
  disabled: boolean;
  onClick: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  children: React.ReactNode;
}>(function RailButton({ label, title, disabled, onClick, onPointerEnter, onPointerLeave, children }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className={RAIL_BUTTON_CLASS}
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
});

export function PromptRail({
  prompts,
  probe,
  scrollEl,
  onJumpToPrompt,
  onJumpToTop,
  onJumpToBottom,
  showJumpBottom,
}: PromptRailProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const count = prompts.length;
  const [place, setPlace] = useState<PromptRailPlace>(EMPTY_PROMPT_RAIL_PLACE);
  const [atTop, setAtTop] = useState(false);
  const [hover, setHover] = useState<HoverSource | null>(null);
  // 레일로 옮겨 붙든 입력(id) — 사용자가 스크롤러를 만지면 놓는다(§5.5 #17-48 (B) ②).
  const heldIdRef = useRef<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const prevBtnRef = useRef<HTMLButtonElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPos, setPopupPos] = useState<{ left: number; top: number } | null>(null);

  const ordById = useMemo(() => new Map(prompts.map((p, i) => [p.id, i] as const)), [prompts]);

  // 스크롤 리스너는 스크롤러가 바뀔 때만 다시 단다 — 최신 값은 ref 로 읽는다.
  const latest = useRef({ prompts, ordById, probe, scrollEl });
  latest.current = { prompts, ordById, probe, scrollEl };

  const recompute = useCallback((): void => {
    const { prompts: list, ordById: ord, probe: measure, scrollEl: el } = latest.current;
    setAtTop(el !== null && el.scrollTop < 2);
    if (list.length === 0) {
      setPlace((p) => (samePromptRailPlace(p, EMPTY_PROMPT_RAIL_PLACE) ? p : EMPTY_PROMPT_RAIL_PLACE));
      return;
    }
    const found = measure();
    if (!found) return; // 잴 것이 없는 프레임 — 앞 자리를 그대로 둔다.
    let held = -1;
    if (heldIdRef.current !== null) {
      held = ord.get(heldIdRef.current) ?? -1;
      if (held < 0) heldIdRef.current = null; // 붙든 입력이 목록에서 사라졌다.
    }
    const ordOf = (id: string | null): number => (id === null ? -1 : ord.get(id) ?? -1);
    const next = resolvePromptRailPlace({
      count: list.length,
      owner: ordOf(found.ownerId),
      anchored: found.anchored,
      lastVisible: ordOf(found.lastVisibleId),
      atBottom: found.atBottom,
      held,
    });
    setPlace((p) => (samePromptRailPlace(p, next) ? p : next));
  }, []);

  useEffect(() => {
    const el = scrollEl;
    if (!el) return;
    let raf = 0;
    // 스크롤 한 번에 측정 한 번(프레임 단위로 합친다) — 상태바 추종(③-2)과 같은 규율.
    const schedule = (): void => {
      if (raf !== 0) return;
      raf = window.requestAnimationFrame(() => { raf = 0; recompute(); });
    };
    // 휠·터치·포인터(스크롤바 포함)·키 — 사용자가 직접 움직이려는 순간 붙든 자리를 놓는다.
    const release = (): void => {
      if (heldIdRef.current === null) return;
      heldIdRef.current = null;
      schedule();
    };
    el.addEventListener('scroll', schedule, { passive: true });
    el.addEventListener('wheel', release, { passive: true });
    el.addEventListener('touchstart', release, { passive: true });
    el.addEventListener('pointerdown', release, { passive: true });
    el.addEventListener('keydown', release);
    schedule();
    return () => {
      if (raf !== 0) window.cancelAnimationFrame(raf);
      el.removeEventListener('scroll', schedule);
      el.removeEventListener('wheel', release);
      el.removeEventListener('touchstart', release);
      el.removeEventListener('pointerdown', release);
      el.removeEventListener('keydown', release);
    };
  }, [scrollEl, recompute]);

  // 입력 목록이 바뀌면(새 입력 · 불러온 과거) 다시 잰다 — 새 목록이 그려진 뒤에 재도록 한 프레임 미룬다.
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => recompute());
    return () => window.cancelAnimationFrame(raf);
  }, [prompts, recompute]);

  const jumpTo = useCallback((index: number): void => {
    const target = prompts[index];
    if (!target) return;
    heldIdRef.current = target.id;
    onJumpToPrompt(target.id);
    // 측정을 기다리지 않고 곧장 그 자리로 그린다 — 붙든 자리가 측정보다 먼저다.
    const next = resolvePromptRailPlace({ count: prompts.length, owner: index, anchored: true, lastVisible: -1, atBottom: false, held: index });
    setPlace((p) => (samePromptRailPlace(p, next) ? p : next));
  }, [prompts, onJumpToPrompt]);

  const goTop = useCallback((): void => {
    heldIdRef.current = null;
    onJumpToTop();
  }, [onJumpToTop]);

  const goBottom = useCallback((): void => {
    heldIdRef.current = null;
    onJumpToBottom();
  }, [onJumpToBottom]);

  /** 트랙 위 포인터 높이 → 가장 가까운 눈금. 눈금이 빽빽해도 1px 를 겨눌 필요가 없다. */
  const markerAt = useCallback((clientY: number): number => {
    const el = trackRef.current;
    if (!el || count === 0) return -1;
    const r = visualClientRect(el);
    return nearestPromptMarker(r.height > 0 ? (clientY - r.top) / r.height : 0.5, count);
  }, [count]);

  const hoverIndex = hover === null
    ? null
    : hover.source === 'track' ? hover.index : hover.source === 'prev' ? place.prev : place.next;
  const hoverEntry = hoverIndex !== null && hoverIndex >= 0 ? prompts[hoverIndex] : undefined;
  const hoverAction = hover?.source === 'prev'
    ? t('ide.mainArea.promptPrev')
    : hover?.source === 'next' ? t('ide.mainArea.promptNext') : null;
  const stamp = useMemo(
    () => (hoverEntry?.at !== undefined ? formatPromptStamp(hoverEntry.at, i18n.language) : null),
    [hoverEntry, i18n.language],
  );
  const preview = useMemo(() => (hoverEntry ? promptPreviewText(hoverEntry.text).text : ''), [hoverEntry]);

  // 팝업을 실측해 레일 왼쪽, 화면 안에 세운다. 페인트 전에 잡아야 한 프레임 튀지 않는다.
  useLayoutEffect(() => {
    if (!hover || !hoverEntry || hoverIndex === null) { setPopupPos(null); return; }
    const rail = railRef.current;
    const box = popupRef.current;
    if (!rail || !box) return;
    let centerY: number;
    if (hover.source === 'track') {
      const track = trackRef.current;
      if (!track) return;
      const r = visualClientRect(track);
      centerY = r.top + promptMarkerRatio(hoverIndex, count) * r.height;
    } else {
      const btn = hover.source === 'prev' ? prevBtnRef.current : nextBtnRef.current;
      if (!btn) return;
      const r = visualClientRect(btn);
      centerY = r.top + r.height / 2;
    }
    const { width, height } = box.getBoundingClientRect();
    setPopupPos(placePromptRailPopup(
      { left: visualClientRect(rail).left, centerY },
      { width, height },
      { width: window.innerWidth, height: window.innerHeight },
    ));
  }, [hover, hoverEntry, hoverIndex, count, preview, stamp]);

  const trackPx = Math.min(TRACK_MAX_PX, Math.max(TRACK_MIN_PX, count * TRACK_PX_PER_PROMPT));

  return (
    <div className="pointer-events-none absolute bottom-3 right-3 top-12 z-20 flex flex-col items-center justify-end gap-1.5">
      {count > 0 && (
        <div
          ref={railRef}
          role="group"
          aria-label={t('ide.mainArea.promptRail')}
          className="pointer-events-auto flex min-h-0 w-7 flex-shrink flex-col items-center gap-0.5 overflow-hidden rounded-full border border-gray-700/80 bg-gray-900/85 py-1 opacity-80 shadow-lg backdrop-blur-sm transition-opacity hover:opacity-100"
        >
          <RailButton label={t('ide.mainArea.jumpToTop')} title={t('ide.mainArea.jumpToTop')} disabled={atTop} onClick={goTop}>
            <path d="M5 3h14" />
            <path d="m18 13-6-6-6 6" />
            <path d="M12 7v14" />
          </RailButton>
          <RailButton
            ref={prevBtnRef}
            label={t('ide.mainArea.promptPrev')}
            disabled={place.prev === null}
            onClick={() => { if (place.prev !== null) jumpTo(place.prev); }}
            onPointerEnter={() => setHover({ source: 'prev' })}
            onPointerLeave={() => setHover(null)}
          >
            <path d="m18 15-6-6-6 6" />
          </RailButton>
          {/* 입력 눈금 트랙 — 순번으로 고르게. 키보드·화면 낭독은 [이전]·[다음]이 맡으므로 트랙은 감춘다. */}
          <div
            ref={trackRef}
            aria-hidden="true"
            className="relative min-h-[24px] w-full flex-shrink cursor-pointer"
            style={{ height: trackPx }}
            onPointerMove={(e) => {
              const index = markerAt(e.clientY);
              if (index < 0) return;
              setHover((h) => (h?.source === 'track' && h.index === index ? h : { source: 'track', index }));
            }}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => {
              const index = markerAt(e.clientY);
              if (index >= 0) jumpTo(index);
            }}
          >
            <span className="absolute bottom-1 left-1/2 top-1 w-px -translate-x-1/2 bg-gray-600/70" />
            {prompts.map((p, i) => {
              const isCurrent = i === place.current;
              const isHovered = hover?.source === 'track' && hover.index === i;
              return (
                <span
                  key={p.id}
                  className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors ${
                    isCurrent
                      ? 'z-[1] h-[3px] w-3.5 bg-blue-400'
                      : isHovered
                        ? 'z-[1] h-[3px] w-3.5 bg-gray-100'
                        : 'h-[2px] w-2 bg-gray-400/70'
                  }`}
                  style={{ top: `${promptMarkerRatio(i, count) * 100}%` }}
                />
              );
            })}
          </div>
          <RailButton
            ref={nextBtnRef}
            label={t('ide.mainArea.promptNext')}
            disabled={place.next === null}
            onClick={() => { if (place.next !== null) jumpTo(place.next); }}
            onPointerEnter={() => setHover({ source: 'next' })}
            onPointerLeave={() => setHover(null)}
          >
            <path d="m6 9 6 6 6-6" />
          </RailButton>
        </div>
      )}
      {/* §5.5 "맨 아래로" — 종전 조건(showJumpBottom)으로 나타났다 사라진다. 칸은 남겨 레일이 출렁이지 않는다.
          클릭 시 추종 재무장 + 바닥으로. */}
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center">
        {showJumpBottom && (
          <button
            type="button"
            onClick={goBottom}
            title={t('ide.mainArea.jumpToBottom')}
            aria-label={t('ide.mainArea.jumpToBottom')}
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-gray-600 bg-gray-800/90 text-gray-200 shadow-lg backdrop-blur-sm transition-colors hover:border-blue-400/60 hover:bg-gray-700 hover:text-white"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>
      {hoverEntry && hoverIndex !== null && createPortal(
        <div
          ref={popupRef}
          role="tooltip"
          className="pointer-events-none fixed z-[9999] w-max max-w-[360px] rounded-md border border-white/[0.08] bg-[#1f2937] px-2.5 py-1.5 text-[12px] leading-snug text-gray-100 shadow-lg shadow-black/50"
          style={{
            left: popupPos?.left ?? 0,
            top: popupPos?.top ?? 0,
            // 실측 전(첫 프레임)에는 그리지 않는다 — 좌상단에 한 번 번쩍이는 것을 막는다.
            visibility: popupPos ? 'visible' : 'hidden',
          }}
        >
          <div className="mb-1 flex items-center gap-2 text-gray-400">
            {hoverAction && <span className="text-gray-300">{hoverAction}</span>}
            <span className="tabular-nums">{t('ide.mainArea.promptPosition', { n: hoverIndex + 1, total: count })}</span>
            {stamp && <span className="tabular-nums text-gray-500" title={stamp.title}>{stamp.text}</span>}
          </div>
          {preview && <div className="whitespace-pre-wrap break-words">{preview}</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}

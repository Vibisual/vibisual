/**
 * §5.5 #17-48 — 내 입력 레일. 좁은 대화 칸에서는 탐색할 때만 펼친다.
 * 판정·배치는 `promptRail.ts`. 레일로 옮긴 입력을 붙들었다가 사용자가 스크롤러를 직접 만지면 놓는다.
 */
import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { visualClientRect } from '../../utils/inspector.js';
import { isComposingKeyEvent } from '../../utils/inputComposition.js';
import { formatPromptStamp } from './promptStamp.js';
import { usePromptRailDisclosure } from './usePromptRailDisclosure.js';
import {
  EMPTY_PROMPT_RAIL_PLACE,
  nearestPromptMarker,
  placePromptRailPopup,
  promptMarkerRatio,
  promptPreviewText,
  promptRailDense,
  promptRailLine,
  promptRailTrackPx,
  resolvePromptRailPlace,
  samePromptRailPlace,
  type PromptProbe,
  type PromptRailEntry,
  type PromptRailPlace,
} from './promptRail.js';

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
  /** [맨 아래로]를 켠다 — 종전 조건(바닥에서 240px 넘게 떨어졌을 때). 아니면 흐리게 눌리지 않는다. */
  showJumpBottom: boolean;
}

/** 팝업을 띄운 자리 — 트랙은 포인터 아래 점, 버튼은 그 버튼이 갈 입력(자리가 바뀌면 따라 바뀐다). */
type HoverSource = { source: 'track'; index: number } | { source: 'prev' } | { source: 'next' };

/** 알약 — 반투명 유리 한 덩어리. 낮은 창에서 줄어들 때 넘치지 않게 가장자리를 자른다(그래서 빛은 안쪽으로 둔다). */
const RAIL_CAPSULE_CLASS =
  'pointer-events-auto min-h-0 flex-shrink items-center gap-0.5 overflow-hidden border border-white/[0.08] bg-gray-900/80 p-0.5 shadow-lg shadow-black/40 backdrop-blur-md';

const RAIL_BUTTON_CLASS =
  'flex flex-shrink-0 items-center justify-center rounded-full transition-[color,background-color,box-shadow] duration-150 disabled:cursor-default disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400';
/** 평소 — 옅은 글리프, 올리면 밝아진다. */
const RAIL_BUTTON_IDLE_CLASS =
  'text-gray-400 hover:bg-white/10 hover:text-white disabled:hover:bg-transparent disabled:hover:text-gray-400';
/** 켜짐 — 아래에 볼 것이 남은 [맨 아래로]. 강조색 바탕 · 안쪽 테 · 안쪽 빛. */
const RAIL_BUTTON_LIT_CLASS =
  'bg-blue-400/20 text-blue-200 ring-1 ring-inset ring-blue-400/40 shadow-[inset_0_0_6px] shadow-blue-400/40 hover:bg-blue-400/30 hover:text-white';

/** 입력 점의 중심을 트랙의 순번 위치에 맞춘다. */
const DOT_CLASS =
  'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-[width,height,background-color,box-shadow] duration-150';
/** 지금 보고 있는 턴 — 강조색으로 조금 크게, 은은한 빛. */
const DOT_CURRENT_CLASS = 'z-[2] h-[7px] w-[7px] bg-blue-400 shadow-[0_0_8px_2px] shadow-blue-400/60';
const DOT_CURRENT_HOVER_CLASS = 'z-[2] h-2 w-2 bg-blue-300 shadow-[0_0_10px_3px] shadow-blue-400/70';
/** 올린 점 — 하얗게 커진다. */
const DOT_HOVER_CLASS = 'z-[1] h-[7px] w-[7px] bg-white shadow-[0_0_6px_1px] shadow-white/40';
/** 나머지 — 불투명 회색(빽빽해 겹쳐도 겹친 자리만 진해지지 않게). */
const DOT_IDLE_CLASS = 'h-[5px] w-[5px] bg-gray-500';
const DOT_IDLE_DENSE_CLASS = 'h-[3px] w-[3px] bg-gray-500';

function dotClass(isCurrent: boolean, isHovered: boolean, dense: boolean): string {
  if (isCurrent) return isHovered ? DOT_CURRENT_HOVER_CLASS : DOT_CURRENT_CLASS;
  if (isHovered) return DOT_HOVER_CLASS;
  return dense ? DOT_IDLE_DENSE_CLASS : DOT_IDLE_CLASS;
}

const RailButton = forwardRef<HTMLButtonElement, {
  label: string;
  /** 네이티브 툴팁 — [이전]·[다음]은 팝업이 대신 말하므로 주지 않는다(둘이 겹쳐 뜨지 않게). */
  title?: string;
  disabled: boolean;
  /** 강조색으로 켠다 — 지금 누를 만한 버튼([맨 아래로]: 아래에 볼 것이 남았다). */
  lit?: boolean;
  compact?: boolean;
  onClick: () => void;
  onPointerEnter?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerLeave?: () => void;
  children: React.ReactNode;
}>(function RailButton({ label, title, disabled, lit = false, compact = false, onClick, onPointerEnter, onPointerLeave, children }, ref) {
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
      className={`${RAIL_BUTTON_CLASS} ${compact ? 'h-10 w-10' : 'h-6 w-6 pointer-coarse:h-8 pointer-coarse:w-8'} ${lit && !disabled ? RAIL_BUTTON_LIT_CLASS : RAIL_BUTTON_IDLE_CLASS}`}
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
  const hostRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const controlsId = useId();
  const { compact, expanded, toggle, close } = usePromptRailDisclosure(hostRef, railRef, scrollEl);
  const navigationVisible = !compact || expanded;
  const trackRef = useRef<HTMLDivElement>(null);
  const topBtnRef = useRef<HTMLButtonElement>(null);
  const prevBtnRef = useRef<HTMLButtonElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPos, setPopupPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => { setHover(null); }, [compact, expanded]);
  useLayoutEffect(() => {
    if (!expanded) return;
    const first = [topBtnRef.current, prevBtnRef.current, nextBtnRef.current].find((button) => button && !button.disabled);
    first?.focus({ preventScroll: true });
  }, [expanded]);
  const closeTools = useCallback((): void => {
    setHover(null);
    close();
    if (compact && expanded) toggleRef.current?.focus({ preventScroll: true });
  }, [close, compact, expanded]);

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
    closeTools();
  }, [prompts, onJumpToPrompt, closeTools]);

  const goTop = useCallback((): void => {
    heldIdRef.current = null;
    onJumpToTop();
    closeTools();
  }, [onJumpToTop, closeTools]);

  const goBottom = useCallback((): void => {
    heldIdRef.current = null;
    onJumpToBottom();
    closeTools();
  }, [onJumpToBottom, closeTools]);

  /** 트랙 위 포인터 → 가장 가까운 점. */
  const markerAt = useCallback((clientX: number, clientY: number): number => {
    const el = trackRef.current;
    if (!el || count === 0) return -1;
    const r = visualClientRect(el);
    const ratio = compact
      ? (r.width > 0 ? (clientX - r.left) / r.width : 0.5)
      : (r.height > 0 ? (clientY - r.top) / r.height : 0.5);
    return nearestPromptMarker(ratio, count);
  }, [count, compact]);

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
      centerY = r.top + (compact ? 0.5 : promptMarkerRatio(hoverIndex, count)) * r.height;
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
  }, [hover, hoverEntry, hoverIndex, count, preview, stamp, compact]);

  const trackPx = promptRailTrackPx(count);
  const dense = promptRailDense(count, trackPx);
  const line = promptRailLine(count, place.current);

  return (
    <div
      ref={hostRef}
      className={`pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-end justify-end px-3 ${compact ? 'top-0' : 'top-12'}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !expanded || isComposingKeyEvent(event.nativeEvent ?? event)) return;
        event.preventDefault();
        event.stopPropagation();
        closeTools();
      }}
    >
      {(count > 0 || showJumpBottom) && (
        <div
          ref={railRef}
          role={count > 0 ? 'group' : undefined}
          aria-label={count > 0 ? t('ide.mainArea.promptRail') : undefined}
          className={`${RAIL_CAPSULE_CLASS} ${compact && expanded ? 'grid grid-cols-5 rounded-2xl' : `flex rounded-full ${compact ? 'flex-row' : 'flex-col'}`}`}
        >
          {count > 0 && navigationVisible && (
            <div id={controlsId} className={compact ? 'contents' : 'flex min-h-0 flex-shrink flex-col items-center gap-0.5'}>
              <RailButton ref={topBtnRef} compact={compact} label={t('ide.mainArea.jumpToTop')} title={t('ide.mainArea.jumpToTop')} disabled={atTop} onClick={goTop}>
                <path d="M5 3h14" />
                <path d="m18 13-6-6-6 6" />
                <path d="M12 7v14" />
              </RailButton>
              <RailButton
                ref={prevBtnRef}
                compact={compact}
                label={t('ide.mainArea.promptPrev')}
                disabled={place.prev === null}
                onClick={() => { if (place.prev !== null) jumpTo(place.prev); }}
                onPointerEnter={(event) => { if (event.pointerType !== 'touch') setHover({ source: 'prev' }); }}
                onPointerLeave={() => setHover(null)}
              >
                <path d="m18 15-6-6-6 6" />
              </RailButton>
              {/* 입력 점 트랙 — 순번으로 고르게. 키보드·화면 낭독은 [이전]·[다음]이 맡으므로 트랙은 감춘다. */}
              <div
                ref={trackRef}
                aria-hidden="true"
                className={`relative w-full cursor-pointer ${compact ? 'col-span-5 row-start-1 h-8' : 'min-h-[24px] flex-shrink'}`}
                style={compact ? undefined : { height: trackPx }}
                onPointerMove={(e) => {
                  if (e.pointerType === 'touch') return;
                  const index = markerAt(e.clientX, e.clientY);
                  if (index < 0) return;
                  setHover((h) => (h?.source === 'track' && h.index === index ? h : { source: 'track', index }));
                }}
                onPointerLeave={() => setHover(null)}
                onClick={(e) => {
                  const index = markerAt(e.clientX, e.clientY);
                  if (index >= 0) jumpTo(index);
                }}
              >
                {line && (
                  <>
                    {/* 첫 점과 마지막 점을 잇는 옅은 선 */}
                    <span
                      className={`pointer-events-none absolute bg-white/10 ${compact ? 'top-1/2 h-px -translate-y-1/2' : 'left-1/2 w-px -translate-x-1/2'}`}
                      style={compact ? { left: `${line.insetPct}%`, right: `${line.insetPct}%` } : { top: `${line.insetPct}%`, bottom: `${line.insetPct}%` }}
                    />
                    {/* 첫 점에서 지금 턴까지 차오른 선 — 위는 옅게, 지금 자리로 갈수록 밝게 */}
                    {line.fillPct > 0 && (
                      <span
                        className={`pointer-events-none absolute rounded-full from-blue-400/10 to-blue-400/70 duration-200 ${compact ? 'top-1/2 h-0.5 -translate-y-1/2 bg-linear-to-r transition-[width]' : 'left-1/2 w-0.5 -translate-x-1/2 bg-linear-to-b transition-[height]'}`}
                        style={compact ? { left: `${line.insetPct}%`, width: `${line.fillPct}%` } : { top: `${line.insetPct}%`, height: `${line.fillPct}%` }}
                      />
                    )}
                  </>
                )}
                {prompts.map((p, i) => (
                  <span
                    key={p.id}
                    className={`${DOT_CLASS} ${compact ? 'top-1/2' : 'left-1/2'} ${dotClass(i === place.current, hover?.source === 'track' && hover.index === i, dense)}`}
                    style={compact ? { left: `${promptMarkerRatio(i, count) * 100}%` } : { top: `${promptMarkerRatio(i, count) * 100}%` }}
                  />
                ))}
              </div>
              <RailButton
                ref={nextBtnRef}
                compact={compact}
                label={t('ide.mainArea.promptNext')}
                disabled={place.next === null}
                onClick={() => { if (place.next !== null) jumpTo(place.next); }}
                onPointerEnter={(event) => { if (event.pointerType !== 'touch') setHover({ source: 'next' }); }}
                onPointerLeave={() => setHover(null)}
              >
                <path d="m6 9 6 6 6-6" />
              </RailButton>
            </div>
          )}
          {/* 접힌 상태에서도 바닥 이동은 한 번에 누를 수 있다. */}
          {(navigationVisible || showJumpBottom) && <RailButton
            compact={compact}
            label={t('ide.mainArea.jumpToBottom')}
            title={t('ide.mainArea.jumpToBottom')}
            disabled={!showJumpBottom}
            lit={showJumpBottom}
            onClick={goBottom}
          >
            <path d="M12 3v14" />
            <path d="m6 11 6 6 6-6" />
            <path d="M5 21h14" />
          </RailButton>}
          {compact && count > 0 && (
            <button
              ref={toggleRef}
              type="button"
              aria-label={t('ide.mainArea.promptRail')}
              aria-expanded={expanded}
              aria-controls={navigationVisible ? controlsId : undefined}
              title={expanded ? t('common.close') : t('ide.mainArea.promptRail')}
              className={`${RAIL_BUTTON_CLASS} ${RAIL_BUTTON_IDLE_CLASS} h-10 ${expanded ? 'w-10' : 'max-w-40 gap-1.5 px-3 text-[12px]'}`}
              onClick={toggle}
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {expanded ? <path d="m6 6 12 12M6 18 18 6" /> : <><path d="M9 6h12M9 12h12M9 18h12" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>}
              </svg>
              {!expanded && <span className="truncate">{t('ide.mainArea.promptRail')}</span>}
            </button>
          )}
        </div>
      )}
      {navigationVisible && hoverEntry && hoverIndex !== null && createPortal(
        <div
          ref={popupRef}
          role="tooltip"
          className="pointer-events-none fixed z-[9999] w-max max-w-[min(360px,calc(100vw-1rem))] rounded-md border border-white/[0.08] bg-vb-raised px-2.5 py-1.5 text-[12px] leading-snug text-gray-100 shadow-lg shadow-black/50"
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

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BUBBLE_STYLES,
  WEB_PAGE_TAB_PREFIX,
  fileFaceFamilyOf,
  webNodeKey,
  type QueuedCommand,
  type SubAgentStreamEvent,
} from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { clientPathPlatform } from '../../utils/platform.js';
import { formatSince } from '../../formatSince.js';
import { BubbleIcon } from '../BubbleMap/BubbleNode.js';
import { FileFamilyGlyph } from '../BubbleMap/fileFaceGlyphs.js';
import { openWebAddress } from '../BubbleMap/openDomainBubble.js';
import { CommandAppIcon } from '../CommandAppIcon.js';
import { editorFileFromAbsPath } from './editorModel.js';
import { useIDEPaneActions } from './idePane.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { requestOlderStreamHistory } from './streamHistory.js';
import { buildSessionBubbles, type SessionBubbleStream, type SessionTouch } from './sessionBubbles.js';
import {
  SESSION_BUBBLE_MAP,
  fitTransform,
  layoutSessionBubbles,
  zoomAround,
  type PlacedBubble,
  type PlacedEdge,
} from './sessionBubbleLayout.js';

/**
 * §5.5 #17-50 [버블] — 대화 칸 자리에 서는 **이 세션만의 버블 지도**.
 *
 * 무엇이 버블이 되는지는 `sessionBubbles.ts`, 어디에 서는지는 `sessionBubbleLayout.ts` 가 정하고, 여기는 그리기와
 * 손짓만 한다. React Flow 를 쓰지 않는다 — IDE 창은 DOM 으로 캔버스의 자식이고 캔버스 판정이 `.react-flow` 를 보므로
 * (`isCanvasSurfaceTarget`), 여기서 React Flow 를 하나 더 띄우면 지도 위 우클릭·길게 누르기가 캔버스 만들기 메뉴로 샌다.
 *
 * 손짓은 캔버스와 같은 문법이다 — 누름 = 고르기(+ 정보 칸) · 더블클릭 = 첫 동작(파일 열기 · 폴더 들어가기 · 주소 열기 ·
 * 대화에서 보기) · 빈 곳 끌기 = 이동 · 휠/두 손가락 = 배율. 우클릭은 누름과 같다(대화 칸 우클릭 메뉴가 뜨지 않게 막는다).
 */

/** IDE 본문의 글자 배율 손짓(Ctrl+휠·두 손가락)이 지도 위에서는 물러나도록 붙이는 표식. */
export const SESSION_BUBBLES_ATTR = 'data-session-bubbles';

/** 이 이벤트가 지도 안에서 시작됐나 — IDE 본문의 capture 리스너가 지도 위 손짓을 가로채지 않게 묻는다. */
export function isInsideSessionBubbles(target: EventTarget | null): boolean {
  const el = target as { closest?: (s: string) => unknown } | null;
  return !!el && typeof el.closest === 'function' && !!el.closest(`[${SESSION_BUBBLES_ATTR}]`);
}

/** 배율 범위 · 휠 감도 · 누름과 끌기를 가르는 문턱(px). */
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 2.5;
const WHEEL_ZOOM_RATE = 0.0015;
const PINCH_WHEEL_ZOOM_RATE = 0.01;
const DRAG_THRESHOLD = 4;
/** 「복사됨」 표시가 머무는 시간(ms). */
const COPIED_MS = 1400;
/** 「그 밖 N곳」 정보 칸에 적는 이름 상한. */
const OVERFLOW_LIST_MAX = 20;

/** 읽기 선 색 — 테마 팔레트를 따르게 `currentColor` 로 그리고 그 색은 부모 글자색 클래스가 정한다. */
const READ_EDGE_CLASS = 'text-gray-500';

function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

function clampZoom(k: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
}

/** 버블 종류 → §2.2 색(채움 · 선). 명령 앱의 `bash` 본색은 어두운 바탕에 묻혀 한 톤 밝은 쪽을 쓴다. */
function paletteOf(b: PlacedBubble, centerColor: string): { fill: string; stroke: string } {
  switch (b.kind) {
    case 'center': return { fill: centerColor, stroke: centerColor };
    case 'folder': {
      const s = b.folder?.internal ? BUBBLE_STYLES.internal_folder : BUBBLE_STYLES.external_folder;
      return { fill: s.color, stroke: s.glow };
    }
    case 'file': return { fill: BUBBLE_STYLES.file.color, stroke: BUBBLE_STYLES.file.glow };
    case 'web': return { fill: BUBBLE_STYLES.domain.color, stroke: BUBBLE_STYLES.domain.glow };
    case 'app': return { fill: BUBBLE_STYLES.bash.glow, stroke: BUBBLE_STYLES.back.glow };
    case 'task': return { fill: BUBBLE_STYLES.agent.color, stroke: BUBBLE_STYLES.agent.glow };
    case 'more':
    case 'overflow': return { fill: BUBBLE_STYLES.ghost.color, stroke: BUBBLE_STYLES.ghost.glow };
  }
}

function touchOf(b: PlacedBubble): SessionTouch | null {
  return b.file ?? b.folder ?? b.web ?? b.app ?? b.task ?? null;
}

function lastSegment(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/** 버블 아래 이름(짧게) — 전체는 정보 칸과 `title`. */
function shortLabel(b: PlacedBubble, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (b.file) return b.file.name;
  if (b.folder) {
    if (b.folder.relPath === '') return lastSegment(b.folder.path);
    return lastSegment(b.folder.relPath ?? b.folder.path);
  }
  if (b.web) return b.web.kind === 'search' ? t('providers.webSearch') : (b.web.host ?? '');
  if (b.app) return b.app.name;
  if (b.task) return b.task.description;
  if (b.kind === 'more') return `+${b.hiddenCount ?? 0}`;
  if (b.kind === 'overflow') return t('ide.list.moreItems', { count: b.hiddenCount ?? 0 });
  return '';
}

/** 폴더 이름 아래 작은 줄 — 프로젝트 안이면 부모 상대 경로, 밖이면 부모 끝 마디. */
function folderSubLabel(b: PlacedBubble): string | null {
  const f = b.folder;
  if (!f) return null;
  const base = f.relPath ?? f.path;
  const parts = base.split('/').filter(Boolean);
  if (parts.length <= 1) return f.internal ? null : (f.path.split('/').filter(Boolean).slice(-2, -1)[0] ?? null);
  return parts.slice(0, -1).slice(-2).join('/');
}

/** 지도 배율·이동. `anim` = 저절로 맞춘 자리라 부드럽게 옮긴다(손으로 끈 자리는 손을 따라 즉시). */
interface Viewport { k: number; x: number; y: number; anim?: boolean }

export interface SessionBubbleViewProps {
  agentId: string;
  /** 칸의 세션 — 메인 탭이면 null(그 탭이 그리는 세션 전부). */
  sessionId: string | null;
  /** 이 칸의 재료 — 세션마다 스트림 + 명령. */
  streams: readonly SessionBubbleStream[];
  /** 앞선 기록을 더 받을 수 있는 세션들(처음까지 실리지 않은 것). 비면 [앞선 기록 더 불러오기]가 서지 않는다. */
  olderSessionIds: readonly string[];
  /** 가운데 원의 이름(세션 탭 이름 · 메인 탭이면 에이전트 이름). */
  title: string;
  /** 가운데 원의 색(에이전트 색). */
  color: string;
  /** 이 칸이 지금 도는가 — 상태바와 같은 판정(`useSessionRunning`). */
  running: boolean;
  /** 답을 기다리는 질문 수(§5.3 #12-2) — 대화 칸 안에만 서므로 지도 위에 알린다. */
  pendingAsks: number;
  /** 대화로 돌아가 그 턴의 프롬프트로 간다(`null` = 대화 맨 아래로). */
  onReturnToStream: (turnId: string | null) => void;
}

export const SessionBubbleView = memo(function SessionBubbleView({
  agentId, sessionId, streams, olderSessionIds, title, color, running, pendingAsks, onReturnToStream,
}: SessionBubbleViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const rootPath = useIDEProjectRoot();
  const { openEditorFile } = useIDEPaneActions();
  const platform = clientPathPlatform();
  const markerScope = useId().replace(/:/g, '');

  const model = useMemo(
    () => buildSessionBubbles({ streams, rootPath, platform }),
    [streams, rootPath, platform],
  );
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const layout = useMemo(() => layoutSessionBubbles(model, focusKey), [model, focusKey]);
  // 들어가 있던 폴더가 모델에서 사라졌으면(창 교체 등) 세션 지도로 돌아온다.
  useEffect(() => {
    if (focusKey && !layout.focus) setFocusKey(null);
  }, [focusKey, layout.focus]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const bubbleById = useMemo(() => new Map(layout.bubbles.map((b) => [b.id, b])), [layout.bubbles]);
  const selected = selectedId ? bubbleById.get(selectedId) ?? null : null;

  // ─── 화면 크기 · 배율 ───
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize((prev) => (prev && prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [view, setView] = useState<Viewport>({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  /** 사용자가 끌거나 배율을 바꿨나 — 그 뒤로는 버블이 늘어도 저절로 다시 맞추지 않는다(보던 자리를 뺏지 않게). */
  const userMovedRef = useRef(false);
  const lastFocusRef = useRef<string | null>(null);
  const { minX, minY, maxX, maxY } = layout.bounds;
  useEffect(() => {
    if (!size) return;
    // 들어가고 나올 때는 늘 다시 맞춘다 — 다른 판이다.
    if (lastFocusRef.current !== focusKey) {
      lastFocusRef.current = focusKey;
      userMovedRef.current = false;
    }
    if (userMovedRef.current) return;
    setView({ ...fitTransform({ minX, minY, maxX, maxY }, size), anim: true });
  }, [size, focusKey, minX, minY, maxX, maxY]);

  const fit = useCallback((): void => {
    if (!size) return;
    userMovedRef.current = false;
    setView({ ...fitTransform(layout.bounds, size), anim: true });
  }, [size, layout.bounds]);

  // ─── 손짓: 끌기 · 두 손가락 · 휠 ───
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<
    | { kind: 'pan'; start: Viewport; sx: number; sy: number; moved: boolean }
    | { kind: 'pinch'; start: Viewport; dist: number; mx: number; my: number; moved: boolean }
    | null
  >(null);
  /** 끌기로 끝난 누름은 클릭으로 치지 않는다(지도를 옮기려던 손이 버블을 고르지 않게). */
  const suppressClickRef = useRef(false);

  const localPoint = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
  }, []);

  const beginGesture = useCallback((): void => {
    const pts = [...pointersRef.current.values()];
    const start = viewRef.current;
    if (pts.length >= 2) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      gestureRef.current = {
        kind: 'pinch', start, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, moved: gestureRef.current?.moved ?? false,
      };
    } else if (pts.length === 1) {
      const p = pts[0]!;
      gestureRef.current = { kind: 'pan', start, sx: p.x, sy: p.y, moved: gestureRef.current?.moved ?? false };
    } else {
      gestureRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, localPoint(e.clientX, e.clientY));
      const g = gestureRef.current;
      if (!g) return;
      if (g.kind === 'pan') {
        const p = pointersRef.current.get(e.pointerId)!;
        const dx = p.x - g.sx;
        const dy = p.y - g.sy;
        if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        g.moved = true;
        userMovedRef.current = true;
        setView({ k: g.start.k, x: g.start.x + dx, y: g.start.y + dy });
        return;
      }
      const pts = [...pointersRef.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      g.moved = true;
      userMovedRef.current = true;
      const zoomed = zoomAround(g.start, clampZoom(g.start.k * (dist / g.dist)), g.mx, g.my);
      setView({ k: zoomed.k, x: zoomed.x + (mx - g.mx), y: zoomed.y + (my - g.my) });
    };
    const onUp = (e: PointerEvent): void => {
      if (!pointersRef.current.delete(e.pointerId)) return;
      const moved = gestureRef.current?.moved ?? false;
      if (pointersRef.current.size === 0) {
        gestureRef.current = null;
        if (moved) {
          suppressClickRef.current = true;
          window.setTimeout(() => { suppressClickRef.current = false; }, 0);
        }
        return;
      }
      // 두 손가락 중 하나를 뗐다 — 남은 손가락으로 이어서 끈다(그 자리에서 다시 잡는다).
      beginGesture();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [beginGesture, localPoint]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointersRef.current.set(e.pointerId, localPoint(e.clientX, e.clientY));
    if (pointersRef.current.size === 1 && gestureRef.current) gestureRef.current.moved = false;
    beginGesture();
  }, [beginGesture, localPoint]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      // 지도 위의 휠은 늘 지도 배율이다 — 대화 칸의 스크롤·글자 배율로 새지 않게 여기서 끝낸다.
      e.preventDefault();
      e.stopPropagation();
      const p = localPoint(e.clientX, e.clientY);
      const cur = viewRef.current;
      const rate = e.ctrlKey ? PINCH_WHEEL_ZOOM_RATE : WHEEL_ZOOM_RATE;
      userMovedRef.current = true;
      setView(zoomAround(cur, clampZoom(cur.k * Math.exp(-e.deltaY * rate)), p.x, p.y));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [localPoint]);

  // ─── 동작 ───
  const enterFolder = useCallback((key: string): void => {
    setFocusKey(key);
    setSelectedId(null);
  }, []);
  const leaveFolder = useCallback((): void => {
    const from = focusKey;
    setFocusKey(null);
    // 어디서 나왔는지 보이게 그 폴더를 고른 채로 돌아온다.
    setSelectedId(from ? `o:${from}` : null);
  }, [focusKey]);

  const openFile = useCallback((absPath: string): void => {
    openEditorFile(editorFileFromAbsPath(absPath, rootPath));
  }, [openEditorFile, rootPath]);

  const openWeb = useCallback((host: string, url: string): void => {
    openWebAddress(`${WEB_PAGE_TAB_PREFIX}${webNodeKey(host)}`, url, host);
  }, []);

  /** 더블클릭·Enter — 그 버블의 첫 동작. */
  const primaryAction = useCallback((b: PlacedBubble): void => {
    if (b.file) { openFile(b.file.path); return; }
    if (b.folder) {
      if (b.center) leaveFolder();
      else enterFolder(b.folder.key);
      return;
    }
    if (b.kind === 'more' && b.id.startsWith('m:')) {
      const key = b.id.slice(2);
      if (!layout.focus) enterFolder(key);
      return;
    }
    if (b.web) {
      if (b.web.kind === 'fetch' && b.web.host && b.web.lastUrl) openWeb(b.web.host, b.web.lastUrl);
      else onReturnToStream(b.web.turnId);
      return;
    }
    const touch = touchOf(b);
    if (touch) onReturnToStream(touch.turnId);
  }, [enterFolder, layout.focus, leaveFolder, onReturnToStream, openFile, openWeb]);

  const onBubbleClick = useCallback((e: React.MouseEvent, b: PlacedBubble): void => {
    e.stopPropagation();
    if (suppressClickRef.current) return;
    setSelectedId(b.id);
  }, []);
  const onBubbleDoubleClick = useCallback((e: React.MouseEvent, b: PlacedBubble): void => {
    e.stopPropagation();
    if (suppressClickRef.current) return;
    primaryAction(b);
  }, [primaryAction]);
  const onBubbleContextMenu = useCallback((e: React.MouseEvent, b: PlacedBubble): void => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(b.id);
  }, []);
  const onBubbleKeyDown = useCallback((e: React.KeyboardEvent, b: PlacedBubble): void => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); primaryAction(b); }
    else if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); setSelectedId(b.id); }
  }, [primaryAction]);

  const onBackgroundClick = useCallback((): void => {
    if (suppressClickRef.current) return;
    setSelectedId(null);
  }, []);
  const onBackgroundContextMenu = useCallback((e: React.MouseEvent): void => {
    // 대화 칸의 우클릭 메뉴(복사·메모·북마크)는 대화를 가리키는 메뉴라 지도 위에서는 열지 않는다.
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // ─── 앞선 기록 ───
  const [olderBusy, setOlderBusy] = useState(false);
  const loadOlder = useCallback((): void => {
    if (olderSessionIds.length === 0) return;
    setOlderBusy(true);
    let left = olderSessionIds.length;
    for (const sid of olderSessionIds) {
      requestOlderStreamHistory(agentId, sid, () => {
        left -= 1;
        if (left <= 0) setOlderBusy(false);
      });
    }
    // 이미 청했거나 쉬는 중이라 콜백이 오지 않는 세션이 있으면 단추가 굳지 않게 한 번 풀어 둔다.
    window.setTimeout(() => setOlderBusy(false), 4000);
  }, [agentId, olderSessionIds]);

  const loadedEvents = useMemo(() => streams.reduce((n, s) => n + s.events.length, 0), [streams]);

  // ─── 그리기 재료 ───
  const showFileLabels = view.k >= SESSION_BUBBLE_MAP.labelZoom;
  const connected = useMemo(() => {
    if (!selectedId) return null;
    // 가운데(이 세션)를 고르면 지도 전체가 그 세션의 것이다 — 아무것도 물리지 않는다.
    if (selectedId === 'center') return null;
    const ids = new Set<string>([selectedId]);
    for (const e of layout.edges) {
      if (e.from === selectedId || e.to === selectedId) { ids.add(e.from); ids.add(e.to); }
    }
    for (const b of layout.bubbles) if (b.parentId === selectedId) ids.add(b.id);
    const sel = bubbleById.get(selectedId);
    if (sel?.parentId) ids.add(sel.parentId);
    return ids;
  }, [selectedId, layout.edges, layout.bubbles, bubbleById]);

  const edgeColor = useCallback((e: PlacedEdge): string | null => {
    if (e.tone === 'read') return null; // 읽기 = 회색(currentColor)
    const target = bubbleById.get(e.target);
    return target ? paletteOf(target, color).stroke : BUBBLE_STYLES.file.glow;
  }, [bubbleById, color]);

  const markerColors = useMemo(() => {
    const set = new Set<string>();
    for (const e of layout.edges) { const c = edgeColor(e); if (c) set.add(c); }
    return [...set];
  }, [layout.edges, edgeColor]);
  const markerIdFor = (c: string | null): string => `sbm-${markerScope}-${c ? c.replace(/[^0-9a-z]/gi, '') : 'read'}`;

  const centerTitle = layout.focus
    ? (layout.focus.relPath === '' ? lastSegment(layout.focus.path) : (layout.focus.relPath ?? layout.focus.path))
    : title;

  return (
    <div
      ref={rootRef}
      {...{ [SESSION_BUBBLES_ATTR]: '' }}
      role="application"
      aria-label={t('ide.bubbles.mapLabel')}
      className="relative h-full min-h-0 w-full touch-none select-none overflow-hidden bg-gray-950"
      onPointerDown={onPointerDown}
      onClick={onBackgroundClick}
      onContextMenu={onBackgroundContextMenu}
    >
      {/* ── 세계(배율·이동이 얹히는 층) ── */}
      <div
        className={`absolute left-0 top-0 origin-top-left ${view.anim ? 'transition-transform duration-200 ease-out' : ''}`}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} aria-hidden="true">
          <defs>
            <marker id={markerIdFor(null)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 1 L9 5 L0 9 z" fill="currentColor" className={READ_EDGE_CLASS} />
            </marker>
            {markerColors.map((c) => (
              <marker key={c} id={markerIdFor(c)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 1 L9 5 L0 9 z" fill={c} />
              </marker>
            ))}
          </defs>
          {layout.edges.map((e) => {
            const a = bubbleById.get(e.from);
            const b = bubbleById.get(e.to);
            if (!a || !b) return null;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const x1 = a.x + ux * (a.r + 2);
            const y1 = a.y + uy * (a.r + 2);
            const x2 = b.x - ux * (b.r + 3);
            const y2 = b.y - uy * (b.r + 3);
            const c = edgeColor(e);
            const dim = connected !== null && !(connected.has(e.from) && connected.has(e.to));
            const base = e.satellite ? (c ? 0.55 : 0.35) : (c ? 0.85 : 0.5);
            const flowing = running && e.pending;
            return (
              <line
                key={e.id}
                x1={x1} y1={y1} x2={x2} y2={y2}
                className={`${c ? '' : READ_EDGE_CLASS} ${flowing ? 'session-bubble-flow' : ''}`}
                stroke={c ?? 'currentColor'}
                strokeWidth={e.satellite ? 1 : 1.6}
                strokeOpacity={dim ? base * 0.25 : base}
                strokeLinecap="round"
                markerEnd={e.satellite ? undefined : `url(#${markerIdFor(c)})`}
              />
            );
          })}
        </svg>

        {layout.bubbles.map((b) => (
          <SessionBubbleDot
            key={b.id}
            bubble={b}
            label={shortLabel(b, t)}
            subLabel={b.kind === 'folder' && !b.center ? folderSubLabel(b) : null}
            centerTitle={b.center ? centerTitle : null}
            palette={paletteOf(b, color)}
            selected={b.id === selectedId}
            dimmed={connected !== null && !connected.has(b.id)}
            showLabel={b.labelAlways || showFileLabels || (b.parentId !== undefined && (b.parentId === selectedId || connected?.has(b.parentId) === true))}
            pulsing={running && (b.kind === 'center' ? !layout.focus : touchOf(b)?.pending === true)}
            onClick={onBubbleClick}
            onDoubleClick={onBubbleDoubleClick}
            onContextMenu={onBubbleContextMenu}
            onKeyDown={onBubbleKeyDown}
          />
        ))}
      </div>

      {/* ── 위쪽 줄: 들어간 폴더 경로 · 답 대기 알림 · [맞추기] ── */}
      <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {layout.focus && (
            <div className="pointer-events-auto flex min-w-0 max-w-full items-center gap-1 rounded-md border border-gray-700/70 bg-gray-900/90 py-0.5 pl-0.5 pr-2 text-[12px] shadow-sm">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); leaveFolder(); }}
                className="flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
                {t('ide.context.scope.session')}
              </button>
              <span className="flex-shrink-0 text-gray-600">/</span>
              <span className="min-w-0 truncate text-gray-400" title={layout.focus.path}>{centerTitle}</span>
            </div>
          )}
          {pendingAsks > 0 && (
            <div className="pointer-events-auto flex min-w-0 max-w-full items-center gap-2 rounded-md border border-amber-400/60 bg-amber-950/90 px-2 py-1 text-[12px] text-amber-100 shadow-lg">
              <span className="relative flex h-2 w-2 flex-shrink-0" aria-hidden="true">
                <span className="session-bubble-pulse absolute inline-flex h-full w-full rounded-full bg-amber-400/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
              </span>
              <span className="min-w-0 truncate">{t('ide.bubbles.pendingAsk', { count: pendingAsks })}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onReturnToStream(null); }}
                className="flex-shrink-0 rounded border border-amber-300/50 px-1.5 py-0.5 font-semibold text-amber-50 transition-colors hover:bg-amber-500/20"
              >
                {t('ide.bubbles.goToConversation')}
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); fit(); }}
          title={t('canvas.controls.fitView')}
          aria-label={t('canvas.controls.fitView')}
          className="pointer-events-auto flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-gray-700/70 bg-gray-900/90 text-gray-400 shadow-sm transition-colors hover:bg-gray-800 hover:text-gray-100 pointer-coarse:h-9 pointer-coarse:w-9"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>
      </div>

      {/* ── 빈 상태 ── */}
      {model.empty && !layout.focus && (
        <div className="pointer-events-none absolute inset-x-4 bottom-12 z-10 text-center text-[12px] text-gray-500">
          {t('ide.bubbles.empty')}
        </div>
      )}

      {/* ── 정보 칸(고른 버블) ── */}
      {selected && (
        <SessionBubbleInfo
          bubble={selected}
          model={model}
          title={title}
          label={shortLabel(selected, t)}
          inFolder={layout.focus !== null}
          viaName={(() => {
            const touch = touchOf(selected);
            if (!touch || touch.direct || !touch.viaTaskKey) return null;
            return model.tasks.find((x) => x.key === touch.viaTaskKey)?.description ?? null;
          })()}
          onClose={() => setSelectedId(null)}
          onOpenFile={openFile}
          onEnter={enterFolder}
          onLeave={leaveFolder}
          onOpenWeb={openWeb}
          onReturnToStream={onReturnToStream}
        />
      )}

      {/* ── 바닥 줄: 몇 번의 호출로 지었나 · 앞선 기록 ── */}
      <div className="pointer-events-none absolute bottom-2 right-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[12px] text-gray-500">
        <span className="truncate">{t('ide.bubbles.summary', { calls: model.toolCalls, events: loadedEvents })}</span>
        {olderSessionIds.length > 0 && (
          <button
            type="button"
            disabled={olderBusy}
            onClick={(e) => { e.stopPropagation(); loadOlder(); }}
            title={t('ide.bubbles.loadOlderTip')}
            className="pointer-events-auto flex-shrink-0 rounded border border-gray-700/70 bg-gray-900/90 px-1.5 py-0.5 text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100 disabled:opacity-50"
          >
            {olderBusy ? t('ide.explorer.loading') : t('ide.bubbles.loadOlder')}
          </button>
        )}
      </div>
    </div>
  );
});

interface SessionBubbleDotProps {
  bubble: PlacedBubble;
  label: string;
  subLabel: string | null;
  centerTitle: string | null;
  palette: { fill: string; stroke: string };
  selected: boolean;
  dimmed: boolean;
  showLabel: boolean;
  pulsing: boolean;
  onClick: (e: React.MouseEvent, b: PlacedBubble) => void;
  onDoubleClick: (e: React.MouseEvent, b: PlacedBubble) => void;
  onContextMenu: (e: React.MouseEvent, b: PlacedBubble) => void;
  onKeyDown: (e: React.KeyboardEvent, b: PlacedBubble) => void;
}

/** 버블 하나 — 원(채움·테두리·글리프) + 아래 이름. 좌표는 세계 좌표 그대로(배율은 부모 층이 얹는다). */
const SessionBubbleDot = memo(function SessionBubbleDot({
  bubble: b, label, subLabel, centerTitle, palette, selected, dimmed, showLabel, pulsing,
  onClick, onDoubleClick, onContextMenu, onKeyDown,
}: SessionBubbleDotProps): React.JSX.Element {
  const size = b.r * 2;
  const wrote = (b.file?.writes ?? 0) > 0 || (b.folder !== undefined && b.folder.files.some((f) => f.writes > 0));
  const title = b.file?.path ?? b.folder?.path ?? b.web?.lastUrl ?? b.web?.host ?? b.app?.commands[0] ?? b.task?.description ?? centerTitle ?? label;
  const labelWidth = b.center ? 180 : b.kind === 'file' ? 112 : 140;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={centerTitle ?? label}
      aria-pressed={selected}
      title={title}
      onClick={(e) => onClick(e, b)}
      onDoubleClick={(e) => onDoubleClick(e, b)}
      onContextMenu={(e) => onContextMenu(e, b)}
      onKeyDown={(e) => onKeyDown(e, b)}
      className={`absolute cursor-pointer outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-blue-400 ${dimmed ? 'opacity-30' : 'opacity-100'}`}
      style={{ left: b.x - b.r, top: b.y - b.r, width: size, height: size, borderRadius: '9999px' }}
    >
      {pulsing && (
        <span
          aria-hidden="true"
          className="session-bubble-pulse pointer-events-none absolute inset-0 rounded-full"
          style={{ boxShadow: `0 0 0 2px ${palette.stroke}` }}
        />
      )}
      <span
        className="absolute inset-0 flex items-center justify-center rounded-full"
        style={{
          background: `linear-gradient(135deg, ${withAlpha(palette.stroke, '90')}, ${withAlpha(palette.fill, 'CC')})`,
          border: `${b.center ? 2 : 1.5}px solid ${withAlpha(palette.stroke, wrote ? 'FF' : 'AA')}`,
          boxShadow: selected
            ? '0 0 0 2px rgba(255,255,255,0.9)'
            : wrote && b.kind === 'file' ? `0 0 0 2px ${withAlpha(palette.stroke, '66')}` : undefined,
        }}
      >
        <BubbleGlyph bubble={b} />
      </span>
      {(showLabel || b.center) && (
        <span
          className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center text-center leading-tight"
          style={{ top: size + 4, width: labelWidth }}
        >
          <span className={`max-w-full truncate text-[12px] ${b.center ? 'font-semibold text-gray-100' : 'text-gray-200'}`}>
            {centerTitle ?? label}
          </span>
          {subLabel && <span className="max-w-full truncate text-[12px] text-gray-500">{subLabel}</span>}
        </span>
      )}
    </div>
  );
});

/** 버블 안 글리프 — 캔버스 버블과 같은 획(`BubbleIcon` · `FileFamilyGlyph` · `CommandAppIcon`). */
function BubbleGlyph({ bubble: b }: { bubble: PlacedBubble }): React.JSX.Element | null {
  const px = Math.max(10, Math.round(b.r * (b.kind === 'file' ? 1.05 : 0.9)));
  switch (b.kind) {
    case 'center': return <BubbleIcon icon={b.folder ? 'folder' : 'agent'} px={px} />;
    case 'folder': return <BubbleIcon icon="folder" px={px} />;
    case 'file': return b.file ? <FileFamilyGlyph family={fileFaceFamilyOf(b.file.path)} px={px} /> : null;
    case 'web': return <BubbleIcon icon="globe" px={px} />;
    case 'app': return <CommandAppIcon executable={b.app?.executable} px={px} />;
    case 'task': return <BubbleIcon icon="agent" px={px} />;
    case 'more':
    case 'overflow':
      return <span className="text-[12px] font-semibold text-white/90">{`+${b.hiddenCount ?? 0}`}</span>;
  }
}

interface SessionBubbleInfoProps {
  bubble: PlacedBubble;
  model: ReturnType<typeof buildSessionBubbles>;
  title: string;
  label: string;
  inFolder: boolean;
  viaName: string | null;
  onClose: () => void;
  onOpenFile: (absPath: string) => void;
  onEnter: (folderKey: string) => void;
  onLeave: () => void;
  onOpenWeb: (host: string, url: string) => void;
  onReturnToStream: (turnId: string | null) => void;
}

/** 고른 버블의 정보 칸 — 전체 경로·횟수·마지막으로 닿은 일 + 그 버블의 동작 단추. 터치에서도 누름 한 번으로 닿는다. */
function SessionBubbleInfo({
  bubble: b, model, title, label, inFolder, viaName, onClose, onOpenFile, onEnter, onLeave, onOpenWeb, onReturnToStream,
}: SessionBubbleInfoProps): React.JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => { /* 막히면 조용히 — 단추는 그대로 */ });
  };
  const touch = touchOf(b);
  const lines: React.ReactNode[] = [];
  const actions: Array<{ id: string; label: string; run: () => void; primary?: boolean }> = [];

  if (b.kind === 'center' && !b.folder) {
    lines.push(<span key="totals">{t('ide.bubbles.centerTotals', {
      files: model.fileCount, webs: model.webs.length, apps: model.apps.length, tasks: model.tasks.length,
    })}</span>);
    lines.push(<span key="rw">{`${t('ide.bubbles.reads', { count: model.readCount })} · ${t('ide.bubbles.writes', { count: model.writeCount })}`}</span>);
  }
  if (b.file) {
    lines.push(<span key="path" className="break-all text-gray-400">{b.file.path}</span>);
    actions.push({ id: 'open', label: t('ide.explorer.ctx.open'), run: () => onOpenFile(b.file!.path), primary: true });
    actions.push({ id: 'copy', label: copied ? t('ide.explorer.copied') : t('ide.explorer.copyPath'), run: () => copy(b.file!.path) });
  }
  if (b.folder) {
    lines.push(<span key="path" className="break-all text-gray-400">{b.folder.path}</span>);
    if (!b.folder.internal) lines.push(<span key="ext" className="text-gray-500">{t('ide.bubbles.external')}</span>);
    lines.push(<span key="files">{t('ide.bubbles.files', { count: b.folder.files.length })}{b.folder.searches > 0 ? ` · ${t('ide.bubbles.searches', { count: b.folder.searches })}` : ''}</span>);
    if (b.center || inFolder) actions.push({ id: 'leave', label: t('ide.bubbles.leave'), run: onLeave, primary: true });
    else actions.push({ id: 'enter', label: t('ide.bubbles.enter'), run: () => onEnter(b.folder!.key), primary: true });
    actions.push({ id: 'copy', label: copied ? t('ide.explorer.copied') : t('ide.explorer.copyPath'), run: () => copy(b.folder!.path) });
  }
  if (b.web) {
    if (b.web.kind === 'fetch' && b.web.lastUrl) {
      lines.push(<span key="url" className="break-all text-gray-400">{b.web.lastUrl}</span>);
      const host = b.web.host;
      const url = b.web.lastUrl;
      if (host) actions.push({ id: 'open', label: t('ide.bubbles.openAddress'), run: () => onOpenWeb(host, url), primary: true });
      actions.push({ id: 'copy', label: copied ? t('ide.explorer.copied') : t('ide.bubbles.copyAddress'), run: () => copy(url) });
    }
    if (b.web.kind === 'search' && b.web.queries.length > 0) {
      lines.push(<span key="qh" className="text-gray-500">{t('ide.bubbles.recentQueries')}</span>);
      b.web.queries.forEach((q, i) => lines.push(<span key={`q${String(i)}`} className="truncate text-gray-300">{q}</span>));
    }
  }
  if (b.app) {
    if (b.app.commands.length > 0) {
      lines.push(<span key="ch" className="text-gray-500">{t('ide.bubbles.recentCommands')}</span>);
      b.app.commands.forEach((c, i) => lines.push(<span key={`c${String(i)}`} className="truncate font-mono text-gray-300" title={c}>{c}</span>));
      const last = b.app.commands[0]!;
      actions.push({ id: 'copy', label: copied ? t('ide.explorer.copied') : t('ide.bubbles.copyCommand'), run: () => copy(last) });
    }
  }
  if (b.task) {
    if (b.task.agentType) lines.push(<span key="type" className="text-gray-400">{b.task.agentType}</span>);
    lines.push(<span key="state">{b.task.done ? t('canvas.agentCard.status.completed') : t('ide.loop.status.running')}</span>);
  }
  if (b.kind === 'more') {
    lines.push(<span key="more">{t('ide.bubbles.moreFiles', { count: b.hiddenCount ?? 0 })}</span>);
    if (!inFolder && b.id.startsWith('m:')) actions.push({ id: 'enter', label: t('ide.bubbles.enter'), run: () => onEnter(b.id.slice(2)), primary: true });
  }
  if (b.kind === 'overflow') {
    lines.push(<span key="hint" className="text-gray-500">{t('ide.bubbles.overflowHint')}</span>);
    const names = b.overflowNames ?? [];
    names.slice(0, OVERFLOW_LIST_MAX).forEach((n, i) => lines.push(<span key={`o${String(i)}`} className="truncate text-gray-300">{n}</span>));
    if (names.length > OVERFLOW_LIST_MAX) lines.push(<span key="o-more" className="text-gray-500">…</span>);
  }
  if (touch) {
    // 읽기·쓰기 횟수는 파일·폴더·웹 가져오기의 말이다 — 서브에이전트·명령 앱·웹 검색은 상태·명령·검색어 목록이 말한다.
    const countsTouches = b.file !== undefined || b.folder !== undefined || b.web?.kind === 'fetch';
    if (countsTouches) {
      lines.push(<span key="rwt">{[
        touch.reads > 0 ? t('ide.bubbles.reads', { count: touch.reads }) : null,
        touch.writes > 0 ? t('ide.bubbles.writes', { count: touch.writes }) : null,
      ].filter(Boolean).join(' · ')}</span>);
    }
    lines.push(<span key="last" className="text-gray-400">{t('ide.bubbles.lastTouch', { tool: touch.lastTool, when: formatSince(touch.lastAt, t) })}</span>);
    if (viaName) lines.push(<span key="via" className="text-gray-400">{t('ide.bubbles.viaTask', { name: viaName })}</span>);
    if (touch.turnId !== null || b.kind === 'task' || b.kind === 'app') {
      actions.push({ id: 'turn', label: t('ide.bubbles.showInConversation'), run: () => onReturnToStream(touch.turnId), primary: !actions.some((a) => a.primary) });
    }
  }

  const heading = b.kind === 'center' && !b.folder ? title : label;
  return (
    <div
      className="absolute bottom-9 left-2 z-20 flex max-h-[calc(100%-4.5rem)] w-[min(24rem,calc(100%-1rem))] flex-col gap-1.5 overflow-auto rounded-lg border border-gray-700/80 bg-gray-900/95 p-2.5 text-[12px] text-gray-200 shadow-xl shadow-black/40"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 break-words font-semibold text-gray-100">{heading}</span>
        <button
          type="button"
          onClick={onClose}
          title={t('common.close')}
          aria-label={t('common.close')}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200 pointer-coarse:h-8 pointer-coarse:w-8"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">{lines}</div>
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={a.run}
              className={`rounded border px-2 py-0.5 text-[12px] transition-colors pointer-coarse:py-1.5 ${
                a.primary
                  ? 'border-blue-400/70 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30'
                  : 'border-gray-600/70 text-gray-300 hover:bg-gray-800 hover:text-gray-100'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 이 칸의 스트림 묶음 — Sub 탭이면 그 세션 하나, 메인 탭이면 그 탭이 그리는 세션 전부(`IDEMainArea` 의 `streams` 와 같은 조립).
 * 명령은 세션별로 갈라 넣는다(턴 귀속이 세션 단위다).
 */
export function sessionBubbleStreamsOf(
  streams: Record<string, readonly SubAgentStreamEvent[]>,
  commands: readonly QueuedCommand[],
): SessionBubbleStream[] {
  return Object.entries(streams).map(([subId, events]) => ({
    events,
    commands: commands.filter((c) => c.subAgentId === subId),
  }));
}

/** 처음까지 실리지 않은 세션들 — 그 세션의 버퍼가 비어 있지 않고 끝 표식이 없다. */
export function useOlderSessionIds(sessionIds: readonly string[]): string[] {
  const key = useGraphStore((s) => sessionIds
    .filter((id) => (s.subAgentStreams[id]?.length ?? 0) > 0 && !s.streamHistoryDone[id])
    .join('\n'));
  return useMemo(() => (key ? key.split('\n') : []), [key]);
}

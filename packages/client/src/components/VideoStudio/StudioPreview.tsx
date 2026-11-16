import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { SAFE_AREAS, formatOfSize, type HitRect, type VideoDoc } from '@vibisual/video';

import { runEnterKey } from '../../hooks/useEnterSubmit.js';
import { useInspectorPicker } from '../../hooks/useInspectorPicker.js';
import { DARK_THEME_LOCK } from '../../theme/themeLock.js';
import { IME_ENTER_OWNER, isImeConsumedKey } from '../../utils/inputComposition.js';
import { previewInspectPicker, type PreviewInspect } from './previewInspect.js';
import { usePlayheadSampled, type PlayheadClock } from './playheadClock.js';
import { StudioIcon } from './studioIcons.js';
import { memoLatest } from './studioMemo.js';
import { clampSpan, noteEditorPlacement, type PreviewBounds } from './studioFit.js';
import { shortcutLabel } from '../../utils/platform.js';
import { handlePoints, movedEnough, screenToDoc, type Corner, type SnapLine } from './previewTransform.js';
import { actualFrame, fitFrame, panFrame, wheelFactor, zoomFrame, zoomPercent, type PreviewFrame } from './previewView.js';
import type { PreviewDragHandlers, PreviewHandles } from './usePreviewDrag.js';

/**
 * §5.13 (V) 37-1·37-6·37-7 — 큰 미리보기: 겹표시(안전 영역·테·핀·글자 칸)가 같은 문서 좌표다. 그림 자체는 셸이 그린다.
 * 무대는 테마와 무관하게 검어 이 칸만 `DARK_THEME_LOCK`.
 * 37-21 — 끌 수 있을 때(`drag`)는 손잡이 틀·안내선이 서고 판이 포인터 이벤트로 끌기를 받는다(마우스·터치·펜 한 길). 누르고 떼는 것은 종전 고르기 그대로.
 * 37-24 (F) — 휠은 포인터 자리를 축으로 키우고, 끌 것이 없는 곳을 끌거나 가운데 단추로 끌면 화면이 옮겨진다(`previewView.ts`).
 */
export interface PreviewRing { readonly id: string; readonly rect: HitRect; readonly tone: 'hover' | 'selected' | 'pointed' }
export interface PreviewPin { readonly id: string; readonly n: number; readonly x: number; readonly y: number; readonly status: string; readonly active?: boolean }
export interface PreviewEdit { readonly rect: HitRect; readonly value: string; readonly fontSize: number; readonly onCommit: (value: string) => void; readonly onCancel: () => void }

export interface StudioPreviewProps {
  readonly doc: VideoDoc;
  readonly mode: 'canvas' | 'stage';
  readonly canvasRef: RefObject<HTMLCanvasElement>;
  readonly stageHostRef: RefObject<HTMLDivElement>;
  /** `free` = 휠·끌기로 정한 자유 보기(37-24 (F) — 배율·자리는 이 칸의 화면 상태다). */
  readonly zoom: 'fit' | 'actual' | 'free';
  /** 휠·끌기로 자유 보기에 들어섰다 — 부르는 쪽이 `zoom` 을 `free` 로 바꾼다. 없으면 휠·화면 끌기는 쉰다. */
  readonly onFreeView?: () => void;
  readonly safeArea: boolean;
  readonly interaction: 'none' | 'point' | 'note';
  readonly rings: readonly PreviewRing[];
  readonly pins: readonly PreviewPin[];
  readonly edit: PreviewEdit | null;
  readonly onHover: (x: number, y: number) => void;
  readonly onLeave: () => void;
  readonly onPress: (x: number, y: number) => void;
  readonly onDoublePress: (x: number, y: number) => void;
  readonly onPin: (id: string) => void;
  readonly onDropFiles: (files: readonly File[]) => void;
  readonly empty: ReactNode | null;
  /** §5.13 (V) 37-7 — 방금 꽂은 메모 핀의 글 칸(화면 비율 자리). */
  readonly noteDraft: { readonly x: number; readonly y: number; readonly n: number } | null;
  readonly onNoteCommit: (text: string) => void;
  readonly onNoteCancel: () => void;
  /** §5.13 (X) 39-3 — 무대가 첫 그림을 세우기 전의 포스터(대표 프레임 — 샌드박스 문서 로딩 중엔 검은 칸이다). `ready` 면 흐려지며 걷힌다. */
  readonly poster?: string | null;
  readonly ready?: boolean;
  /**
   * §5.13 (Z) 41-5 ② — 재생 중 보여야 할 컴포지션이 아직 첫 그림을 못 냈다(처음 여는 장면 · 다시 연 장면). 그동안 그 시각 장면의
   * 대표 프레임(`posterAt` — 가벼운 판)을 깔았다가 첫 그림이 서면 같은 흐려짐으로 걷는다. 재생·소리는 멈추지 않는다.
   */
  readonly cold?: boolean;
  readonly posterAt?: (t: number) => string | null;
  /** §5.4 #15 (C) — Alt 인스펙터의 그림 안(문서 픽셀) 답. 없으면 프레임 전체가 집힌다(캔버스·무대라). */
  readonly inspect?: PreviewInspect;
  /**
   * §5.13 (Y) 40-5 — 재생 중에도 테·핀이 시각을 따라가게: 시계를 굵게 구독해(`usePlayheadSampled`) 그 시각의 테·핀을 묻는다(셸은
   * 재생 중 다시 그려지지 않는다). 주지 않으면 `rings`·`pins` 그대로.
   */
  readonly clock?: PlayheadClock;
  readonly playhead?: number;
  readonly overlaysAt?: (t: number) => { readonly rings: readonly PreviewRing[]; readonly pins: readonly PreviewPin[]; readonly handles?: PreviewHandles | null; readonly guides?: readonly SnapLine[] };
  /** §5.13 (V) 37-21 — 손잡이 틀·붙은 안내선(`overlaysAt` 을 주면 그 답이 먼저다). */
  readonly handles?: PreviewHandles | null;
  readonly guides?: readonly SnapLine[];
  /** §5.13 (V) 37-21 — 끌기 손짓. 없으면 끌 수 없다(재생 중 · 가리키기·메모 모드). */
  readonly drag?: PreviewDragHandlers | null;
  /** §5.13 (Y) 40-3 ⑤ — 문서 픽셀 → 화면 실제 픽셀 배율(맞춤 배율 × devicePixelRatio). 실사를 그 폭만큼만 풀어 옮긴다. */
  readonly onDisplayScale?: (scale: number) => void;
}

/** 손잡이의 방향 커서(돌린 아이템도 모서리 이름 그대로 — 대각선 둘 중 하나). */
const HANDLE_CURSOR: Readonly<Record<Corner, string>> = { nw: 'cursor-nwse-resize', se: 'cursor-nwse-resize', ne: 'cursor-nesw-resize', sw: 'cursor-nesw-resize' };

function useBox(ref: RefObject<HTMLDivElement>): { w: number; h: number } {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

/**
 * §5.13 (Y) 40-5 ③ — 값이 같으면 다시 그리지 않는다(손잡이는 늘 최신을 부른다 — `studioMemo.ts`). 겹표시(`overlaysAt`)는 렌더 중에
 * 불러 그리는 함수라 정체로 비교한다(고른 것·메모·가리킨 것이 바뀔 때만 새로 만들어진다).
 */
export const StudioPreview = memoLatest(function StudioPreview(p: StudioPreviewProps): React.JSX.Element {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  /** 조작 판(프레임과 같은 상자) — Alt 인스펙터가 판이 아니라 그 자리에 그려진 것을 집도록 공급자를 단다. */
  const layerRef = useRef<HTMLDivElement>(null);
  const box = useBox(boxRef);
  const W = p.doc.size.width;
  const H = p.doc.size.height;
  useInspectorPicker(layerRef, p.inspect ? previewInspectPicker(p.doc.size, p.inspect) : null);
  // 37-24 (F) — 자유 보기의 판(배율·자리). `zoom` 이 `free` 인 동안만 쓰고, 맞춤·100% 로 돌아가면 버린다.
  const [free, setFree] = useState<PreviewFrame | null>(null);
  const [panning, setPanning] = useState(false);
  useEffect(() => { if (p.zoom !== 'free') setFree(null); }, [p.zoom]);
  const fit = p.zoom === 'fit' || (p.zoom === 'free' && free === null);
  const frame: PreviewFrame = p.zoom === 'free' && free ? free : p.zoom === 'actual' ? actualFrame(box, p.doc.size) : fitFrame(box, p.doc.size);
  /** 판 크기(화면 px) — 맞춤이 아닌 보기에서 그림·무대 칸이 이 크기로 선다. */
  const shown = { left: 0, top: 0, width: W * frame.scale, height: H * frame.scale };
  const toDoc = (e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = frame.scale > 0 ? frame.scale : 1;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  };
  const px = (r: HitRect): React.CSSProperties => ({ left: r.x * frame.scale, top: r.y * frame.scale, width: r.width * frame.scale, height: r.height * frame.scale });
  const safe = SAFE_AREAS[formatOfSize(p.doc.size)];
  const cursor = p.interaction === 'point' ? 'cursor-crosshair' : p.interaction === 'note' ? 'cursor-copy' : 'cursor-default';
  const frameStyle: React.CSSProperties = { left: frame.left, top: frame.top, width: W * frame.scale, height: H * frame.scale };
  const sampledAt = usePlayheadSampled(p.overlaysAt ? p.clock : undefined, p.playhead ?? 0);
  const overlay = p.overlaysAt ? p.overlaysAt(sampledAt) : { rings: p.rings, pins: p.pins, handles: p.handles, guides: p.guides };
  // §5.13 (V) 37-21 — 끌기. 누른 자리에서 조금(마우스 4 · 터치·펜 10 화면 px) 움직여야 끌기이고, 그 안에서 떼면 종전 누르기(고르기)다.
  const drag = p.drag ?? null;
  const handles = drag ? overlay.handles ?? null : null;
  const press = useRef<{ pointer: number; type: string; x: number; y: number; active: boolean } | null>(null);
  /** 끌기·손잡이 누름 뒤에 따라오는 click 은 고르기가 아니다. */
  const swallowClick = useRef(false);
  /** 마지막 누름이 손잡이였나 — 손잡이를 두 번 눌러도 제자리 글자 칸은 열지 않는다. */
  const downOnHandle = useRef(false);
  const pointerDoc = (e: React.PointerEvent<HTMLElement>): { x: number; y: number } =>
    screenToDoc(e.clientX, e.clientY, (layerRef.current ?? e.currentTarget).getBoundingClientRect(), frame.scale);
  /** 붙든 포인터를 푼다 — 끌기가 어떻게 끝나든 손짓 훅이 한 번 부른다(37-21 (L) 정리 함수의 몫). */
  const releaseFor = (pointer: number): (() => void) => () => {
    const at = press.current;
    if (at?.pointer === pointer) {
      // 끌던 것이 끝났으면 뒤따르는 click 은 고르기가 아니다(다음 누름이 다시 정한다).
      if (at.active) swallowClick.current = true;
      press.current = null;
    }
    try { layerRef.current?.releasePointerCapture(pointer); } catch { /* 이미 풀렸다 */ }
  };
  const onDragDown = (e: React.PointerEvent<HTMLElement>, corner: Corner | null): void => {
    // 떼는 순간을 못 받아 남은 옛 끌기는 취소로 끝낸다.
    if (press.current) drag?.cancel();
    swallowClick.current = corner !== null;
    downOnHandle.current = corner !== null;
    press.current = null;
    // Alt 는 인스펙터(§5.4 #15)의 손짓이다.
    if (!drag || e.button !== 0 || !e.isPrimary || e.altKey) return;
    if (!drag.begin(pointerDoc(e), corner, frame.scale > 0 ? frame.scale : 1, releaseFor(e.pointerId))) return;
    press.current = { pointer: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, active: false };
    try { layerRef.current?.setPointerCapture(e.pointerId); } catch { /* 붙들지 못해도 판 안에서는 끌린다 */ }
  };
  const onDragMove = (e: React.PointerEvent<HTMLElement>): void => {
    const at = press.current;
    if (!at || at.pointer !== e.pointerId || !drag) return;
    // 주 버튼이 떼어진 채 온 움직임 — 떼는 순간을 놓쳤다(창 밖에서 뗌 등). 놓은 적이 없으니 취소다.
    if ((e.buttons & 1) === 0) { drag.cancel(); return; }
    if (!at.active) {
      if (!movedEnough(e.clientX - at.x, e.clientY - at.y, at.type)) return;
      at.active = true;
    }
    drag.move(pointerDoc(e), { keepAspect: e.shiftKey, free: e.ctrlKey || e.metaKey });
  };
  const onDragEnd = (e: React.PointerEvent<HTMLElement>, cancelled: boolean): void => {
    const at = press.current;
    if (!at || at.pointer !== e.pointerId) return;
    if (!drag) { releaseFor(at.pointer)(); return; }
    if (at.active && !cancelled) drag.end();
    else drag.cancel();
  };
  // 끄는 중 창이 초점을 잃거나 문서가 숨으면(Alt+Tab·탭 전환) 떼는 순간이 오지 않는다 — 취소. 판이 걷히거나 끌 수 없게 되어도 같다.
  //   `drag` 는 memoLatest 가 렌더마다 새 대리 객체로 넘기므로 정체가 아니라 "끌 수 있나"에 건다(끄는 중 다시 그려져도 취소되지 않게).
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const canDrag = drag !== null;
  useEffect(() => {
    if (!canDrag) return undefined;
    const stop = (): void => {
      const at = press.current;
      if (!at) return;
      // 끌 수 없게 된 뒤면 손짓 훅이 이미 되돌렸다 — 포인터만 푼다.
      if (dragRef.current) dragRef.current.cancel();
      else releaseFor(at.pointer)();
    };
    const win = typeof window === 'undefined' ? null : window;
    const page = typeof document === 'undefined' ? null : document;
    const onVisibility = (): void => { if (page?.visibilityState === 'hidden') stop(); };
    win?.addEventListener('blur', stop);
    page?.addEventListener('visibilitychange', onVisibility);
    return () => {
      win?.removeEventListener('blur', stop);
      page?.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 최신 손짓은 dragRef 로 읽는다
  }, [canDrag]);
  // ─── 37-24 (F) 자유 보기 — 휠 확대 · 화면 끌기 ───
  const canFree = p.onFreeView !== undefined;
  const view = useRef({ frame, box, size: p.doc.size, zoom: p.zoom, onFreeView: p.onFreeView });
  view.current = { frame, box, size: p.doc.size, zoom: p.zoom, onFreeView: p.onFreeView };
  const goFree = (next: PreviewFrame): void => {
    setFree(next);
    if (view.current.zoom !== 'free') view.current.onFreeView?.();
  };
  const goFreeRef = useRef(goFree);
  goFreeRef.current = goFree;
  // 휠의 기본 동작을 막아야 해 직접 단다(React 의 onWheel 은 passive 라 preventDefault 가 먹지 않는다).
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !canFree) return undefined;
    const onWheel = (e: WheelEvent): void => {
      const cur = view.current;
      // 글 칸 안의 스크롤 · 끄는 중의 휠은 받지 않는다(끌기는 시작할 때의 배율로 계산한다).
      if (!(cur.frame.scale > 0) || press.current || (e.target as Element | null)?.closest?.('textarea,[data-wheel-own]')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      goFreeRef.current(zoomFrame(cur.frame, e.clientX - r.left, e.clientY - r.top, wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), cur.size, cur.box));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [canFree]);
  /** 화면 끌기 — 문턱(37-21 과 같다)을 넘어야 끌기이고, 그 안에서 떼면 종전 누르기다. */
  const pan = useRef<{ pointer: number; type: string; held: number; x: number; y: number; from: PreviewFrame; active: boolean } | null>(null);
  const endPan = (): void => {
    const at = pan.current;
    if (!at) return;
    pan.current = null;
    // 끌던 것이 끝났으면 뒤따르는 click 은 고르기가 아니다.
    if (at.active) { swallowClick.current = true; setPanning(false); }
    try { boxRef.current?.releasePointerCapture(at.pointer); } catch { /* 이미 풀렸다 */ }
  };
  const onPanDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    endPan();
    if (!canFree || !(frame.scale > 0) || !e.isPrimary) return;
    if ((e.target as HTMLElement).closest('button,textarea,[data-drag-handle]')) return;
    // 가운데 단추는 늘 화면 끌기. 주 단추는 끌 것을 못 잡았을 때만(Alt 는 인스펙터 몫 — §5.4 #15).
    const middle = e.button === 1;
    if (!middle && (e.button !== 0 || e.altKey || press.current)) return;
    pan.current = { pointer: e.pointerId, type: e.pointerType, held: middle ? 4 : 1, x: e.clientX, y: e.clientY, from: frame, active: false };
  };
  const onPanMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const at = pan.current;
    if (!at || at.pointer !== e.pointerId) return;
    // 단추가 떼어진 채 온 움직임 — 떼는 순간을 놓쳤다.
    if ((e.buttons & at.held) === 0) { endPan(); return; }
    const dx = e.clientX - at.x;
    const dy = e.clientY - at.y;
    if (!at.active) {
      if (!movedEnough(dx, dy, at.type)) return;
      at.active = true;
      setPanning(true);
      try { boxRef.current?.setPointerCapture(e.pointerId); } catch { /* 붙들지 못해도 칸 안에서는 끌린다 */ }
    }
    goFree(panFrame(at.from, dx, dy, p.doc.size, box));
  };
  // 손잡이가 설 때만 계산한다 — 재생 중(굵은 구독이 이 판을 깨우는 동안)에는 아무것도 더하지 않는다.
  const handleAt = handles ? handlePoints(handles.box, handles.rotation, p.doc.size) : null;
  const handleHint = handles ? t('panel.videoStudio.preview.dragHint', {
    lock: shortcutLabel('Shift'), free: shortcutLabel('Ctrl'),
    nudge: ['Left', 'Right', 'Up', 'Down'].map((key) => shortcutLabel(`Ctrl+${key}`)).join(' '),
  }) : '';
  // §5.13 (Z) 41-5 ② — 첫 그림을 못 낸 장면 자리에는 그 시각 장면의 대표 프레임(재생 중에도 굵게만 따라간다).
  const coldAt = usePlayheadSampled(p.cold ? p.clock : undefined, p.playhead ?? 0);
  const standIn = p.ready === false ? p.poster ?? null : p.cold === true ? p.posterAt?.(coldAt) ?? p.poster ?? null : null;
  const showStandIn = p.ready === false || (p.cold === true && standIn !== null);
  /** 걷을 때 흐려지는 그림 = 마지막으로 깔았던 그 그림(다른 장면 그림으로 바뀌어 사라지지 않게). */
  const lastStandIn = useRef<string | null>(null);
  if (showStandIn && standIn) lastStandIn.current = standIn;
  const fadeSrc = lastStandIn.current ?? p.poster ?? null;
  const onDisplayScale = p.onDisplayScale;
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  useEffect(() => { if (frame.scale > 0) onDisplayScale?.(frame.scale * ratio); }, [frame.scale, ratio, onDisplayScale]);
  // 반응형 — 메모 글 칸을 미리보기 상자 안으로 맞출 기준. 폭은 이미 재고 있는 상자 크기(`useBox`)를 쓴다 — 새로 재지 않는다.
  const noteBounds: PreviewBounds | null = box.w > 0 && box.h > 0 ? { width: box.w, height: box.h, frameLeft: frame.left, frameTop: frame.top } : null;
  return (
    <div ref={boxRef} {...DARK_THEME_LOCK} className={`relative min-h-0 flex-1 touch-none overflow-hidden rounded-lg border border-white/10 bg-black ${panning ? 'cursor-grabbing' : ''}`}
      // 가운데 단추의 자동 스크롤 표식을 막는다(화면 끌기로 쓴다).
      onMouseDown={(e) => { if (e.button === 1 && canFree) e.preventDefault(); }}
      onPointerDown={onPanDown}
      onPointerMove={onPanMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onLostPointerCapture={endPan}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); p.onDropFiles(Array.from(e.dataTransfer.files)); }}>
      <div className="absolute" style={fit ? { inset: 0 } : { left: frame.left, top: frame.top, width: shown.width, height: shown.height }}>
        <canvas ref={p.canvasRef} width={W} height={H} aria-label={t('panel.videoStudio.preview.label')}
          className={p.mode === 'stage' ? 'hidden' : 'absolute'} style={fit ? frameStyle : shown} />
        {/* 컴포지션 문서의 DOM 무대가 서는 자리(무대가 자기 크기를 이 칸에 맞춰 줄인다). */}
        <div ref={p.stageHostRef} className={p.mode === 'stage' ? 'absolute inset-0 overflow-hidden' : 'hidden'} />
        {/* 39-3 — 그림이 서기 전의 포스터(없으면 은은한 숨쉬기). 그림이 서면 흐려지며 걷힌다 — 손짓은 그대로 아래로 지나간다.
            41-5 ② — 재생 중 첫 그림을 못 낸 장면도 같은 자리에 그 장면의 대표 프레임을 깔았다가 같은 흐려짐으로 걷는다. */}
        {showStandIn ? (standIn ? (
          <img src={standIn} alt="" aria-hidden="true" decoding="async" draggable={false}
            className="pointer-events-none absolute object-contain" style={fit ? frameStyle : shown} />
        ) : (
          <div aria-hidden="true" className="pointer-events-none absolute bg-white/[0.03] motion-safe:animate-pulse" style={fit ? frameStyle : shown} />
        )) : fadeSrc ? (
          <img src={fadeSrc} alt="" aria-hidden="true" decoding="async" draggable={false}
            className="pointer-events-none absolute animate-[vs-fade-out_200ms_ease-out] object-contain opacity-0" style={fit ? frameStyle : shown} />
        ) : null}
      </div>
      {/* 37-21 · 37-24 (F-2) — 끌 수 있으면 어느 보기에서나 `touch-none`(터치로 몸통을 끈다 — 스크롤하는 칸이 아니다). */}
      <div ref={layerRef} className={`absolute ${panning ? '' : cursor} ${drag ? 'touch-none' : ''} ${fit ? '' : 'outline outline-1 outline-white/15'}`} style={frameStyle}
        onMouseMove={(e) => { if (p.interaction !== 'none') { const d = toDoc(e); p.onHover(d.x, d.y); } }}
        onMouseLeave={p.onLeave}
        onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('button,textarea')) onDragDown(e, null); }}
        onPointerMove={onDragMove}
        onPointerUp={(e) => onDragEnd(e, false)}
        onPointerCancel={(e) => onDragEnd(e, true)}
        onLostPointerCapture={(e) => onDragEnd(e, true)}
        onClick={(e) => { if (swallowClick.current) { swallowClick.current = false; return; } const d = toDoc(e); p.onPress(d.x, d.y); }}
        onDoubleClick={(e) => { if (downOnHandle.current) return; const d = toDoc(e); p.onDoublePress(d.x, d.y); }}>
        {p.safeArea ? (
          <div className="pointer-events-none absolute border border-dashed border-amber-300/80"
            style={{ left: `${safe.left * 100}%`, top: `${safe.top * 100}%`, width: `${(safe.right - safe.left) * 100}%`, height: `${(safe.bottom - safe.top) * 100}%` }}
            aria-label={t('panel.videoStudio.preview.safeArea')} />
        ) : null}
        {overlay.rings.map((ring) => (
          <div key={ring.id} className={`pointer-events-none absolute rounded-sm ${ring.tone === 'hover' ? 'ring-1 ring-slate-200/70' : ring.tone === 'pointed' ? 'ring-2 ring-slate-100' : 'ring-1 ring-[var(--vs-accent)]'}`} style={px(ring.rect)} />
        ))}
        {handles ? (overlay.guides ?? []).map((line) => (
          <div key={`${line.axis}:${line.at}`} aria-hidden="true" data-snap-guide={line.kind}
            className={`pointer-events-none absolute bg-[var(--vs-accent)] ${line.axis === 'x' ? 'top-0 h-full w-px' : 'left-0 h-px w-full'}`}
            style={line.axis === 'x' ? { left: line.at * frame.scale } : { top: line.at * frame.scale }} />
        )) : null}
        {handles && handleAt ? (
          <>
            <div aria-hidden="true" data-drag-frame={handles.kind} className="pointer-events-none absolute ring-1 ring-[var(--vs-accent)]"
              style={handles.rotation !== 0 ? { ...px(handles.box), transform: `rotate(${handles.rotation}deg)` } : px(handles.box)} />
            {handles.corners.map((corner) => (
              <div key={corner} aria-hidden="true" data-drag-handle={corner} title={handleHint}
                onPointerDown={(e) => { e.stopPropagation(); onDragDown(e, corner); }}
                className={`absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center pointer-coarse:h-11 pointer-coarse:w-11 ${HANDLE_CURSOR[corner]}`}
                style={{ left: handleAt[corner].x * frame.scale, top: handleAt[corner].y * frame.scale }}>
                <span className="h-2.5 w-2.5 rounded-[2px] border border-white bg-[var(--vs-accent)] shadow shadow-black/60 pointer-coarse:h-4 pointer-coarse:w-4" />
              </div>
            ))}
          </>
        ) : null}
        {overlay.pins.map((pin) => (
          <button key={pin.id} type="button" onClick={(e) => { e.stopPropagation(); p.onPin(pin.id); }}
            title={t('panel.videoStudio.notes.pinTitle', { n: pin.n })}
            className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[12px] font-semibold tabular-nums shadow-md shadow-black/50 pointer-coarse:h-9 pointer-coarse:w-9 ${pin.status === 'fixed' ? 'border-slate-200 bg-vb-card text-slate-100' : 'border-white/80 bg-black/70 text-white'} ${pin.active ? 'ring-2 ring-[var(--vs-accent)]' : ''}`}
            style={{ left: pin.x * W * frame.scale, top: pin.y * H * frame.scale }}>
            {pin.status === 'fixed' ? <StudioIcon name="check" className="h-3.5 w-3.5" /> : pin.n}
          </button>
        ))}
        {p.edit ? <InlineEditor edit={p.edit} scale={frame.scale} frameW={W * frame.scale} frameH={H * frame.scale} /> : null}
        {p.noteDraft ? (
          <NoteEditor draft={p.noteDraft} left={p.noteDraft.x * W * frame.scale} top={p.noteDraft.y * H * frame.scale}
            flip={p.noteDraft.x > 0.6} bounds={noteBounds} onCommit={p.onNoteCommit} onCancel={p.onNoteCancel} />
        ) : null}
      </div>
      {p.empty ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 box-narrow:p-3">{p.empty}</div> : null}
      {/* 37-24 (F-2) — 맞춤이 아닌 보기: 보이는 것이 실제 렌더 크기의 몇 배인가. */}
      {!fit && frame.scale > 0 ? (
        <div data-preview-zoom="" className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[12px] tabular-nums text-slate-300">
          {W}×{H} · {zoomPercent(frame.scale)}
        </div>
      ) : null}
    </div>
  );
}, { fresh: ['overlaysAt', 'posterAt'] });

/** 방금 꽂은 핀 + 글 칸(Enter 로 꽂고, Esc·빈 글로 바깥을 누르면 거둔다). `bounds` 가 있으면 상자 밖으로 안 잘리게 맞추고(`noteEditorPlacement`), 높으면 안에서 스크롤. */
function NoteEditor({ draft, left, top, flip, bounds, onCommit, onCancel }: {
  readonly draft: { readonly n: number };
  readonly left: number;
  readonly top: number;
  readonly flip: boolean;
  readonly bounds: PreviewBounds | null;
  readonly onCommit: (text: string) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const place = bounds ? noteEditorPlacement(left, top, flip, bounds) : null;
  return (
    <div className="absolute" style={{ left, top }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <span className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-black/70 text-[12px] font-semibold tabular-nums text-white ring-2 ring-[var(--vs-accent)] pointer-coarse:h-9 pointer-coarse:w-9">{draft.n}</span>
      <div data-wheel-own="" className={`absolute animate-[vs-pop_140ms_ease-out] rounded-lg border border-white/15 bg-vb-raised p-2 shadow-xl shadow-black/60 ${place ? 'scrollbar-thin overflow-y-auto' : `top-3 w-64 ${flip ? 'right-3' : 'left-3'}`}`}
        style={place ? { left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight } : undefined}>
        <textarea
          {...IME_ENTER_OWNER}
          autoFocus
          rows={3}
          value={value}
          placeholder={t('panel.videoStudio.notes.placeholder')}
          aria-label={t('panel.videoStudio.notes.newNote', { n: draft.n })}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => { if (value.trim() === '') onCancel(); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            // §6 조합 입력 보호 — Enter 꽂기 · Shift+Enter 줄(한글 확정 Enter 도 한 번에). 판정은 runEnterKey 하나.
            if (runEnterKey(e, (live) => { if (live.trim() !== '') onCommit(live); })) return;
            if (isImeConsumedKey(e.nativeEvent)) return;
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          className="w-full resize-none rounded-md border border-white/10 bg-vb-sunken px-2 py-1.5 text-[12px] leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-[var(--vs-accent)]"
        />
        <div className="mt-1.5 flex justify-end gap-1.5">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onCancel} className="rounded-md px-2 py-1 text-[12px] text-slate-400 hover:bg-white/10 hover:text-slate-100 pointer-coarse:py-2">{t('common.cancel')}</button>
          <button type="button" disabled={value.trim() === ''} onMouseDown={(e) => e.preventDefault()} onClick={() => onCommit(value)}
            className="rounded-md border border-white/15 bg-white/10 px-2 py-1 text-[12px] font-semibold text-slate-50 hover:bg-white/15 disabled:opacity-40 pointer-coarse:py-2">{t('panel.videoStudio.notes.pin')}</button>
        </div>
      </div>
    </div>
  );
}

function InlineEditor({ edit, scale, frameW, frameH }: { readonly edit: PreviewEdit; readonly scale: number; readonly frameW: number; readonly frameH: number }): React.JSX.Element {
  const [value, setValue] = useState(edit.value);
  // 칸 하한(80×28)이 작은 배율의 글 자리보다 크면 판 밖으로 나가 잘린다 — 칸만 판 안으로 민다(글 자리·문서 좌표는 그대로).
  const width = Math.max(80, edit.rect.width * scale);
  const height = Math.max(28, edit.rect.height * scale);
  return (
    <textarea
      {...IME_ENTER_OWNER}
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => edit.onCommit(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        // §6 조합 입력 보호 — Enter 확정 · Shift+Enter 줄(한글 확정 Enter 도 한 번에). 판정은 runEnterKey 하나.
        if (runEnterKey(e, (live) => edit.onCommit(live))) return;
        if (isImeConsumedKey(e.nativeEvent)) return;
        if (e.key === 'Escape') { e.preventDefault(); edit.onCancel(); }
      }}
      className="absolute resize-none rounded-sm bg-black/70 p-1 text-center text-white outline-none ring-2 ring-[var(--vs-accent)]"
      style={{ left: clampSpan(edit.rect.x * scale, width, frameW), top: clampSpan(edit.rect.y * scale, height, frameH), width, height, fontSize: Math.max(12, edit.fontSize * scale) }}
    />
  );
}

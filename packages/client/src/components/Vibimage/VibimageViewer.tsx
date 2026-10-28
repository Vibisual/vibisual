import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IMAGE_VIEW, PREVIEW_POLICY, imageHeaderAnimated, imageHeaderOrientation, imageHeaderSize, orientedImageSize } from '@vibisual/shared';
import type { AppShellProps } from '../../apps/registry.js';
import { useAppVisible } from '../../apps/appWindowVisibility.js';
import { useInspectorPicker } from '../../hooks/useInspectorPicker.js';
import { WindowControls } from '../Layout/WindowControls.js';
import { fetchWorkspaceMediaBlob, mediaFileName } from '../../utils/workspaceMedia.js';
import { imageViewerLevels } from './imageInspect.js';
import { pinchSpan, pinchView, type PinchPoint, type PinchStart } from './imageViewerPinch.js';
import { planImageView, viewerFitScale } from './imageViewPlan.js';

/**
 * §5.13 (R-9) — Vibimage 그림 보기(높이는 호스트, §5.13 (S-7)). 바이트는 `workspaceMediaUrl` 을 `fetch` 로 — `<img src>` 는 패키지 앱(file://)에서 IPC 를 안 타 빈다.
 * 필요한 만큼만 풀고 안 보면 놓는다(판단은 `imageViewPlan.ts`): 흘려 받기(§5.13 40-1) · 창 크기 미리보기(`bitmaprenderer`) · 더 촘촘할 때만 원본
 * · 숨은 지 `IMAGE_VIEW.hiddenReleaseMs` 면 다 놓고(받는 중이면 끊는다) 다시 보이면 그 배율·자리로 다시 받는다. 움직이는 그림·SVG·머리 못 읽는 형식은 원본 그대로.
 */

/** 확대 한계와 한 번의 배율 — 이 셸 안에서만 쓰는 손맛 값이라 여기 한 곳에 둔다. */
const ZOOM_LIMITS = { min: 0.05, max: 16, step: 1.2 } as const;

type Backdrop = 'checker' | 'dark';

interface Natural {
  w: number;
  h: number;
}

/** 받은 그림 — 바이트와 그 머리에서 읽은 것. */
type Source =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | {
    readonly kind: 'ready';
    readonly blob: Blob;
    /** 미리보기 없이 원본 그대로 그린다(SVG · 움직이는 그림 · 머리를 못 읽는 형식). */
    readonly direct: boolean;
    /** 머리에서 읽은, EXIF 회전을 세운 뒤의 크기. 모르면 null(원본이 뜨면 안다). */
    readonly natural: Natural | null;
  };

/** 창에 맞춰 줄여 푼 임시 저화질 한 장. `bitmap` 은 캔버스에 넘기는 순간 비워진다(크기는 따로 들고 있다). */
interface Preview {
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
  /** 청한 너비 — 다시 풀지는 이것으로 판단한다(브라우저가 회전을 어떻게 세든 같은 답). */
  readonly requested: number;
}

/** 풀린 미리보기가 머리에서 읽은 크기와 같은 가로·세로 비인가(반올림 몇 픽셀은 같다고 본다). 머리를 모르면 그렇다고 본다. */
function sameAspect(bitmap: { readonly width: number; readonly height: number }, natural: Natural | null): boolean {
  if (!natural || !(bitmap.width > 0) || !(bitmap.height > 0)) return natural === null;
  const expectedHeight = (bitmap.width * natural.h) / natural.w;
  return Math.abs(bitmap.height - expectedHeight) <= Math.max(2, expectedHeight * 0.02);
}

/** 받은 바이트의 머리만 본다 — 세운 뒤의 크기와, 원본 그대로 그려야 하는지. */
async function probeImage(blob: Blob): Promise<{ direct: boolean; natural: Natural | null }> {
  if (blob.type === 'image/svg+xml') return { direct: true, natural: null };
  try {
    const head = new Uint8Array(await blob.slice(0, PREVIEW_POLICY.headerBytes).arrayBuffer());
    const raw = imageHeaderSize(head);
    if (!raw) return { direct: true, natural: null };
    const size = orientedImageSize(raw, imageHeaderOrientation(head));
    return { direct: imageHeaderAnimated(head), natural: { w: size.width, h: size.height } };
  } catch {
    return { direct: true, natural: null };
  }
}

function ToolButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`rounded px-2 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 pointer-coarse:py-2 ${
        active ? 'bg-amber-200/20 text-amber-100' : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.12]'
      }`}
    >
      {children}
    </button>
  );
}

function clampZoom(z: number): number {
  return Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, z));
}

/** 무대에 닿은 처음 두 포인터의 거리·가운데(무대 상자 기준 px)와 무대 크기 — 둘이 안 되면 null. */
function fingerPair(
  pointers: ReadonlyMap<number, PinchPoint>, el: HTMLElement,
): { distance: number; mid: PinchPoint; box: { w: number; h: number } } | null {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return null;
  const rect = el.getBoundingClientRect();
  return { ...pinchSpan({ x: a.x - rect.left, y: a.y - rect.top }, { x: b.x - rect.left, y: b.y - rect.top }), box: { w: rect.width, h: rect.height } };
}

/**
 * §5.13 (R-10) — `onEdit` makes an editable source from this picture. The viewer itself never writes anything; the
 * editor stores the source (and the picture as a blob under `.vibisual`) only when it is saved.
 */
export function VibimageViewer({ params, onEdit }: AppShellProps & { onEdit?: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const root = params['projectId'] ?? '';
  const file = params['file'] ?? '';
  const hosted = !!params['appWindowId'] || params['appWindowHosted'] === '1';

  const stageRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [natural, setNatural] = useState<Natural | null>(null);

  // ④ 안 보면 내려놓는다 — 숨은 지 조금 지나야 놓는다(탭을 잠깐 오갈 때마다 다시 받지 않게). 처음부터 숨어 있으면 받지 않는다.
  const visible = useAppVisible();
  const [active, setActive] = useState(visible);
  useEffect(() => {
    if (visible) {
      setActive(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setActive(false), IMAGE_VIEW.hiddenReleaseMs);
    return () => window.clearTimeout(timer);
  }, [visible]);

  // ① 그림을 흘려 받는다 — 다른 그림이 오거나 내려놓거나 창을 닫으면 받던 것을 끊는다(파일 손잡이도 닫힌다).
  const [source, setSource] = useState<Source>({ kind: 'idle' });
  useEffect(() => {
    if (!root || !file || !active) {
      setSource({ kind: 'idle' });
      return undefined;
    }
    const ctrl = new AbortController();
    setSource({ kind: 'loading' });
    void (async () => {
      const blob = await fetchWorkspaceMediaBlob(root, file, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (!blob || blob.size === 0) {
        setSource({ kind: 'failed' });
        return;
      }
      const probe = await probeImage(blob);
      if (!ctrl.signal.aborted) setSource({ kind: 'ready', blob, ...probe });
    })();
    return () => ctrl.abort();
  }, [root, file, active]);
  const ready = source.kind === 'ready' ? source : null;

  const [stage, setStage] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  /** null = 맞춤(창이 바뀌면 다시 맞춘다). 숫자 = 사용자가 고른 배율. */
  const [zoom, setZoom] = useState<number | null>(null);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [backdrop, setBackdrop] = useState<Backdrop>('checker');
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  /** 무대에 닿아 있는 포인터(clientX/Y) — 둘이면 핀치, 하나면 끌기. */
  const pointersRef = useRef(new Map<number, PinchPoint>());
  /** 진행 중인 두 손가락 핀치의 시작 상태(`imageViewerPinch.ts`). */
  const pinchRef = useRef<PinchStart | null>(null);

  // 다른 그림을 받으면 처음부터 — 옛 그림의 배율·자리를 새 그림에 씌우지 않는다(내려놓았다 다시 받을 때는 그대로 둔다).
  useEffect(() => {
    setNatural(null);
    setZoom(null);
    setOffset({ x: 0, y: 0 });
  }, [root, file]);

  // 머리에서 읽은 크기 — 원본을 풀지 않고도 배율·자리·픽셀 크기를 안다.
  useEffect(() => {
    if (source.kind === 'ready' && source.natural) setNatural(source.natural);
  }, [source]);

  // 미리보기·원본 붙들기·실패는 **받은 그 그림의 것**이다 — 다른 그림이 오거나 내려놓은 그 렌더부터 앞 그림의 것은 없는 셈이다
  //   (한 프레임이라도 앞 그림의 "원본 붙들기"가 새 그림에 씌워지면 새 그림의 원본을 풀기 시작한다).
  const [previewState, setPreviewState] = useState<(Preview & { readonly source: Source }) | null>(null);
  const [previewFailedFor, setPreviewFailedFor] = useState<Source | null>(null);
  const [heldFor, setHeldFor] = useState<Source | null>(null);
  const [displayFailedFor, setDisplayFailedFor] = useState<Source | null>(null);
  const [fullReady, setFullReady] = useState(false);
  const preview = ready !== null && previewState?.source === ready ? previewState : null;
  const previewFailed = ready !== null && previewFailedFor === ready;
  const holdFull = ready !== null && heldFor === ready;
  const displayFailed = ready !== null && displayFailedFor === ready;
  // 앞 그림을 가리키던 것은 바로 놓는다(그 바이트를 붙들고 있지 않게).
  useEffect(() => {
    setPreviewState((p) => (p && p.source !== source ? null : p));
    setPreviewFailedFor((s) => (s === source ? s : null));
    setHeldFor((s) => (s === source ? s : null));
    setDisplayFailedFor((s) => (s === source ? s : null));
  }, [source]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = (): void => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 맞춤 배율 — 창보다 크면 줄이고, 작으면 그대로(작은 아이콘을 흐리게 키우지 않는다).
  const fitScale = natural ? viewerFitScale({ width: natural.w, height: natural.h }, { width: stage.w, height: stage.h }) : 1;
  const scale = zoom ?? Math.max(ZOOM_LIMITS.min, fitScale);
  /** 지금 보이는 배율·자리 — 손짓 처리기는 렌더를 기다리지 않고 이 최신 값에서 이어 간다(손가락을 바꿔 쥘 때 그림이 튀지 않게). */
  const viewRef = useRef({ scale, offset });
  viewRef.current = { scale, offset };

  // ②③ 무엇을 얼마나 풀어 둘지 — **보이는 동안만** 판단한다. 숨은 창은 무대가 0×0 으로 재여 맞춤 배율이 1 로 읽히므로, 그때
  //   판단하면 내려놓기 전 몇 초 사이에 원본을 풀게 된다. 무대를 아직 못 쟀으면(막 열림) 화면 크기로 본다.
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  const planStage = stage.w > 0 && stage.h > 0
    ? { width: stage.w, height: stage.h }
    : { width: typeof window === 'undefined' ? 0 : window.screen.availWidth, height: typeof window === 'undefined' ? 0 : window.screen.availHeight };
  const plan = visible && ready && !ready.direct && !previewFailed && natural
    ? planImageView({
      natural: { width: natural.w, height: natural.h },
      stage: planStage,
      devicePixelRatio: dpr,
      scale,
      previewRequested: preview?.requested ?? 0,
      previewWidth: preview?.width ?? 0,
      holdingFull: holdFull,
    })
    : null;
  const direct = ready !== null && (ready.direct || previewFailed || natural === null || plan?.direct === true);
  // 원본 그대로 그리는 그림(SVG · 움직이는 그림)은 숨어도 내려놓을 때까지 그대로 둔다 — 미리보기 그림은 숨으면 원본부터 놓는다.
  const wantFull = ready !== null && (direct || plan?.full === true);
  const previewTarget = plan && !plan.direct ? plan.previewWidth : 0;
  const previewRequested = preview?.requested ?? 0;

  // ② 창에 맞는 크기로만 줄여 푼다 — 처음은 바로, 창이 커져 다시 풀 때는 끄는 동안 매 프레임 풀지 않게 조금 기다린다.
  useEffect(() => {
    if (!ready || previewTarget <= 0 || previewTarget <= previewRequested) return undefined;
    const owner = ready;
    const { blob, natural: expected } = owner;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      createImageBitmap(blob, { resizeWidth: previewTarget, resizeQuality: 'high', imageOrientation: 'from-image' }).then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        // 세운 방향이 머리와 다르게 나오면(가로·세로 비가 어긋남) 찌그러뜨려 깔지 않고 원본 그대로 보기로 물러선다.
        if (!sameAspect(bitmap, expected)) {
          bitmap.close();
          setPreviewFailedFor(owner);
          return;
        }
        setPreviewState({ source: owner, bitmap, width: bitmap.width, height: bitmap.height, requested: previewTarget });
      }, () => {
        if (!cancelled) setPreviewFailedFor(owner);
      });
    }, previewRequested > 0 ? IMAGE_VIEW.regrowDebounceMs : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ready, previewTarget, previewRequested]);

  // 미리보기를 캔버스에 넘긴다 — `bitmaprenderer` 는 복사 없이 그 비트맵을 쥐고, 다음 것이 오면 앞의 것을 놓는다.
  useLayoutEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!preview || !canvas) return;
    canvas.width = preview.width;
    canvas.height = preview.height;
    const ctx = canvas.getContext('bitmaprenderer');
    if (ctx) {
      ctx.transferFromImageBitmap(preview.bitmap);
      return;
    }
    canvas.getContext('2d')?.drawImage(preview.bitmap, 0, 0);
    preview.bitmap.close();
  }, [preview]);

  // ③ 원본을 붙들지 — 필요해지면 바로, 미리보기로 충분해지면 조금 뒤에 놓는다(확대·축소를 오가며 다시 풀지 않게).
  useEffect(() => {
    if (wantFull && ready) {
      setHeldFor(ready);
      return undefined;
    }
    if (!holdFull) return undefined;
    const timer = window.setTimeout(() => setHeldFor(null), IMAGE_VIEW.fullReleaseDelayMs);
    return () => window.clearTimeout(timer);
  }, [wantFull, holdFull, ready]);

  // 원본의 blob URL — 붙드는 동안만 있고, 놓거나 다른 그림이 오거나 창을 닫으면 되돌린다.
  const fullBlob = ready && holdFull ? ready.blob : null;
  const [fullUrl, setFullUrl] = useState('');
  useEffect(() => {
    setFullReady(false);
    if (!fullBlob) {
      setFullUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(fullBlob);
    setFullUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [fullBlob]);

  // 원본만으로 그리게 된 뒤(창이 커져 원본이 곧 맞춤 크기가 됐다)에는 미리보기를 놓는다.
  useEffect(() => {
    if (direct && fullReady && preview) setPreviewState(null);
  }, [direct, fullReady, preview]);

  const failed = source.kind === 'failed' || displayFailed;

  const zoomBy = useCallback((factor: number): void => {
    setZoom((z) => clampZoom((z ?? Math.max(ZOOM_LIMITS.min, fitScale)) * factor));
  }, [fitScale]);

  // 무대는 스크롤하지 않는 상자라 기본 동작을 막을 일이 없다(React 의 휠 리스너는 passive 다).
  const onWheel = useCallback((e: React.WheelEvent): void => {
    if (!natural) return;
    zoomBy(e.deltaY < 0 ? ZOOM_LIMITS.step : 1 / ZOOM_LIMITS.step);
  }, [natural, zoomBy]);

  // 한 손 끌기·휠은 종전 그대로이고, 손가락이 둘 닿은 동안만 핀치가 배율과 자리를 함께 정한다(폰에는 휠이 없다).
  const onPointerDown = useCallback((e: React.PointerEvent): void => {
    if (!natural || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pair = pointersRef.current.size >= 2 ? fingerPair(pointersRef.current, e.currentTarget as HTMLElement) : null;
    if (pair) {
      dragRef.current = null;
      pinchRef.current = { distance: pair.distance, mid: pair.mid, scale: viewRef.current.scale, offset: viewRef.current.offset };
      return;
    }
    dragRef.current = { x: e.clientX, y: e.clientY, ox: viewRef.current.offset.x, oy: viewRef.current.offset.y };
  }, [natural]);

  const onPointerMove = useCallback((e: React.PointerEvent): void => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pinch = pinchRef.current;
    if (pinch) {
      const pair = fingerPair(pointersRef.current, e.currentTarget as HTMLElement);
      if (!pair) return;
      const next = pinchView(pinch, pair.distance, pair.mid, pair.box, ZOOM_LIMITS);
      viewRef.current = next;
      setZoom(next.scale);
      setOffset(next.offset);
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const next = { x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) };
    viewRef.current = { ...viewRef.current, offset: next };
    setOffset(next);
  }, []);

  const endDrag = useCallback((e: React.PointerEvent): void => {
    pointersRef.current.delete(e.pointerId);
    if (pinchRef.current && pointersRef.current.size < 2) {
      pinchRef.current = null;
      // 한 손가락이 남으면 그 자리에서 끌기로 이어 간다 — 떼는 순간 그림이 손가락을 따라 튀지 않게.
      const rest = [...pointersRef.current.values()][0];
      dragRef.current = rest ? { x: rest.x, y: rest.y, ox: viewRef.current.offset.x, oy: viewRef.current.offset.y } : null;
      return;
    }
    if (pointersRef.current.size === 0) dragRef.current = null;
  }, []);

  const fit = useCallback((): void => { setZoom(null); setOffset({ x: 0, y: 0 }); }, []);
  const actual = useCallback((): void => { setZoom(1); setOffset({ x: 0, y: 0 }); }, []);

  const name = file ? mediaFileName(file) : '';
  const percent = Math.round(scale * 100);
  const transform = `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`;

  // §5.4 #15 (C) — 그림은 손짓을 받지 않아(`pointer-events-none`) 브라우저는 무대를 집는다. 무대가 그림 자리와 픽셀을 답한다.
  useInspectorPicker(stageRef, natural ? (at) => imageViewerLevels({
    stageWidth: stage.w, stageHeight: stage.h, naturalWidth: natural.w, naturalHeight: natural.h, scale, offsetX: offset.x, offsetY: offset.y,
  }, { projectId: root, path: file, name }, at) : null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-950 text-gray-100">
      <header className={`${hosted ? '' : 'app-drag '}flex h-11 shrink-0 items-center gap-3 border-b border-white/10 px-3`}>
        <span className={`${hosted ? '' : 'app-drag-label '}shrink-0 text-sm font-semibold`}>Vibimage</span>
        <span className={`${hosted ? '' : 'app-drag-label '}min-w-0 truncate text-[12px] text-gray-400`} title={file || undefined}>
          {name}
          {natural ? ` · ${natural.w}×${natural.h}` : ''}
        </span>
        {!hosted && <div className="app-nodrag ml-auto"><WindowControls /></div>}
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2">
        <ToolButton disabled={!natural} active={zoom === null} onClick={fit}>{t('panel.apps.vibimage.fit')}</ToolButton>
        <ToolButton disabled={!natural} active={zoom === 1} onClick={actual}>{t('panel.apps.vibimage.actualSize')}</ToolButton>
        <ToolButton disabled={!natural} onClick={() => zoomBy(1 / ZOOM_LIMITS.step)} title={t('panel.apps.vibimage.zoomOut')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </ToolButton>
        <span className="min-w-[3.5rem] text-center text-[12px] tabular-nums text-gray-400">{natural ? `${percent}%` : ''}</span>
        <ToolButton disabled={!natural} onClick={() => zoomBy(ZOOM_LIMITS.step)} title={t('panel.apps.vibimage.zoomIn')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M5 12h14M12 5v14" />
          </svg>
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <ToolButton active={backdrop === 'checker'} onClick={() => setBackdrop(backdrop === 'checker' ? 'dark' : 'checker')}>
          {t('panel.apps.vibimage.transparency')}
        </ToolButton>
        {onEdit && file && !failed && (
          <>
            <span className="mx-1 h-4 w-px bg-white/10" />
            <ToolButton onClick={onEdit}>{t('panel.fileEdit.edit')}</ToolButton>
          </>
        )}
      </div>

      <div
        ref={stageRef}
        className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${
          backdrop === 'checker'
            ? 'bg-[conic-gradient(#26262b_25%,#1b1b1f_0_50%,#26262b_0_75%,#1b1b1f_0)] bg-[length:16px_16px]'
            : 'bg-gray-950'
        } ${natural ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={fit}
        aria-label={t('panel.apps.vibimage.viewport')}
      >
        {/* ② 임시 저화질 — 그림의 원본 크기(CSS px)로 깔고 원본과 같은 변환을 건다(원본이 뜨면 그 아래에 그대로 있다). */}
        {preview && natural && !failed && (
          <canvas
            ref={previewCanvasRef}
            role="img"
            aria-label={name}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none origin-center"
            style={{ width: `${natural.w}px`, height: `${natural.h}px`, transform }}
          />
        )}

        {/* ③ 원본 — 붙드는 동안만 있다. 다 풀리기 전에는 보이지 않는다(밑의 미리보기가 그대로 보인다). */}
        {fullUrl && !failed && (
          <img
            key={fullUrl}
            src={fullUrl}
            alt={name}
            draggable={false}
            decoding="async"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0) {
                const next = { w: img.naturalWidth, h: img.naturalHeight };
                setNatural((n) => (n && n.w === next.w && n.h === next.h ? n : next));
              }
              setFullReady(true);
            }}
            onError={() => {
              // 미리보기가 있으면 그것으로 계속 본다 — 원본을 못 풀었다고 보던 그림을 지우지 않는다.
              if (!preview && ready) setDisplayFailedFor(ready);
            }}
            className={`pointer-events-none absolute left-1/2 top-1/2 max-w-none origin-center ${fullReady && natural ? '' : 'opacity-0'}`}
            style={{
              transform,
              imageRendering: scale >= 3 ? 'pixelated' : 'auto',
            }}
          />
        )}

        {/* 낮은 창에서 안내 카드가 무대보다 크면 위가 잘리지 않게 — 가운데 맞춤은 m-auto 로(넘치면 위부터) 하고 이 칸이 스크롤한다. */}
        {(!file || failed) && (
          <div className="absolute inset-0 flex overflow-auto p-6 box-narrow:p-3">
            <div className="m-auto max-w-sm rounded-lg border border-white/10 bg-gray-900/95 p-5 text-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 h-6 w-6 text-amber-200/70" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
              </svg>
              <p className="mb-2 text-sm font-medium">
                {failed ? t('panel.apps.vibimage.loadFailed') : t('panel.apps.vibimage.empty')}
              </p>
              {/* 못 읽은 그림의 경로는 끊을 자리가 없는 긴 낱말이다 — 넘칠 때만 아무 데서나 끊는다(안내 문장은 낱말 그대로). */}
              <p className="text-[12px] leading-relaxed text-gray-400 wrap-anywhere">
                {failed ? (file || '') : t('panel.apps.vibimage.emptyHint')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

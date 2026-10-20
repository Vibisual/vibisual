import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppShellProps } from '../../apps/registry.js';
import { useInspectorPicker } from '../../hooks/useInspectorPicker.js';
import { WindowControls } from '../Layout/WindowControls.js';
import { fetchWorkspaceMediaBlob, mediaFileName } from '../../utils/workspaceMedia.js';
import { imageViewerLevels } from './imageInspect.js';
import { pinchSpan, pinchView, type PinchPoint, type PinchStart } from './imageViewerPinch.js';

/**
 * §5.13 (R-9) — **Vibimage.** 캔버스 참조 노드(§5.4 #36)에 담긴 그림 한 장을 본다.
 *
 * 바이트는 영상·소리·3D 와 같은 창구(`workspaceMediaUrl`)를 **`fetch` 로** 읽어 blob URL 로 그린다 — 앱마다 쿼리를
 * 조립하면 서버 가드가 바뀔 때 앱 수만큼 고치게 되고, 그 주소를 `<img src>` 에 바로 걸면 패키지 앱(file://)에서
 * IPC 를 타지 않아 빈 화면이 된다(첫 판이 그랬다 — §5.4 #36 (F)). 그림 표시는 브라우저 `<img>` 하나라 새로 들여온
 * 제3자 코드가 없다.
 *
 * 높이는 호스트가 준다(§5.13 (S-7)) — 셸은 `h-full` 이다.
 */

/** 확대 한계와 한 번의 배율 — 이 셸 안에서만 쓰는 손맛 값이라 여기 한 곳에 둔다. */
const ZOOM_LIMITS = { min: 0.05, max: 16, step: 1.2 } as const;

type Backdrop = 'checker' | 'dark';

interface Natural {
  w: number;
  h: number;
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
  /** 받아 둔 그림의 blob URL. 받는 중이면 ''(빈 화면 문구는 `!file` 일 때만 — 받는 중에 "없음"이라 말하지 않는다). */
  const [src, setSrc] = useState('');

  const stageRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<Natural | null>(null);
  const [failed, setFailed] = useState(false);

  // 그림을 fetch 로 받아 이 문서의 blob URL 로 — 다른 그림이 오거나 창을 닫으면 앞의 것을 되돌린다.
  useEffect(() => {
    setSrc('');
    if (!root || !file) return undefined;
    let cancelled = false;
    let made = '';
    void fetchWorkspaceMediaBlob(root, file).then((blob) => {
      if (cancelled) return;
      if (!blob) {
        setFailed(true);
        return;
      }
      made = URL.createObjectURL(blob);
      setSrc(made);
    });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [root, file]);
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

  // 다른 그림을 받으면 처음부터 — 옛 그림의 배율·자리를 새 그림에 씌우지 않는다.
  useEffect(() => {
    setNatural(null);
    setFailed(false);
    setZoom(null);
    setOffset({ x: 0, y: 0 });
  }, [src]);

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
  const fitScale = natural && stage.w > 0 && stage.h > 0
    ? Math.min(1, (stage.w - 32) / natural.w, (stage.h - 32) / natural.h)
    : 1;
  const scale = zoom ?? Math.max(ZOOM_LIMITS.min, fitScale);
  /** 지금 보이는 배율·자리 — 손짓 처리기는 렌더를 기다리지 않고 이 최신 값에서 이어 간다(손가락을 바꿔 쥘 때 그림이 튀지 않게). */
  const viewRef = useRef({ scale, offset });
  viewRef.current = { scale, offset };

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
        {src && !failed && (
          <img
            key={src}
            src={src}
            alt={name}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setFailed(true)}
            className={`pointer-events-none absolute left-1/2 top-1/2 max-w-none origin-center ${natural ? '' : 'opacity-0'}`}
            style={{
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`,
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

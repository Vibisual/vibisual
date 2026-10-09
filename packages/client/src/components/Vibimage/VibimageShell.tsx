import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppShellProps } from '../../apps/registry.js';
import { WindowControls } from '../Layout/WindowControls.js';
import { mediaFileName, workspaceMediaUrl } from '../../utils/workspaceMedia.js';

/**
 * §5.13 (R-9) — **Vibimage.** 캔버스 참조 노드(§5.4 #36)에 담긴 그림 한 장을 본다.
 *
 * 바이트는 영상·소리·3D 와 같은 창구(`workspaceMediaUrl`)로 읽는다 — 앱마다 쿼리를 조립하면 서버 가드가
 * 바뀔 때 앱 수만큼 고치게 된다. 그림 표시는 브라우저 `<img>` 하나라 새로 들여온 제3자 코드가 없다.
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
      className={`rounded px-2 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
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

export function VibimageShell({ params }: AppShellProps): React.JSX.Element {
  const { t } = useTranslation();
  const root = params['projectId'] ?? '';
  const file = params['file'] ?? '';
  const hosted = !!params['appWindowId'] || params['appWindowHosted'] === '1';
  const src = root && file ? workspaceMediaUrl(root, file) : '';

  const stageRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<Natural | null>(null);
  const [failed, setFailed] = useState(false);
  const [stage, setStage] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  /** null = 맞춤(창이 바뀌면 다시 맞춘다). 숫자 = 사용자가 고른 배율. */
  const [zoom, setZoom] = useState<number | null>(null);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [backdrop, setBackdrop] = useState<Backdrop>('checker');
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

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

  const zoomBy = useCallback((factor: number): void => {
    setZoom((z) => clampZoom((z ?? Math.max(ZOOM_LIMITS.min, fitScale)) * factor));
  }, [fitScale]);

  // 무대는 스크롤하지 않는 상자라 기본 동작을 막을 일이 없다(React 의 휠 리스너는 passive 다).
  const onWheel = useCallback((e: React.WheelEvent): void => {
    if (!natural) return;
    zoomBy(e.deltaY < 0 ? ZOOM_LIMITS.step : 1 / ZOOM_LIMITS.step);
  }, [natural, zoomBy]);

  const onPointerDown = useCallback((e: React.PointerEvent): void => {
    if (!natural || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }, [natural, offset]);

  const onPointerMove = useCallback((e: React.PointerEvent): void => {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
  }, []);

  const endDrag = useCallback((): void => { dragRef.current = null; }, []);

  const fit = useCallback((): void => { setZoom(null); setOffset({ x: 0, y: 0 }); }, []);
  const actual = useCallback((): void => { setZoom(1); setOffset({ x: 0, y: 0 }); }, []);

  const name = file ? mediaFileName(file) : '';
  const percent = Math.round(scale * 100);

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-950 text-gray-100">
      <header className={`${hosted ? '' : 'app-drag '}flex h-11 shrink-0 items-center gap-3 border-b border-white/10 px-3`}>
        <span className={`${hosted ? '' : 'app-drag-label '}text-sm font-semibold`}>Vibimage</span>
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

        {(!src || failed) && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm rounded-lg border border-white/10 bg-gray-900/95 p-5 text-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 h-6 w-6 text-amber-200/70" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
              </svg>
              <p className="mb-2 text-sm font-medium">
                {failed ? t('panel.apps.vibimage.loadFailed') : t('panel.apps.vibimage.empty')}
              </p>
              <p className="text-[12px] leading-relaxed text-gray-400">
                {failed ? (file || '') : t('panel.apps.vibimage.emptyHint')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

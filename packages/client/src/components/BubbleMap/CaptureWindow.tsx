import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CAPTURE_BUBBLE_DEFAULTS, type CaptureSourceKind } from '@vibisual/shared';
import { useCaptureRemoteControl } from '../../hooks/useCaptureRemoteControl.js';
import { useCapturePrefs } from '../../stores/captureBubblePrefs.js';
import { useCaptureRuntime, type CaptureControlMode } from '../../stores/captureBubbleRuntime.js';
import { CaptureControlOverlay } from './CaptureControlOverlay.js';
import { registerCaptureWindow, type CaptureWindowHandle } from './captureWindowManager.js';

// §5.9 v3.34 — 캡처 버블 헤더 더블클릭 시 뜨는 "앱 내부 IDE식 창".
//
// 종전엔 라이브 영상을 `position:fixed; inset:0` 풀스크린으로만 확대했다(가운데 팝업·이동·크기 단계 없음).
// 이제 IDE 오버레이(AgentIDEOverlay)의 floating/maximized 창 톤을 캡처용으로 이식해:
//   · 처음 켜지면 화면 **가운데**에 적당한 크기의 창으로 뜬다(멀티 윈도우라 백드롭 없음 — 뒤 캔버스 그대로).
//   · 타이틀바 **드래그로 이동**, 우하단 핸들로 **리사이즈**, 타이틀바 버튼/더블클릭으로 **최대화↔복원**.
//   · 여러 버블의 창을 동시에 열면 계단식으로 뜨는 **멀티 윈도우** — 클릭한 창이 맨 앞으로(z-order).
// createPortal 로 캔버스 변환 밖(document.body)에 그려 캔버스 팬/줌·노드 좌표와 무관하게 화면 기준으로 뜬다.

/** 앱 통합 타이틀바 높이(px) — 최대화 시 그 아래부터 시작(IDE 오버레이와 동일 톤). */
const APP_HEADER_H = 36;
/** 리사이즈 최소 크기. */
const CW_MIN_W = 320;
const CW_MIN_H = 200;
/** 드래그로 인식하는 이동 임계(px). */
const CW_DRAG_THRESHOLD = 4;
/** 초기(floating) 크기 — 뷰포트 비율 × 상한. */
const CW_DEFAULT_W_RATIO = 0.6;
const CW_DEFAULT_H_RATIO = 0.62;
const CW_MAX_DEFAULT_W = 960;
const CW_MAX_DEFAULT_H = 640;

/** 원격 조작 주입 API(sendInput)가 있는 환경(데스크톱 렌더러)에서만 조작 UI 를 노출. */
const canControl = typeof window !== 'undefined' && !!window.api?.capture?.sendInput;

/** 번역 함수의 최소 형태 — off/touch/mouse 3상태 라벨용(i18next 타입 의존 회피). */
type TFn = (key: string, opts?: { defaultValue?: string }) => string;

/** 조작 모드('off'/'touch'/'mouse') → 짧은 라벨. v3.43 3상태 통합 이후 타이틀바 셀렉터 라벨. */
function modeLabel(m: CaptureControlMode, t: TFn): string {
  if (m === 'touch') return t('bubbleMap.capture.pointerModeTouch', { defaultValue: '터치' });
  if (m === 'mouse') return t('bubbleMap.capture.pointerModeMouse', { defaultValue: '마우스' });
  return t('bubbleMap.capture.controlModeOff', { defaultValue: '끄기' });
}

export interface CaptureWindowProps {
  /** 조작 모드(런타임 스토어)를 캔버스 노드·DetailPanel 과 공유하기 위한 버블 id. */
  captureBubbleId: string;
  /** 소스명(타이틀). */
  title: string;
  /** 캡처 버블 액센트 색(타이틀바 배경 — 캡처 정체성 유지). */
  accent: string;
  /** 조작 주입 대상 식별 — 캔버스 노드와 동일한 값. */
  sourceId: string;
  sourceKind: CaptureSourceKind;
  sourceName: string;
  /** 라이브 MediaStream(렌더러 전용). null 이면 로딩/소스 없음. */
  stream: MediaStream | null;
  /** 스트림 연결 중. */
  loading: boolean;
  /** 소스를 못 찾음(창 닫힘/재시작). */
  hasError: boolean;
  /** 창 닫기. */
  onClose: () => void;
}

interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** floating 기본 크기 — 뷰포트 비율에 상/하한을 적용. */
function defaultFloatSize(): { w: number; h: number } {
  const w = Math.min(CW_MAX_DEFAULT_W, Math.max(CW_MIN_W, Math.round(window.innerWidth * CW_DEFAULT_W_RATIO)));
  const h = Math.min(CW_MAX_DEFAULT_H, Math.max(CW_MIN_H, Math.round(window.innerHeight * CW_DEFAULT_H_RATIO)));
  return { w, h };
}

/** 초기 위치 — 화면 가운데 + 계단식 오프셋(멀티 윈도우 겹침 방지). */
function initialGeom(cascade: number): Geom {
  const { w, h } = defaultFloatSize();
  const x = Math.max(8, Math.round((window.innerWidth - w) / 2) + cascade);
  const y = Math.max(APP_HEADER_H, Math.round((window.innerHeight - h) / 2) + cascade);
  return { x, y, w, h };
}

export const CaptureWindow = memo(function CaptureWindow({
  captureBubbleId,
  title,
  accent,
  sourceId,
  sourceKind,
  sourceName,
  stream,
  loading,
  hasError,
  onClose,
}: CaptureWindowProps): React.JSX.Element {
  const { t } = useTranslation();

  // 최신 onClose 를 ref 로 — 매니저에 넘긴 close 콜백이 stale 되지 않게.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 멀티 윈도우 매니저 등록(z-order + Escape 최상단). 첫 렌더에 1회.
  const handleRef = useRef<CaptureWindowHandle | null>(null);
  if (!handleRef.current) handleRef.current = registerCaptureWindow(() => onCloseRef.current());
  const handle = handleRef.current;

  const [geom, setGeom] = useState<Geom>(() => initialGeom(handle.cascadeOffset));
  const [maximized, setMaximized] = useState(false);
  const [z, setZ] = useState<number>(handle.initialZ);

  const windowRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // §5.9 v3.43 — 크게 본 화면에서도 원격 조작. 캔버스 노드와 **같은 런타임 축·같은 훅**을 쓴다:
  // 기본 'off' 라 창을 열어도 마우스는 캡처 대상에 반영되지 않고(영상 위 클릭·드래그는 창/캔버스 몫),
  // 타이틀바에서 터치/마우스 모드를 직접 고를 때만 조작이 붙는다(DetailPanel 3분할과 같은 상태).
  const [prefs] = useCapturePrefs(captureBubbleId);
  const [runtime, setRuntime] = useCaptureRuntime(captureBubbleId);
  const controlMode = runtime.controlMode;
  const control = useCaptureRemoteControl({
    mode: controlMode,
    sourceId,
    sourceKind,
    sourceName,
    videoRef,
    surfaceRef,
    stream,
    timeoutSec: prefs.controlTimeoutSec,
    readOnly: prefs.readOnly,
    backgroundClick: prefs.backgroundClick,
    onDisengage: useCallback(() => setRuntime({ controlMode: 'off' }), [setRuntime]),
  });
  // 진행 중 드래그/리사이즈의 window 리스너 정리 함수 — 언마운트 시 강제 해제(누수 방지).
  const activeDragCleanupRef = useRef<(() => void) | null>(null);

  // 언마운트 — 매니저 등록 해제 + 진행 중 드래그 리스너 정리.
  useEffect(() => () => {
    activeDragCleanupRef.current?.();
    activeDragCleanupRef.current = null;
    handle.release();
  }, [handle]);

  // 라이브 스트림을 <video> 에 연결.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) v.play().catch(() => { /* muted 라 autoplay 차단 없음 */ });
  }, [stream]);

  const bringToFront = useCallback(() => { setZ(handle.bringToFront()); }, [handle]);
  const toggleMaximized = useCallback(() => setMaximized((v) => !v), []);

  // 타이틀바 드래그 — 창 이동. 최대화 상태에서 끌면 먼저 복원 후 커서 기준으로 이동(IDE 톤).
  const handleTitleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return; // 버튼에서 시작한 클릭은 드래그 ❌

    const startX = e.clientX;
    const startY = e.clientY;
    const win = windowRef.current;
    if (!win) return;
    const rect = win.getBoundingClientRect();
    // 클릭 지점이 창 좌상단에서 떨어진 비율 — 복원/이동 후에도 유지.
    const grabRatioX = (startX - rect.left) / rect.width;
    const grabRatioY = (startY - rect.top) / rect.height;

    let dragging = false;
    let curMax = maximized;
    let nextW = rect.width;
    let nextH = rect.height;

    function handleMove(ev: MouseEvent): void {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < CW_DRAG_THRESHOLD && Math.abs(dy) < CW_DRAG_THRESHOLD) return;
        dragging = true;
        if (curMax) {
          // 최대화 상태에서 끌면 복원 → floating 기본 크기로.
          const size = defaultFloatSize();
          nextW = size.w;
          nextH = size.h;
          setMaximized(false);
          curMax = false;
        }
      }
      const x = ev.clientX - grabRatioX * nextW;
      const y = ev.clientY - grabRatioY * nextH;
      const clampedX = Math.min(Math.max(x, -nextW + 80), window.innerWidth - 80);
      const clampedY = Math.min(Math.max(y, 0), window.innerHeight - 40);
      setGeom({ x: clampedX, y: clampedY, w: nextW, h: nextH });
    }
    function handleUp(): void {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      activeDragCleanupRef.current = null;
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    activeDragCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [maximized]);

  // 우하단 리사이즈 핸들.
  const handleResizeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    bringToFront();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = geom.w;
    const startH = geom.h;
    function handleMove(ev: MouseEvent): void {
      const w = Math.max(CW_MIN_W, startW + (ev.clientX - startX));
      const h = Math.max(CW_MIN_H, startH + (ev.clientY - startY));
      setGeom((g) => ({ ...g, w, h }));
    }
    function handleUp(): void {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      activeDragCleanupRef.current = null;
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    activeDragCleanupRef.current = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [bringToFront, geom.w, geom.h]);

  // 타이틀바 더블클릭 — 최대화 토글(버튼 자손에서 시작된 더블클릭은 제외).
  const handleTitleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    toggleMaximized();
  }, [toggleMaximized]);

  const geomStyle: React.CSSProperties = maximized
    ? { left: 0, top: APP_HEADER_H, right: 0, bottom: 0, zIndex: z }
    : { left: geom.x, top: geom.y, width: geom.w, height: geom.h, zIndex: z };

  return createPortal(
    <div
      ref={windowRef}
      data-capture-window=""
      className="fixed flex flex-col overflow-hidden rounded-xl shadow-2xl shadow-black/70"
      style={{
        ...geomStyle,
        background: CAPTURE_BUBBLE_DEFAULTS.STAGE_BG,
        border: `1px solid ${control.active ? `${CAPTURE_BUBBLE_DEFAULTS.CONTROL_COLOR}66` : CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}`,
        boxShadow: control.active
          ? `0 0 0 1px ${CAPTURE_BUBBLE_DEFAULTS.CONTROL_COLOR}55, 0 30px 70px -24px rgba(0,0,0,0.95)`
          : '0 30px 70px -24px rgba(0,0,0,0.95)',
      }}
      // portal 은 React 트리상 CaptureNode 의 자손이라, 여기서 시작된 pointer/click/wheel 이벤트가
      // 캔버스(노드 선택·팬·컨텍스트 메뉴)로 버블링될 수 있다 → 창 경계에서 전파를 끊고, mousedown 은
      // 이 창을 맨 앞으로 올린다(멀티 윈도우 z-order).
      // 조작 표면은 자기 mousedown 의 전파를 끊으므로(주입 전용), z-order 올리기는 capture 단계에서
      // 먼저 잡는다 — 조작 중에도 창을 클릭하면 맨 앞으로 온다.
      onMouseDownCapture={bringToFront}
      onMouseDown={(e) => { e.stopPropagation(); }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* Title bar — 그래파이트 유리면(v3.56, 종전 rose 색면 대체). 드래그 이동 + 더블클릭 최대화. */}
      <div
        onMouseDown={handleTitleMouseDown}
        onDoubleClick={handleTitleDoubleClick}
        className="flex h-10 flex-shrink-0 select-none items-center gap-2 px-3 text-slate-200 cursor-grab active:cursor-grabbing"
        style={{
          background: CAPTURE_BUBBLE_DEFAULTS.CHROME_BG,
          borderBottom: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}`,
          backdropFilter: 'blur(10px)',
        }}
      >
        {/* 라이브 도트(녹화등) — 색은 여기서만 붉게. */}
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${stream ? 'animate-pulse' : ''}`}
          style={{
            background: stream ? CAPTURE_BUBBLE_DEFAULTS.LIVE_COLOR : 'rgba(148,163,184,0.45)',
            boxShadow: stream ? `0 0 8px ${CAPTURE_BUBBLE_DEFAULTS.LIVE_COLOR}` : 'none',
          }}
        />
        <span className="truncate text-[13px] font-semibold text-slate-100" title={title}>{title}</span>
        <span
          className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
          style={{ background: `${accent}1f`, color: accent }}
        >
          {sourceKind === 'screen'
            ? t('bubbleMap.capture.kindScreen', { defaultValue: '화면' })
            : t('bubbleMap.capture.kindWindow', { defaultValue: '창' })}
        </span>
        <span className="flex-1" />

        {/* 원격 조작 모드 3분할 — 기본 '끄기'(영상에 마우스가 전혀 반영되지 않음). 터치/마우스를
            직접 고를 때만 크롬 원격처럼 조작이 붙는다. DetailPanel 의 3분할과 같은 런타임 축이라
            어느 쪽에서 바꿔도 즉시 서로 반영된다. */}
        {canControl && stream && (
          <div
            className="flex shrink-0 items-center gap-0.5 rounded-full p-0.5"
            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}` }}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            title={t('bubbleMap.capture.controlInWindow', { defaultValue: '이 창에서의 원격 조작 — 기본은 끄기(마우스 미반영)' })}
          >
            {(['off', 'touch', 'mouse'] as const).map((m) => {
              const isActive = controlMode === m;
              const disabled = prefs.readOnly && m !== 'off';
              const on = isActive && m !== 'off';
              return (
                <button
                  key={m}
                  type="button"
                  disabled={disabled}
                  onClick={() => setRuntime({ controlMode: m })}
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    background: on
                      ? CAPTURE_BUBBLE_DEFAULTS.CONTROL_COLOR
                      : isActive ? 'rgba(255,255,255,0.14)' : 'transparent',
                    color: on ? '#04140D' : isActive ? '#F1F5F9' : '#94A3B8',
                  }}
                >
                  {modeLabel(m, t)}
                </button>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={toggleMaximized}
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100"
          title={maximized ? t('bubbleMap.capture.restore', { defaultValue: '원래 크기로' }) : t('bubbleMap.capture.maximize', { defaultValue: '최대화' })}
          aria-label={maximized ? t('bubbleMap.capture.restore', { defaultValue: '원래 크기로' }) : t('bubbleMap.capture.maximize', { defaultValue: '최대화' })}
        >
          {maximized ? (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3v3a2 2 0 0 1-2 2H3" />
              <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
              <path d="M3 16h3a2 2 0 0 1 2 2v3" />
              <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => onClose()}
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-500/80 hover:text-white"
          title={t('bubbleMap.capture.windowClose', { defaultValue: '닫기 (Esc)' })}
          aria-label={t('bubbleMap.capture.windowClose', { defaultValue: '닫기 (Esc)' })}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* Body — 라이브 영상 크게. 조작 모드가 'off'(기본)면 표면이 이벤트를 잡지 않아 마우스는
          캡처 대상에 반영되지 않는다. 터치/마우스 모드에서만 조작 표면이 된다(캔버스 노드와 동일). */}
      <div
        ref={surfaceRef}
        {...control.surfaceProps}
        className="relative flex min-h-0 flex-1 items-center justify-center outline-none"
        // v3.58 — 조작 중에도 로컬 커서를 숨기지 않는다(가상 커서는 오버레이가 따로 그린다).
        style={{
          cursor: control.surfaceCursor,
          background: CAPTURE_BUBBLE_DEFAULTS.STAGE_BG,
          // 모바일 — 조작 중 손가락 끌기를 브라우저 스크롤에 뺏기지 않게.
          touchAction: control.active ? 'none' : undefined,
        }}
      >
        {stream ? (
          <video
            ref={videoRef}
            muted
            autoPlay
            playsInline
            onLoadedMetadata={() => { if (control.active) control.syncCursorPx(); }}
            className="h-full w-full object-contain"
            style={{ pointerEvents: 'none' }}
          />
        ) : (
          <div className="flex flex-col items-center gap-2.5 text-center">
            <span
              className="flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: 'rgba(148,163,184,0.10)', border: '1px solid rgba(255,255,255,0.08)', color: accent }}
            >
              <svg
                className={`h-5 w-5 ${loading ? 'animate-pulse' : ''}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              >
                <rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
              </svg>
            </span>
            <span className="text-[12px] text-slate-400">
              {hasError && !loading
                ? t('bubbleMap.capture.sourceLost', { defaultValue: '소스를 찾을 수 없습니다 · 다시 선택' })
                : t('bubbleMap.capture.connecting', { defaultValue: '연결 중…' })}
            </span>
          </div>
        )}

        {/* 조작 중일 때만 얹히는 공유 오버레이 — 마우스 모드 가상 커서 + 특수키/클립보드 바. */}
        {control.active && stream && (
          <CaptureControlOverlay
            cursorPx={control.cursorPx}
            targetMissing={control.targetMissing}
            injectError={control.injectError}
            backgroundFallback={control.backgroundFallback}
            onSpecialKey={control.sendSpecialKey}
            onPaste={() => { void control.pasteClipboard(); }}
          />
        )}

        {/* 우하단 리사이즈 핸들 — 최대화 중엔 숨김. */}
        {!maximized && (
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-1 text-slate-600 transition-colors hover:text-slate-300"
            aria-hidden="true"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15 15 21" />
              <path d="M21 9 9 21" />
            </svg>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
});

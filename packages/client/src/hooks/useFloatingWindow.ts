import { useCallback, useEffect, useRef, useState } from 'react';
import {
  centeredGeom,
  clampGeom,
  clampPosition,
  defaultFloatSize,
  resolveFloatingWindowConfig,
  windowStyle,
  type FloatingWindowConfig,
  type FloatingWindowGeom,
  type FloatingWindowMode,
  type FloatingWindowSnapshot,
} from './floatingWindowGeom.js';

// §5.9 v3.34 캡처 창이 처음 만든 "앱 내부 IDE식 창" 거동(가운데 팝업 → 타이틀바 드래그 이동 →
// 우하단 리사이즈 → 최대화/복원)을 훅으로 뽑은 것. §5.10 v3.77 에서 기억 라이브러리도 같은 창이
// 되면서 같은 좌표·드래그 로직이 두 곳이 됐기 때문(coding.md DRY — 같은 로직 2곳이면 공통 모듈).
//
// 이 훅은 **좌표와 3상태만** 책임진다. z-order·Escape·백드롭·내용은 호출부 몫이다
// (캡처는 멀티 윈도우 매니저를, 기억 라이브러리는 단일 창 + Esc 닫기를 쓴다).

export type { FloatingWindowGeom, FloatingWindowMode, FloatingWindowSnapshot } from './floatingWindowGeom.js';

export interface FloatingWindowOptions extends Partial<FloatingWindowConfig> {
  /** 초기 위치 계단식 오프셋(px) — 여러 창을 동시에 열 때 겹침 방지. */
  cascade?: number;
  /** 이전 상태 복원(다시 열면 그 자리) — 마운트 시 1회만 읽는다. */
  initial?: FloatingWindowSnapshot | null;
  /** 좁은 뷰포트(모바일) — 항상 전체화면, 이동·리사이즈 잠금. */
  lockFullScreen?: boolean;
  /** 드래그·리사이즈 시작 시(맨 앞으로 올리기 등). */
  onInteractStart?: () => void;
  /** geom·mode 가 바뀔 때마다 통지(자리 기억 저장). */
  onChange?: (snapshot: FloatingWindowSnapshot) => void;
}

export interface FloatingWindowApi {
  /** 창 루트 엘리먼트 ref — 드래그 시작 시 실측에 쓴다. */
  windowRef: React.MutableRefObject<HTMLDivElement | null>;
  geom: FloatingWindowGeom;
  mode: FloatingWindowMode;
  maximized: boolean;
  minimized: boolean;
  /** 최대화 또는 잠긴 전체화면 — 캔버스 덮개 등록(§4 v3.71) 판정에 쓴다. */
  fullScreen: boolean;
  /** `position:fixed` 창에 그대로 붙이는 위치·크기(zIndex 는 호출부가 얹는다). */
  style: React.CSSProperties;
  /** 타이틀바에 스프레드 — 드래그 이동 + 더블클릭 최대화 토글. */
  titleBarProps: {
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
    onDoubleClick: (e: React.MouseEvent<HTMLElement>) => void;
  };
  /** 우하단 리사이즈 핸들에 스프레드. */
  resizeProps: { onMouseDown: (e: React.MouseEvent<HTMLElement>) => void };
  toggleMaximized: () => void;
  toggleMinimized: () => void;
  /** 상태 직접 지정(업데이터 함수도 가능) — 예: 다시 열 때 셰이드 해제. */
  setMode: React.Dispatch<React.SetStateAction<FloatingWindowMode>>;
}

/** 드래그를 시작하면 안 되는 인터랙티브 자손 — 버튼/입력에서 시작한 마우스다운은 창 이동 ❌. */
const NO_DRAG_SELECTOR = 'button, input, select, textarea, a, [data-window-nodrag]';

function viewport(): { w: number; h: number } {
  return { w: window.innerWidth, h: window.innerHeight };
}

export function useFloatingWindow(options: FloatingWindowOptions = {}): FloatingWindowApi {
  const { cascade = 0, initial = null, lockFullScreen = false, onInteractStart, onChange, ...configPartial } = options;

  // 설정은 매 렌더 재계산하되 핸들러는 ref 로 최신값을 본다(콜백 재생성으로 리스너가 흔들리지 않게).
  const cfg = resolveFloatingWindowConfig(configPartial);
  const cfgRef = useRef<FloatingWindowConfig>(cfg);
  cfgRef.current = cfg;
  const lockRef = useRef(lockFullScreen);
  lockRef.current = lockFullScreen;
  const onInteractStartRef = useRef(onInteractStart);
  onInteractStartRef.current = onInteractStart;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [geom, setGeom] = useState<FloatingWindowGeom>(() => (
    initial?.geom ? clampGeom(initial.geom, viewport(), cfg) : centeredGeom(viewport(), cfg, cascade)
  ));
  const [mode, setMode] = useState<FloatingWindowMode>(() => initial?.mode ?? 'floating');

  const geomRef = useRef(geom);
  geomRef.current = geom;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const windowRef = useRef<HTMLDivElement | null>(null);
  /** 진행 중 드래그/리사이즈의 window 리스너 해제 함수 — 언마운트 시 강제 정리(누수 방지). */
  const activeDragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    activeDragCleanupRef.current?.();
    activeDragCleanupRef.current = null;
  }, []);

  // 자리 기억 통지.
  useEffect(() => { onChangeRef.current?.({ geom, mode }); }, [geom, mode]);

  // 뷰포트가 줄면(창 리사이즈·회전) 창을 화면 안으로 되돌린다 — 종전 고정 크기 모달의 "화면 밖" 회귀 차단.
  useEffect(() => {
    const onResize = (): void => setGeom((g) => clampGeom(g, viewport(), cfgRef.current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /** 진행 중 드래그의 window 리스너를 등록하고 정리 함수를 기억해 둔다. */
  const bindDrag = useCallback((onMove: (ev: MouseEvent) => void) => {
    function handleUp(): void {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', handleUp);
      activeDragCleanupRef.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', handleUp);
    activeDragCleanupRef.current = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  // 타이틀바 드래그 — 창 이동. 최대화 상태에서 끌면 먼저 복원하고 커서 기준으로 이어 옮긴다(IDE 톤).
  const handleTitleMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || lockRef.current) return;
    if ((e.target as HTMLElement).closest(NO_DRAG_SELECTOR)) return;
    const win = windowRef.current;
    if (!win) return;

    onInteractStartRef.current?.();

    const startX = e.clientX;
    const startY = e.clientY;
    const rect = win.getBoundingClientRect();
    // 클릭 지점이 창 좌상단에서 떨어진 비율 — 복원(크기 변화) 후에도 커서 위치를 유지한다.
    const grabRatioX = rect.width > 0 ? (startX - rect.left) / rect.width : 0;
    const grabRatioY = rect.height > 0 ? (startY - rect.top) / rect.height : 0;

    let dragging = false;
    let curMode = modeRef.current;
    // 화면상 크기(셰이드 중이면 타이틀바 높이) — 위치 계산용. 저장된 복원 크기와 구분한다.
    let posW = rect.width;
    let posH = rect.height;

    function handleMove(ev: MouseEvent): void {
      const cfgNow = cfgRef.current;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < cfgNow.dragThreshold && Math.abs(dy) < cfgNow.dragThreshold) return;
        dragging = true;
        if (curMode === 'maximized') {
          const size = defaultFloatSize(viewport(), cfgNow);
          posW = size.w;
          posH = size.h;
          curMode = 'floating';
          setMode('floating');
        }
      }
      const x = ev.clientX - grabRatioX * posW;
      const y = ev.clientY - grabRatioY * posH;
      const pos = clampPosition(x, y, { w: posW, h: posH }, viewport(), cfgNow);
      setGeom((g) => ({
        ...pos,
        // 셰이드(최소화) 중엔 복원 크기를 건드리지 않는다 — 펼치면 원래 크기로 돌아와야 한다.
        w: curMode === 'minimized' ? g.w : posW,
        h: curMode === 'minimized' ? g.h : posH,
      }));
    }
    bindDrag(handleMove);
  }, [bindDrag]);

  // 우하단 리사이즈 핸들.
  const handleResizeMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || lockRef.current) return;
    e.preventDefault();
    onInteractStartRef.current?.();

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = geomRef.current.w;
    const startH = geomRef.current.h;

    function handleMove(ev: MouseEvent): void {
      const cfgNow = cfgRef.current;
      const w = Math.max(cfgNow.minSize.w, startW + (ev.clientX - startX));
      const h = Math.max(cfgNow.minSize.h, startH + (ev.clientY - startY));
      setGeom((g) => ({ ...g, w, h }));
    }
    bindDrag(handleMove);
  }, [bindDrag]);

  // 타이틀바 더블클릭 — 최대화 토글(버튼 등 인터랙티브 자손에서 시작한 건 제외).
  const handleTitleDoubleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (lockRef.current) return;
    if ((e.target as HTMLElement).closest(NO_DRAG_SELECTOR)) return;
    setMode((m) => (m === 'maximized' ? 'floating' : 'maximized'));
  }, []);

  const toggleMaximized = useCallback(() => setMode((m) => (m === 'maximized' ? 'floating' : 'maximized')), []);
  const toggleMinimized = useCallback(() => setMode((m) => (m === 'minimized' ? 'floating' : 'minimized')), []);

  return {
    windowRef,
    geom,
    mode,
    maximized: mode === 'maximized',
    minimized: mode === 'minimized' && !lockFullScreen,
    fullScreen: lockFullScreen || mode === 'maximized',
    style: windowStyle(geom, mode, cfg, lockFullScreen),
    titleBarProps: { onMouseDown: handleTitleMouseDown, onDoubleClick: handleTitleDoubleClick },
    resizeProps: { onMouseDown: handleResizeMouseDown },
    toggleMaximized,
    toggleMinimized,
    setMode,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WINDOW_PULL_OUT,
  centeredGeom,
  clampGeom,
  clampPosition,
  defaultFloatSize,
  isCursorOutsideViewport,
  isCursorPinnedToViewportEdge,
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

/**
 * §5.13 (S-3) — 타이틀바로 창을 **앱 밖으로 끌어내는** 손짓.
 *
 * 이 훅은 손짓의 **판정과 시점**만 맡는다 — 밖에 무엇을 띄울지는 창마다 다르므로 부르는 쪽 몫이다
 * (내부 앱 창은 `InternalApp.open()` 으로 OS 창을 연다). 옵션을 주지 않으면 종전과 완전히 같다.
 */
export interface FloatingWindowPullOut {
  /**
   * 끌어내기가 가능한 환경인가. false 면 손짓 자체가 없다 — 창을 못 여는 판(웹·구버전 preload)에서
   * 무장 표시만 뜨고 아무 일도 안 일어나면, 그건 고장으로 읽힌다.
   */
  enabled: boolean;
  /** 무장 상태가 바뀔 때 — 화면에 "놓으면 밖으로 나갑니다"를 보여 주는 자리. */
  onArmedChange?: (armed: boolean) => void;
  /** 무장된 채 손을 뗐다. 창을 밖으로 꺼내고 이 창을 닫는 것은 부르는 쪽이 한다. */
  onRelease: (info: { geom: FloatingWindowGeom }) => void;
}

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
  /** §5.13 (S-3) 앱 밖으로 끌어내기 — 주지 않으면 종전과 같다(창은 화면 안에 머문다). */
  pullOut?: FloatingWindowPullOut;
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
  const { cascade = 0, initial = null, lockFullScreen = false, onInteractStart, onChange, pullOut, ...configPartial } = options;

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
  const pullOutRef = useRef(pullOut);
  pullOutRef.current = pullOut;

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

  /**
   * 진행 중 드래그의 window 리스너를 등록하고 정리 함수를 기억해 둔다.
   *
   * `onEnd` 는 **손을 떼든 언마운트로 강제 정리되든 반드시 한 번** 불린다 — 끌어내기 손짓이
   * 걸어 둔 시계를 여기서 거두지 않으면, 창이 사라진 뒤에 타이머가 깨어나 무장 상태를 알린다.
   */
  const bindDrag = useCallback((onMove: (ev: MouseEvent) => void, onEnd?: (committed: boolean) => void) => {
    let ended = false;
    function finish(committed: boolean): void {
      if (ended) return;
      ended = true;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', handleUp);
      onEnd?.(committed);
    }
    function handleUp(): void {
      finish(true);
      activeDragCleanupRef.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', handleUp);
    activeDragCleanupRef.current = () => { finish(false); };
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

    /**
     * §5.13 (S-3) — **앱 밖으로 끌어내는** 손짓. 두 갈래를 함께 본다.
     *
     * ① 커서가 창 밖으로 나갔다 ② 화면 끝에 막힌 채 버틴다. 하나만 두면 그 손짓은 어떤 사용자에게
     * 통째로 **없는 기능**이 된다 — 단일 모니터에 앱을 최대화해 쓰면 커서는 뷰포트를 한 픽셀도
     * 벗어나지 못하고, 반대로 시간만으로 판정하면 창을 화면 끝에 붙여 두려던 손도 걸린다.
     */
    let armed = false;
    let edgeTimer: number | null = null;
    function setArmed(next: boolean): void {
      if (armed === next) return;
      armed = next;
      pullOutRef.current?.onArmedChange?.(next);
    }
    function clearEdgeWatch(): void {
      if (edgeTimer === null) return;
      window.clearTimeout(edgeTimer);
      edgeTimer = null;
    }
    function trackPullOut(ev: MouseEvent): void {
      const po = pullOutRef.current;
      if (!po?.enabled) return;
      const vp = viewport();
      const cursor = { x: ev.clientX, y: ev.clientY };
      if (isCursorOutsideViewport(cursor, vp)) {
        clearEdgeWatch();
        setArmed(true);
        return;
      }
      if (isCursorPinnedToViewportEdge(cursor, vp)) {
        // 띠 안에서 버티는 중 — 이미 무장했으면 그대로 둔다(시계를 다시 걸면 영영 안 걸린다).
        if (!armed && edgeTimer === null) {
          edgeTimer = window.setTimeout(() => {
            edgeTimer = null;
            setArmed(true);
          }, WINDOW_PULL_OUT.EDGE_DWELL_MS);
        }
        return;
      }
      // 가장자리를 떠났다 — 스쳐 지나간 손이 창을 밖으로 던지면 안 된다.
      clearEdgeWatch();
      setArmed(false);
    }

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
      trackPullOut(ev);
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
    bindDrag(handleMove, (committed) => {
      clearEdgeWatch();
      const wasArmed = armed;
      setArmed(false);
      // 언마운트로 강제 정리된 판(committed=false)에서는 꺼내지 않는다 — 사람이 손을 뗀 것이 아니다.
      if (committed && wasArmed) pullOutRef.current?.onRelease({ geom: geomRef.current });
    });
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

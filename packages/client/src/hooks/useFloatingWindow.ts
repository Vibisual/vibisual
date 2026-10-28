import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WINDOW_PULL_OUT,
  centeredGeom,
  clampGeom,
  clampPosition,
  defaultFloatSize,
  edgeNudgeOffset,
  isCursorPinnedToViewportEdge,
  isWindowPulledFullyOut,
  overflowPastClampPosition,
  pullOutGhostDecision,
  resolveFloatingWindowConfig,
  windowStyle,
  type FloatingWindowConfig,
  type FloatingWindowGeom,
  type FloatingWindowMode,
  type FloatingWindowSnapshot,
} from './floatingWindowGeom.js';

// 떠 있는 창 거동(가운데 팝업 → 끌어 이동 → 우하단 크기 조절 → 최대화/복원) 한 벌. **좌표와 3상태만** 맡고 z-order·Escape·백드롭·내용은 호출부 몫이다.

export type { FloatingWindowGeom, FloatingWindowMode, FloatingWindowSnapshot } from './floatingWindowGeom.js';

/** 끌어내기 손짓이 끝나 밖으로 내보낼 때 부르는 쪽에 넘기는 값. */
export interface FloatingWindowPullOutRelease {
  /** 손을 뗀 자리의 창(가두지 않은 자리 — 크기는 그대로 새 창의 크기다). */
  geom: FloatingWindowGeom;
  /** 손을 뗀 자리의 창 좌상단 화면 좌표 — main 의 선이 없을 때 새 창을 앉히는 자리. */
  screenPosition: { x: number; y: number };
  /** §5.13 (S-10) main 에 선을 멈춰 달라고 했다 — 새 창은 그 선의 자리·크기를 main 이 직접 읽어 쓴다(렌더러 좌표는 배율이 다른 모니터에서 어긋난다 — §5.5 #17-6 (H)). */
  fromGhost: boolean;
}

/** §5.13 (S-3) — 타이틀바로 창을 **앱 밖으로 끌어내는** 손짓의 판정·시점·가상 창(S-10). 밖에 띄울 것은 부르는 쪽 몫(내부 앱 창은 `InternalApp.open()`). 옵션이 없으면 끌어내기도 없다. */
export interface FloatingWindowPullOut {
  /** 끌어내기가 가능한 환경인가. false 면 손짓이 없다 — 창을 못 여는 판(웹·구버전 preload)에서 무장 표시만 뜨면 고장으로 읽힌다. */
  enabled: boolean;
  /** 무장 상태가 바뀔 때 — 지금 손을 떼면 밖으로 나가는가. */
  onArmedChange?: (armed: boolean) => void;
  /**
   * 무장된 채 손을 뗐다(꺼내기·닫기는 부르는 쪽). §5.13 (S-10) 약속을 돌려주면 끝날 때까지 선을 세우고 본체를 숨긴다 —
   * 참이면 새 창이 선을 잇고(선은 main 이 걷는다), 거짓이면 선을 걷고 본체를 되살린다. 약속이 없으면 곧바로 걷는다.
   */
  onRelease: (info: FloatingWindowPullOutRelease) => void | Promise<boolean>;
  /** §5.13 (S-10) 가상 창의 이름 띠와 안내 한 줄 — 문구는 부르는 쪽 로케일로(main 엔 번역이 없다). */
  ghost?: { label: string; hint: (armed: boolean) => string };
}

/** §5.13 (S-10) 가상 창(선) — §5.5 #17-6 (H-6) 과 같은 것. 선이 선 동안 본체는 숨는다(H-19). 앱 안 윤곽선으로 먼저, main 클릭통과 창이 서면 그쪽이 앱 밖까지 잇는다. */
export interface FloatingWindowPullOutGhost {
  /** 선을 누가 그리나 — `os` 는 main 클릭통과 창(앱 밖까지), `inapp` 은 그 창이 없을 때의 폴백으로 부르는 쪽이 앱 안에 그린다(경계에서 잘린다). */
  kind: 'os' | 'inapp';
  /** 지금 손을 떼면 그대로 나가는가 — 선이 밝아져 놓기 전에 그것을 말한다. */
  armed: boolean;
  /** 앱 안 윤곽선이 설 자리(뷰포트 좌표, 가장자리 버팀으로 밀어 낸 만큼 포함). */
  rect: FloatingWindowGeom;
}

/** 타이틀바 누름 — React·네이티브 둘 다 받는다(이 필드만 본다). §5.13 (S-11) 포털 머리줄의 React 이벤트는 창 틀까지 오르지 않아 창 틀이 네이티브로 넘긴다(`useAppChromeSlotGestures`). */
export type TitleBarPress = Pick<MouseEvent, 'button' | 'clientX' | 'clientY' | 'screenX' | 'screenY' | 'target' | 'preventDefault'>;

export interface FloatingWindowOptions extends Partial<FloatingWindowConfig> {
  /** A hidden project keeps its geometry but cannot continue dragging or resizing. */
  enabled?: boolean;
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
  /** 최대화 또는 잠긴 전체화면 — 캔버스 덮개 등록(§4) 판정에 쓴다. */
  fullScreen: boolean;
  /** `position:fixed` 창에 그대로 붙이는 위치·크기(zIndex 는 호출부가 얹는다). */
  style: React.CSSProperties;
  /** §5.13 (S-10) 빼는 동안의 가상 창 — 있으면 본체를 숨기고 `inapp` 이면 이 자리에 윤곽선을 그린다. 끌어내기 판이 아니면 null. */
  pullOutGhost: FloatingWindowPullOutGhost | null;
  /** 타이틀바에 스프레드 — 드래그 이동 + 더블클릭 최대화 토글. 네이티브 이벤트로 불러도 된다(`TitleBarPress`). */
  titleBarProps: {
    onMouseDown: (e: TitleBarPress) => void;
    onDoubleClick: (e: Pick<MouseEvent, 'target'>) => void;
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

/** 부르는 쪽이 약속을 돌려줬는가 — `onRelease` 는 약속 없이 끝나도 된다(종전 호출부). */
function isPromiseLike(value: unknown): value is PromiseLike<boolean> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

export function useFloatingWindow(options: FloatingWindowOptions = {}): FloatingWindowApi {
  const { enabled = true, cascade = 0, initial = null, lockFullScreen = false, onInteractStart, onChange, pullOut, ...configPartial } = options;

  // 설정은 매 렌더 재계산하되 핸들러는 ref 로 최신값을 본다(콜백 재생성으로 리스너가 흔들리지 않게).
  const cfg = resolveFloatingWindowConfig(configPartial);
  const cfgRef = useRef<FloatingWindowConfig>(cfg);
  cfgRef.current = cfg;
  const lockRef = useRef(lockFullScreen);
  lockRef.current = lockFullScreen;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
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
  const [pullOutGhost, setPullOutGhost] = useState<FloatingWindowPullOutGhost | null>(null);

  const geomRef = useRef(geom);
  geomRef.current = geom;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const windowRef = useRef<HTMLDivElement | null>(null);
  /** 진행 중 드래그/리사이즈의 window 리스너 해제 함수 — 언마운트 시 강제 정리(누수 방지). */
  const activeDragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (enabled) return;
    activeDragCleanupRef.current?.();
    activeDragCleanupRef.current = null;
  }, [enabled]);

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

  /** 진행 중 드래그의 window 리스너를 걸고 정리 함수를 기억한다. `onEnd` 는 떼든 언마운트든 **반드시 한 번** 불린다 — 안 그러면 끌어내기 시계가 창이 사라진 뒤 깨어난다. */
  const bindDrag = useCallback((onMove: (ev: MouseEvent) => void, onEnd?: (committed: boolean) => void) => {
    let ended = false;
    function finish(committed: boolean): void {
      if (ended) return;
      ended = true;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('blur', handleCancel);
      onEnd?.(committed);
    }
    function handleUp(event: MouseEvent): void {
      if (event.button !== 0) return;
      finish(true);
      activeDragCleanupRef.current = null;
    }
    function handleCancel(): void { finish(false); activeDragCleanupRef.current = null; }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); handleCancel(); }
    }
    activeDragCleanupRef.current?.();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('blur', handleCancel);
    activeDragCleanupRef.current = () => { finish(false); };
  }, []);

  // 타이틀바 드래그 — 창 이동. 최대화 상태에서 끌면 먼저 복원하고 커서 기준으로 이어 옮긴다(IDE 톤).
  const handleTitleMouseDown = useCallback((e: TitleBarPress) => {
    if (e.button !== 0 || lockRef.current || !enabledRef.current) return;
    if ((e.target as HTMLElement).closest(NO_DRAG_SELECTOR)) return;
    const win = windowRef.current;
    if (!win) return;
    e.preventDefault();

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
    /** 마지막으로 본 커서의 화면 좌표 — 손을 뗀 자리의 창 좌상단을 여기서 낸다. */
    let lastScreen = { x: e.screenX, y: e.screenY };
    let releaseGeom = geomRef.current;

    /** §5.13 (S-10) 밖으로 끌어낼 수 있는 판인가 — 누른 순간 정한다. 그런 판은 IDE 창(§5.5 #17-6 (H-6))처럼 창을 가두지 않고 빼면 선을 띄운다. 아니면(캡처 창 등) 화면 안에서만. */
    const pullOutDrag = !!pullOutRef.current?.enabled;

    /**
     * §5.13 (S-3) — 무장 이유는 넷, 판정은 한 곳(`pullOutGhostDecision`): ① 커서가 앱 밖 ② 창을 완전히 빼냄 ③ 놓을 자리를 멀리 넘김 ④ 화면 끝에 막힌 채 버팀.
     * 하나만 두지 마라 — 최대화한 단일 모니터에선 커서가 뷰포트를 못 벗어나고, 시간만으로 가르면 창을 끝에 붙이려던 손도 걸린다.
     */
    let armed = false;
    function setArmed(next: boolean): void {
      if (armed === next) return;
      armed = next;
      pullOutRef.current?.onArmedChange?.(next);
    }

    /** §5.13 (S-10) — 빼는 중엔 창 크기의 선 하나만 커서를 따르고 본체는 숨는다(§5.5 #17-6 (H-6) ③ · (H-19)). `ghostKind`: `os` = main 클릭통과 창(앱 밖까지), `inapp` = 폴백(경계에서 잘린다). */
    let ghostOn = false;
    let ghostKind: 'os' | 'inapp' = 'inapp';
    let ghostArmed = false;
    /** (H-22) 이 판이 앱 밖을 한 번이라도 밟았는가 — 밟았으면 도로 들어와도 놓을 때까지 선이다. */
    let ghostEscaped = false;
    /** 가장자리 버팀 동안 선을 그 변 밖으로 밀어 낸 여분(px). */
    let ghostPush = { dx: 0, dy: 0 };
    let ghostKeepAlive: number | null = null;
    /** 손을 떼고 내보내는 중 — 선은 멈춘 채 새 창을 기다리고 본체는 숨어 있다. 끝난 판의 시계·판정이 선을 건드리지 않게 한다. */
    let handingOff = false;
    /** 가두지 않은 **지금** 자리 — 선 판정과 버팀 시계가 함께 읽는다(둘이 갈리면 말이 달라진다). */
    let lastRaw: FloatingWindowGeom | null = null;
    /** 마지막으로 본 커서(앱 창 안 좌표) — 잡은 지점 때문에 창은 안쪽인데 손은 이미 밖인 순간이 있다. */
    let lastCursor: { x: number; y: number } | null = null;

    /** main 의 선에 넘길 크기·잡은 지점 — 끌던 손 아래 그대로 이어지게. */
    function ghostFrame(): { width: number; height: number; grabX: number; grabY: number } {
      return {
        width: Math.round(posW),
        height: Math.round(posH),
        grabX: Math.round(grabRatioX * posW),
        grabY: Math.round(grabRatioY * posH),
      };
    }

    /** main 에 선을 세워 달라는 부탁(서 있으면 크기·무장·문구만 갈아 끼운다). `settled` 면 그 자리에 멈춘다 — 손을 뗀 뒤라 커서를 따라가면 안 된다. */
    function requestOsGhost(armedNow: boolean, settled = false): Promise<boolean> | null {
      const ov = window.api?.overlay;
      if (!ov?.ghostShow) return null;
      const look = pullOutRef.current?.ghost;
      return ov.ghostShow({
        ...ghostFrame(),
        label: look?.label ?? '',
        armed: armedNow,
        ...(look ? { hint: look.hint(armedNow) } : {}),
        ...(settled ? { settled: true } : {}),
      });
    }

    /** 부르는 쪽에 지금 선의 모양을 알린다 — `inapp` 이면 그 자리에 윤곽선을 그린다. */
    function publishGhost(): void {
      if (!ghostOn || !lastRaw) return;
      const r = lastRaw;
      setPullOutGhost({
        kind: ghostKind,
        armed: ghostArmed,
        rect: { x: r.x + ghostPush.dx, y: r.y + ghostPush.dy, w: r.w, h: r.h },
      });
    }

    /** (H-22) 선이 선 동안 main 에 아직 끌고 있다고 알린다 — 안 그러면 main 의 수명 그물(20초)이 긴 판에서 끌던 손 아래 선을 걷는다. */
    function startGhostKeepAlive(): void {
      if (ghostKeepAlive !== null) return;
      ghostKeepAlive = window.setInterval(() => {
        if (!ghostOn || ghostKind !== 'os' || handingOff) return;
        void requestOsGhost(ghostArmed);
      }, WINDOW_PULL_OUT.GHOST_KEEPALIVE_MS);
    }
    function stopGhostKeepAlive(): void {
      if (ghostKeepAlive === null) return;
      window.clearInterval(ghostKeepAlive);
      ghostKeepAlive = null;
    }

    function showGhost(armedNow: boolean): void {
      const armChanged = ghostOn && armedNow !== ghostArmed;
      ghostArmed = armedNow;
      if (!ghostOn) {
        ghostOn = true;
        startGhostKeepAlive();
        // 선은 **지금 이 프레임에** 떠야 한다 — 본체는 이미 숨는데 OS 창이 서기를 기다리면(창 하나를
        //   만들어 띄우는 데 백 밀리초 남짓) 그동안 손을 따라오는 것이 없다. 그래서 앱 안 윤곽선으로
        //   먼저 그리고, main 의 선이 실제로 그려지면 그쪽으로 넘긴다(둘이 같은 자리를 그린다).
        ghostKind = 'inapp';
        const pending = requestOsGhost(armedNow);
        if (pending) {
          void pending.then((ok) => {
            // 못 띄웠거나(컴포지터 없는 환경 등) 그 사이 선을 걷었으면 앱 안 윤곽선 그대로 간다.
            if (!ok || !ghostOn) return;
            ghostKind = 'os';
            publishGhost();
          }).catch(() => { /* 앱 안 윤곽선으로 계속 간다 */ });
        }
      } else if (armChanged && ghostKind === 'os') {
        void requestOsGhost(armedNow);
      }
      publishGhost();
    }

    /** 선을 걷는다 — 판이 끝났거나(앱 안에 놓음·취소) 선을 켤 이유가 사라졌다. */
    function hideGhost(): void {
      if (!ghostOn) return;
      ghostOn = false;
      ghostArmed = false;
      ghostPush = { dx: 0, dy: 0 };
      stopGhostKeepAlive();
      setPullOutGhost(null);
      void window.api?.overlay?.ghostHide?.();
    }

    /** 막혀 못 나가는 사람용 버팀 시계(§5.5 #17-6 (H-3)+(H-6)) — 가장자리를 떠나면 되돌린다. 먼저 선을 띄우고(`EDGE_GHOST_MS`), 남은 동안 변 밖으로 밀다 끝나면 무장한다(나가는 건 손을 뗄 때 — (H-17)). */
    let edgeTimer: number | null = null;
    let edgeArmTimer: number | null = null;
    let edgeStartedAt = 0;
    /** 이 판의 버팀 길이 — 선이 **이미** 떠 있었다면 처음부터 다시 기다리지 않는다. */
    let edgeSpan: number = WINDOW_PULL_OUT.EDGE_DWELL_MS;
    let edgeTarget = { dx: 0, dy: 0 };
    let edgeArmed = false;

    /** @param opts.keepPush 밀어 낸 만큼 그대로 둔다(내보내는 판에서만) — 그 자리가 창이 설 자리다. 되돌리면 선이 튀고 창은 엉뚱한 곳에 선다. */
    function clearEdgeWatch(opts?: { keepPush?: boolean }): void {
      if (edgeTimer !== null) { window.clearInterval(edgeTimer); edgeTimer = null; }
      if (edgeArmTimer !== null) { window.clearTimeout(edgeArmTimer); edgeArmTimer = null; }
      edgeStartedAt = 0;
      edgeArmed = false;
      if (opts?.keepPush) return;
      // 가장자리를 떠났으면 밀어 냈던 만큼도 되돌린다 — 안 되돌리면 선이 그 자리에 어긋난 채 남는다.
      if (ghostPush.dx !== 0 || ghostPush.dy !== 0) {
        ghostPush = { dx: 0, dy: 0 };
        if (ghostOn && ghostKind === 'os') void window.api?.overlay?.ghostNudge?.({ dx: 0, dy: 0 });
        publishGhost();
      }
    }

    function startEdgeWatch(cursor: { x: number; y: number }, vp: { w: number; h: number }): void {
      edgeStartedAt = Date.now();
      edgeSpan = ghostOn ? WINDOW_PULL_OUT.EDGE_DWELL_ARMED_MS : WINDOW_PULL_OUT.EDGE_DWELL_MS;
      edgeTarget = edgeNudgeOffset(cursor, vp);
      edgeTimer = window.setInterval(() => {
        if (handingOff) return;
        const elapsed = Date.now() - edgeStartedAt;
        refreshGhost();
        if (!ghostOn) return;
        // 버팀이 진행된 만큼 선을 그 변 밖으로 밀어 낸다 — 커서가 화면 끝에 막힌 사람에게도
        //   "지금 밖으로 빠지고 있다"가 눈에 보인다(기다리는 동안 보이는 것이 약속뿐이면 안 된다).
        const from = Math.min(WINDOW_PULL_OUT.EDGE_GHOST_MS, edgeSpan);
        const p = Math.max(0, Math.min(1, (elapsed - from) / Math.max(1, edgeSpan - from)));
        ghostPush = { dx: edgeTarget.dx * p, dy: edgeTarget.dy * p };
        if (ghostKind === 'os') {
          void window.api?.overlay?.ghostNudge?.({ dx: Math.round(ghostPush.dx), dy: Math.round(ghostPush.dy) });
        } else {
          publishGhost();
        }
      }, WINDOW_PULL_OUT.EDGE_TICK_MS);
      // 버팀이 끝나는 그 순간 = **무장**하는 순간(나가는 것은 손을 뗄 때다). 시계의 결(32ms)에 맡기지
      //   않고 제 시각에 한 번 친다 — 무장 시점이 결만큼 들쭉날쭉하지 않게.
      edgeArmTimer = window.setTimeout(() => {
        edgeArmTimer = null;
        if (handingOff) return;
        edgeArmed = true;
        refreshGhost();
      }, edgeSpan);
    }

    /** 선을 그릴지·지금 놓으면 나가는지는 **한 곳에서만** 정한다(갈리면 깜빡인다). 문턱은 순수 함수 `pullOutGhostDecision`(IDE 창도 같은 함수). */
    function refreshGhost(): void {
      if (!pullOutDrag || handingOff || !lastRaw) return;
      if (!pullOutRef.current?.enabled) {
        // 그 사이 끌어낼 수 없는 판이 됐다(내보내는 중 · 숨은 프로젝트) — 선도 무장도 거둔다.
        hideGhost();
        setArmed(false);
        return;
      }
      const vp = viewport();
      const want = pullOutGhostDecision({
        beyond: overflowPastClampPosition(lastRaw, vp, cfgRef.current),
        fullyOut: isWindowPulledFullyOut(lastRaw, vp),
        cursor: lastCursor ?? { x: lastRaw.x, y: lastRaw.y },
        vp,
        edgeDwell: edgeTimer !== null && Date.now() - edgeStartedAt >= WINDOW_PULL_OUT.EDGE_GHOST_MS,
        edgeArmed,
        escaped: ghostEscaped,
      });
      // 걸쇠는 판정 **뒤에** 문다 — 이번 프레임의 답은 지금 자리가 정한다.
      if (want.outside) ghostEscaped = true;
      if (want.show) showGhost(want.armed);
      else hideGhost();
      setArmed(ghostOn && ghostArmed);
    }

    /** 끄는 동안 가두지 않았으므로, 앱 안에 놓인(또는 손짓이 끊긴) 자리를 여기서 화면 안으로 되돌린다. */
    function settleInside(): void {
      setGeom((g) => {
        const pos = clampPosition(g.x, g.y, { w: posW, h: posH }, viewport(), cfgRef.current);
        return pos.x === g.x && pos.y === g.y ? g : { ...g, ...pos };
      });
    }

    /** 내보내지 못했다 — 선을 걷고 본체를 앱 안 제자리에 되살린다(실패 안내는 부르는 쪽이 띄운다). */
    function withdraw(): void {
      handingOff = false;
      hideGhost();
      if (dragging) settleInside();
    }

    /**
     * §5.13 (S-10) ⑥ **놓은 그 자리 그 크기 그대로** 내보낸다((H-17) ④ 와 같다). 선은 그 자리에 멈추고(OS 선이 없으면 이 부탁이 세운다),
     * 본체는 숨은 채 둔다 — 새 창이 서기 전에 나타났다 닫히면 그 번쩍임이 잔상이다((H-19)).
     */
    function handOff(po: FloatingWindowPullOut): void {
      handingOff = true;
      const push = { dx: ghostPush.dx, dy: ghostPush.dy };
      const screenPosition = {
        x: lastScreen.x - grabRatioX * posW + push.dx,
        y: lastScreen.y - grabRatioY * posH + push.dy,
      };
      const fromGhost = requestOsGhost(true, true) !== null;
      ghostArmed = true;
      publishGhost();
      let result: unknown;
      try {
        result = po.onRelease({ geom: releaseGeom, screenPosition, fromGhost });
      } catch {
        withdraw();
        return;
      }
      if (isPromiseLike(result)) {
        void result.then((ok) => { if (!ok) withdraw(); }, () => withdraw());
        return;
      }
      // 약속 없이 끝난 부름 — 기다릴 것이 없으니 선을 쥐고 있을 까닭도 없다.
      withdraw();
    }

    function handleMove(ev: MouseEvent): void {
      if (handingOff) return;
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
      lastScreen = { x: ev.screenX, y: ev.screenY };
      if (pullOutDrag) {
        // §5.13 (S-10) ① **끄는 동안에는 가두지 않는다.** `clampPosition` 은 결과를 위한 안전망이라
        //   앱 안에 놓을 때만 건다 — 과정에 걸면 커서는 계속 가는데 창은 최소 가시량 선에서 멈춰,
        //   밖으로 빼려는 손에는 벽으로 잡히고 창은 앱 경계에서 잘린 채 남는다(§5.5 #17-6 (H-6) ①).
        const raw = { x, y, w: posW, h: posH };
        lastRaw = raw;
        lastCursor = { x: ev.clientX, y: ev.clientY };
        releaseGeom = raw;
        const vp = viewport();
        const pinned = isCursorPinnedToViewportEdge(lastCursor, vp);
        if (!pinned) clearEdgeWatch();
        else if (edgeTimer === null) startEdgeWatch(lastCursor, vp);
        refreshGhost();
        // 선이 서 있어도 본체 자리는 계속 맞춘다(숨은 채로) — 선이 꺼지면 손 아래 그 자리에 다시 나타나야 한다.
        setGeom((g) => ({
          x,
          y,
          w: curMode === 'minimized' ? g.w : posW,
          h: curMode === 'minimized' ? g.h : posH,
        }));
        return;
      }
      const pos = clampPosition(x, y, { w: posW, h: posH }, viewport(), cfgNow);
      releaseGeom = { ...pos, w: posW, h: posH };
      setGeom((g) => ({
        ...pos,
        // 셰이드(최소화) 중엔 복원 크기를 건드리지 않는다 — 펼치면 원래 크기로 돌아와야 한다.
        w: curMode === 'minimized' ? g.w : posW,
        h: curMode === 'minimized' ? g.h : posH,
      }));
    }
    bindDrag(handleMove, (committed) => {
      const po = pullOutRef.current;
      // (H-17) 나가는 자리는 **뗌 하나**다 — 선이 무장한 채 손을 뗐을 때만. 언마운트로 강제 정리된 판
      //   (committed=false)에서는 꺼내지 않는다 — 사람이 손을 뗀 것이 아니다.
      const goingOut = committed && dragging && ghostOn && ghostArmed && !!po?.enabled;
      clearEdgeWatch({ keepPush: goingOut });
      stopGhostKeepAlive();
      setArmed(false);
      if (goingOut && po) {
        handOff(po);
        return;
      }
      hideGhost();
      if (pullOutDrag && dragging) settleInside();
    });
  }, [bindDrag]);

  // 우하단 리사이즈 핸들.
  const handleResizeMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || lockRef.current || !enabledRef.current) return;
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
  const handleTitleDoubleClick = useCallback((e: Pick<MouseEvent, 'target'>) => {
    if (lockRef.current || !enabledRef.current) return;
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
    pullOutGhost,
    titleBarProps: { onMouseDown: handleTitleMouseDown, onDoubleClick: handleTitleDoubleClick },
    resizeProps: { onMouseDown: handleResizeMouseDown },
    toggleMaximized,
    toggleMinimized,
    setMode,
  };
}

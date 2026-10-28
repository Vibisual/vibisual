import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { CaptureInputEvent, CaptureInjectResult, CaptureSourceKind } from '@vibisual/shared';
import type { CaptureControlMode } from '../stores/captureBubbleRuntime.js';

// §5.9 원격 조작 — CaptureNode·CaptureWindow 공용. `off / touch / mouse` 한 축, 기본 off(이벤트를 안 잡는다).
// **제스처는 손을 뗀 뒤 한 번에 재생한다** — Windows 는 누르는 동안 Chromium 의 마우스 캡처(SetCapture)가 SendInput 주입을 우리 창으로 되돌린다.
// 터치(절대): 같은 자리 `click` · 멀면 `drag` · 연타 `dblclick`. 마우스(상대): 가상 마우스를 끌어 옮기고(켜면 한가운데) 짧은 탭이 그 자리를 클릭한다 — 실제 마우스는 따라가지 않는다.
// OS 커서는 주입 순간에만 빌려 쓰고 곧 돌려준다.

/** 주입 직후 이 시간(ms) 안에 들어온 이벤트만 반향 후보 — OS 는 주입을 즉시 되돌려 준다. */
const ECHO_WINDOW_MS = 200;
/** 사용자의 실제 포인터 자리에서 이만큼(px) 넘게 튀어 들어왔으면 사람 손이 아니라 반향. */
const ECHO_JUMP_PX = 24;
/** 이 거리(px) 안에서 뗐으면 '탭'(클릭), 넘겼으면 '드래그'. */
const TAP_SLOP_PX = 6;
/** 마우스(트랙패드) 모드의 탭 판정 — 짧게 톡 누르면 조금 흔들려도 클릭이다(6px 같은 작은 문턱이면 클릭이 사라진다). */
const MOUSE_TAP_MAX_MS = 300;
const MOUSE_TAP_SLOP_PX = 10;
/** 연속 두 탭이 이 시간(ms)·거리 안이면 더블클릭으로 재생. */
const DBLCLICK_MS = 320;
const DBLCLICK_SLOP_PX = 12;

const clamp01 = (n: number): number => Math.min(Math.max(n, 0), 1);

const buttonName = (b: number): 'left' | 'right' | 'middle' => (b === 2 ? 'right' : b === 1 ? 'middle' : 'left');

/** 조작 표면(영상 레이어) props — off 면 pointerEvents 가 none. **포인터 이벤트**를 쓴다 — 마우스 이벤트만이면 폰의 손가락 끌기가 스크롤에 먹힌다(`setPointerCapture` 로 밖까지 끌어도 이어진다). */
export interface CaptureSurfaceProps {
  tabIndex: number;
  'data-capture-control': 'on' | 'off';
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerEnter: (e: React.PointerEvent) => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onWheel: (e: React.WheelEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export interface CaptureRemoteControlParams {
  /** 현재 조작 모드. 'off' 면 훅은 완전히 잠잠하다. */
  mode: CaptureControlMode;
  sourceId: string;
  sourceKind: CaptureSourceKind;
  sourceName: string;
  /** 라이브 영상 element — 정규화 좌표(u,v) 계산 기준. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** 조작 표면 element — 가상 커서 좌표계 기준(영상을 감싸는 박스). */
  surfaceRef: RefObject<HTMLElement | null>;
  /** 스트림이 없으면 조작을 자동 해제(허공 주입 방지). */
  stream: MediaStream | null;
  /** 무입력 자동 해제까지의 시간(초). 0=끄기. */
  timeoutSec: number;
  /** 읽기 전용(조작 잠금) — 켜지면 즉시 해제. */
  readOnly: boolean;
  /** "커서 안 움직이기" — 대상 창에 메시지를 직접 넣어 사용자의 커서를 안 건드린다. */
  backgroundClick: boolean;
  /** 스트림 끊김·타임아웃·읽기전용으로 조작을 놓아야 할 때 호출(모드를 'off' 로). */
  onDisengage: () => void;
}

export interface CaptureRemoteControl {
  /** 조작 중(모드가 off 가 아님) — 표면 pointerEvents·강조 링 판단용. */
  active: boolean;
  /** 가상 커서의 표면 기준 px. 표시할 게 없으면 null. */
  cursorPx: { x: number; y: number } | null;
  /** 버튼을 누르고 있는 중 — 오버레이 표시용(아직 주입 전이다). */
  pressing: boolean;
  /** 대상 화면/창을 못 찾아 주입이 안 통하는 상태(창 제목이 바뀐 window 소스 등) — 오버레이가 이유를 알린다. */
  targetMissing: boolean;
  /** 마지막 주입이 실패한 이유(성공·미시도면 null). 오버레이가 칩으로 띄우고 몇 초 뒤 지운다. */
  injectError: NonNullable<CaptureInjectResult['reason']> | null;
  /** "커서 안 움직이기"를 켰는데 이 앱에선 불가능해 커서를 잠깐 빌려 쓴 사유 — 오버레이가 알린다. */
  backgroundFallback: NonNullable<CaptureInjectResult['fallback']> | null;
  /** 표면 CSS cursor — 조작 중엔 `none`(오버레이의 복제 커서가 대신한다). */
  surfaceCursor: string;
  surfaceProps: CaptureSurfaceProps;
  /** 특수키(Esc/Tab/방향키/Ctrl 콤보) 주입. */
  sendSpecialKey: (def: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }) => void;
  /** 브라우저 클립보드 텍스트를 캡처 대상에 타이핑 주입(폰→PC). */
  pasteClipboard: () => Promise<void>;
  /** 영상 메타데이터가 붙은 뒤 가상 커서 위치를 다시 계산(<video onLoadedMetadata>). */
  syncCursorPx: () => void;
}

export function useCaptureRemoteControl({
  mode,
  sourceId,
  sourceKind,
  sourceName,
  videoRef,
  surfaceRef,
  stream,
  timeoutSec,
  readOnly,
  backgroundClick,
  onDisengage,
}: CaptureRemoteControlParams): CaptureRemoteControl {
  const active = mode !== 'off';

  // 가상 커서(정규화 0..1) — ref 로 즉시 갱신, 표시용 px 는 state.
  const vuRef = useRef(0.5);
  const vvRef = useRef(0.5);
  const [cursorPx, setCursorPx] = useState<{ x: number; y: number } | null>(null);
  const [pressing, setPressing] = useState(false);
  const [targetMissing, setTargetMissing] = useState(false);
  // 마지막 주입 실패 이유(성공하면 null) — 오버레이가 "왜 안 먹었는지"를 알려 준다.
  const [injectError, setInjectError] = useState<NonNullable<CaptureInjectResult['reason']> | null>(null);
  const [backgroundFallback, setBackgroundFallback] = useState<NonNullable<CaptureInjectResult['fallback']> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 지금 화면에 닿아 있는 손가락들 — 두 개면 우클릭(모바일 트랙패드 관행).
  const touchPointersRef = useRef<Set<number>>(new Set());
  // 진행 중인 누름 — 시작 정규화 좌표 + 시작 화면좌표(탭/드래그 판정) + 버튼 + 포인터 id(멀티터치 구분).
  // `button`·`twoFinger` 는 두 번째 손가락이 닿는 순간 갱신된다(한 손가락=좌클릭, 두 손가락=우클릭).
  const pressRef = useRef<
    { button: number; pointerId: number; u: number; v: number; clientX: number; clientY: number; at: number; twoFinger?: boolean } | null
  >(null);
  // 직전 포인터 위치(마우스 모드 상대 이동용).
  const lastPointerRef = useRef({ x: 0, y: 0 });
  // 직전 탭 — 더블클릭 판정용(시각 + 정규화 좌표 + 버튼).
  const lastTapRef = useRef<{ at: number; u: number; v: number; button: number } | null>(null);
  // 무입력 타임아웃용 — 마지막 주입 시각.
  const lastInputRef = useRef(0);
  // 반향 판정용 — 마지막 주입 시각 + 사용자의 실제 포인터가 마지막으로 있던 자리(반향 샘플은 제외 추적).
  const lastInjectRef = useRef(0);
  const hoverRef = useRef({ x: 0, y: 0 });

  // onDisengage 는 호출부에서 매 렌더 새로 만들어질 수 있어 ref 로 고정(effect 재실행 방지).
  const disengageRef = useRef(onDisengage);
  disengageRef.current = onDisengage;

  const sendInput = useCallback((ev: CaptureInputEvent) => {
    lastInputRef.current = performance.now();
    lastInjectRef.current = lastInputRef.current;
    const payload: CaptureInputEvent =
      ev.type === 'mouse' && backgroundClick ? { ...ev, preferBackgroundClick: true } : ev;
    const pending = window.api?.capture?.sendInput?.(payload);
    if (!pending) return;
    // 주입 실패면 이유를 띄우고(삼키면 "클릭이 안 먹는다"로만 보인다), 성공하면 조용히 지운다.
    void Promise.resolve(pending)
      .then((res) => {
        if (!res || typeof res !== 'object') return; // 구버전 preload — 성패를 알 수 없다
        if (res.ok) {
          setInjectError(null);
          // 배경 클릭을 켰는데 커서 경로로 되돌아갔으면 그 이유를 알린다(성공이지만 커서가 움직였다).
          setBackgroundFallback(res.method === 'cursor' && res.fallback ? res.fallback : null);
          return;
        }
        setInjectError(res.reason ?? 'error');
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        errorTimerRef.current = setTimeout(() => setInjectError(null), 4000);
      })
      .catch(() => { /* IPC 자체 실패 — 무시 */ });
  }, [backgroundClick]);

  /** 우리가 방금 주입한 입력이 이 창으로 되돌아온 것인가(자기 화면 캡처 시의 반향). */
  const isEcho = useCallback((clientX: number, clientY: number): boolean => {
    if (performance.now() - lastInjectRef.current > ECHO_WINDOW_MS) return false;
    return Math.hypot(clientX - hoverRef.current.x, clientY - hoverRef.current.y) > ECHO_JUMP_PX;
  }, []);

  const inputBase = useCallback(() => ({ sourceId, sourceKind, sourceName }), [sourceId, sourceKind, sourceName]);

  /** 이벤트 화면좌표 → 캡처 콘텐츠 정규화 좌표(object-fit:contain 레터박스 보정). */
  const normFromEvent = useCallback((clientX: number, clientY: number): { u: number; v: number } | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const rect = video.getBoundingClientRect();
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const dispW = video.videoWidth * scale;
    const dispH = video.videoHeight * scale;
    const offX = rect.left + (rect.width - dispW) / 2;
    const offY = rect.top + (rect.height - dispH) / 2;
    return { u: clamp01((clientX - offX) / dispW), v: clamp01((clientY - offY) / dispH) };
  }, [videoRef]);

  /** 표면 안에서 object-fit:contain 으로 실제 표시되는 영상 영역(px, 표면 기준). 가상 커서 좌표 변환용. */
  const displayMetrics = useCallback((): { dispW: number; dispH: number; offX: number; offY: number } | null => {
    const video = videoRef.current;
    const surface = surfaceRef.current;
    if (!video || !surface || !video.videoWidth || !video.videoHeight) return null;
    const rect = surface.getBoundingClientRect();
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const dispW = video.videoWidth * scale;
    const dispH = video.videoHeight * scale;
    return { dispW, dispH, offX: (rect.width - dispW) / 2, offY: (rect.height - dispH) / 2 };
  }, [videoRef, surfaceRef]);

  /** 정규화 좌표 → 표면 기준 px(오버레이 표시용). */
  const pxFromNorm = useCallback((u: number, v: number): { x: number; y: number } | null => {
    const m = displayMetrics();
    if (!m) return null;
    return { x: m.offX + u * m.dispW, y: m.offY + v * m.dispH };
  }, [displayMetrics]);

  /** 가상 커서를 그릴지. 좌표(vu/vv)는 두 모드 모두 추적한다 — 재생에 필요하다. */
  // 두 모드 모두 **진짜 커서를 숨기고(cursor:none) 같은 모양의 복제 커서**를 그린다 — 주입 때 진짜 커서가 대상에 다녀와도 안 보인다. 터치는 포인터 1:1, 마우스는 가상 포인터 자리.
  const showVirtualCursor = true;

  const syncCursorPx = useCallback(() => {
    setCursorPx(showVirtualCursor ? pxFromNorm(vuRef.current, vvRef.current) : null);
  }, [pxFromNorm, showVirtualCursor]);

  /** 가상 커서를 (u,v) 로 옮기고(마우스 모드면) 표시 좌표까지 갱신. */
  const moveVirtual = useCallback((u: number, v: number) => {
    vuRef.current = clamp01(u);
    vvRef.current = clamp01(v);
    if (!showVirtualCursor) return;
    const p = pxFromNorm(vuRef.current, vvRef.current);
    if (p) setCursorPx(p);
  }, [pxFromNorm, showVirtualCursor]);

  // 모드를 켜거나 바꾸면 가상 마우스를 화면 한가운데에서 새로 시작한다(켜는 순간 가운데에 포인터가 생기는 게 약속).
  useEffect(() => {
    // 모드가 바뀌면 반향 창을 닫아 둔다(직전 세션의 주입 시각 때문에 첫 조작이 반향으로 오인되지 않게).
    lastInjectRef.current = 0;
    lastTapRef.current = null;
    if (active && stream) {
      vuRef.current = 0.5;
      vvRef.current = 0.5;
      syncCursorPx();
    } else {
      setCursorPx(null);
    }
  }, [mode, active, stream, syncCursorPx]);

  // 조작을 켤 때 대상(화면/창)이 실제로 잡히는지 미리 확인 — 창 제목이 바뀐 소스는 여기서 걸린다.
  useEffect(() => {
    if (!active) { setTargetMissing(false); return; }
    const probe = window.api?.capture?.targetRect;
    if (!probe) { setTargetMissing(false); return; }
    let cancelled = false;
    void probe({ sourceId, sourceKind, sourceName })
      .then((rect) => { if (!cancelled) setTargetMissing(!rect.ok); })
      .catch(() => { if (!cancelled) setTargetMissing(false); });
    return () => { cancelled = true; };
  }, [active, sourceId, sourceKind, sourceName]);

  // 스트림이 끊기면 조작 해제(허공에 입력 주입 방지).
  useEffect(() => {
    if (!stream && active) disengageRef.current();
  }, [stream, active]);

  // 읽기 전용(권한 분리) — 잠그면 진행 중인 조작도 즉시 해제.
  useEffect(() => {
    if (readOnly && active) disengageRef.current();
  }, [readOnly, active]);

  // 무입력이 설정 시간을 넘으면 조작 자동 해제(원격 방치 안전).
  useEffect(() => {
    if (!active || timeoutSec <= 0) return;
    lastInputRef.current = performance.now();
    const iv = setInterval(() => {
      if (performance.now() - lastInputRef.current > timeoutSec * 1000) disengageRef.current();
    }, 1000);
    return () => clearInterval(iv);
  }, [active, timeoutSec]);

  // 진행 중인 누름의 window 리스너 정리 함수(언마운트·조작 해제 시 강제 정리).
  const pressCleanupRef = useRef<(() => void) | null>(null);

  /** 진행 중인 누름을 주입 없이 버린다(조작 해제·언마운트 — 아직 아무것도 주입되지 않았으므로 안전). */
  const abortPress = useCallback(() => {
    pressCleanupRef.current?.();
    pressCleanupRef.current = null;
    pressRef.current = null;
    setPressing(false);
  }, []);

  useEffect(() => {
    if (!active) abortPress();
  }, [active, abortPress]);
  useEffect(() => () => abortPress(), [abortPress]);

  // 닿아 있는 손가락 집계 — 두 손가락 우클릭 판정의 근거. 표면 밖에서 떼는 경우까지 세려면 window 에서.
  useEffect(() => {
    if (!active) return;
    const drop = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') touchPointersRef.current.delete(e.pointerId);
    };
    window.addEventListener('pointerup', drop, true);
    window.addEventListener('pointercancel', drop, true);
    return () => {
      window.removeEventListener('pointerup', drop, true);
      window.removeEventListener('pointercancel', drop, true);
      touchPointersRef.current.clear();
    };
  }, [active]);

  // 실패 칩 타이머 정리.
  useEffect(() => () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current); }, []);

  const onPointerEnter = useCallback((e: React.PointerEvent) => {
    if (!active) return;
    hoverRef.current = { x: e.clientX, y: e.clientY };
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    // 터치는 들어온 그 지점이 곧 조작 지점. 마우스(상대)는 밀어 둔 가상 커서를 그대로 유지한다.
    if (mode === 'touch') {
      const n = normFromEvent(e.clientX, e.clientY);
      if (n) moveVirtual(n.u, n.v);
      return;
    }
    syncCursorPx();
  }, [active, mode, normFromEvent, moveVirtual, syncCursorPx]);

  /** 손을 뗀 시점에 제스처 하나를 원자적으로 재생한다 — 쥔 동안엔 Windows 마우스 캡처가 우리 창을 물어 주입이 대상에 안 닿는다. 커서는 main 이 빌리고 곧 돌려준다. */
  const replayGesture = useCallback((press: NonNullable<typeof pressRef.current>) => {
    if (targetMissing) return; // 대상을 못 찾는 상태면 주입해도 허공 — 오버레이가 이유를 표시한다.
    const button = buttonName(press.button);
    const endU = vuRef.current;
    const endV = vvRef.current;
    const p0 = pxFromNorm(press.u, press.v);
    const p1 = pxFromNorm(endU, endV);
    const movedPx = p0 && p1 ? Math.hypot(p1.x - p0.x, p1.y - p0.y) : 0;

    // 두 손가락 제스처는 언제나 "우클릭 탭"이다 — 두 손가락이 조금 흔들렸다고 드래그로 보지 않는다.
    const twoFinger = press.twoFinger === true;

    // 마우스(상대) 모드 = 화면 안 가상 마우스를 **드래그 앤 드롭으로 옮기고, 탭하면 그 자리를 클릭**.
    //   · 끌어서 옮긴 것(길게/멀리) → 포인터 이동일 뿐, 대상에는 아무것도 주입하지 않는다.
    //   · 짧게 톡 누른 것 → 조금 흔들렸더라도 **가상 마우스가 있는 그 지점을 클릭**한다.
    if (!twoFinger && mode === 'mouse') {
      const heldMs = performance.now() - press.at;
      const isTap = movedPx <= TAP_SLOP_PX || (heldMs <= MOUSE_TAP_MAX_MS && movedPx <= MOUSE_TAP_SLOP_PX);
      if (!isTap) return;
    }

    // 터치(절대) 모드에서 손이 충분히 움직였으면 그 구간을 진짜 드래그로 재생.
    if (!twoFinger && mode === 'touch' && movedPx > TAP_SLOP_PX) {
      lastTapRef.current = null;
      sendInput({
        type: 'mouse', ...inputBase(), action: 'drag',
        u: press.u, v: press.v, u2: endU, v2: endV,
        button, restoreCursor: true,
      });
      return;
    }

    // 탭 — 직전 탭과 가까우면 더블클릭, 아니면 클릭.
    const now = performance.now();
    const prev = lastTapRef.current;
    const prevPx = prev ? pxFromNorm(prev.u, prev.v) : null;
    const isDouble = !!prev && prev.button === press.button && now - prev.at < DBLCLICK_MS
      && (!prevPx || !p1 || Math.hypot(p1.x - prevPx.x, p1.y - prevPx.y) < DBLCLICK_SLOP_PX);
    lastTapRef.current = isDouble ? null : { at: now, u: endU, v: endV, button: press.button };
    sendInput({
      type: 'mouse', ...inputBase(), action: isDouble ? 'dblclick' : 'click',
      u: endU, v: endV, button, restoreCursor: true,
    });
  }, [targetMissing, mode, pxFromNorm, sendInput, inputBase]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!active) return;
    e.stopPropagation();
    // 우리가 주입한 클릭이 되돌아온 반향이면 새 제스처로 삼지 않는다(재주입 연쇄 차단).
    if (isEcho(e.clientX, e.clientY)) return;

    // 두 손가락 탭 = 우클릭(폰엔 오른쪽 버튼이 없다). 두 번째 손가락은 새 제스처를 열지 않고 진행 중인 제스처를 우클릭으로 바꾸기만 한다.
    if (e.pointerType === 'touch') {
      touchPointersRef.current.add(e.pointerId);
      const inProgress = pressRef.current;
      if (inProgress && touchPointersRef.current.size >= 2) {
        inProgress.button = 2;
        inProgress.twoFinger = true;
        return;
      }
    }
    // 앞선 누름이 아직 안 끝났으면(두 버튼 동시 누르기·멀티터치) 그 대기 리스너를 걷어낸다 — 제스처는
    // 한 번에 하나만 추적한다(아직 아무것도 주입되지 않았으므로 버려도 대상 상태는 그대로다).
    pressCleanupRef.current?.();
    (surfaceRef.current as HTMLElement | null)?.focus?.();
    // 포인터 캡처 — 손가락·마우스가 버블 밖으로 나가도 이동/뗌이 계속 이 표면으로 온다(모바일 필수).
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 미지원 환경 무시 */ }
    hoverRef.current = { x: e.clientX, y: e.clientY };
    lastPointerRef.current = { x: e.clientX, y: e.clientY };

    // 누를 지점 확정 — 터치(절대)는 지금 짚은 곳, 마우스(상대)는 밀어 둔 가상 커서 자리.
    if (mode === 'touch') {
      const n = normFromEvent(e.clientX, e.clientY);
      if (n) moveVirtual(n.u, n.v);
    }
    const press = {
      button: e.button,
      pointerId: e.pointerId,
      u: vuRef.current,
      v: vvRef.current,
      clientX: e.clientX,
      clientY: e.clientY,
      at: performance.now(),
    };
    pressRef.current = press;
    setPressing(true);

    // 손 떼기는 **window** 에서 듣는다 — 표면 밖에서 떼도(드래그가 버블 경계를 넘어가는 흔한 경우)
    // 제스처가 조용히 사라지지 않게. 여기서 비로소 주입이 일어난다.
    const finish = (ev: PointerEvent): void => {
      if (ev.pointerId !== press.pointerId) return;
      cleanup();
      if (pressRef.current !== press) return;
      pressRef.current = null;
      setPressing(false);
      // pointercancel(전화 수신·제스처 가로채기 등)은 제스처가 무효라 주입하지 않는다.
      if (ev.type === 'pointerup') replayGesture(press);
    };
    function cleanup(): void {
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      // 자기 것일 때만 비운다 — 뒤이어 시작된 다른 누름의 정리 함수를 지우지 않게.
      if (pressCleanupRef.current === cleanup) pressCleanupRef.current = null;
    }
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    pressCleanupRef.current = cleanup;
  }, [active, isEcho, surfaceRef, mode, normFromEvent, moveVirtual, replayGesture]);

  // 표면에서 손을 떼는 경로는 window 리스너가 담당한다 — 여기선 전파만 끊는다(캔버스 오작동 방지).
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!active) return;
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* 이미 풀렸으면 무시 */ }
  }, [active]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!active) return;
    if (isEcho(e.clientX, e.clientY)) return;
    const prev = lastPointerRef.current;
    hoverRef.current = { x: e.clientX, y: e.clientY };
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    if (mode === 'touch') {
      // 터치(절대) — 가리킨 그 지점이 곧 조작 지점. 누르고 끄는 중이면 그게 곧 드래그 끝점이 된다.
      const n = normFromEvent(e.clientX, e.clientY);
      if (n) moveVirtual(n.u, n.v);
      return;
    }
    // 마우스(트랙패드·상대) — **누르고 끄는 동안에만** 가상 마우스가 움직인다. hover 로 실제 마우스를 따라가게 하지 마라 — '커서 미러'가 되고 폰엔 hover 가 없다.
    if (!pressRef.current) return;
    const m = displayMetrics();
    if (!m) return;
    moveVirtual(
      vuRef.current + (e.clientX - prev.x) / m.dispW,
      vvRef.current + (e.clientY - prev.y) / m.dispH,
    );
  }, [active, isEcho, mode, normFromEvent, moveVirtual, displayMetrics]);

  // 가상 마우스는 표면을 벗어나도 그 자리에 남는다 — 손을 따르는 표시가 아니라 대상 위에 놓인 포인터다.
  const onPointerLeave = useCallback(() => {
    /* 유지 — 지우지 않는다. */
  }, []);

  // 제스처가 무효화되면(전화 수신·시스템 제스처 가로채기 등) 주입 없이 버린다.
  const onPointerCancel = useCallback(() => {
    abortPress();
  }, [abortPress]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!active) return;
    e.stopPropagation();
    // 주입한 스크롤이 되돌아온 반향이면 버린다 — 가상 커서는 고정 지점이라 그대로 재주입하면 루프가 된다.
    if (isEcho(e.clientX, e.clientY)) return;
    if (targetMissing) return;
    if (mode === 'touch') {
      const n = normFromEvent(e.clientX, e.clientY);
      if (n) moveVirtual(n.u, n.v);
    }
    sendInput({
      type: 'mouse', ...inputBase(), action: 'wheel', u: vuRef.current, v: vvRef.current,
      deltaY: Math.sign(e.deltaY) * 3, restoreCursor: true,
    });
  }, [active, isEcho, targetMissing, mode, normFromEvent, moveVirtual, sendInput, inputBase]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!active) return;
    e.stopPropagation();
    e.preventDefault(); // 캔버스 Delete/단축키가 캡처 버블을 지우지 않도록 + 브라우저 기본동작 차단
    const printable = e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
    if (printable) {
      sendInput({ type: 'key', ...inputBase(), action: 'type', text: e.key });
    } else {
      sendInput({ type: 'key', ...inputBase(), action: 'press', key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
    }
  }, [active, sendInput, inputBase]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
  }, [active]);

  const sendSpecialKey = useCallback((def: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }) => {
    (surfaceRef.current as HTMLElement | null)?.focus?.();
    sendInput({ type: 'key', ...inputBase(), action: 'press', key: def.key, ctrl: def.ctrl, shift: def.shift, alt: def.alt, meta: def.meta });
  }, [sendInput, inputBase, surfaceRef]);

  const pasteClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) sendInput({ type: 'key', ...inputBase(), action: 'type', text });
    } catch { /* 클립보드 권한 없음/빈 값 — 무시 */ }
  }, [sendInput, inputBase]);

  return {
    active,
    cursorPx,
    pressing,
    targetMissing,
    injectError,
    backgroundFallback,
    // 조작 중엔 진짜 커서를 숨긴다 — 복제 커서가 대신해 주입 때 진짜 커서가 대상에 다녀오는 것이 안 보인다.
    surfaceCursor: active ? 'none' : 'default',
    surfaceProps: {
      tabIndex: active ? 0 : -1,
      'data-capture-control': active ? 'on' : 'off',
      onPointerDown,
      onPointerUp,
      onPointerMove,
      onPointerEnter,
      onPointerLeave,
      onPointerCancel,
      onWheel,
      onKeyDown,
      onContextMenu,
    },
    sendSpecialKey,
    pasteClipboard,
    syncCursorPx,
  };
}

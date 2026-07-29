// §5.9 v3.34 — 캡처 버블 "앱 내부 멀티 윈도우" z-order + Escape(최상단만) 관리.
//
// 여러 캡처 창(CaptureWindow)이 document.body 로 portal 되어 동시에 뜰 수 있다(버블마다 하나).
// 이 모듈이 창들 사이의 두 가지 공유 관심사를 담당한다.
//   1) z-order — 클릭(mousedown)한 창을 맨 앞으로 올린다(bringToFront). 각 창의 로컬 zIndex state 는
//      여기서 발급한 단조 증가 z 값을 반영한다.
//   2) Escape — 어느 창에 포커스가 있든 Escape 는 "가장 앞(z 최대)" 창 하나만 닫는다. 각 창이 제
//      Escape 리스너를 붙이면 여러 개가 동시에 닫혀 버리므로, 전역 리스너 하나로 최상단만 닫는다.
//
// 순수 스택 로직(등록/최상단/앞으로)은 window 바인딩과 분리해 단위 테스트 가능하게 두었다.

/** 캡처 창 base z — 앱 UI(수십~수백)·IDE 오버레이(z-50)보다 확실히 위, 32-bit 상한 여유. */
const CAPTURE_WINDOW_Z_BASE = 1_000_000;
/** 계단식 초기 위치 오프셋 — 새 창이 정확히 겹치지 않게 순환. */
const CASCADE_STEPS = 6;
const CASCADE_PX = 32;

interface CaptureWindowEntry {
  z: number;
  close: () => void;
}

const entries = new Map<number, CaptureWindowEntry>();
let uidSeq = 0;
let zSeq = CAPTURE_WINDOW_Z_BASE;
let escBound = false;

/** 현재 등록된 창 중 z 가 가장 큰(맨 앞) uid. 없으면 -1. */
export function topCaptureWindowUid(): number {
  let topUid = -1;
  let topZ = -Infinity;
  for (const [uid, e] of entries) {
    if (e.z > topZ) {
      topZ = e.z;
      topUid = uid;
    }
  }
  return topUid;
}

/** 최상단(z 최대) 캡처 창 하나를 닫는다. 닫았으면 true. Escape 핸들러 + 테스트에서 사용. */
export function closeTopCaptureWindow(): boolean {
  const uid = topCaptureWindowUid();
  if (uid < 0) return false;
  const entry = entries.get(uid);
  if (!entry) return false;
  entry.close();
  return true;
}

function handleEsc(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return;
  // 최상단 캡처 창만 닫고, 닫았을 때만 전파를 끊는다(IDE 오버레이 등 다른 Escape 핸들러가 함께 반응하지 않게).
  if (closeTopCaptureWindow()) ev.stopPropagation();
}

function ensureEscListener(): void {
  if (escBound || typeof window === 'undefined') return;
  window.addEventListener('keydown', handleEsc, true);
  escBound = true;
}

function maybeRemoveEscListener(): void {
  if (!escBound || entries.size > 0 || typeof window === 'undefined') return;
  window.removeEventListener('keydown', handleEsc, true);
  escBound = false;
}

export interface CaptureWindowHandle {
  /** 이 창의 고유 id. */
  uid: number;
  /** 마운트 시 초기 zIndex. */
  initialZ: number;
  /** 계단식 초기 위치 오프셋(px) — 여러 창이 겹치지 않게. */
  cascadeOffset: number;
  /** 이 창을 맨 앞으로 올린다. 새 zIndex 를 반환. */
  bringToFront: () => number;
  /** 등록 해제(언마운트 시). */
  release: () => void;
}

/**
 * 캡처 창을 매니저에 등록한다. 첫 등록 시 전역 Escape 리스너를 붙이고, 마지막 창이 release 되면 뗀다.
 * @param close 이 창을 닫는 콜백(Escape 로 최상단이 이 창일 때 호출).
 */
export function registerCaptureWindow(close: () => void): CaptureWindowHandle {
  const uid = ++uidSeq;
  const initialZ = ++zSeq;
  entries.set(uid, { z: initialZ, close });
  ensureEscListener();
  return {
    uid,
    initialZ,
    cascadeOffset: (uid % CASCADE_STEPS) * CASCADE_PX,
    bringToFront(): number {
      const entry = entries.get(uid);
      if (!entry) return zSeq;
      entry.z = ++zSeq;
      return entry.z;
    },
    release(): void {
      entries.delete(uid);
      maybeRemoveEscListener();
    },
  };
}

/** 테스트 전용 — 모듈 싱글턴 상태 초기화. */
export function __resetCaptureWindowsForTest(): void {
  entries.clear();
  uidSeq = 0;
  zSeq = CAPTURE_WINDOW_Z_BASE;
  if (escBound && typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleEsc, true);
  }
  escBound = false;
}

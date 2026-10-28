// §5.9 — 캡처 창들의 z-order(mousedown 한 창을 단조 증가 z 로 앞으로)와 Escape(z 최대 하나만 — 창마다 리스너면 한꺼번에 닫혀 전역 하나로).
// 순수 스택은 window 바인딩과 분리해 시험한다.

import { selectShellImmersive, useProjectImmersionStore } from '../../stores/projectImmersion.js';

/** 캡처 창 base z — 앱 UI(수십~수백)·IDE 오버레이(z-50)보다 확실히 위, 32-bit 상한 여유. */
const CAPTURE_WINDOW_Z_BASE = 1_000_000;
/** 계단식 초기 위치 오프셋 — 새 창이 정확히 겹치지 않게 순환. */
const CASCADE_STEPS = 6;
const CASCADE_PX = 32;

interface CaptureWindowEntry {
  z: number;
  close: () => void;
  isVisible: () => boolean;
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
    if (!e.isVisible()) continue;
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

/** §5.5 #17-27 ⑳ — 파일 창의 Esc 는 그 편집기 것이다. 파일 창은 이 스택 대상이 아니라 여기서 걸러야 뒤에 선 다른 창이 닫히지 않는다. */
export function escBelongsToFileWindow(target: unknown): boolean {
  const el = target as { closest?: unknown } | null | undefined;
  if (!el || typeof el.closest !== 'function') return false;
  return !!(el.closest as (selector: string) => unknown).call(el, '[data-file-window]');
}

function handleEsc(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return;
  // This listener can predate immersion. Let the project shell restore its layout first.
  if (selectShellImmersive(useProjectImmersionStore.getState())) return;
  if (escBelongsToFileWindow(ev.target)) return;
  // 이 누름으로 비동기 확인 팝업이 열릴 수 있다. 같은 window의 다른 캡처 리스너도 멈춰야
  // 팝업을 연 Escape가 뒤에 있던 편집창/메뉴까지 닫지 않는다.
  if (closeTopCaptureWindow()) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }
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

/** 첫 등록에 전역 Escape 리스너를 붙이고 마지막 release 에 뗀다. */
export function registerCaptureWindow(close: () => void, isVisible: () => boolean = () => true): CaptureWindowHandle {
  const uid = ++uidSeq;
  const initialZ = ++zSeq;
  entries.set(uid, { z: initialZ, close, isVisible });
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

import { useCallback } from 'react';
import { create } from 'zustand';

// §5.9 캡처 버블 — 이 세션에서만 의미 있는 조작 상태(비영속). CaptureNode 와 CaptureBubbleDetail 이 함께 봐서 버블 id 별 런타임 스토어에 둔다.

/**
 * 원격 조작 모드 — 모드를 고르는 순간이 조작 시작, 그 외엔 off. 'off' = 입력을 캡처 대상에 전혀 반영하지 않는다 ·
 * 'touch' = 절대 좌표(탭한 지점 클릭) · 'mouse' = 상대 좌표(가상 커서를 밀어 옮기고 탭하면 그 위치 클릭).
 */
export type CaptureControlMode = 'off' | 'touch' | 'mouse';

export interface CaptureRuntime {
  /** 스트림을 내려 데이터·CPU 절감(일시정지). */
  frozen: boolean;
  /** 원격 조작 모드 — 'off' 가 아니면 조작 표면이 pointer/key 를 잡아 OS 로 주입. */
  controlMode: CaptureControlMode;
  /** 라이브 영상을 앱 내부 IDE식 창(CaptureWindow)으로 크게 보는 중. */
  expanded: boolean;
}

export const DEFAULT_CAPTURE_RUNTIME: CaptureRuntime = {
  frozen: false,
  controlMode: 'off',
  expanded: false,
};

interface CaptureRuntimeState {
  runtime: Record<string, CaptureRuntime>;
  setRuntime: (id: string, patch: Partial<CaptureRuntime>) => void;
}

export const useCaptureRuntimeStore = create<CaptureRuntimeState>((set, get) => ({
  runtime: {},
  setRuntime: (id, patch): void => {
    const cur = get().runtime[id] ?? DEFAULT_CAPTURE_RUNTIME;
    set({ runtime: { ...get().runtime, [id]: { ...cur, ...patch } } });
  },
}));

/** 특정 버블의 런타임 상태 + 부분 갱신 setter. 항목이 없으면 기본값을 돌려준다. */
export function useCaptureRuntime(id: string): [CaptureRuntime, (patch: Partial<CaptureRuntime>) => void] {
  const runtime = useCaptureRuntimeStore((s) => s.runtime[id]) ?? DEFAULT_CAPTURE_RUNTIME;
  const setRuntimeRaw = useCaptureRuntimeStore((s) => s.setRuntime);
  const set = useCallback((patch: Partial<CaptureRuntime>) => setRuntimeRaw(id, patch), [id, setRuntimeRaw]);
  return [runtime, set];
}

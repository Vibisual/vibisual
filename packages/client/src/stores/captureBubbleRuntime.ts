import { useCallback } from 'react';
import { create } from 'zustand';

// §5.9 캡처 버블 — "지금 이 세션에서만" 의미 있는 조작 상태(비영속).
//
// frozen(일시정지)·controlMode(원격 조작 모드)·expanded(크게 보기 창)는 화질/핀 같은 취향(prefs)
// 과 달리 앱을 다시 켜면 초기화되는 게 맞다. 다만 헤더에 몰려 있던 조작을 DetailPanel 로 옮기면서
// CaptureNode(본체 영상 로직)와 CaptureBubbleDetail(설정 패널)이 같은 상태를 봐야 하므로,
// 컴포넌트 지역 useState 대신 버블 id 별 전역 런타임 스토어로 끌어올린다(localStorage 미저장).

/**
 * 원격 조작 모드 (v3.43) — "조작 켜기"와 "포인터 방식"을 하나의 축으로 합친 3상태.
 *  · 'off'   = 기본. 캔버스 버블도 크게 보기 창도 마우스/키보드를 캡처 대상에 **전혀 반영하지 않는다**.
 *  · 'touch' = 절대 좌표. 표면에서 탭한 그 지점을 캡처 대상에서 클릭(터치스크린처럼).
 *  · 'mouse' = 상대 좌표. 표면을 밀어 오버레이 가상 커서를 옮기고 탭하면 그 커서 위치를 클릭(크롬 원격식).
 *
 * 종전엔 controlMode(불리언) + prefs.pointerMode(localStorage 취향) 2축이라 "켜져 있는지"와 "어떤
 * 방식인지"가 갈려 있었다. 사용자가 모드를 직접 고르는 순간이 곧 조작 시작 — 그 외엔 항상 off.
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

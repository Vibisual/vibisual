import { useEffect } from 'react';
import { create } from 'zustand';

// §4 (첫 실행 온보딩) — "가로막는 게이트가 떠 있는가" 신호. 게이트 백드롭(`fixed inset-0`)이 헤더의 언어 전환기(모국어로 바꿀 첫 입구)를 덮으므로
// 그동안 전환기를 위로 띄운다. 서로 모르는 게이트·헤더가 작은 스토어로 등록만 주고받는다(서버·영속 ❌).

export type OnboardingGateId = 'setup' | 'login' | 'projectFolder' | 'version';

interface OnboardingGateState {
  /** 지금 열려 있는 게이트들. 빈 배열이면 화면을 가로막는 창이 없다. */
  openGates: readonly OnboardingGateId[];
  setGateOpen: (id: OnboardingGateId, open: boolean) => void;
}

export const useOnboardingGateStore = create<OnboardingGateState>((set) => ({
  openGates: [],
  setGateOpen: (id, open) =>
    set((s) => {
      const had = s.openGates.includes(id);
      // 같은 값이면 상태를 그대로 둔다 — 새 배열을 만들면 구독자가 매번 새 참조를 받는다.
      if (had === open) return s;
      return { openGates: open ? [...s.openGates, id] : s.openGates.filter((g) => g !== id) };
    }),
}));

/**
 * 게이트가 열려 있는 동안만 등록한다. 언마운트되면 자동으로 해제되므로
 * (창이 조건부로 `return null` 하더라도) 열림 표시가 남아 떠도는 일이 없다.
 */
export function useOnboardingGate(id: OnboardingGateId, open: boolean): void {
  useEffect(() => {
    const { setGateOpen } = useOnboardingGateStore.getState();
    setGateOpen(id, open);
    return () => useOnboardingGateStore.getState().setGateOpen(id, false);
  }, [id, open]);
}

/** 화면을 가로막는 창이 하나라도 떠 있는가 — 원시값이라 파생 선택자 함정이 없다. */
export function useAnyOnboardingGateOpen(): boolean {
  return useOnboardingGateStore((s) => s.openGates.length > 0);
}

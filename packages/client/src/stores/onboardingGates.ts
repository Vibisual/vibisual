import { useEffect } from 'react';
import { create } from 'zustand';

// §4 (첫 실행 온보딩) — "지금 화면을 가로막는 창이 하나라도 떠 있는가" 하나만 나눠 갖는 신호.
//
// 설치·로그인·폴더·버전 게이트는 전부 `fixed inset-0` 백드롭을 깔아 **헤더까지 덮는다**.
// 헤더 오른쪽 언어 전환기는 그 밑에 깔려 눌리지 않으므로(처음 켠 사람에게는 앱을 모국어로
// 바꿀 첫 입구다), 그 동안만 전환기를 창 위로 띄워야 한다 — 그러려면 헤더가 "지금 게이트가
// 열려 있다"를 알아야 한다. 창끼리는 서로를 모르고 헤더와도 부모-자식이 아니라, 아주 작은
// 스토어 하나로 등록만 주고받는다(서버 비관여 · 영속 없음 · 순수 표시 상태).

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

import { create } from 'zustand';

// §4 가시성 LOD — 캔버스가 다른 UI 에 덮여 있는가(비영속). IDE 오버레이는 BubbleMap 자식이라 다 덮여도 React Flow·물리 rAF 가 돈다
// (물리 절전은 `document.hidden` 만 본다). 덮개가 여럿이라 각 덮개가 키로 신고하고, 하나라도 있으면 covered=true.

interface CanvasVisibilityState {
  /** 등록된 덮개 키 집합 — 하나라도 있으면 캔버스가 안 보인다. */
  covers: string[];
  /** covers.length > 0 (구독 편의를 위한 파생 비트). */
  covered: boolean;
  setCover: (key: string, covered: boolean) => void;
}

export const useCanvasVisibilityStore = create<CanvasVisibilityState>((set) => ({
  covers: [],
  covered: false,
  setCover: (key, covered): void => {
    set((s) => {
      const has = s.covers.includes(key);
      if (covered === has) return s; // 같은 상태 재신고는 리렌더 유발 ❌
      const covers = covered ? [...s.covers, key] : s.covers.filter((k) => k !== key);
      return { covers, covered: covers.length > 0 };
    });
  },
}));

/** 덮개 등록/해제 — 오버레이 컴포넌트가 useEffect 로 부른다. */
export function setCanvasCover(key: string, covered: boolean): void {
  useCanvasVisibilityStore.getState().setCover(key, covered);
}

/** 훅 밖(rAF 루프 등)에서 쓰는 즉시 조회 — 구독 없이 현재 값만 본다. */
export function isCanvasCovered(): boolean {
  return useCanvasVisibilityStore.getState().covered;
}

/** covered 비트가 바뀔 때만 콜백 — 멈춰 있던 루프를 다시 점화할 때 쓴다. */
export function subscribeCanvasCovered(cb: (covered: boolean) => void): () => void {
  return useCanvasVisibilityStore.subscribe((s, prev) => {
    if (s.covered !== prev.covered) cb(s.covered);
  });
}

/** 컴포넌트용 — covered 가 바뀔 때만 리렌더. */
export function useCanvasCovered(): boolean {
  return useCanvasVisibilityStore((s) => s.covered);
}

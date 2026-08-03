import { create } from 'zustand';

// §4 v3.71 가시성 LOD — "지금 캔버스가 다른 UI 에 덮여 있는가" 한 비트(비영속, 표시/게이팅 전용).
//
// IDE 오버레이는 BubbleMap 의 자식으로 렌더되므로, 최대화·모달로 캔버스를 완전히 덮어도 그 아래
// React Flow 는 계속 그려지고 물리 rAF·주기 타이머도 계속 돈다(물리의 절전 조건은 document.hidden
// 뿐이라 "같은 창 안에서 덮인 상태"를 못 본다). 덮개는 IDE 말고도 여럿이라(기억 피드·옵션창·모바일
// 접속창) prop 으로 내려보내면 갈래가 생긴다 — captureSnapGuides 선례대로 런타임 스토어 한 곳에
// 키 단위로 등록하고, 하나라도 켜져 있으면 covered=true 로 본다.
//
// 캔버스가 아니라 "덮개"가 자기 상태를 신고한다(덮개가 자기 모드를 가장 잘 안다).

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

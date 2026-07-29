import { create } from 'zustand';
import type { SnapGuide } from '../components/BubbleMap/captureSnap.js';

// §5.9 캡처 버블 이어 붙이기 — "지금 어디에 붙는지" 가이드선(비영속, 표시 전용).
//
// 자석이 걸린 축을 선으로 보여 주는 값. 쓰는 쪽이 둘이라(드래그는 BubbleMap, 리사이즈는 CaptureNode)
// prop 으로 내려보내면 두 갈래가 되므로 런타임 스토어 한 곳에 모아 CaptureSnapGuides 가 읽는다
// (captureBubbleRuntime 과 같은 패턴 — localStorage 미저장, 손을 떼면 비운다).

interface CaptureSnapGuideState {
  guides: SnapGuide[];
  setGuides: (guides: SnapGuide[]) => void;
}

export const useCaptureSnapGuideStore = create<CaptureSnapGuideState>((set) => ({
  guides: [],
  setGuides: (guides): void => {
    // 스냅이 안 걸린 프레임(빈 배열 → 빈 배열)에 매번 새 배열을 넣어 리렌더를 유발하지 않는다.
    set((s) => (s.guides.length === 0 && guides.length === 0 ? s : { guides }));
  },
}));

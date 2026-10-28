import { create } from 'zustand';
import type { SnapGuide } from '../components/BubbleMap/captureSnap.js';

// §5.9 — 자석이 걸린 축의 가이드선(비영속, 손을 떼면 비운다). 쓰는 쪽이 둘(BubbleMap 드래그·CaptureNode 리사이즈)이라 스토어 한 곳에 모은다.

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

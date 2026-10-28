/** §5.13 (V) 37-1·37-15 — 판형 판정과 안전 영역(순수, 칩·프리셋·파생·검수 공용). 정확히 맞지 않는 크기는 비율이 가장 가까운 판형에 붙는다. */

import { VIDEO_FORMATS } from './constants.js';
import type { VideoDoc, VideoFormatId } from './types.js';

export const VIDEO_FORMAT_IDS: readonly VideoFormatId[] = ['landscape', 'portrait', 'square'];

/** 크기 → 판형. 정확히 같은 프리셋이 먼저, 아니면 비율이 가장 가까운 것. */
export function formatOfSize(size: VideoDoc['size']): VideoFormatId {
  for (const id of VIDEO_FORMAT_IDS) {
    const f = VIDEO_FORMATS[id];
    if (f.width === size.width && f.height === size.height) return id;
  }
  const ratio = size.height > 0 ? size.width / size.height : 1;
  let best: VideoFormatId = 'landscape';
  let bestGap = Infinity;
  for (const id of VIDEO_FORMAT_IDS) {
    const f = VIDEO_FORMATS[id];
    const gap = Math.abs(Math.log(ratio) - Math.log(f.width / f.height));
    if (gap < bestGap) { bestGap = gap; best = id; }
  }
  return best;
}

/** 판형 칩 글자(16:9·9:16·1:1) — 번역할 것이 아니라 비율 표기다. */
export function formatRatioLabel(id: VideoFormatId): string {
  return id === 'landscape' ? '16:9' : id === 'portrait' ? '9:16' : '1:1';
}

/**
 * §5.13 (V) 37-9 — 판형별 **안전 영역**(화면 비율 0~1 의 안쪽 사각형). 9:16 은 짧은 영상 앱의 화면 UI 자리(위 12% ·
 * 아래 22% · 오른쪽 14%)를 비우고, 16:9·1:1 은 가장자리만 비운다. 검수와 [안전 영역 겹쳐 보기]가 같은 값을 쓴다.
 */
export const SAFE_AREAS: Readonly<Record<VideoFormatId, { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }>> = {
  landscape: { left: 0.05, top: 0.05, right: 0.95, bottom: 0.95 },
  portrait: { left: 0.04, top: 0.12, right: 0.86, bottom: 0.78 },
  square: { left: 0.06, top: 0.06, right: 0.94, bottom: 0.94 },
};

/** 안전 영역을 문서 픽셀로. */
export function safeAreaRect(size: VideoDoc['size']): { x: number; y: number; width: number; height: number } {
  const a = SAFE_AREAS[formatOfSize(size)];
  return {
    x: a.left * size.width,
    y: a.top * size.height,
    width: (a.right - a.left) * size.width,
    height: (a.bottom - a.top) * size.height,
  };
}

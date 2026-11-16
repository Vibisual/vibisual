/**
 * §5.13 (V) 37-24 (F) — 미리보기 자유 보기의 순수 계산(시험 고정). 판(`PreviewFrame`) = 미리보기 칸 안에서 그림 판이 선 자리(px)와
 * 문서 픽셀 → 화면 픽셀 배율. 휠은 포인터 자리를 축으로 키우고, 끌면 옮기며, 판은 칸 밖으로 다 나가지 못한다.
 */
export interface PreviewFrame { readonly left: number; readonly top: number; readonly scale: number }
export interface PreviewBox { readonly w: number; readonly h: number }
export interface PreviewSize { readonly width: number; readonly height: number }

export const PREVIEW_ZOOM = {
  min: 0.05,
  max: 8,
  /** 휠 한 눈금(deltaY 100) ≈ 16%. */
  wheelStep: 0.0015,
  /** 트랙패드 집기(Ctrl+휠)는 delta 가 작다 — 그만큼 세게 받는다. */
  pinchBoost: 6,
  /** 줄 단위 delta(Firefox)의 한 줄 = 이만큼 px. */
  linePx: 16,
  /** 한 사건이 바꿀 수 있는 배율의 한계(튀는 delta 한 번에 날아가지 않게). */
  stepMin: 0.5,
  stepMax: 2,
  /** 판이 칸 안에 남겨야 하는 폭(px). */
  keepVisible: 48,
} as const;

/** 맞춤 — 비율을 지켜 칸 안 가운데(레터박스). 칸을 아직 못 쟀으면 배율 0. */
export function fitFrame(box: PreviewBox, size: PreviewSize): PreviewFrame {
  const scale = box.w > 0 && box.h > 0 && size.width > 0 && size.height > 0 ? Math.min(box.w / size.width, box.h / size.height) : 0;
  return { left: (box.w - size.width * scale) / 2, top: (box.h - size.height * scale) / 2, scale };
}

/** 100% — 문서 픽셀 그대로 가운데(칸보다 크면 가장자리가 밖으로 나간다 — 끌어 옮긴다). */
export function actualFrame(box: PreviewBox, size: PreviewSize): PreviewFrame {
  return { left: (box.w - size.width) / 2, top: (box.h - size.height) / 2, scale: 1 };
}

function clampAxis(start: number, length: number, limit: number): number {
  const keep = Math.min(PREVIEW_ZOOM.keepVisible, length, Math.max(0, limit));
  return Math.min(Math.max(start, keep - length), limit - keep);
}

/** 판이 칸 밖으로 다 나가지 않게 민다(`keepVisible` 은 남는다). */
export function clampFrame(frame: PreviewFrame, size: PreviewSize, box: PreviewBox): PreviewFrame {
  return {
    scale: frame.scale,
    left: clampAxis(frame.left, size.width * frame.scale, box.w),
    top: clampAxis(frame.top, size.height * frame.scale, box.h),
  };
}

/** 휠 delta → 배율 곱. 위로 굴리면(음수) 커진다. */
export function wheelFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
  const px = deltaMode === 1 ? deltaY * PREVIEW_ZOOM.linePx : deltaY;
  const factor = Math.exp(-px * PREVIEW_ZOOM.wheelStep * (pinch ? PREVIEW_ZOOM.pinchBoost : 1));
  return Math.min(PREVIEW_ZOOM.stepMax, Math.max(PREVIEW_ZOOM.stepMin, factor));
}

/** 칸 안 `(px, py)` 를 축으로 배율을 곱한다 — 그 자리 아래의 문서 점이 그대로 그 자리에 남는다(묶이기 전). */
export function zoomFrame(frame: PreviewFrame, px: number, py: number, factor: number, size: PreviewSize, box: PreviewBox): PreviewFrame {
  if (!(frame.scale > 0) || !(factor > 0)) return frame;
  const scale = Math.min(PREVIEW_ZOOM.max, Math.max(PREVIEW_ZOOM.min, frame.scale * factor));
  const k = scale / frame.scale;
  return clampFrame({ scale, left: px - (px - frame.left) * k, top: py - (py - frame.top) * k }, size, box);
}

/** 끌기 — 누른 때의 판에서 `(dx, dy)` 만큼. */
export function panFrame(from: PreviewFrame, dx: number, dy: number, size: PreviewSize, box: PreviewBox): PreviewFrame {
  return clampFrame({ scale: from.scale, left: from.left + dx, top: from.top + dy }, size, box);
}

/** `67%`. */
export function zoomPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

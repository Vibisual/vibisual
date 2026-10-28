/**
 * §5.13 (R-9) — 두 손가락 핀치(닿은 동안만). 그림은 무대 가운데 + offset 중심의 `scale`(`VibimageViewer` transform 과 같은 모형)
 * — P 의 그림 점은 `(P - 가운데 - offset) / scale`, 시작 때 손가락 가운데 아래 점이 계속 그 아래 오도록 offset 을 맞춘다.
 */

/** 무대 좌표의 한 점(무대 상자 왼쪽 위 기준 px). */
export interface PinchPoint { x: number; y: number }

/** 핀치를 시작한 순간 — 두 손가락 사이 거리·가운데와 그때의 배율·자리. */
export interface PinchStart {
  distance: number;
  mid: PinchPoint;
  scale: number;
  offset: PinchPoint;
}

export interface PinchView { scale: number; offset: PinchPoint }

/** 두 손가락 사이 거리와 가운데. */
export function pinchSpan(a: PinchPoint, b: PinchPoint): { distance: number; mid: PinchPoint } {
  return { distance: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

/**
 * 지금 손가락 거리·가운데로 본 배율과 자리. 배율은 `limits` 안으로 묶는다 — 묶여도 자리는 실제 배율로 맞추므로, 시작할 때 손가락
 * 가운데 아래 있던 점은 한계에서도 손가락 가운데에 그대로 붙어 있다(그림이 튀지 않는다). 시작 거리가 0 이면(두 손가락이 한 점)
 * 배율은 그대로 두고 끌기만 따른다.
 */
export function pinchView(
  start: PinchStart, distance: number, mid: PinchPoint, stage: { w: number; h: number }, limits: { min: number; max: number },
): PinchView {
  const raw = start.distance > 0 && distance > 0 ? start.scale * (distance / start.distance) : start.scale;
  const scale = Math.min(limits.max, Math.max(limits.min, raw));
  const ratio = start.scale > 0 ? scale / start.scale : 1;
  const cx = stage.w / 2;
  const cy = stage.h / 2;
  return {
    scale,
    offset: {
      x: mid.x - cx - (start.mid.x - cx - start.offset.x) * ratio,
      y: mid.y - cy - (start.mid.y - cy - start.offset.y) * ratio,
    },
  };
}

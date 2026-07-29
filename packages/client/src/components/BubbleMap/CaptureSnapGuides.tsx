import { ViewportPortal, useStore } from '@xyflow/react';
import { CAPTURE_SNAP } from '@vibisual/shared';
import { useCaptureSnapGuideStore } from '../../stores/captureSnapGuides.js';

/**
 * §5.9 캡처 버블 이어 붙이기 가이드선 — 드래그·리사이즈 중 자석이 걸린 축을 캔버스에 그린다.
 *
 * `ViewportPortal` 안에 그려 캔버스 변환(팬·줌)을 그대로 타므로 좌표를 그대로 쓰면 된다.
 * 선 두께·후광·여유는 줌으로 나눠 화면상 굵기가 일정하게 보이도록 환산한다(줌 아웃에서 실처럼
 * 사라지거나 줌 인에서 굵은 띠가 되지 않게). 스카이=이어 붙임(변이 맞닿음), 바이올렛=정렬.
 */
export function CaptureSnapGuides(): React.JSX.Element | null {
  const guides = useCaptureSnapGuideStore((s) => s.guides);
  const zoom = useStore((s) => s.transform[2]);

  if (guides.length === 0) return null;

  const thickness = CAPTURE_SNAP.GUIDE_WIDTH_PX / Math.max(zoom, 0.05);
  const pad = 14 / Math.max(zoom, 0.05);

  return (
    <ViewportPortal>
      {guides.map((g, i) => {
        const color = g.butt ? CAPTURE_SNAP.GUIDE_BUTT_COLOR : CAPTURE_SNAP.GUIDE_ALIGN_COLOR;
        const span = g.to - g.from + pad * 2;
        return (
          <div
            key={`${g.axis}:${g.position}:${i}`}
            style={{
              position: 'absolute',
              left: g.axis === 'x' ? g.position - thickness / 2 : g.from - pad,
              top: g.axis === 'x' ? g.from - pad : g.position - thickness / 2,
              width: g.axis === 'x' ? thickness : span,
              height: g.axis === 'x' ? span : thickness,
              background: color,
              boxShadow: `0 0 ${6 / Math.max(zoom, 0.05)}px ${color}`,
              opacity: g.butt ? 0.95 : 0.7,
              pointerEvents: 'none',
              zIndex: 1200,
            }}
          />
        );
      })}
    </ViewportPortal>
  );
}

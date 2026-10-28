import { ViewportPortal, useStore } from '@xyflow/react';
import { CAPTURE_SNAP } from '@vibisual/shared';
import { useCaptureSnapGuideStore } from '../../stores/captureSnapGuides.js';

/**
 * §5.9 캡처 버블 이어 붙이기 가이드선. `ViewportPortal` 안이라 캔버스 좌표 그대로, 두께·후광·여유는 줌으로 나눠 화면상 굵기를 일정하게 한다.
 * 스카이=이어 붙임, 바이올렛=정렬.
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

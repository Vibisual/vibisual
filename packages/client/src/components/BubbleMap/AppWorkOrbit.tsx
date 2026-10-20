import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_WORK, FILE_MIN_SIZE, SATELLITE_ORBIT_GAP, clipNameList } from '@vibisual/shared';

import type { AppWorkOrbitInfo } from './appWorkFold.js';

/**
 * §5.1 #2-1 (F) ⑤⑧ — 앱 작업 보기 중인 앱 노드의 **작업 궤도**. 작업 위성이 앉는 위쪽 반원(9시 → 12시 → 3시)에 앱 색의 흐린
 * 점선 타원을 그리고(아래 반원은 구슬 줄 자리라 비운다), 위성 상한을 넘은 작업물이 있으면 궤도 오른쪽 끝에 회색 `+N` 점을 둔다
 * (표시 전용 — 누르는 손잡이 ❌, 툴팁에 이름 목록).
 *
 * 타원의 두 반지름은 물리가 위성을 거는 자리와 같다(`orbitSeatAtAngle` — 가로·세로 반폭 + 위성 반경 + 간격). 위성 지름은 제각각이라
 * 가장 작은 파일 지름으로 그린다(위성이 궤도 바깥쪽에 살짝 걸쳐 앉는다). SVG 필터·마스크 ❌ — 획 하나다.
 */
export const AppWorkOrbit = memo(function AppWorkOrbit({
  orbit,
  width,
  height,
}: {
  orbit: AppWorkOrbitInfo;
  width: number;
  height: number;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (orbit.moons === 0 && orbit.overflow === 0) return null;
  const rx = width / 2 + SATELLITE_ORBIT_GAP + FILE_MIN_SIZE / 2;
  const ry = height / 2 + SATELLITE_ORBIT_GAP + FILE_MIN_SIZE / 2;
  const pad = 4;
  const boxW = rx * 2 + pad * 2;
  const boxH = ry * 2 + pad * 2;
  const cx = boxW / 2;
  const cy = boxH / 2;
  // 위쪽 반원 — 9시(왼쪽 끝)에서 위로 돌아 3시(오른쪽 끝)까지.
  const arc = `M${(cx - rx).toFixed(1)},${cy.toFixed(1)} A${rx.toFixed(1)},${ry.toFixed(1)} 0 0 1 ${(cx + rx).toFixed(1)},${cy.toFixed(1)}`;
  const dotAngle = APP_WORK.seatArcTo - Math.PI * 0.04;
  const dot = 20;
  const dotX = cx + Math.cos(dotAngle) * rx;
  const dotY = cy + Math.sin(dotAngle) * ry;
  const { shown, more } = clipNameList(orbit.overflowNames);
  const overflowTitle = orbit.overflow > 0
    ? [
      t('canvas.appWork.overflow', { count: orbit.overflow }),
      ...shown.map((n) => `  ${n}`),
      ...(more > 0 ? [t('canvas.appWork.more', { count: more })] : []),
    ].join('\n')
    : undefined;
  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: width / 2 - cx, top: height / 2 - cy, width: boxW, height: boxH }}
      aria-hidden={orbit.overflow === 0 ? true : undefined}
    >
      {orbit.moons > 0 ? (
        <svg className="absolute inset-0" width={boxW} height={boxH} viewBox={`0 0 ${boxW} ${boxH}`} aria-hidden="true">
          <path
            d={arc}
            fill="none"
            stroke={orbit.ring}
            strokeOpacity={APP_WORK.orbitOpacity}
            strokeWidth={1.25}
            strokeDasharray="2 6"
            strokeLinecap="round"
          />
        </svg>
      ) : null}
      {orbit.overflow > 0 ? (
        <span
          className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-gray-500/70 bg-gray-800 font-semibold leading-none tabular-nums text-gray-200"
          style={{ left: dotX - dot / 2, top: dotY - dot / 2, minWidth: dot, height: dot, padding: '0 4px', fontSize: 12 }}
          title={overflowTitle}
          aria-label={overflowTitle}
        >
          +{orbit.overflow}
        </span>
      ) : null}
    </div>
  );
});

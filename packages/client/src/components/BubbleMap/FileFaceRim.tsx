import { memo } from 'react';
import { FILE_FACE, FILE_MIN_SIZE, SATELLITE_ORBIT_GAP } from '@vibisual/shared';

import { formatMediaDuration, type ThumbState } from '../../apps/appThumbnails.js';
import type { FileFace } from '../../utils/fileFaceView.js';
import { FileKindGlyph } from './fileFaceGlyphs.js';

/**
 * §5.1 #2-1 (A) — 미디어 파일 버블의 **원 밖** 표식: 오른쪽 아래 림의 종류 배지와 원 아래 이름 줄.
 *
 * 렌즈가 원 안을 그림으로 채우므로 이름은 그림 위에 얹지 않고 **원 아래**에 둔다 — 말풍선의 원 아래 이름과 같은
 * 버블 문법이고 같은 글꼴(`text-[12px] text-gray-200` — 테마를 따른다)이다. 영상·소리는 길이를 덧붙인다.
 * 둘 다 손짓을 받지 않는다(끌기·선택·더블클릭은 본체가 받는다 — 툴팁도 본체가 말한다).
 */
export interface FileFaceRimProps {
  readonly face: FileFace;
  readonly thumb: ThumbState;
  readonly size: number;
  /** 버블 텍스트 배율(지름 / `BUBBLE_TEXT_REF_SIZE`). */
  readonly ts: number;
  readonly label: string;
}

export const FileFaceRim = memo(function FileFaceRim({ face, thumb, size, ts, label }: FileFaceRimProps): React.JSX.Element {
  const badge = Math.max(14, Math.round(18 * ts));
  // 원의 45° 림 위 — 감싸는 사각형의 모서리에 두면 배지가 림에서 떨어져 허공에 뜬다(히트 배지와 같은 자리 규칙).
  const inset = Math.max(0, Math.round((size / 2) * (1 - Math.SQRT1_2) - badge / 2));
  const seconds = thumb.status === 'ready' ? thumb.thumb?.durationSec : undefined;
  const duration = typeof seconds === 'number' ? formatMediaDuration(seconds) : '';
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute z-20 flex items-center justify-center rounded-full border"
        style={{ right: inset, bottom: inset, width: badge, height: badge, background: face.color, borderColor: face.glow }}
      >
        <FileKindGlyph kind={face.kind} px={Math.max(8, Math.round(badge * 0.62))} color={face.glow} strokeWidth={2.2} />
      </span>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 items-center whitespace-nowrap text-[12px] font-medium leading-[14px] text-gray-200"
        style={{ top: size + FILE_FACE.captionGap, maxWidth: Math.max(size * 1.8, 96) }}
      >
        <span className="min-w-0 truncate">{label}</span>
        {duration !== '' ? <span className="shrink-0 text-gray-400">&nbsp;·&nbsp;{duration}</span> : null}
      </div>
    </>
  );
});

/**
 * §5.1 #2-1 (B) — 별자리 중심의 **궤도**. 위성들이 앉는 반지름(중심 반경 + 위성 간격 + 파일 최소 반경 — 물리 스프링의
 * 평형점)에 흐린 점선 원을 그린다. 위성이 흩어져도 "이것들이 한 무리"가 읽히게 하는 선이다. 손짓은 받지 않는다.
 */
export const ConstellationOrbit = memo(function ConstellationOrbit({ size, glow }: { size: number; glow: string }): React.JSX.Element {
  const radius = size / 2 + SATELLITE_ORBIT_GAP + FILE_MIN_SIZE / 2;
  const pad = radius - size / 2 + 2;
  const box = size + pad * 2;
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{ left: -pad, top: -pad }}
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
    >
      <circle
        cx={box / 2}
        cy={box / 2}
        r={radius}
        fill="none"
        stroke={glow}
        strokeOpacity={FILE_FACE.orbitOpacity}
        strokeWidth={1.25}
        strokeDasharray="2 6"
        strokeLinecap="round"
      />
    </svg>
  );
});

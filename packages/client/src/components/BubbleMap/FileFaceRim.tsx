import { memo } from 'react';
import { FILE_FACE } from '@vibisual/shared';

import { formatMediaDuration, type ThumbState } from '../../apps/appThumbnails.js';
import type { FileFace } from '../../utils/fileFaceView.js';
import { satelliteOrbitRadius } from '../../utils/satellite.js';
import { FileKindGlyph } from './fileFaceGlyphs.js';

/** §5.1 #2-1 (A) — 원 밖 표식: 림의 종류 배지 + 원 아래 이름 줄(말풍선과 같은 문법·글꼴 `text-[12px] text-gray-200`). 손짓은 본체가 받는다. */
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
      {/* 줄 높이 `leading-[14px]` = `FILE_FACE.captionLineHeight` · 최대 폭 = `captionMaxWidth` — 묶음 안 배치가 같은 값으로 이 줄을 피한다. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 items-center whitespace-nowrap text-[12px] font-medium leading-[14px] text-gray-200"
        style={{ top: size + FILE_FACE.captionGap, maxWidth: Math.max(size * FILE_FACE.captionMaxWidth.ratio, FILE_FACE.captionMaxWidth.min) }}
      >
        <span className="min-w-0 truncate">{label}</span>
        {duration !== '' ? <span className="shrink-0 text-gray-400">&nbsp;·&nbsp;{duration}</span> : null}
      </div>
    </>
  );
});

/**
 * §5.1 #2-1 (B) — 별자리 궤도: 위성 고리의 흐린 점선 원(손짓 ❌).
 * §5.1 #2-2 (J) — 반지름은 달 격자 고리 0(`satelliteOrbitRadius`). 가장 작은 파일 반지름을 쓰면 미디어 달(56px↑) 안쪽을 스친다. `moons` 를 모르면 1.
 */
export const ConstellationOrbit = memo(function ConstellationOrbit({ size, glow, moons }: { size: number; glow: string; moons?: number }): React.JSX.Element {
  const radius = satelliteOrbitRadius(size / 2, Math.max(1, Math.floor(moons ?? 1)));
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

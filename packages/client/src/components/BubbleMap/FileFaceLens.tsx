import { memo } from 'react';
import { FILE_FACE } from '@vibisual/shared';
import type { FileFaceKind } from '@vibisual/shared';

import type { ThumbState } from '../../apps/appThumbnails.js';
import type { FileFace } from '../../utils/fileFaceView.js';
import { FileFamilyGlyph } from './fileFaceGlyphs.js';

/**
 * §5.1 #2-1 (A) — 미디어 파일 버블의 렌즈: 원 안을 미리보기로 채우고 종류 표식(영상 필름 띠·사진 인화 테·소리 방사 파형·3D 궤도)을 얹는다.
 * 본체(`overflow-hidden rounded-full`) 안에 깔리고 손짓은 통과시킨다. SVG 필터·마스크 ❌(§5.4 #31 (K)) — 획과 채움만.
 */
export interface FileFaceLensProps {
  readonly face: FileFace;
  readonly thumb: ThumbState;
  /** 버블 지름(캔버스 px). */
  readonly size: number;
}

export const FileFaceLens = memo(function FileFaceLens({ face, thumb, size }: FileFaceLensProps): React.JSX.Element {
  const ready = thumb.status === 'ready' ? thumb.thumb : null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full" aria-hidden="true">
      {ready !== null && ready.kind === 'picture' ? (
        <img
          src={ready.url}
          alt=""
          draggable={false}
          // §5.1 #2-1 (G) ⑧ — 구운 작은 그림도 화면 스레드 밖에서 푼다(버블이 한꺼번에 들어올 때 그리기가 밀리지 않게).
          decoding="async"
          className={`absolute inset-0 h-full w-full ${ready.fit === 'contain' ? 'object-contain' : 'object-cover'}`}
        />
      ) : null}
      {ready !== null && ready.kind === 'wave' ? <RadialWave peaks={ready.peaks} size={size} glow={face.glow} /> : null}
      {ready === null ? (
        <div className="absolute inset-0 flex items-center justify-center">
          {/* §5.1 #2-1 (G) ⑤ — 미리보기가 없으면(굽는 중 · 못 구움 · 성능 기준이 막음) 갈래 아이콘이 무엇인지 말한다. */}
          <FileFamilyGlyph
            family={face.family}
            px={Math.max(12, Math.round(size * 0.36))}
            color={face.glow}
            strokeWidth={1.75}
            className={thumb.status === 'loading' ? 'shrink-0 motion-safe:animate-pulse' : 'shrink-0'}
          />
        </div>
      ) : null}
      <FaceMarks kind={face.kind} size={size} glow={face.glow} />
    </div>
  );
});

/** 소리 — 구운 파형(봉우리 배열)을 원 둘레로 다시 뽑아 가운데 원에서 뻗는 막대로 그린다. path 하나라 막대가 몇 개든 DOM 은 하나다. */
function RadialWave({ peaks, size, glow }: { peaks: readonly number[]; size: number; glow: string }): React.JSX.Element {
  const c = size / 2;
  const inner = size * 0.2;
  const outer = size * 0.46;
  const bars = FILE_FACE.radialBars;
  let d = '';
  for (let i = 0; i < bars; i += 1) {
    const raw = peaks.length > 0 ? peaks[Math.floor((i * peaks.length) / bars)] ?? 0 : 0;
    const reach = inner + Math.max(0.08, Math.min(1, raw)) * (outer - inner);
    const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
    d += `M${(c + Math.cos(a) * inner).toFixed(1)},${(c + Math.sin(a) * inner).toFixed(1)}`;
    d += `L${(c + Math.cos(a) * reach).toFixed(1)},${(c + Math.sin(a) * reach).toFixed(1)}`;
  }
  const stroke = Math.max(1, ((Math.PI * 2 * inner) / bars) * 0.55);
  return (
    <svg className="absolute inset-0" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={inner * 0.78} fill={glow} fillOpacity={0.22} />
      <path d={d} fill="none" stroke={glow} strokeWidth={stroke} strokeLinecap="round" />
    </svg>
  );
}

/** 종류 표식 — 영상(퍼포레이션 띠) · 사진(인화 테) · 3D(궤도 타원). 소리는 파형 자체가 표식이다. */
function FaceMarks({ kind, size, glow }: { kind: FileFaceKind; size: number; glow: string }): React.JSX.Element | null {
  const c = size / 2;
  if (kind === 'video') {
    const band = Math.max(4, size * 0.13);
    const r = c - band / 2;
    const holeW = Math.max(2, size * 0.06);
    const holeH = Math.max(1.5, size * 0.042);
    const holes = Array.from({ length: FILE_FACE.sprocketCount }, (_, i) => {
      const deg = (i / FILE_FACE.sprocketCount) * 360;
      const a = (deg * Math.PI) / 180;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      return (
        <rect
          key={i}
          x={x - holeW / 2}
          y={y - holeH / 2}
          width={holeW}
          height={holeH}
          rx={holeH * 0.3}
          transform={`rotate(${deg + 90} ${x} ${y})`}
          fill="white"
          fillOpacity={0.7}
        />
      );
    });
    return (
      <svg className="absolute inset-0" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={c} cy={c} r={r} fill="none" stroke="black" strokeOpacity={0.5} strokeWidth={band} />
        {holes}
      </svg>
    );
  }
  if (kind === 'image') {
    return (
      <svg className="absolute inset-0" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={c} cy={c} r={c - 2.5} fill="none" stroke="white" strokeOpacity={0.75} strokeWidth={1.5} />
      </svg>
    );
  }
  if (kind === 'model') {
    return (
      <svg className="absolute inset-0" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <ellipse
          cx={c}
          cy={c}
          rx={size * 0.44}
          ry={size * 0.15}
          transform={`rotate(-24 ${c} ${c})`}
          fill="none"
          stroke={glow}
          strokeOpacity={0.75}
          strokeWidth={Math.max(1, size * 0.02)}
        />
      </svg>
    );
  }
  return null;
}

/** §5.5 #17-17 ⑪(n) — 무대 그림 조각 한 벌(글리프·장면·단계 표식). 따로 그리면 같은 종류가 창마다 다른 색이 된다. 고르기는 `stageSurface.ts`. */
import React, { memo } from 'react';
import { VISUAL_SCENE_VIEWBOX, type SessionGoalStepStatus, type VisualKindCard } from '@vibisual/shared';

/** 종류가 색을 안 냈을 때의 중립색 — 시든 카드·끝난 단계도 이 색으로 내려간다. */
export const KIND_NEUTRAL = '#94A3B8';
export const KIND_MUTED = '#6B7280';

/** 종류 글리프(24 좌표계). path 가 없으면 중립 점 — 카드는 있는데 그림만 없는 상태를 그대로 말한다. */
export const KindGlyph = memo(function KindGlyph({
  card,
  className = 'h-3.5 w-3.5',
  muted,
}: {
  card?: VisualKindCard | undefined;
  className?: string;
  muted?: boolean;
}): React.JSX.Element {
  const color = muted ? KIND_MUTED : (card?.color ?? KIND_NEUTRAL);
  if (!card?.glyph) {
    return (
      <span
        className={`inline-flex ${className} items-center justify-center`}
        style={{ color }}
        aria-hidden
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ color }}
      aria-hidden
    >
      <path d={card.glyph} />
    </svg>
  );
});

/** ㉒(d) — path 하나를 그리는 조각(골격 표 `STAGE_SURFACE_CHROME` 용 — 카드 색과 다른 축이라 `KindGlyph` 에 가짜 카드를 넘기지 않는다). */
export const PathGlyph = memo(function PathGlyph({
  d,
  color,
  className = 'h-3.5 w-3.5',
}: {
  d: string;
  color?: string | undefined;
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={color ? { color } : undefined}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
});

/** ⑪(i)(n) — 장면 그림. `scene` 이 없으면 글리프를 키우고, 그것도 없으면 중립 고리. 받아 온 그림 태그 ❌ — 출처 불명 에셋 라이선스(⑪(b), `stageEntry.test.ts`). */
export const SceneArt = memo(function SceneArt({
  card,
  className = 'h-16 w-16',
  muted,
  opacity,
}: {
  card?: VisualKindCard | undefined;
  className?: string;
  muted?: boolean;
  /** 배경 워터마크로 쓸 때의 투명도(0~1). 없으면 불투명. */
  opacity?: number;
}): React.JSX.Element {
  const paths = card?.scene;
  const color = muted ? KIND_MUTED : (card?.color ?? KIND_NEUTRAL);
  return (
    <svg
      className={className}
      viewBox={paths ? VISUAL_SCENE_VIEWBOX : '0 0 24 24'}
      fill="none"
      stroke="currentColor"
      strokeWidth={paths ? 3 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color, ...(opacity !== undefined ? { opacity } : {}) }}
      aria-hidden
    >
      {paths
        ? paths.map((d, i) => <path key={i} d={d} />)
        : card?.glyph
          ? <path d={card.glyph} />
          : <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /></>}
    </svg>
  );
});

/**
 * ⑪(n) — 단계 표식. **셋이 서로 다른 모양**이어야 한다 — 색만 다르면 색각 이상에서 전부 같은 점이고,
 * 어두운 화면에서 회색 두 단계는 눈으로 갈리지 않는다.
 *
 * 끝남 = 체크가 든 고리 · 지금 = 반쯤 찬 고리 · 아직 = 빈 고리.
 */
export const StepMark = memo(function StepMark({
  status,
  color,
  className = 'h-3.5 w-3.5',
}: {
  status: SessionGoalStepStatus;
  color?: string | undefined;
  className?: string;
}): React.JSX.Element {
  const tone = status === 'done' ? '#10B981' : status === 'in_progress' ? (color ?? '#F59E0B') : KIND_MUTED;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ color: tone }}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      {status === 'done' && <path d="M8 12.5 11 15.5 16.5 9" />}
      {status === 'in_progress' && <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />}
    </svg>
  );
});

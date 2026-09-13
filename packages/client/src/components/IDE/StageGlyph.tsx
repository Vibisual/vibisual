/**
 * §5.5 #17-17 ⑪(n) — **무대가 쓰는 그림 조각 한 벌.**
 *
 * 종류 글리프(24)·장면(96)·단계 표식은 지금까지 네 곳에서 각자 그려졌다(지도 노드·무대 머리·종류
 * 서랍·그리고 ⑪(l) 의 대화 카드가 다섯 번째가 될 참이었다). 같은 그림을 다섯 벌 그리면 색 규칙이
 * 한 곳에서만 바뀌는 날이 오고, 그때 사용자는 "같은 종류인데 창마다 다른 색"을 본다.
 *
 * 여기 있는 것은 **그리기만** 한다 — 무엇을 그릴지 고르는 판정은 `stageSurface.ts` 가 한다.
 */
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

/**
 * ㉒(d) — **path 문자열 하나를 그리는 조각.** 종류 카드가 아니라 **골격 표**가 가진 그림을 그린다
 * (`STAGE_SURFACE_CHROME` — 카드 색과 다른 축이므로 `KindGlyph` 에 억지로 카드 모양을 만들어
 * 넘기지 않는다). 그림 조각을 "한 벌"로 모아 둔다는 이 파일의 규약을 지키기 위해 여기 둔다.
 */
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

/**
 * ⑪(i)(n) — **장면 그림.** 카드가 `scene` 을 안 들고 있으면 24px 글리프를 크게 키워 대신 세운다
 * (그것도 없으면 중립 고리) — 무대가 빈 사각형으로 시작하지 않게.
 *
 * 그림은 전부 우리 좌표계의 stroke path 다 — 웹에서 받아 온 그림 태그는 이 창에 하나도 없다(⑪(b) ·
 * 무료 배포 제품이라 출처 불명 에셋의 라이선스를 우리가 뒤집어쓴다). `stageEntry.test.ts` 가 지킨다.
 */
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

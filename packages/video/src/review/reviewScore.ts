/**
 * §5.13 (G) 검수 점수(C) — 모션 검수 결과를 숫자 하나와 종류별 개수로 접고, 두 판의 결과를 안정 id 로 짝지어 늘어난·줄어든 문제를 낸다(순수).
 * 식은 일부러 단순하다: 점수 = max(0, 100 − Σ 가중치×개수). 응답에 식·가중치·종류별 점을 그대로 싣는다(설명 가능하게).
 * `introduced` 는 patch `fix[]` 진단과 같은 이름이다(그 판이 새로 낳은 것).
 */

import { REVIEW_SCORE_MAX, REVIEW_SCORE_WEIGHTS } from '../constants.js';
import type { MotionCode, MotionFinding } from './motionReview.js';

export type ReviewScoreWeights = Readonly<Record<MotionCode, number>>;

/** 응답 표의 순서(무거운 것부터) — 같은 입력이면 같은 순서. */
export const REVIEW_SCORE_CODES: readonly MotionCode[] = [
  'blank', 'caption-clip', 'text-overlap', 'low-contrast', 'safe-area', 'read-time', 'off-beat', 'silence',
];

export const REVIEW_SCORE_FORMULA = `score = max(0, ${REVIEW_SCORE_MAX} - sum(weight x count))`;

export interface ReviewCodeCount {
  readonly code: MotionCode;
  readonly count: number;
  readonly weight: number;
  readonly points: number;
}

export interface ReviewScore {
  readonly score: number;
  /** Σ 가중치×개수 — 점수가 0 에 닿아도 이 숫자는 계속 비교된다. */
  readonly penalty: number;
  readonly counts: { readonly error: number; readonly warn: number; readonly info: number };
  readonly byCode: readonly ReviewCodeCount[];
}

export function scoreFindings(findings: readonly MotionFinding[], weights: ReviewScoreWeights = REVIEW_SCORE_WEIGHTS): ReviewScore {
  const per = new Map<MotionCode, number>();
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) {
    per.set(f.code, (per.get(f.code) ?? 0) + 1);
    counts[f.level] += 1;
  }
  const byCode = REVIEW_SCORE_CODES.map((code): ReviewCodeCount => {
    const count = per.get(code) ?? 0;
    const weight = weights[code] ?? 0;
    return { code, count, weight, points: count * weight };
  });
  const penalty = byCode.reduce((sum, c) => sum + c.points, 0);
  return { score: Math.max(0, REVIEW_SCORE_MAX - penalty), penalty, counts, byCode };
}

export interface ReviewScoreDelta {
  readonly score: number;
  readonly penalty: number;
  readonly byCode: readonly { readonly code: MotionCode; readonly before: number; readonly after: number; readonly change: number }[];
  /** 기준 판에 없던 결과 수 · 사라진 결과 수 · 둘 다 있는 결과 수. */
  readonly introduced: number;
  readonly resolved: number;
  readonly kept: number;
}

export type ScoredFinding = MotionFinding & { readonly introduced: boolean };

export interface ReviewComparison {
  readonly findings: readonly ScoredFinding[];
  readonly resolved: readonly MotionFinding[];
  readonly delta: ReviewScoreDelta;
}

/** 두 판의 결과를 id 로 짝짓는다(id 는 `<code>:<대상>:<시각>` — 대상이 시각을 옮기면 사라짐 + 새로 생김으로 센다). */
export function compareFindings(target: readonly MotionFinding[], base: readonly MotionFinding[], weights: ReviewScoreWeights = REVIEW_SCORE_WEIGHTS): ReviewComparison {
  const baseIds = new Set(base.map((f) => f.id));
  const targetIds = new Set(target.map((f) => f.id));
  const findings = target.map((f): ScoredFinding => ({ ...f, introduced: !baseIds.has(f.id) }));
  const resolved = base.filter((f) => !targetIds.has(f.id));
  const now = scoreFindings(target, weights);
  const before = scoreFindings(base, weights);
  const beforeOf = new Map(before.byCode.map((c) => [c.code, c.count]));
  const introduced = findings.filter((f) => f.introduced).length;
  return {
    findings,
    resolved,
    delta: {
      score: now.score - before.score,
      penalty: now.penalty - before.penalty,
      byCode: now.byCode.map((c) => {
        const was = beforeOf.get(c.code) ?? 0;
        return { code: c.code, before: was, after: c.count, change: c.count - was };
      }),
      introduced,
      resolved: resolved.length,
      kept: findings.length - introduced,
    },
  };
}

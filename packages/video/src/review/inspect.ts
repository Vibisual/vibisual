/**
 * 자동 검수 (SCENARIO.md §5.13 (G)).
 *
 * 렌더가 끝난 뒤 **컷 경계마다 한 장씩 떠서** 사람이 이상하다고 느낄 만한 것을 찾는다.
 * 발상은 이미 검증된 것을 따랐다 — 에이전트가 자기 결과물을 확인하지 않으면 "돌긴
 * 돌았는데 결과가 이상한" 영상이 그대로 사용자에게 간다.
 *
 * 이 파일은 **순수**하다. 픽셀 배열과 몇 가지 숫자만 받아 판정하므로 화면 없이 전부
 * 시험할 수 있고, 판정 기준이 바뀌었을 때 무엇이 달라지는지 테스트로 고정된다.
 */

export interface FrameStats {
  /** 평균 밝기 0~1. */
  readonly meanLuma: number;
  /** 밝기 표준편차 0~1. 평평한 화면일수록 0에 가깝다. */
  readonly stdLuma: number;
  /** 완전히 같은 색이 아닌 픽셀의 비율 0~1. */
  readonly variedRatio: number;
}

/**
 * 픽셀에서 통계를 뽑는다.
 *
 * 전 픽셀을 다 보지 않고 `step` 간격으로 건너뛴다 — 1080p 한 장이 200만 픽셀이라
 * 컷마다 전부 훑으면 검수가 렌더보다 오래 걸린다. 통계는 표본으로 충분하다.
 */
export function computeFrameStats(rgba: Uint8ClampedArray, step = 16): FrameStats {
  const stride = Math.max(1, Math.floor(step)) * 4;
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let firstLuma = -1;
  let varied = 0;

  for (let i = 0; i + 3 < rgba.length; i += stride) {
    const r = rgba[i] ?? 0;
    const g = rgba[i + 1] ?? 0;
    const b = rgba[i + 2] ?? 0;
    // 사람 눈의 밝기 가중치(Rec. 601) — 단순 평균보다 실제 인상에 가깝다.
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (firstLuma < 0) firstLuma = luma;
    else if (Math.abs(luma - firstLuma) > 0.004) varied += 1;
    sum += luma;
    sumSq += luma * luma;
    n += 1;
  }

  if (n === 0) return { meanLuma: 0, stdLuma: 0, variedRatio: 0 };
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return { meanLuma: mean, stdLuma: Math.sqrt(variance), variedRatio: varied / n };
}

export type FindingCode = 'blank-frame' | 'hard-jump' | 'caption-overflow' | 'caption-empty' | 'silent-audio';

export interface ReviewFinding {
  readonly code: FindingCode;
  readonly level: 'error' | 'warn';
  /** 문제가 관측된 시각(초). */
  readonly t: number;
  readonly message: string;
  /** 이 시각에 그려지던 아이템. 고칠 대상을 바로 짚어 준다. */
  readonly itemIds?: readonly string[];
}

/** 컷 경계 한 곳의 관측값. */
export interface ReviewSample {
  readonly t: number;
  readonly stats: FrameStats;
  /** 그 시각에 그려지던 아이템 id 들. */
  readonly itemIds: readonly string[];
  /** 그 시각에 보여야 할 자막 글자. 없으면 빈 문자열. */
  readonly captionText: string;
  /** 자막 상자가 화면 밖으로 나갔는가. */
  readonly captionOverflow: boolean;
  /** 그 시각에 소리가 있어야 하는가. */
  readonly expectsAudio: boolean;
  /** 실제 소리 크기 0~1. 오디오를 못 재면 undefined. */
  readonly audioLevel?: number;
}

export interface ReviewThresholds {
  /** 이보다 평평하면 빈 화면으로 본다. */
  readonly blankStd: number;
  /** 이보다 다른 색 픽셀이 적으면 빈 화면으로 본다. */
  readonly blankVariedRatio: number;
  /** 인접 표본 밝기가 이보다 크게 튀면 급변으로 본다. */
  readonly jumpLuma: number;
  /** 이보다 조용하면 무음으로 본다. */
  readonly silentLevel: number;
}

export const DEFAULT_REVIEW_THRESHOLDS: ReviewThresholds = {
  blankStd: 0.012,
  blankVariedRatio: 0.01,
  jumpLuma: 0.55,
  silentLevel: 0.002,
};

/**
 * 표본들을 보고 문제를 찾는다.
 *
 * 판정이 보수적인 이유는 오탐이 잦으면 사람이 검수 결과를 안 읽게 되기 때문이다.
 * 확실히 이상한 것만 잡고, 애매하면 넘어간다.
 */
export function inspectSamples(
  samples: readonly ReviewSample[],
  thresholds: ReviewThresholds = DEFAULT_REVIEW_THRESHOLDS,
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  samples.forEach((s, i) => {
    // 그릴 것이 있다고 했는데 화면이 평평하면 뭔가 안 그려진 것이다.
    if (s.itemIds.length > 0 && s.stats.stdLuma < thresholds.blankStd && s.stats.variedRatio < thresholds.blankVariedRatio) {
      findings.push({
        code: 'blank-frame',
        level: 'error',
        t: s.t,
        message: `${s.t.toFixed(2)}초에 그릴 것이 ${s.itemIds.length}개 있는데 화면이 비어 있습니다.`,
        itemIds: s.itemIds,
      });
    }

    if (s.captionOverflow) {
      findings.push({
        code: 'caption-overflow',
        level: 'warn',
        t: s.t,
        message: `${s.t.toFixed(2)}초의 자막이 화면 밖으로 넘칩니다.`,
        itemIds: s.itemIds,
      });
    }

    if (s.expectsAudio && s.captionText === '' && s.itemIds.length > 0) {
      // 말이 나오는데 자막이 없다 — 오류는 아니고 확인할 거리다.
      findings.push({
        code: 'caption-empty',
        level: 'warn',
        t: s.t,
        message: `${s.t.toFixed(2)}초에 소리는 있는데 자막이 없습니다.`,
      });
    }

    if (s.expectsAudio && s.audioLevel !== undefined && s.audioLevel < thresholds.silentLevel) {
      findings.push({
        code: 'silent-audio',
        level: 'error',
        t: s.t,
        message: `${s.t.toFixed(2)}초에 소리가 있어야 하는데 무음입니다.`,
      });
    }

    const prev = i > 0 ? samples[i - 1] : undefined;
    if (prev && Math.abs(s.stats.meanLuma - prev.stats.meanLuma) > thresholds.jumpLuma) {
      findings.push({
        code: 'hard-jump',
        level: 'warn',
        t: s.t,
        message: `${prev.t.toFixed(2)}초에서 ${s.t.toFixed(2)}초 사이 밝기가 급하게 바뀝니다. 전환을 넣는 편이 좋습니다.`,
        itemIds: s.itemIds,
      });
    }
  });

  return findings;
}

/** 검수 결과 한 줄 요약. 검수 카드 제목으로 쓴다. */
export function summarizeFindings(findings: readonly ReviewFinding[]): string {
  if (findings.length === 0) return '문제를 찾지 못했습니다.';
  const errors = findings.filter((f) => f.level === 'error').length;
  const warns = findings.length - errors;
  const parts: string[] = [];
  if (errors > 0) parts.push(`오류 ${errors}건`);
  if (warns > 0) parts.push(`확인 ${warns}건`);
  return parts.join(' · ');
}

/** 다시 렌더해서 고칠 수 있는 종류인가. 경고만 남았으면 재시도할 이유가 없다. */
export function shouldRetry(findings: readonly ReviewFinding[]): boolean {
  return findings.some((f) => f.level === 'error');
}

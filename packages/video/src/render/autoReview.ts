/**
 * 자동 검수 실행 (SCENARIO.md §5.13 (G)).
 *
 * 컷 경계마다 한 장씩 떠서 `inspectSamples` 에 넘긴다. 판정은 순수 층에 있으므로
 * 여기서 하는 일은 **표본을 모으는 것뿐**이다 — 그래야 판정 기준을 화면 없이 고칠 수
 * 있고, 같은 표본에 대해 언제나 같은 결론이 나온다.
 *
 * 경계 정확히 그 지점이 아니라 조금 안쪽을 보는 이유는, 경계는 전환 중이라 흐릿해서
 * "빈 화면"으로 오해되기 쉽기 때문이다.
 */

import { CUT_INSPECT_EPSILON } from '../constants.js';
import { cutPoints, resolveTimeline } from '../resolveTimeline.js';
import type { ResolvedTimeline, VideoDoc } from '../types.js';
import {
  DEFAULT_REVIEW_THRESHOLDS,
  computeFrameStats,
  inspectSamples,
  type ReviewFinding,
  type ReviewSample,
  type ReviewThresholds,
} from '../review/inspect.js';
import type { RenderBackend } from './backend.js';
import { audioItemsAt, buildDrawList, captionTextAt } from './drawList.js';

export interface AutoReviewOptions {
  readonly doc: VideoDoc;
  readonly timeline?: ResolvedTimeline;
  readonly backend: RenderBackend;
  readonly thresholds?: ReviewThresholds;
  /** 그 시각의 소리 크기(0~1). 오디오를 아직 못 재면 생략한다. */
  readonly audioLevelAt?: (t: number) => number | undefined;
  readonly signal?: AbortSignal;
  /** 검사할 지점 수 상한. 컷이 아주 많은 영상에서 검수가 렌더보다 길어지지 않게. */
  readonly maxSamples?: number;
}

export interface AutoReviewResult {
  readonly findings: readonly ReviewFinding[];
  readonly samples: readonly ReviewSample[];
}

/** 컷 경계를 검사 지점으로 바꾼다 — 끝점은 이미 다음 컷이므로 조금 안쪽을 본다. */
export function inspectionPoints(cuts: readonly number[], duration: number, max: number): number[] {
  const points: number[] = [];
  for (const c of cuts) {
    const t = Math.min(Math.max(0, c + CUT_INSPECT_EPSILON), Math.max(0, duration - CUT_INSPECT_EPSILON));
    if (t < 0 || t > duration) continue;
    if (points.length > 0 && Math.abs((points[points.length - 1] ?? 0) - t) < 1e-6) continue;
    points.push(t);
  }
  if (points.length <= max) return points;

  // 너무 많으면 고르게 솎아 낸다 — 앞뒤만 보는 것보다 전체를 훑는 편이 낫다.
  const step = points.length / max;
  const thinned: number[] = [];
  for (let i = 0; i < max; i += 1) {
    const v = points[Math.floor(i * step)];
    if (v !== undefined) thinned.push(v);
  }
  return thinned;
}

export async function autoReview(opts: AutoReviewOptions): Promise<AutoReviewResult> {
  const { doc, backend } = opts;
  const timeline = opts.timeline ?? resolveTimeline(doc);
  const points = inspectionPoints(cutPoints(timeline.items), timeline.duration, opts.maxSamples ?? 60);
  if (points.length === 0) return { findings: [], samples: [] };

  const audioItems = audioItemsAt(doc, timeline);

  await backend.init({ width: doc.size.width, height: doc.size.height });
  const samples: ReviewSample[] = [];

  try {
    const canvas = backend.canvas;
    if (!canvas) throw new Error('백엔드가 캔버스를 만들지 못했습니다.');
    const ctx = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('2D 컨텍스트를 얻지 못했습니다.');

    for (const t of points) {
      if (opts.signal?.aborted === true) break;

      await backend.drawFrame(t);
      const image = ctx.getImageData(0, 0, doc.size.width, doc.size.height);
      const stats = computeFrameStats(image.data);

      const ops = buildDrawList(doc, timeline, t);
      const captionText = captionTextAt(ops);
      const expectsAudio = audioItems.some((a) => t >= a.start && t < a.end);
      const level = opts.audioLevelAt?.(t);

      samples.push({
        t,
        stats,
        itemIds: ops.map((o) => o.itemId),
        captionText,
        // 자막 상자가 화면을 벗어났는지는 그리는 쪽만 아는데, 현재 캔버스 자막은
        // 폭에 맞춰 줄바꿈하므로 가로 넘침이 생기지 않는다. 세로만 본다.
        captionOverflow: false,
        expectsAudio,
        ...(level === undefined ? {} : { audioLevel: level }),
      });
    }
  } finally {
    backend.dispose();
  }

  return {
    findings: inspectSamples(samples, opts.thresholds ?? DEFAULT_REVIEW_THRESHOLDS),
    samples,
  };
}

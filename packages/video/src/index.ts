/**
 * Vibistudio 코어 배럴 (SCENARIO.md §5.13).
 *
 * 이 진입점은 **화면도 파일 접근도 인코딩 라이브러리도 없는 순수 층**이다. 시간 계산,
 * 편집 연산, 해시, 검증, 그리기 목록, 백엔드 선택 규칙, 검수 판정만 들어 있다.
 * 서버와 테스트가 이것만 쓰므로 무거운 의존성이 그쪽으로 새지 않는다.
 *
 * 실제로 그리고 인코딩하는 것은 `@vibisual/video/render`(브라우저 전용)에 있다.
 */

export * from './types.js';
export * from './constants.js';
export { resolveTimeline, activeItems, itemsAt, cutPoints, secondsToFrame, frameToSeconds } from './resolveTimeline.js';
export { applyPatch, createEmptyDoc } from './ops.js';
export { hashItem, hashDocShape, stableHash } from './hashItem.js';
export { validateDoc } from './validateDoc.js';
export type { ValidateResult } from './validateDoc.js';

// §5.13 (Q) — 콘티 한 벌을 이 앱의 문서로 옮기는 순수 변환(파일·네트워크 없음).
export { buildStoryboardOps, buildStoryboardDoc, storyboardLayout, storyboardDuration } from './storyboard.js';
export type { StoryboardBuildArgs, StoryboardLayout, StoryboardRect } from './storyboard.js';

// 순수한 렌더 결정 규칙 — 서버도 "어떤 방식으로 그렸나"를 말할 수 있어야 한다.
export {
  RENDER_BACKEND_CAPABILITIES,
  selectRenderBackend,
  describeSelection,
} from './render/backend.js';
export type {
  BackendProbe,
  BackendSelection,
  RenderBackend,
  RenderBackendCapabilities,
  RenderSurface,
  SkippedBackend,
} from './render/backend.js';

export { buildDrawList, audioItemsAt, captionTextAt } from './render/drawList.js';
export type { DrawOp, ResolvedTransform } from './render/drawList.js';

export { frameSignature, totalFrames } from './render/frameSignature.js';

// 검수 판정도 순수라 서버가 결과를 되짚어 볼 수 있다.
export {
  computeFrameStats,
  inspectSamples,
  summarizeFindings,
  shouldRetry,
  DEFAULT_REVIEW_THRESHOLDS,
} from './review/inspect.js';
export type { FindingCode, FrameStats, ReviewFinding, ReviewSample, ReviewThresholds } from './review/inspect.js';

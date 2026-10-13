/**
 * §5.13 (T) 코드 컴포지션 — 순수 층 배럴.
 *
 * 화면도 파일 접근도 없다. 서버(내주기·탐침)와 렌더 층(무대)과 테스트가 같은 판정을 쓰게 여기 모은다.
 */

export {
  compositionFolderOf,
  compositionMimeType,
  isCompositionHtmlPath,
  isCompositionWebFile,
  isProjectRelativePath,
  safeCompositionName,
  toPosixPath,
} from './paths.js';
export { localReferences, parseCompositionMeta, parseCompositionSize, parsePropsDecl } from './meta.js';
export type { CompositionDeclared, PropsDeclParse } from './meta.js';
export { scanComposition } from './lint.js';
export type { CompositionScan, CompositionSources, ScanOptions } from './lint.js';
// §5.13 (W) 38-9 — 렌더 엔진이 모르는 기능 표(순수).
export { ENGINE_FEATURES, unsupportedEngineFeatures } from './engineFeatures.js';
export type { EngineFeature } from './engineFeatures.js';
export {
  COMPOSITION_RUNTIME_JS,
  compositionCsp,
  compositionRuntimeScript,
  compositionSeed,
  injectCompositionRuntime,
} from './runtime.js';
export type { CompositionRuntimeInit, CompositionRuntimeStyle } from './runtime.js';
export { compositionSkeleton } from './skeleton.js';
export type { CompositionSkeletonArgs } from './skeleton.js';
export { COMPOSITION_GUIDE, MOTION_CRAFT_GUIDE, VIBISTUDIO_AGENT_GUIDE, compositionGuideFor } from './guide.js';
// §5.13 (T-10)(V) 37-11 — HTML 한 장 들여오기(바깥 참조 찾기·바꿔 쓰기 — 순수).
export { absoluteUrl, cssExternalRefs, ensureDurationMeta, findExternalRefs, rewriteUrls, vendorFileName } from './externalRefs.js';
export type { ExternalRef, ExternalRefKind } from './externalRefs.js';
// §5.13 (T-8) — 표지 모으기 결과 다듬기(겹침·순서·상한·같은 이름·도중 오류 — 순수).
export { cueScanLength, settleCues } from './cues.js';
export type { CueScanError, SettledCues } from './cues.js';
// §5.13 (V) 37-2 — 시작 화면 레시피(에이전트가 읽는 요청 확장 — 영문 정본).
export { VIDEO_RECIPES, findRecipe } from './recipes.js';
export type { RecipeMaterial, VideoRecipe } from './recipes.js';

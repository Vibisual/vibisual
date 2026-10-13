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

// §5.13 (R-3) — 눌러 연 영상 파일 한 개를 문서로 담는 순수 변환 + 빠진 실측값 채우기.
export {
  FILE_DOC_ASSET_ID,
  FILE_DOC_ITEM_ID,
  assetsNeedingMeasurement,
  buildFileDocOps,
  buildMeasurementOps,
  evenSide,
  isUntouchedDoc,
} from './fileDoc.js';
export type { MediaMeasurement } from './fileDoc.js';

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

// §5.13 (T) — 코드 컴포지션의 순수 판정·규약 글·런타임 심 문자열(서버·렌더 층·테스트가 같은 것을 쓴다).
export * from './composition/index.js';

// §5.13 (V) 37-12 — 소리의 순수 판정(비트 분석·덕킹 곡선).
export * from './audio/index.js';

/** 문서에 켜진 composition 아이템이 있는가 — DOM 무대(오프스크린 창)로만 그릴 수 있는 문서인지 가른다. */
export { docHasCompositions } from './resolveTimeline.js';

// §5.13 (V) 스튜디오 개편 — 장면 층·차이·판 기록·판형(순수).
export {
  anchorItemRef,
  anchorOffset,
  buildMergeChapterOps,
  buildRemoveChapterOps,
  buildSplitChapterOps,
  chapterFingerprint,
  chapterIdOf,
  chapterMap,
  deriveChapterOps,
  effectivePick,
  isUnpickedVariant,
  nextChapterId,
  offsetAnchor,
  resolveChapters,
  transitionOverlap,
} from './chapters.js';
export { requiredSchemaVersion } from './ops.js';
// §5.13 (V) 37-13 — 대본으로 편집(문장 목록·잘라 낼 구간·자르기 연산 — 순수).
export { buildCutOps, buildTranscript, keptSegments, mapCutTime, mergeCutRanges, sentenceCutRanges } from './transcript.js';
export type { CutPlan, CutRange, TranscriptSentence } from './transcript.js';
// §5.13 (V) 37-15 — 내보내기(판형 파생·SRT·자막 따로 내기 — 순수).
export { coverBox, deriveFormatDoc, derivedDocId } from './derive.js';
export { buildSrt, srtTime, withoutCaptions } from './srt.js';
export { diffDoc, diffTargets, summarizeDiff, DIFF_LINE_LIMIT } from './diffDoc.js';
export type { DiffChange, DiffLine, DiffLineKind, DocDiff } from './diffDoc.js';
export { isSafeHistoryId, restoreOps } from './history.js';
export type {
  DocActivity,
  HistoryAuthor,
  HistoryEntry,
  HistoryIndex,
  HistoryKind,
  PassRecord,
  PassReport,
  PassesFile,
} from './history.js';
export { SAFE_AREAS, VIDEO_FORMAT_IDS, formatOfSize, formatRatioLabel, safeAreaRect } from './formats.js';
// §5.13 (T-6)(V) 37-11 — 가져오기 목록 모양·라이선스 찾기·주입 태그(순수).
export { LIB_DOWNLOAD_MAX_BYTES, PACK_VENDOR_MAX_FILES, detectLicense, libFormatOf, libInjection, safeLibName } from './libs.js';
export type { LibFormat, LibItem, LibKind, LibRequest, LibsFile, LibVendored } from './libs.js';
// §5.13 (V) 37-11 — 우리가 쓴 부품 아홉(순수 HTML 생성기).
export { VIDEO_PARTS, findPart, partHtml } from './parts/index.js';
export type { PartCategory, SavedPart, SavedPartItem, VideoPartDef } from './parts/index.js';
// §5.13 (V) 37-8 — 전환 표(세 백엔드가 같은 것을 쓴다).
export { TRANSITION_KINDS, transitionEffect, flashAlpha, easeInOutCubic } from './render/transitions.js';
// §5.13 (V) 37-10 — 스타일 카드(후보 → 제안 — 순수).
export { DEFAULT_DOC_STYLE, hexToHsl, isCssColor, normalizeHex, suggestStyle } from './style.js';
export type { ColorCandidate, FontCandidate, LogoCandidate, StyleCandidates, StyleFile } from './style.js';
// §5.13 (V) 37-7 — 메모 핀의 모양(순수).
export { NOTE_STATUSES, NOTE_TEXT_MAX_CHARS, NOTE_REPLY_MAX_CHARS, NOTES_MAX_PER_DOC, isActiveNote, isNoteStatus, isSafeNoteId } from './notes.js';
export type { NoteStatus, NotesFile, VideoNote } from './notes.js';

// §5.13 (W) 38-4 — 상자의 시간 곡선(키프레임 — 순수).
export {
  KEYFRAME_EASES,
  KEYFRAME_PROPS,
  easeValue,
  hasKeyframes,
  punchInKeyframes,
  rebaseKeyframes,
  sampleKeyframes,
  scaleKeyframes,
  slowPushKeyframes,
  sortedKeyframes,
} from './keyframes.js';
export type { KeyframeProp, KeyframeState } from './keyframes.js';
// §5.13 (W) 38-5 — 이펙트 → CSS 필터·비네트(순수 — 세 백엔드가 같은 값).
export { effectsToFilter, isVideoLookName, vignetteCss, vignetteStops } from './render/effects.js';
export type { EffectStyle } from './render/effects.js';
// §5.13 (W) 38-6 — 자막 파일(SRT·VTT·낱말 JSON)과 자막 아이템 연산(순수 — 화면과 서버가 같은 것).
export {
  captionFormatOf,
  captionImportOps,
  cuesFromWords,
  looksLikeCaptionJson,
  nextDocId,
  parseCaptionText,
  parseSrt,
  parseVtt,
  parseWordsJson,
} from './captions.js';
export type { CaptionFileFormat, TimedWord } from './captions.js';
// §5.13 (W) 38-7 — 기획 단계 정지 화면(그 컴포지션 하나짜리 문서).
export { CHAPTER_FRAME_ITEM_ID, chapterFrameDoc, chapterFrameTime } from './chapters.js';

export { buildDrawList, audioItemsAt, captionTextAt } from './render/drawList.js';
// §5.13 (V) 37-6 — 화면의 한 점 아래 무엇이 있나(순수).
export { hitTest, opRect, textBounds } from './render/hitTest.js';
export type { HitRect, HitResult } from './render/hitTest.js';
export type { DrawOp, ResolvedTransform } from './render/drawList.js';
// §5.13 (V) 37-12 — 단어 강조 자막(순수 — 인스펙터가 추정 여부를 읽는다).
export { captionWordSpans, splitCaptionWords, wantsWordHighlight } from './render/captionWords.js';
export type { CaptionWordLayout, CaptionWordSpan } from './render/captionWords.js';

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

// §5.13 (V) 37-9 — 모션 검수 여덟(순수 — 문서 판정 + 일꾼 표본).
export {
  captionLines,
  contrastRatio,
  docTextBoxesAt,
  readingSeconds,
  relativeLuminance,
  reviewMotion,
  reviewSampleTimes,
  strongBeatsInDoc,
} from './review/motionReview.js';
export type { FrameProbe, MotionCode, MotionFinding, ProbeText } from './review/motionReview.js';

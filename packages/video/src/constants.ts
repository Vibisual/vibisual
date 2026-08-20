/**
 * Vibistudio 상수 (SCENARIO.md §5.13 §3.3 하드코딩 금지).
 *
 * 숫자를 코드 안에 흩어 놓지 않는다 — 값을 바꿔야 할 때 어디를 고쳐야 하는지가
 * 한 곳에서 보여야 한다.
 */

/** 문서 스키마 버전. 올릴 때는 로드 시 마이그레이션을 함께 넣는다(§5.13 (I)). */
export const VIDEO_SCHEMA_VERSION = 1;

/** 프로젝트 폴더 안에서 이 앱이 쓰는 자리(§3.5 프로젝트 독립성). */
export const VIDEO_DIR = 'video';
export const VIDEO_OUT_DIR = 'video/out';
export const VIDEO_CACHE_DIR = 'video/cache';

/** 새 문서 기본값. */
export const DEFAULT_VIDEO_SIZE = { width: 1920, height: 1080 } as const;
export const DEFAULT_VIDEO_FPS = 30;

/**
 * 렌더 백엔드 우선순위(§5.13 (F)).
 *
 * 앞에서부터 써 보고 못 쓰면 다음으로 내려간다. `html-in-canvas` 가 CSS 충실도와
 * GPU 속도를 동시에 주지만 오리진 트라이얼 단계라, 폴백이 없으면 API 가 흔들리는
 * 날 앱이 통째로 멈춘다.
 */
export const RENDER_BACKEND_ORDER = ['html-in-canvas', 'offscreen-capture', 'canvas2d'] as const;
export type RenderBackendId = (typeof RENDER_BACKEND_ORDER)[number];

/** 자동 검수 재시도 상한(§5.13 (G)). 무한 재렌더로 시간을 태우지 않게. */
export const AUTO_REVIEW_MAX_ATTEMPTS = 3;

/** 컷 경계 검사 시 경계에서 이만큼 안쪽을 본다(초) — 경계 정확히 그 지점은 전환 중이라 흐리다. */
export const CUT_INSPECT_EPSILON = 0.04;

/** 스틸 응답 최대 변. 에이전트 피드백용이라 원본 해상도가 필요 없다. */
export const STILL_MAX_EDGE = 640;

/** 한 문서가 가질 수 있는 아이템 수 상한. 넘으면 문서가 깨졌다고 본다. */
export const VIDEO_MAX_ITEMS = 5000;

/** 렌더 캐시 보관 상한(개). 넘으면 오래된 것부터 버린다. */
export const RENDER_CACHE_MAX_ENTRIES = 2000;

// ─── §5.13 (Q) 콘티 → 타임라인 ───

/** 빈 문서가 들고 나오는 트랙 id. 콘티를 옮길 때 새 트랙을 만들지 않는 이유가 이것이다. */
export const STORYBOARD_VISUAL_TRACK = 'visual';
export const STORYBOARD_CAPTION_TRACK = 'caption';

/**
 * 콘티에서 옮겨 온 아이템 수 상한.
 *
 * `VIDEO_MAX_ITEMS`(문서 전체 상한)보다 훨씬 낮게 잡는다 — 컷 16장 × 스탬프 십수 개는
 * 수백 개면 충분하고, 그보다 많이 나오면 콘티 쪽이 깨진 것이라 옮기기를 멈추는 편이 낫다.
 */
export const STORYBOARD_MAX_ITEMS = 1200;

/** 판넬 바깥 여백 — 출력 짧은 변 대비 비율. */
export const STORYBOARD_MARGIN_RATIO = 0.045;

/**
 * Vibistudio 상수 (SCENARIO.md §5.13 §3.3 하드코딩 금지).
 *
 * 숫자를 코드 안에 흩어 놓지 않는다 — 값을 바꿔야 할 때 어디를 고쳐야 하는지가
 * 한 곳에서 보여야 한다.
 */

/**
 * 문서 스키마 버전. 올릴 때는 로드 시 마이그레이션을 함께 넣는다(§5.13 (I)).
 *
 * 2 — §5.13 (T-1) `composition` 아이템·소재 종류. 1 → 2 는 모양이 그대로라 마이그레이션이 없다(옛 문서는 그대로 읽힌다).
 * 올리는 이유는 옛 앱이 composition 이 든 문서를 "모르는 종류"로 조용히 버리지 않고 "앱을 업데이트하세요"로 말하게 하려는 것.
 *
 * 3 — §5.13 (V) 37-4 장면 층(`chapters`·`chapterId`·`{chapter}` 앵커) + (T-8) 표지 앵커(`{cue,item}`) + 갈래(`variantId`)
 * + 문서 `style`. 2 → 3 도 더하기만이라 마이그레이션이 없다(옛 문서는 그대로 읽힌다).
 */
export const VIDEO_SCHEMA_VERSION = 3;

/** 프로젝트 폴더 안에서 이 앱이 쓰는 자리(§3.5 프로젝트 독립성). */
export const VIDEO_DIR = 'video';
export const VIDEO_OUT_DIR = 'video/out';
export const VIDEO_CACHE_DIR = 'video/cache';
/** §5.13 (T-1) — 컴포지션 폴더의 기본 자리(`.vibisual/` 아래). */
export const VIDEO_COMPOSITIONS_DIR = 'video/compositions';
/** §5.13 (T-6) — 사용자가 들여놓은 라이브러리·글꼴 자리(`.vibisual/` 아래). 컴포지션이 함께 읽을 수 있는 두 번째 뿌리. */
export const VIDEO_LIBS_DIR = 'video/libs';
/**
 * 가져온 소재 자리(`.vibisual/` 아래). §5.13 (V) 37-5 — 컴포지션의 '그림' 값이 문서 소재를 가리킬 수 있게 세 번째 뿌리로도
 * 내준다(웹 그림 형식만 — 영상·소리 파일은 내주지 않는다, (T-3) ②).
 */
export const VIDEO_ASSETS_DIR = 'video/assets';
/**
 * §5.13 (G)(T-9) — 에이전트가 자기 결과를 눈으로 보도록 스틸·프레임 띠를 써 두는 자리(`.vibisual/` 아래).
 * 같은 문서·같은 시각이면 같은 파일을 **덮어쓴다** — 지우는 코드 없이도 끝없이 쌓이지 않는다((K) 자동 삭제 ❌).
 */
export const VIDEO_REVIEW_DIR = 'video/review';

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

// ─── §5.13 (T) 코드 컴포지션 ───

/**
 * 가상 프레임 콜백의 고정 틱(Hz) — 출력 fps 와 떼어 낸다(T-2). rAF 마다 고정량을 더하는 코드는 브라우저의 60Hz 를
 * 전제로 쓰여 있어, 출력 프레임마다 부르면 30fps 문서에서 절반 속도가 된다.
 */
export const COMPOSITION_RAF_HZ = 60;

/** 컴포지션 한 장을 맞추는 데 기다리는 상한(ms). 넘으면 어느 아이템이 몇 초에서 멈췄는지 말한다. */
export const COMPOSITION_SEEK_TIMEOUT_MS = 10_000;

/** 컴포지션 문서가 처음 뜨기를 기다리는 상한(ms). */
export const COMPOSITION_LOAD_TIMEOUT_MS = 15_000;

/** 가상 시계의 0초가 가리키는 날짜(2026-01-01T00:00:00Z) — `Date.now()` 도 문서마다 같은 값을 낸다(결정성). */
export const COMPOSITION_CLOCK_EPOCH = 1_767_225_600_000;

/** 컴포지션 폴더에서 내주는(=읽을 수 있는) 웹 형식. 나머지는 뿌리 안에 있어도 내주지 않는다(T-3 ②). */
export const COMPOSITION_WEB_EXTENSIONS: readonly string[] = [
  '.html', '.htm', '.js', '.mjs', '.css', '.json', '.svg',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif',
  '.woff2', '.woff', '.ttf', '.otf',
];

/** 컴포지션 지문·결정성 검사에서 훑는 파일 수 상한(폴더가 크면 앞에서부터 이만큼). */
export const COMPOSITION_SCAN_MAX_FILES = 400;

/** 결정성 검사가 한 파일에서 읽는 바이트 상한 — 압축된 큰 라이브러리를 통째로 훑지 않는다. */
export const COMPOSITION_SCAN_MAX_BYTES = 2 * 1024 * 1024;

/** 뼈대 컴포지션의 기본 길이(초). */
export const COMPOSITION_DEFAULT_DURATION = 5;

// ─── §5.13 (G)(T-4)(T-9) 스틸 · 프레임 띠 · 일꾼 ───

/** 스틸 요청이 응답을 기다리는 최대 시간(ms). 숨은 일꾼 창을 처음 띄우는 몫까지 포함한다. */
export const STILL_TIMEOUT_MS = 45_000;

/** 프레임 띠의 기본 칸 수와 상한. */
export const STRIP_DEFAULT_FRAMES = 8;
export const STRIP_MAX_FRAMES = 24;

/** 프레임 띠 한 장의 최대 변(px). 칸은 이 안의 격자로 붙는다. */
export const STRIP_MAX_EDGE = 1600;

/** 프레임 띠 요청이 기다리는 최대 시간(ms) — 칸 수만큼 찍어야 해서 스틸보다 길다. */
export const STRIP_TIMEOUT_MS = 120_000;

/**
 * 집어 간 일감이 진행을 알려야 하는 간격 상한(ms) — 임대(T-4). 넘기면 일꾼이 죽은 것으로 보고 그 일감을 오류로 닫는다
 * (`running` 으로 영원히 굳지 않게). 일꾼은 이보다 훨씬 짧게(`JOB_HEARTBEAT_MS`) 진행을 보낸다.
 */
export const JOB_LEASE_MS = 90_000;
export const JOB_HEARTBEAT_MS = 5_000;

/** 일감이 없을 때 숨은 일꾼 창이 스스로 닫히기까지(ms) — 안 쓰면 0(P-1). */
export const WORKER_IDLE_MS = 120_000;

// ─── §5.13 (AA) 42 내보내기 편의 ───

/** §5.13 (AA) 42-1 — 마지막 내보내기 설정·내 프리셋(`.vibisual/` 아래). */
export const VIDEO_EXPORT_SETTINGS_FILE = 'video/export-settings.json';
/** §5.13 (AA) 42-6 — 렌더 대기열(아직 안 끝난 것 + 최근 끝난 것의 기록). */
export const VIDEO_RENDER_QUEUE_FILE = 'video/render-queue.json';
/** §5.13 (AA) 42-6 — 대기열에 남기는 끝난 기록 수(목록의 기록일 뿐 — 결과 파일은 지우지 않는다 (K)). */
export const RENDER_HISTORY_MAX = 200;
/** §5.13 (AA) 42-4 — [렌더] 한 번이 줄에 세우는 일감 상한(문서 × 판형 × 장면). */
export const EXPORT_BATCH_MAX = 60;
/** §5.13 (AA) 42-1 — 이름 붙여 저장하는 내 프리셋 수. */
export const EXPORT_PRESETS_MAX = 20;
/** §5.13 (AA) 42-5 — 도는 렌더가 일시정지·취소를 알아채려고 상태를 묻는 간격(ms). */
export const RENDER_CONTROL_POLL_MS = 600;
/** §5.13 (AA) 42-2 — 파일 이름(확장자 앞)의 UTF-8 바이트 상한 — 세 OS 의 이름 상한(255바이트) 아래로 번호 자리를 남긴다. */
export const EXPORT_FILE_NAME_MAX_BYTES = 200;
/** §5.13 (AA) 42-1 — 파일 이름 규칙의 기본값. */
export const EXPORT_DEFAULT_FILE_NAME = '{title}';
/** §5.13 (AA) 42 — 일감에 싣는 짧은 글(장면 이름·알림 글·이름 규칙)의 글자 상한. */
export const EXPORT_TEXT_MAX = 200;
/** §5.13 (AA) 42-2 — 저장 위치 경로의 글자 상한. */
export const EXPORT_PATH_MAX = 1024;
/** §5.13 (AA) 42-4 — 구간 렌더의 가장 짧은 길이(초). */
export const EXPORT_MIN_RANGE_S = 0.05;
/** §5.13 (AA) 42-1 — 고를 수 있는 프레임 수 범위. */
export const EXPORT_FPS_MIN = 1;
export const EXPORT_FPS_MAX = 120;
/**
 * §5.13 (U)(AA) 42-11 — 일꾼 ↔ 서버가 한 번에 주고받는 바이트 상한(소재 가져오기·렌더 결과). 넘는 렌더 결과는 일꾼이 올리기 전에
 * 사람 말로 알린다(서버가 413 으로 끊기 전에).
 */
export const VIDEO_TRANSFER_MAX_BYTES = 128 * 1024 * 1024;

// ─── §5.13 (V) 스튜디오 개편 ───

/** §5.13 (V) 37-3 — 판 기록 자리(`.vibisual/` 아래 `<docId>/`). 자동 삭제 코드는 없다((K)). */
export const VIDEO_HISTORY_DIR = 'video/history';
/** §5.13 (V) 37-7 — 메모 핀 자리(`.vibisual/` 아래 `<docId>.json`). */
export const VIDEO_NOTES_DIR = 'video/notes';
/** §5.13 (V) 37-10 — 프로젝트 스타일 카드(`.vibisual/` 아래). */
export const VIDEO_STYLE_FILE = 'video/style.json';
/** §5.13 (V) 37-10 — 스타일 글꼴·로고 사본 자리(라이브러리 뿌리 안 — 컴포지션이 읽을 수 있다). */
export const VIDEO_STYLE_ASSET_DIR = 'video/libs/style';
/** §5.13 (V) 37-11 — 부품 자리(우리 부품의 사본·내 부품·썸네일). */
export const VIDEO_PARTS_DIR = 'video/parts';

/** §5.13 (V) 37-3 — 판 기록 한 줄의 요청 글 상한(글자). 긴 요청은 앞부분만 남긴다(목록이 부풀지 않게). */
export const HISTORY_REQUEST_MAX_CHARS = 600;
/** §5.13 (V) 37-3 — 바퀴 보고의 요약·제안·경고 상한. */
export const PASS_SUMMARY_MAX_CHARS = 2000;
export const PASS_LIST_MAX_ITEMS = 12;
export const PASS_LIST_ITEM_MAX_CHARS = 400;

/** §5.13 (V) 37-15 — 판형 셋. 출력 프리셋(쇼츠·가로·정사각)도 이 표를 쓴다. */
export const VIDEO_FORMATS = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
} as const;

/** §5.13 (V) 37-2 — 시작 화면의 길이 칩(초). */
export const START_LENGTH_CHOICES: readonly number[] = [15, 30, 60];

/** §5.13 (T-8) — 컴포지션 하나에서 모으는 신호 표지 상한(파티클마다 부르는 코드가 문서를 부풀리지 않게). */
export const COMPOSITION_CUES_MAX = 500;
/** §5.13 (T-8) — 표지 모으기 일감(렌더 줄 — 끝까지 한 번 흘린다)을 기다리는 상한(ms). */
export const CUES_TIMEOUT_MS = 180_000;

/** §5.13 (V) 37-9 — 프레임 검수 일감(`frames=1`)을 기다리는 상한(ms) — 표본 여러 장을 찍는다. */
export const REVIEW_TIMEOUT_MS = 150_000;
/** §5.13 (V) 37-9 — 프레임 검수 표본 수 상한. */
export const REVIEW_MAX_SAMPLES = 24;

/** §5.13 (V) 37-8 — 전환 길이 범위(초)와 기본값. */
export const TRANSITION_MIN_SECONDS = 0.2;
export const TRANSITION_MAX_SECONDS = 1.5;
export const TRANSITION_DEFAULT_SECONDS = 0.5;

/**
 * §5.13 (W) 38-2 — 렌더가 나눠 쓰는 숨은 캡처 창 수(상한). 실제 수는 논리 코어 절반을 넘지 않는다 — 창 하나가 렌더러
 * 프로세스 하나다.
 */
export const VIDEO_CAPTURE_SESSIONS = 3;
/** §5.13 (W) 38-2 — 세션마다 앞질러 찍어 두는 프레임 수(날 비트맵이 메모리에 머무는 상한). */
export const VIDEO_CAPTURE_LOOKAHEAD_PER_SESSION = 2;
/**
 * §5.13 (W) 38-1 — 숨은 렌더 창의 크기 상한(DIP). Windows 는 창을 화면 작업 영역으로 줄인다(실측: 1920×1080 → 1707×912) —
 * 최대 크기를 이만큼 연 뒤 내용 크기를 다시 준다.
 */
export const OFFSCREEN_MAX_EDGE = 16_384;

/** §5.13 (W) 38-4 — [강조 줌]: 이만큼 키우고(배율), 오르내리는 데 걸리는 초, 유지하는 초. */
export const PUNCH_IN_SCALE = 1.15;
export const PUNCH_IN_RAMP_SECONDS = 0.3;
export const PUNCH_IN_HOLD_SECONDS = 1.2;
/** §5.13 (W) 38-4 — [천천히 밀기]: 아이템 길이 동안 이 배율까지. */
export const SLOW_PUSH_SCALE = 1.08;

/**
 * §5.13 (W) 38-5 — 이름 붙은 색 룩(우리가 정한 값). 값의 뜻은 `color` 이펙트와 같다(곱 1 = 그대로, `temperature` -1~1,
 * `vignette` 0~1). 새 룩은 여기 한 줄로만.
 */
export const VIDEO_LOOKS = {
  warm: { temperature: 0.45, saturation: 1.08, contrast: 1.04 },
  cool: { temperature: -0.45, saturation: 0.96, contrast: 1.04 },
  mono: { saturation: 0, contrast: 1.12 },
  vivid: { saturation: 1.3, contrast: 1.1 },
  fade: { contrast: 0.86, brightness: 1.06, saturation: 0.85 },
  cinematic: { contrast: 1.14, saturation: 0.9, temperature: -0.12, vignette: 0.35 },
} as const satisfies Readonly<Record<string, Readonly<Partial<Record<'brightness' | 'contrast' | 'saturation' | 'hue' | 'temperature' | 'vignette', number>>>>>;
export type VideoLookName = keyof typeof VIDEO_LOOKS;

/** §5.13 (W) 38-6 — 낱말만 있는 받아쓰기를 자막 큐로 묶는 기준: 이만큼 쉬면 끊고, 글자 수·길이를 넘으면 끊는다. */
export const CAPTION_GROUP_PAUSE_SECONDS = 0.6;
export const CAPTION_GROUP_MAX_CHARS = 42;
export const CAPTION_GROUP_MAX_SECONDS = 7;
/** §5.13 (W) 38-6 — 에이전트가 가져오는 자막 파일 크기 상한(바이트). */
export const CAPTION_IMPORT_MAX_BYTES = 8 * 1024 * 1024;

// ─── §5.13 (X) 첫 열림·재생 성능 ───

/** §5.13 (X) 39-5 — 미리보기 무대가 미리 여는 거리(초): 이 안에 시작하는 컴포지션은 지금 열어 첫 시각에 맞춰 둔다. */
export const STAGE_WARM_AHEAD_SECONDS = 3;
/** §5.13 (X) 39-5 — 한 번에 미리 여는 컴포지션 수 상한(샌드박스 프레임 하나가 문서 한 벌이다). */
export const STAGE_WARM_AHEAD_MAX = 2;
/** §5.13 (X) 39-5 — 막 지나간 컴포지션을 버리지 않고 보관하는 수(앞뒤로 훑을 때 다시 열지 않게). */
export const STAGE_WARM_PARKED_MAX = 2;
/** §5.13 (X) 39-5 — 보관한 컴포지션을 이만큼(ms) 다시 안 쓰면 버린다. */
export const STAGE_WARM_PARKED_TTL_MS = 30_000;

/** §5.13 (X) 39-4 — 장면 구슬·기획 카드의 대표 프레임 한 변(px). 구슬은 높이 44px 이라 화면 배율 3배에도 남는다. */
export const CHAPTER_THUMB_MAX_EDGE = 320;
/** §5.13 (X) 39-4 — 대표 프레임 디스크 기억 자리(`.vibisual/` 아래 `<docId>/<열쇠>.<확장자>`). 문서마다 지금 장면 것만 남긴다. */
export const VIDEO_THUMBS_DIR = 'video/thumbs';
/** §5.13 (X) 39-4 — 한 문서가 디스크에 남기는 대표 프레임 상한(장 — 넘으면 오래된 것부터 지운다). */
export const CHAPTER_THUMBS_MAX_PER_DOC = 64;
/** §5.13 (X) 39-4 — 대표 프레임 한 장의 상한(바이트) — 넘는 그림은 남기지 않는다. */
export const CHAPTER_THUMB_MAX_BYTES = 512 * 1024;
/** §5.13 (X) 39-4 — 대표 프레임 일감이 기다리는 최대 시간(ms) — 여러 장을 한 무대에서 차례로 찍는다. */
export const CHAPTER_THUMBS_TIMEOUT_MS = 90_000;
/** §5.13 (X) 39-4 — 대표 프레임을 창 안에 기억하는 바이트 예산(데이터 주소 글자 수 기준 — 개수가 아니라 크기로 묶는다). */
export const CHAPTER_THUMB_CACHE_BYTES = 24 * 1024 * 1024;

/** §5.13 (X) 39-6 — 재생하는 동안 화면 전체(대화·구슬·값 카드)를 다시 그리는 간격(ms). 그림·재생 머리·시계는 프레임마다 따로 간다. */
export const STUDIO_PLAYBACK_UI_MS = 120;
/** §5.13 (X) 39-8 — 숨은 스튜디오(다른 탭으로 가려진 앱 안 창·최소화된 창)가 무대를 내려놓기까지(ms). 돌아오면 다시 세운다. */
export const STUDIO_HIDDEN_RELEASE_MS = 45_000;

// ─── §5.13 (Z) 흘려 트는 재생 ───

/**
 * §5.13 (Z) 41-3 — 재생 중 합성기에 미리 예약하는 거리(초). 이만큼 앞까지의 컷·전환·페이드를 Web Animations 로 걸어 두므로,
 * 화면 스레드가 이보다 짧게 막히는 동안은 상자가 제때 바뀐다. 곧 보일 컴포지션도 이 안이면 미리 깨워 둔다.
 */
export const STAGE_PLAN_HORIZON_S = 3;
/** §5.13 (Z) 41-3 — 예약을 다시 짜는 간격(초). 예약 거리의 1/3 이라 화면 스레드가 2초 막혀도 예약이 바닥나지 않는다. */
export const STAGE_PLAN_REFRESH_S = 1;
/** §5.13 (Z) 41-4 — 실사 `<video>` 를 시작 전에 미리 굴려 두는 시간(초) — 키프레임부터 푸는 첫 장이 시작 순간에 서 있게. */
export const FOOTAGE_STREAM_PREROLL_S = 0.5;
/** §5.13 (Z) 41-4 — 재생 시계와 이만큼(초) 넘게 어긋날 때만 `<video>` 를 맞춘다(40-14 ① — 자주 맞추면 그때마다 디코더가 키프레임부터 다시 푼다). */
export const FOOTAGE_STREAM_DRIFT_S = 0.45;

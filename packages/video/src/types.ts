/**
 * Vibistudio 타임라인 문서 스키마 (SCENARIO.md §5.13 (D)).
 *
 * **영상의 진실은 코드가 아니라 이 문서에 있다.** 코드는 이 문서를 그리는 방법일 뿐이고,
 * AI 에이전트가 편집하는 대상도 코드가 아니라 이 문서다.
 *
 * 설계에서 절대 어기지 않는 세 가지:
 *
 * 1. **시간 단위는 초(`number`)다.** 프레임과 fps 는 렌더 시점에만 존재한다. 문서에
 *    `durationInFrames` 류 표현을 두면 fps 를 바꾸는 순간 문서 전체가 거짓이 되고,
 *    AI 가 "3초 뒤"를 쓰려면 매번 fps 를 곱해야 한다.
 * 2. **참조는 안정 식별자(id)로만 한다.** 순번(index)으로 가리키면 에이전트가 아이템을
 *    하나 넣거나 뺄 때마다 그 뒤의 모든 참조가 조용히 어긋난다.
 * 3. **`scene`(코드로 그리는 것)과 `footage`(실사 파일)는 같은 자격이다.** 둘을 한 트랙
 *    모델에 동등하게 올리는 것이 이 앱의 존재 이유다(§5.13 (A) 빈자리).
 */

/** 트랙의 성격. 렌더 시 합성 순서와 처리 경로를 가른다. */
export type VideoTrackKind = 'visual' | 'audio' | 'caption';

/**
 * 아이템 종류.
 *
 * `scene` 은 우리가 코드로 그리는 모션그래픽이고 `footage` 는 실사 파일이다.
 * **둘이 같은 유니온에 있다는 것 자체가 설계의 핵심**이며, 새 종류는 이 유니온에
 * 한 줄 추가하는 것으로만 늘린다.
 *
 * §5.13 (T-1) — `composition` 은 에이전트(또는 사람)가 HTML·CSS·JS 로 짠 모션그래픽 파일이다. 움직임은 그
 * 파일에, 언제·어디에·어떤 데이터(`props`)로는 이 문서에 있다. 기본 씬 6종과 **병행**한다(대체 ❌).
 */
export type VideoItemKind = 'scene' | 'footage' | 'image' | 'audio' | 'caption' | 'shape' | 'text' | 'composition';

/**
 * 시각 앵커.
 *
 * 절대 초로도 쓸 수 있지만, **상대 앵커가 기본**이다. 씬을 하나 끼워 넣어도 뒤의
 * 모든 아이템이 밀리지 않는 이유가 여기 있다.
 *
 * - `3.5` — 절대 3.5초
 * - `{ after: 'intro', offset: 0.5 }` — intro 가 끝나고 0.5초 뒤
 * - `{ start: 'narration', offset: -0.2 }` — narration 과 같이 시작하되 0.2초 먼저
 */
export type TimeAnchor =
  | number
  | { readonly after: string; readonly offset?: number }
  | { readonly start: string; readonly offset?: number }
  /** §5.13 (V) 37-4 — 장면 시작 + offset. 장면이 움직이면(순서·길이) 따라간다. */
  | { readonly chapter: string; readonly offset?: number }
  /** §5.13 (T-8) — composition 아이템 `item` 이 알린 표지 `cue` 의 시각 + offset(음수면 앞). */
  | { readonly cue: string; readonly item: string; readonly offset?: number };

/**
 * 길이.
 *
 * `'auto'` 는 그 아이템이 참조하는 소재(오디오·영상)의 실측 길이를 쓴다는 뜻이다.
 * **오디오가 시간의 주인**이라는 원칙이 이 한 값으로 구현된다 — 음성 길이가 씬 길이를
 * 정하고 비주얼이 따라간다. 길이를 사람이 손으로 맞추다 보정 스크립트를 짜게 되는
 * 부류의 사고를 구조에서 없앤다.
 */
export type VideoDuration = number | 'auto';

/** 소재가 어디서 오는가. */
export type VideoAssetSource =
  /** 이미 디스크에 있는 파일. 프로젝트 루트 기준 상대 경로를 권장한다. */
  | { readonly kind: 'file'; readonly path: string }
  /**
   * 외부 도구가 만들어 내는 소재(TTS·이미지 생성·얼굴 생성 등).
   *
   * §5.13 (H) — 앱은 무거운 생성 모델을 안지 않는다. 부를 자리만 열어 두고 실제
   * 생성은 사용자의 기존 파이프라인이 계속한다.
   */
  | {
      readonly kind: 'external';
      readonly command: string;
      readonly args?: readonly string[];
      /** 그 명령이 만들어 낼 파일 경로. 이게 있어야 결과를 다시 소재로 집을 수 있다. */
      readonly output: string;
    };

/**
 * §5.13 (T-2) — 컴포지션이 시각을 맞추는 방식.
 *
 * - `random` — 아무 시각으로나 바로 뛴다(CSS 애니메이션·Web Animations·`__vibi.seek`·타임라인 객체만 쓴다).
 * - `forward` — 프레임 콜백(rAF·타이머)에 기대 상태를 쌓는다. 뒤로 가면 처음부터 다시 흘린다(그만큼 느리다).
 */
export type CompositionSeekMode = 'random' | 'forward';

/**
 * §5.13 (T-2) — 컴포지션 소스를 훑어 찾은 것 한 줄(결정성 검사).
 *
 * `code` 는 화면이 번역 키로 쓰고(`panel.videoStudio.lint.<code>`), `message` 는 에이전트가 읽는 영문이다.
 */
export interface CompositionLintEntry {
  readonly level: 'error' | 'warn' | 'info';
  readonly code: string;
  readonly message: string;
}

/**
 * §5.13 (V) 37-5 — 컴포지션이 선언한 **값** 하나(`<script type="application/json" id="vibi-props">`).
 *
 * 사람이 바꿀 만한 글자·숫자·색·글꼴·그림·시각·고르기를 코드 밖으로 꺼낸 것이다. 스튜디오는 이 선언으로 종류별 손잡이를
 * 그리고, 값은 아이템 `props[name]` 에 산다(없으면 `default`).
 */
export type CompositionPropType = 'text' | 'number' | 'color' | 'font' | 'image' | 'time' | 'choice';

export interface CompositionPropDecl {
  readonly name: string;
  readonly type: CompositionPropType;
  readonly default?: string | number;
  readonly label?: string;
  readonly description?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** `choice` 의 고를 값들. */
  readonly options?: readonly string[];
  /** `text` 를 여러 줄 칸으로. */
  readonly multiline?: boolean;
}

/** §5.13 (T-8) — 컴포지션이 알린 신호 표지 한 개(그 컴포지션 안 시각, 초). */
export interface CompositionCue {
  readonly name: string;
  readonly t: number;
}

/**
 * §5.13 (T-8) — 표지 모으기가 남긴 이상 한 건. 해소기가 그 소재를 쓰는 아이템의 진단으로 옮긴다.
 * `cues-truncated` = 상한을 넘어 앞에서부터만 남겼다 · `cue-duplicate` = 같은 이름이 `count` 번(묶이는 것은 첫 번째) ·
 * `cue-error` = 흘리는 도중 `t` 초에서 오류가 났다.
 */
export interface CueIssue {
  readonly code: 'cues-truncated' | 'cue-duplicate' | 'cue-error';
  readonly name?: string;
  readonly count?: number;
  readonly t?: number;
  readonly message?: string;
}

/** 소재 한 건. 실측값(길이·크기)은 파일을 실제로 읽은 뒤에만 채워진다. */
export interface VideoAsset {
  readonly id: string;
  /** §5.13 (T-1) — `composition` = 프로젝트 안 HTML 파일 하나(그 파일이 있는 폴더가 컴포지션 폴더). */
  readonly kind: 'audio' | 'video' | 'image' | 'font' | 'composition';
  readonly source: VideoAssetSource;
  /** 초. 오디오·영상·컴포지션이 의미가 있으며, 이 값이 있어야 `duration:'auto'` 를 풀 수 있다. */
  readonly duration?: number;
  readonly width?: number;
  readonly height?: number;
  /** Whether a measured video/audio source contains an audio track. Missing means not measured yet. */
  readonly hasAudio?: boolean;
  /**
   * 파일 내용 해시. 소재가 바뀌면 그 아이템의 렌더 캐시만 무효가 된다.
   * 컴포지션은 폴더 안 웹 형식 파일 전부의 지문이다 — 코드 한 줄을 고치면 이 값이 바뀌어 미리보기가 다시 읽는다.
   */
  readonly contentHash?: string;
  /** §5.13 (T-2) — 컴포지션만. 탐침이 판정한 시각 맞춤 방식. */
  readonly mode?: CompositionSeekMode;
  /** §5.13 (T-2) — 컴포지션만. 탐침이 소스를 훑어 찾은 것(에이전트가 `GET /doc` 으로 바로 본다). */
  readonly lint?: readonly CompositionLintEntry[];
  /** §5.13 (V) 37-5 — 컴포지션만. 값 선언(순서 보존). 탐침이 채운다. */
  readonly propsDecl?: readonly CompositionPropDecl[];
  /**
   * §5.13 (V) 37-15 — 컴포지션만. `<meta name="vibi:responsive" content="true">` — 선언 크기 대신 아이템 상자 크기를 받아
   * 그 크기에 맞춰 다시 짠다(판형 파생).
   */
  readonly responsive?: boolean;
  /** §5.13 (T-8) — 컴포지션만. 표지 모으기가 채운 신호 표지와 그때의 내용 해시. */
  readonly cues?: readonly CompositionCue[];
  readonly cuesHash?: string;
  /** §5.13 (T-8) — 컴포지션만. 탐침이 소스에서 `__vibi.cue` 를 봤다(표지를 모아야 한다). */
  readonly usesCues?: boolean;
  /** §5.13 (T-8) — 컴포지션만. 마지막 표지 모으기가 남긴 이상(상한·같은 이름·도중 오류). */
  readonly cueIssues?: readonly CueIssue[];
  /** §5.13 (V) 37-12 — 음악 소재만. 로컬 비트 분석 결과(초)와 그때의 내용 표식. */
  readonly beats?: readonly number[];
  readonly beatsStrong?: readonly number[];
  readonly bpm?: number;
  readonly beatsHash?: string;
}

/** §5.13 (V) 37-4 — 장면의 단계. 기획(`plan`) → 승인(`approved`) → 짓는 중(`building`) → 끝(`done`). */
export type ChapterStatus = 'plan' | 'approved' | 'building' | 'done';

/** §5.13 (V) 37-8 — 장면 사이 전환(우리가 쓴 것). `cut` 은 겹치지 않는다. */
export type TransitionKind = 'cut' | 'dissolve' | 'push' | 'zoom' | 'flash' | 'wipe';

export interface ChapterTransition {
  readonly kind: TransitionKind;
  /** 초 — 앞 장면과 이만큼 겹친다. */
  readonly duration: number;
}

/** §5.13 (V) 37-14 — 엔진. */
export type VideoEngineKind = 'claude' | 'codex';

/**
 * §5.13 (W) 38-7 — 기획 단계의 **정지 화면**: 그 장면의 핵심 순간을 다 디자인한 컴포지션 소재 하나와 보여 줄 시각(초, 기본 0).
 * 움직임을 짓기 전에 사람이 이 그림으로 모양을 승인한다.
 */
export interface ChapterFrame {
  readonly assetId: string;
  readonly t?: number;
}

/** §5.13 (V) 37-14 — 같은 장면을 엔진마다 지은 갈래 하나. 아이템 `variantId` 가 이 id 를 가리킨다. */
export interface ChapterVariant {
  readonly id: string;
  readonly engine: VideoEngineKind;
  readonly agentId?: string;
  readonly label?: string;
  readonly status: 'building' | 'done';
}

/**
 * §5.13 (V) 37-4 — **장면** 하나. 문서의 `chapters` 배열 순서가 곧 시간 순서다.
 *
 * 장면은 앞 장면 끝에서(들어오는 전환 길이만큼 겹쳐) 시작하고 `offset` 만큼 밀린다. `at` 이 숫자면 그 절대 시각이다.
 * 그래서 순서를 바꾸면 뒤 장면이 따라오고, `{ chapter }` 앵커로 묶인 아이템도 함께 움직인다(상대 앵커).
 */
export interface VideoChapter {
  readonly id: string;
  readonly title: string;
  readonly at?: number;
  readonly offset?: number;
  /** 초. 장면이 차지하는 시간(기획 카드의 길이). */
  readonly duration: number;
  /** 움직임·내용 설명(기획 카드). */
  readonly brief?: string;
  /** 화면에 나올 글자(기획 카드). */
  readonly text?: string;
  /** 쓸 소재 id 들(기획 카드). */
  readonly media?: readonly string[];
  /** 소리 설명(기획 카드). */
  readonly sound?: string;
  readonly status: ChapterStatus;
  /** 이 장면으로 **들어오는** 전환. */
  readonly transition?: ChapterTransition;
  readonly variants?: readonly ChapterVariant[];
  /** 고른 갈래 id. 없으면 첫 갈래가 보인다. */
  readonly pick?: string;
  /** 이 장면을 지은 엔진(표시용). */
  readonly engine?: VideoEngineKind;
  /** §5.13 (W) 38-7 — 기획 단계 정지 화면(기획 카드가 띄운다). */
  readonly frame?: ChapterFrame;
}

/** §5.13 (V) 37-10 — 문서에 적힌 스타일(스타일 카드에서 온다). 같은 문서 = 같은 프레임. */
export interface DocStyle {
  readonly accent: string;
  readonly bg: string;
  readonly fg: string;
  readonly muted: string;
  readonly fontFamily?: string;
  /** 프로젝트 기준 상대 경로(`.vibisual/video/libs/style/…`). */
  readonly fontFile?: string;
  /** 프로젝트 기준 상대 경로(`.vibisual/video/libs/style/…`). */
  readonly logo?: string;
}

/** §5.13 (V) 37-15 — 판형. */
export type VideoFormatId = 'landscape' | 'portrait' | 'square';

/** 자막 한 단어. 단어 단위 타임스탬프는 1급 데이터다(§5.13 (D)). */
export interface CaptionWord {
  /** 그 단어가 시작하는 시각(초, 문서 전체 기준). */
  readonly t: number;
  readonly text: string;
}

/** 자막 한 덩어리. */
export interface CaptionCue {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly words?: readonly CaptionWord[];
}

/** 화면 배치. 값은 전부 정규화(0~1)가 아니라 문서 `size` 기준 픽셀이다. */
export interface VideoTransform {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
  readonly opacity?: number;
  readonly scale?: number;
}

/**
 * 이펙트 한 건. 종류별 파라미터는 `params` 에 담는다.
 *
 * §5.13 (W) 38-5 — 렌더가 읽는 종류(`VideoEffectKind`): `look`(`{ name }` — `VIDEO_LOOKS`) · `color`(`brightness`·`contrast`·
 * `saturation` 곱 · `hue` 도 · `temperature` -1~1) · `blur`(`radius` 문서 픽셀) · `vignette`(`amount` 0~1). 모르는 종류는 그리지
 * 않고 문서에는 남는다(지우지 않는다).
 */
export interface VideoEffect {
  readonly id: string;
  readonly kind: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/** §5.13 (W) 38-5 — 렌더가 아는 이펙트 종류. */
export type VideoEffectKind = 'look' | 'color' | 'blur' | 'vignette';

/**
 * §5.13 (W) 38-4 — 키프레임 곡선. 그 키프레임으로 **들어오는** 구간에 쓴다. `hold` 는 그 시각이 될 때까지 앞 값을 유지한다.
 */
export type KeyframeEase = 'linear' | 'in' | 'out' | 'inOut' | 'hold';

/**
 * §5.13 (W) 38-4 — 아이템 **상자**의 시간 곡선 한 점(컴포지션 안의 움직임은 여전히 코드다).
 *
 * `t` 는 아이템 시작부터의 초. 값은 기본 배치(`transform`)에 **얹는 상대값**이다 — `dx`·`dy` 는 문서 픽셀만큼 옮기고, `scale`·
 * `opacity` 는 곱하고, `rotation` 은 도를 더한다. 그래서 상자를 옮겨도 움직임은 그대로 따라오고, 판형 파생이 dx·dy 만 옮기면 된다.
 * 속성마다 그 속성을 적은 키프레임끼리만 보간한다.
 */
export interface VideoKeyframe {
  readonly t: number;
  readonly dx?: number;
  readonly dy?: number;
  readonly scale?: number;
  readonly rotation?: number;
  readonly opacity?: number;
  readonly ease?: KeyframeEase;
}

/** 타임라인 위의 아이템 하나. */
export interface VideoItem {
  readonly id: string;
  readonly kind: VideoItemKind;
  readonly at: TimeAnchor;
  readonly duration: VideoDuration;
  /** `footage` / `image` / `audio` 가 참조하는 소재. */
  readonly assetId?: string;
  /** `scene` 이 그릴 장면 컴포넌트의 이름. */
  readonly sceneId?: string;
  /** 장면에 넘길 데이터. 씬을 데이터 주도로 만드는 자리. */
  readonly props?: Readonly<Record<string, unknown>>;
  readonly transform?: VideoTransform;
  /** §5.13 (W) 38-4 — 상자의 시간 곡선(강조 줌·천천히 밀기 등). 없으면 `transform` 그대로. */
  readonly keyframes?: readonly VideoKeyframe[];
  readonly effects?: readonly VideoEffect[];
  /** `caption` 전용. */
  readonly cues?: readonly CaptionCue[];
  /** 소재 안에서 잘라 쓸 시작 지점(초). 소재 자체를 건드리지 않는 비파괴 트림. */
  readonly trimStart?: number;
  /** 꺼 두면 렌더에서 빠지되 문서에는 남는다. 지우지 않고 끄는 길을 항상 둔다. */
  readonly enabled?: boolean;
  readonly label?: string;
  /** §5.13 (V) 37-4 — 이 아이템이 속한 장면. 시각은 `at:{chapter}` 앵커로 묶는 것이 기본이다. */
  readonly chapterId?: string;
  /** §5.13 (V) 37-14 — 이 아이템이 속한 갈래(장면의 `variants`). 고르지 않은 갈래는 그리지 않는다. */
  readonly variantId?: string;
}

/** 트랙 하나. */
export interface VideoTrack {
  readonly id: string;
  readonly kind: VideoTrackKind;
  readonly label?: string;
  readonly muted?: boolean;
  readonly hidden?: boolean;
  readonly items: readonly VideoItem[];
}

/** 문서 전체. */
export interface VideoDoc {
  readonly schemaVersion: number;
  readonly id: string;
  readonly title: string;
  /** 낙관적 잠금용. 패치가 성공할 때마다 1씩 오른다(§5.13 (G)). */
  readonly version: number;
  readonly size: { readonly width: number; readonly height: number };
  /** 렌더 시점에만 쓰이는 값. 문서의 시간 표현은 초라서 이걸 바꿔도 타이밍은 안 변한다. */
  readonly fps: number;
  /** 난수는 전부 여기서 파생한다 — 같은 문서는 같은 프레임을 낸다(결정성). */
  readonly seed?: number;
  readonly tracks: readonly VideoTrack[];
  readonly assets: Readonly<Record<string, VideoAsset>>;
  /** §5.13 (V) 37-4 — 장면 층(배열 순서 = 시간 순서). 없으면 종전 문서와 같다. */
  readonly chapters?: readonly VideoChapter[];
  /** §5.13 (V) 37-10 — 이 문서의 스타일(모든 컴포지션에 같은 팔레트). */
  readonly style?: DocStyle;
  /** §5.13 (V) 37-15 — 판형 파생 문서면 원본. */
  readonly derivedFrom?: { readonly docId: string; readonly format: VideoFormatId };
  readonly createdAt: number;
  readonly updatedAt: number;
}

// ---------------------------------------------------------------------------
// 해소 결과 (resolveTimeline)
// ---------------------------------------------------------------------------

/** 진단 심각도. `error` 는 그 아이템이 타임라인에서 빠졌다는 뜻이다. */
export type ResolveLevel = 'error' | 'warn';

/**
 * 진단 코드.
 *
 * 문자열 유니온으로 두는 이유는 UI 가 번역 키로 바로 쓰고, 테스트가 메시지 문구가
 * 아니라 코드로 고정되기 때문이다(문구를 다듬어도 테스트가 깨지지 않는다).
 */
export type ResolveCode =
  | 'duplicate-item-id'
  | 'unknown-anchor'
  | 'anchor-cycle'
  | 'unknown-asset'
  | 'auto-without-source'
  | 'auto-without-duration'
  | 'negative-duration'
  | 'negative-start'
  | 'empty-caption'
  // §5.13 (T-1) — composition 아이템이 잘못된 소재를 가리킨다(그 아이템만 빠진다).
  | 'composition-asset-kind'
  | 'composition-not-html'
  | 'composition-outside-project'
  // §5.13 (V) 37-4 — 장면 앵커가 없는 장면을 가리킨다 / 장면 길이가 숫자가 아니다.
  | 'unknown-chapter'
  | 'chapter-bad-duration'
  // §5.13 (T-8) — 표지 앵커가 풀리지 않는다(표지가 없다 / 아이템 구간 밖이다).
  | 'cue-missing'
  | 'cue-outside'
  // §5.13 (T-8) — 표지 모으기가 남긴 이상(같은 이름 N번 / 상한 / 흘리는 도중 오류) — 그 소재를 쓰는 아이템에 단다.
  | 'cue-duplicate'
  | 'cues-truncated'
  | 'cue-error'
  // §5.13 (W) 38-7 — 장면의 정지 화면이 없는 소재·컴포지션이 아닌 소재를 가리킨다(문서는 그대로, 카드에 그림이 안 선다).
  | 'chapter-frame-asset';

export interface ResolveDiagnostic {
  readonly level: ResolveLevel;
  readonly code: ResolveCode;
  readonly message: string;
  readonly itemId?: string;
  readonly trackId?: string;
}

/** 시각이 확정된 아이템. */
export interface ResolvedItem {
  readonly id: string;
  readonly trackId: string;
  readonly trackKind: VideoTrackKind;
  readonly kind: VideoItemKind;
  readonly start: number;
  readonly end: number;
  readonly duration: number;
  readonly item: VideoItem;
}

/** §5.13 (V) 37-4 — 시각이 확정된 장면. */
export interface ResolvedChapter {
  readonly id: string;
  /** 0 부터의 순번(화면에 "n번 장면" 으로 쓸 때만 — 참조는 id 로). */
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly duration: number;
  /** 들어오는 전환이 실제로 겹치는 길이(초). */
  readonly overlapIn: number;
  readonly chapter: VideoChapter;
}

/** 해소된 타임라인. 렌더러는 이것만 보고 그린다. */
export interface ResolvedTimeline {
  readonly items: readonly ResolvedItem[];
  /** 문서 전체 길이(초) = 그려질 아이템 `end` 와 장면 끝의 최댓값. */
  readonly duration: number;
  readonly diagnostics: readonly ResolveDiagnostic[];
  /** §5.13 (V) 37-4 — 장면(문서 순서). 장면이 없으면 빈 배열. */
  readonly chapters: readonly ResolvedChapter[];
}

// ---------------------------------------------------------------------------
// 편집 연산 (§5.13 (G))
// ---------------------------------------------------------------------------

/**
 * 문서 편집 연산.
 *
 * 전부 안정 식별자 기반이며 순번을 쓰지 않는다. 에이전트는 이 연산 배열을
 * `baseVersion` 과 함께 보내고, 서버는 버전이 어긋나면 거절한다.
 */
export type VideoDocOp =
  | { readonly op: 'addTrack'; readonly track: VideoTrack; readonly beforeTrackId?: string }
  | { readonly op: 'removeTrack'; readonly trackId: string }
  | { readonly op: 'updateTrack'; readonly trackId: string; readonly patch: Partial<Omit<VideoTrack, 'id' | 'items'>> }
  | { readonly op: 'addItem'; readonly trackId: string; readonly item: VideoItem; readonly beforeItemId?: string }
  | { readonly op: 'removeItem'; readonly itemId: string }
  | { readonly op: 'updateItem'; readonly itemId: string; readonly patch: Partial<Omit<VideoItem, 'id'>> }
  | { readonly op: 'moveItem'; readonly itemId: string; readonly toTrackId: string; readonly beforeItemId?: string }
  | { readonly op: 'setAsset'; readonly asset: VideoAsset }
  | { readonly op: 'removeAsset'; readonly assetId: string }
  /** `style: null` 이면 스타일을 걷는다(JSON 은 undefined 를 보낼 수 없다). */
  | { readonly op: 'setDoc'; readonly patch: Partial<Pick<VideoDoc, 'title' | 'size' | 'fps' | 'seed'>> & { readonly style?: DocStyle | null } }
  // §5.13 (V) 37-4 — 장면 층.
  | { readonly op: 'addChapter'; readonly chapter: VideoChapter; readonly beforeChapterId?: string }
  | { readonly op: 'updateChapter'; readonly chapterId: string; readonly patch: Partial<Omit<VideoChapter, 'id'>> }
  | { readonly op: 'removeChapter'; readonly chapterId: string }
  | { readonly op: 'moveChapter'; readonly chapterId: string; readonly beforeChapterId?: string }
  | { readonly op: 'setChapters'; readonly chapters: readonly VideoChapter[] };

/** 패치 요청. `baseVersion` 이 현재 문서 버전과 다르면 서버가 409 로 거절한다. */
export interface VideoDocPatch {
  readonly baseVersion: number;
  readonly ops: readonly VideoDocOp[];
}

/** 패치 결과. 실패해도 예외를 던지지 않고 이유를 돌려준다. */
export type VideoDocPatchResult =
  | { readonly ok: true; readonly doc: VideoDoc; readonly applied: number }
  | { readonly ok: false; readonly reason: 'version-conflict'; readonly currentVersion: number }
  | { readonly ok: false; readonly reason: 'invalid-op'; readonly opIndex: number; readonly message: string };

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
 */
export type VideoItemKind = 'scene' | 'footage' | 'image' | 'audio' | 'caption' | 'shape' | 'text';

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
  | { readonly start: string; readonly offset?: number };

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

/** 소재 한 건. 실측값(길이·크기)은 파일을 실제로 읽은 뒤에만 채워진다. */
export interface VideoAsset {
  readonly id: string;
  readonly kind: 'audio' | 'video' | 'image' | 'font';
  readonly source: VideoAssetSource;
  /** 초. 오디오·영상만 의미가 있으며, 이 값이 있어야 `duration:'auto'` 를 풀 수 있다. */
  readonly duration?: number;
  readonly width?: number;
  readonly height?: number;
  /** 파일 내용 해시. 소재가 바뀌면 그 아이템의 렌더 캐시만 무효가 된다. */
  readonly contentHash?: string;
}

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

/** 이펙트 한 건. 종류별 파라미터는 `params` 에 담는다. */
export interface VideoEffect {
  readonly id: string;
  readonly kind: string;
  readonly params?: Readonly<Record<string, unknown>>;
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
  readonly effects?: readonly VideoEffect[];
  /** `caption` 전용. */
  readonly cues?: readonly CaptionCue[];
  /** 소재 안에서 잘라 쓸 시작 지점(초). 소재 자체를 건드리지 않는 비파괴 트림. */
  readonly trimStart?: number;
  /** 꺼 두면 렌더에서 빠지되 문서에는 남는다. 지우지 않고 끄는 길을 항상 둔다. */
  readonly enabled?: boolean;
  readonly label?: string;
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
  | 'empty-caption';

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

/** 해소된 타임라인. 렌더러는 이것만 보고 그린다. */
export interface ResolvedTimeline {
  readonly items: readonly ResolvedItem[];
  /** 문서 전체 길이(초) = 모든 아이템 `end` 의 최댓값. */
  readonly duration: number;
  readonly diagnostics: readonly ResolveDiagnostic[];
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
  | { readonly op: 'setDoc'; readonly patch: Partial<Pick<VideoDoc, 'title' | 'size' | 'fps' | 'seed'>> };

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

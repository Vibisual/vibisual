/**
 * §5.5 #17-38 인식 엔진을 부르는 자리 한 곳.
 * `SpeechRecognition` 은 TS `lib.dom` 에 없어(`webkitSpeechRecognition` 은 앞으로도 안 들어온다) 쓰는 모양만 좁게 적어 그 타입으로만 다닌다
 * (컴포넌트마다 `any` 면 오타가 런타임까지 간다 — `utils/platform.ts` 의 `userAgentData` 와 같은 규율). 다른 인식기를 붙여도 고칠 곳은 여기 하나다.
 * ⚠ 생성자가 있다고 되는 것이 아니다 — Chromium 이 인식 서비스에 닿을 때만 동작한다. 그래서 여기서는 **있다/없다만** 답하고 실제 가부는
 * `start()` 뒤의 실패 코드(`mapVoiceError`)가 화면에 말한다(생성자만 보고 "지원함"이라 쓰면 켜도 조용히 아무 일도 없다).
 */

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

/** 우리가 실제로 쓰는 것만. 명세의 나머지(문법 목록·서비스 URI)는 쓰지 않으므로 적지 않는다. */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onspeechend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechWindow {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

function speechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** 이 환경에 인식 엔진이 **있는가**(된다는 뜻은 아니다 — 위 주석 참조). */
export function speechRecognitionSupported(): boolean {
  return speechCtor() !== null;
}

/** 인식기 한 대. 없으면 `null` — 부르는 쪽이 `unsupported` 로 화면에 알린다. */
export function createSpeechRecognition(): SpeechRecognitionLike | null {
  const Ctor = speechCtor();
  if (Ctor === null) return null;
  try {
    return new Ctor();
  } catch {
    // 생성자가 있는데 만들지 못하는 판(권한 정책 등)도 "없음"과 같이 다룬다.
    return null;
  }
}

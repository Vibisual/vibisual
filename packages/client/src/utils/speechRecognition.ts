/**
 * speechRecognition.ts — **§5.5 #17-38 인식 엔진을 부르는 자리 한 곳.**
 *
 * 왜 따로 두는가:
 *
 * 1. **타입이 없다.** `SpeechRecognition` 은 TS `lib.dom` 에 없고(`webkitSpeechRecognition` 은
 *    앞으로도 안 들어온다), 그렇다고 컴포넌트마다 `any` 를 뿌리면 오타가 런타임까지 간다.
 *    쓰는 모양만 좁게 적어 두고 그 타입으로만 다닌다(`utils/platform.ts` 의 `userAgentData`
 *    선례와 같은 규율).
 * 2. **엔진이 하나가 아닐 수 있다.** 지금은 브라우저 내장 하나지만, 이 자리를 한 곳으로 모아
 *    두면 나중에 다른 인식기를 붙일 때 고칠 곳이 여기 하나다.
 *
 * ⚠ **`webkitSpeechRecognition` 이 있다고 되는 것은 아니다.** 이 API 는 Chromium 이 인식
 *    서비스에 닿을 수 있을 때만 실제로 동작한다 — 생성자만 보고 "지원함"이라고 화면에 쓰면,
 *    켰다가 조용히 아무 일도 안 일어나는 상태가 된다. 그래서 이 모듈은 **있다/없다만** 답하고,
 *    실제 가부는 `start()` 뒤에 오는 실패 코드(`mapVoiceError`)가 화면에 말하게 한다.
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

/**
 * voiceInput.ts — **§5.5 #17-38 음성 받아쓰기의 판정 한 곳.**
 *
 * 마이크를 열고 소리를 글자로 바꾸는 일은 브라우저(Chromium)가 한다. 이 파일이 맡는 것은
 * 그 결과를 **어디에 어떻게 꽂을 것인가** 하나다 — 단축키를 뜻으로 바꾸고, 인식된 토막을
 * 입력창의 커서 자리에 끼워 넣고, 엔진이 돌려준 실패 코드를 사람에게 보여 줄 이름으로
 * 접는다. DOM·React·오디오 API 를 모르는 순수 함수라 **실기(mac·리눅스) 없이도 세 OS 의
 * 조합을 단위 테스트로 전부 확인**할 수 있다([docs/rules/multiplatform.md] "플랫폼 분기는
 * 인자로 받는다" — 우리에게는 이것이 규칙을 지켰는지 확인하는 유일한 방법이다).
 *
 * 왜 shared 인가: 판정이 컴포넌트 안에 있으면 그 화면을 띄우지 않고는 확인할 수 없고,
 * 나중에 입력창이 한 곳 더 생기면(지휘통제실·모바일) 규칙이 두 벌로 갈린다.
 */

/** 화면·동작이 함께 보는 값들. 매직넘버를 컴포넌트에 흩지 않는다(§3.3). */
export const VOICE_INPUT = {
  /**
   * 받아쓰기 켜기/끄기 단축키. 라벨은 `shortcutLabel(VOICE_INPUT.SHORTCUT)` 가 그린다 —
   * mac 에서는 `⇧⌘M` 이 되고, 번역문에 `Ctrl+` 를 박지 않는다(멀티플랫폼 규칙 5).
   */
  SHORTCUT: 'Ctrl+Shift+M',
  /** 오버레이 파형의 막대 개수 = 최근 레벨을 몇 칸까지 기억하는가. */
  BAR_COUNT: 32,
  /** 레벨을 다시 재는 주기(ms). 24fps 언저리 — 눈에는 이어져 보이고 CPU 는 거의 쓰지 않는다. */
  LEVEL_INTERVAL_MS: 42,
  /** `AnalyserNode.fftSize` — 파형이 아니라 세기만 쓰므로 작게 잡는다. */
  FFT_SIZE: 512,
  /** 소리가 없어도 막대가 완전히 사라지지 않게 하는 하한(0~1). 꺼진 것처럼 보이지 않게. */
  BAR_MIN: 0.12,
  /** RMS 를 막대 높이로 펼 때 곱하는 값 — 말소리(RMS 0.02~0.2)가 0.2~1 로 오게. */
  LEVEL_GAIN: 6,
  /**
   * 한 번 켜면 최대 이만큼만 듣는다(ms). 사용자가 끄는 것을 잊고 자리를 떠도 마이크가
   * 영원히 열려 있지 않게 하는 안전판이다 — 켜 둔 채로 두면 배터리·개인정보 양쪽이 샌다.
   */
  MAX_SESSION_MS: 5 * 60_000,
  /** 인식된 최종 토막을 화면에 잠깐 남겨 두는 시간(ms) — 무엇이 들어갔는지 눈으로 확인되게. */
  COMMIT_FLASH_MS: 900,
} as const;

/** 지금 받아쓰기가 어느 상태인가. */
export type VoiceInputStatus =
  /** 꺼져 있음(기본). */
  | 'idle'
  /** 마이크 권한·장치를 여는 중 — 아직 듣지는 않는다. */
  | 'starting'
  /** 듣는 중. */
  | 'listening'
  /** 실패해서 멎음. 사유는 `VoiceInputErrorCode`. */
  | 'error';

/**
 * 엔진이 돌려준 실패를 **사람에게 보여 줄 이름**으로 접은 것.
 *
 * 원문(`SpeechRecognitionErrorEvent.error`)을 그대로 화면에 쓰지 않는다 — 브라우저마다
 * 문자열이 갈리고, 12개 로케일에 번역할 키를 그 문자열 수만큼 만들 수는 없다.
 */
export type VoiceInputErrorCode =
  /** 이 환경에 음성 인식 자체가 없다. */
  | 'unsupported'
  /** 마이크 사용이 거부됐다(브라우저 권한 또는 OS 개인정보 설정). */
  | 'permission'
  /** 마이크를 못 찾았거나 열지 못했다. */
  | 'device'
  /** 인식 서비스에 닿지 못했다. */
  | 'network'
  /** 이 언어를 인식기가 모른다. */
  | 'language'
  /** 아무 말도 못 들었다(치명 ❌ — 계속 듣는다). */
  | 'no-speech'
  /** 우리가 껐거나 다른 곳이 마이크를 가져갔다(치명 ❌). */
  | 'aborted'
  /** 그 외. */
  | 'unknown';

/** 이 실패로 **받아쓰기를 멈춰야 하는가**. 아니라면 화면은 그대로 두고 계속 듣는다. */
export function isFatalVoiceError(code: VoiceInputErrorCode): boolean {
  return code !== 'no-speech' && code !== 'aborted';
}

/**
 * 엔진 실패 문자열 → 우리 코드.
 *
 * 값은 Web Speech 명세의 `SpeechRecognitionErrorCode` 를 따른다. 모르는 값은 지어내지 않고
 * `unknown` 으로 떨어뜨린다 — 넘겨짚은 안내문이 진짜 원인을 가리는 쪽이 더 나쁘다.
 */
export function mapVoiceError(raw: string | undefined | null): VoiceInputErrorCode {
  switch ((raw ?? '').trim()) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission';
    case 'audio-capture':
      return 'device';
    case 'network':
      return 'network';
    case 'language-not-supported':
      return 'language';
    case 'no-speech':
      return 'no-speech';
    case 'aborted':
      return 'aborted';
    default:
      return 'unknown';
  }
}

/**
 * `getUserMedia` 가 던진 `DOMException` → 우리 코드.
 *
 * 마이크를 여는 단계와 인식하는 단계는 실패 모양이 다르다(`NotAllowedError` vs
 * `not-allowed`). 두 표를 하나로 합치면 어느 쪽이 막혔는지 화면이 말할 수 없게 된다.
 */
export function mapMediaError(name: string | undefined | null): VoiceInputErrorCode {
  switch ((name ?? '').trim()) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission';
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'NotReadableError':
      return 'device';
    case 'AbortError':
      return 'aborted';
    default:
      return 'unknown';
  }
}

/** 단축키 판정에 쓰는 것만. 테스트가 진짜 `KeyboardEvent` 를 만들지 않아도 되게 좁게 받는다. */
export interface VoiceKeyLike {
  /** 자판 배열과 무관한 물리 키. `key` 가 아니라 이것을 보는 이유는 아래 주석 참조. */
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * 이 키가 "받아쓰기 켜기/끄기"인가 — `Ctrl+Shift+M`(mac `⇧⌘M`).
 *
 * ⚠ **`e.key` 가 아니라 `e.code`** 를 본다. `Shift` 가 눌린 상태의 `key` 는 자판 배열에 따라
 * `'M'`·`'m'`·다른 글자까지 되고, macOS 는 `⌥`/`⌘` 조합에서 `key` 가 통째로 달라지는 자리가
 * 있다. 물리 키로 보면 세 OS·모든 자판에서 같은 손짓이 같은 뜻이 된다(#17-37 과 같은 규율).
 *
 * ⚠ **`Alt` 가 낀 조합은 통째로 비켜선다** — 일부 유럽 자판에서 `Ctrl+Alt` 는 AltGr 이라
 * 글자 입력을 가로채게 된다.
 *
 * mac 예외(`Cmd` 대신 진짜 `Control`)를 두지 않는 이유: `⇧⌘M` 은 macOS 가 선점한 조합이
 * 아니라 우리에게 그대로 도달한다(선점된 `⌘Tab` 때문에 예외를 둔 #17-37 과 다르다).
 */
export function isVoiceToggleKey(e: VoiceKeyLike): boolean {
  if (e.altKey) return false;
  if (!e.shiftKey) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  return e.code === 'KeyM';
}

/**
 * UI 로케일 → 인식기에 넘길 BCP-47 언어.
 *
 * 인식기는 "무슨 말이 들어올지"를 미리 알아야 정확도가 산다 — 한국어를 `en-US` 로 들으면
 * 결과가 통째로 무의미해진다. 그래서 **앱의 화면 언어를 그대로 따라간다**(사용자가 이미
 * 고른 값이라 따로 물을 것이 없다).
 *
 * 표에 없는 로케일은 지역 없는 코드를 그대로 넘긴다 — 인식기가 알면 쓰고, 모르면
 * `language-not-supported` 로 돌려주므로 화면이 사유를 말할 수 있다.
 */
const VOICE_LANG: Record<string, string> = {
  ko: 'ko-KR',
  en: 'en-US',
  ja: 'ja-JP',
  'zh-CN': 'zh-CN',
  de: 'de-DE',
  es: 'es-ES',
  'es-419': 'es-MX',
  fr: 'fr-FR',
  hi: 'hi-IN',
  id: 'id-ID',
  it: 'it-IT',
  'pt-BR': 'pt-BR',
};

export function voiceRecognitionLang(uiLocale: string | undefined | null): string {
  const raw = (uiLocale ?? '').trim();
  if (raw.length === 0) return VOICE_LANG.en as string;
  const exact = VOICE_LANG[raw];
  if (exact !== undefined) return exact;
  // `ko-KR` 처럼 지역이 붙어 들어오면 앞 조각으로 한 번 더 찾아본다.
  const base = raw.split('-')[0] ?? '';
  return VOICE_LANG[base] ?? raw;
}

/**
 * 파형 막대 = **최근에 실제로 잰 소리 세기의 기록**.
 *
 * 무작위로 흔드는 가짜 파형을 쓰지 않는다 — 마이크가 죽어 있어도 춤을 추면 사용자는
 * 되고 있다고 믿고 계속 말하게 된다. 새 값은 오른쪽으로 들어가고 가장 오래된 것이 밀려난다.
 */
export function pushVoiceLevel(prev: readonly number[], level: number): number[] {
  const clamped = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const next = prev.length >= VOICE_INPUT.BAR_COUNT
    ? prev.slice(prev.length - VOICE_INPUT.BAR_COUNT + 1)
    : [...prev];
  next.push(clamped);
  while (next.length < VOICE_INPUT.BAR_COUNT) next.unshift(0);
  return next;
}

/** 처음 상태의 막대(전부 조용함). */
export function emptyVoiceLevels(): number[] {
  return new Array<number>(VOICE_INPUT.BAR_COUNT).fill(0);
}

/**
 * 시간 영역 표본(`getByteTimeDomainData`) → 0~1 세기.
 *
 * RMS 를 쓴다(최댓값 ❌) — 최댓값은 클릭 잡음 하나에 막대가 천장을 치고, 말이 멎어도
 * 한동안 안 내려온다. `LEVEL_GAIN` 으로 말소리 대역을 화면 높이에 맞춰 편다.
 */
export function levelFromTimeDomain(samples: Uint8Array | readonly number[]): number {
  const len = samples.length;
  if (len === 0) return 0;
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    // 128 이 무음 기준선(0 이 아니다 — 부호 없는 8비트라 가운데가 128).
    const v = ((samples[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / len);
  return Math.min(1, rms * VOICE_INPUT.LEVEL_GAIN);
}

/** 커서 자리에 글을 끼워 넣은 결과. */
export interface VoiceTextMerge {
  text: string;
  /** 끼워 넣은 뒤 커서가 서야 할 자리(끼운 글의 끝). */
  caret: number;
}

/** 붙여 쓰면 안 되는 자리인가 — 여는 괄호·따옴표 뒤에는 공백을 넣지 않는다. */
function opensPhrase(ch: string): boolean {
  return ch === '(' || ch === '[' || ch === '{' || ch === '"' || ch === "'" || ch === '`';
}

/** 앞에 공백을 두면 어색한 글자인가 — 문장부호는 앞말에 붙는다. */
function attachesToPrev(ch: string): boolean {
  return '.,!?;:)]}%'.includes(ch);
}

/**
 * 인식된 토막을 입력창에 끼워 넣는다 — **커서 자리에**, 선택 범위가 있으면 그것을 갈아 끼운다.
 *
 * 항상 뒤에 이어 붙이지 않는 이유: 사용자가 문장 가운데를 고치다가 마이크를 켜는 일이 실제로
 * 있고, 그때 말한 것이 엉뚱하게 맨 끝에 붙으면 그 문장을 다시 손봐야 한다.
 *
 * 띄어쓰기는 **필요할 때만** 넣는다 — 앞 글자가 공백·줄바꿈·여는 괄호면 넣지 않고, 끼우는
 * 말이 문장부호로 시작하면 앞말에 붙인다. 한국어·영어 모두 같은 규칙으로 읽힌다.
 */
export function mergeVoiceText(
  prev: string,
  selStart: number,
  selEnd: number,
  chunk: string,
): VoiceTextMerge {
  const piece = chunk.trim();
  const start = Math.max(0, Math.min(prev.length, Math.min(selStart, selEnd)));
  const end = Math.max(0, Math.min(prev.length, Math.max(selStart, selEnd)));
  if (piece.length === 0) return { text: prev, caret: end };

  const before = prev.slice(0, start);
  const after = prev.slice(end);
  const prevCh = before.slice(-1);
  const nextCh = after.slice(0, 1);

  const needsLead =
    before.length > 0
    && !/\s/.test(prevCh)
    && !opensPhrase(prevCh)
    && !attachesToPrev(piece.charAt(0));
  const needsTrail = after.length > 0 && !/\s/.test(nextCh) && !attachesToPrev(nextCh);

  const inserted = `${needsLead ? ' ' : ''}${piece}${needsTrail ? ' ' : ''}`;
  return {
    text: `${before}${inserted}${after}`,
    // 뒤 공백까지 지나서 서면 다음 말이 두 칸 띄어 들어간다 — 끼운 말의 끝에 세운다.
    caret: start + inserted.length - (needsTrail ? 1 : 0),
  };
}

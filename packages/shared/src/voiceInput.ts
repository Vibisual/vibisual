/**
 * §5.5 #17-38 음성 받아쓰기 판정 한 곳 — 인식은 브라우저가, 이 파일은 단축키 해석·커서 자리 끼우기·실패 코드 이름 접기를 맡는다.
 * DOM·React·오디오 API 를 모르는 순수 함수라 세 OS 조합을 단위 테스트로 확인하고, 입력창이 늘어도(모바일 등) 규칙이 한 벌로 남는다.
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

/** 엔진 실패를 보여 줄 이름으로 접은 것 — 원문 문자열은 브라우저마다 갈려 12개 로케일 키를 그 수만큼 만들 수 없다. */
export type VoiceInputErrorCode =
  /** 이 환경에 음성 인식 자체가 없다. */
  | 'unsupported'
  /** 마이크 사용이 거부됐다(브라우저 권한 또는 OS 개인정보 설정). */
  | 'permission'
  /** 마이크를 못 찾았거나 못 열었는데 원인을 더 좁히지 못했다(`no-device`·`device-busy` 를 뺀 나머지) — 화면은 권한·연결 둘 다 말한다. */
  | 'device'
  /** 입력 장치가 0개다 — 할 일이 권한(설정)이 아니라 꽂는 것이라 `permission` 과 가른다. Windows 는 끊긴 장치도 목록에 회색으로 남겨 화면이 "없다"고 분명히 말해야 한다. */
  | 'no-device'
  /** 다른 앱이 마이크를 쥐고 있다(`NotReadableError`). `device` 로 접으면 마이크를 다시 꽂아 본다 — 할 일은 그 앱을 끄는 것이다. */
  | 'device-busy'
  /** 인식 서비스에 닿지 못했다. */
  | 'network'
  /** 받아 둔 인식기가 이 PC 에서 뜨지 않았다(⑫). `network` 와 가른다 — 할 일이 회선 확인이 아니라 다시 받기다(⑬). */
  | 'engine'
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

/** 엔진 실패 문자열(Web Speech `SpeechRecognitionErrorCode`) → 우리 코드. 모르는 값은 지어내지 않고 `unknown`. */
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

/** `getUserMedia` 의 `DOMException` → 우리 코드. 인식 단계(`not-allowed`)와 모양이 달라 표를 따로 둔다 — 합치면 어느 단계가 막혔는지 모른다. */
export function mapMediaError(name: string | undefined | null): VoiceInputErrorCode {
  switch ((name ?? '').trim()) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission';
    case 'NotFoundError':
    case 'OverconstrainedError':
      // 여기서는 아직 "없다"고 단정하지 않는다 — win 에서 "데스크톱 앱 허용" 이 꺼져도
      //   같은 `NotFoundError` 가 오기 때문이다(권한인데 장치 없음으로 읽히는 자리).
      //   장치 목록을 물어본 뒤 `refineDeviceError` 가 `no-device` 로 좁힌다.
      return 'device';
    case 'NotReadableError':
      // 목록에는 있는데 OS 가 못 넘겨준다 = 다른 앱이 쥐고 있다. 꽂으라고 하면 안 되는 자리다.
      return 'device-busy';
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
 * 받아쓰기 토글 키인가 — `Ctrl+Shift+M`(mac `⇧⌘M`). ⚠ `e.key` 가 아니라 `e.code`(물리 키) — `key` 는 자판 배열·mac 조합키마다 달라진다(#17-37).
 * ⚠ `Alt` 가 낀 조합은 비켜선다(일부 유럽 자판의 `Ctrl+Alt` = AltGr). mac 예외는 없다 — `⇧⌘M` 은 macOS 가 선점하지 않는다.
 */
export function isVoiceToggleKey(e: VoiceKeyLike): boolean {
  if (e.altKey) return false;
  if (!e.shiftKey) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  return e.code === 'KeyM';
}

/** UI 로케일 → 인식기 BCP-47 언어(앱 화면 언어를 따른다 — 들어올 말을 알아야 정확하다). 표에 없으면 지역 없는 코드를 넘기고, 모르면 인식기가 `language-not-supported` 를 준다. */
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

/** 파형 막대 = 최근에 실제로 잰 세기(새 값이 오른쪽). 가짜 파형 ❌ — 마이크가 죽어도 춤을 추면 되는 줄 알고 계속 말한다. */
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

/** 시간 영역 표본 → 0~1 세기. RMS 를 쓴다(최댓값은 클릭 하나에 천장을 치고 한동안 안 내려온다). `LEVEL_GAIN` 으로 말소리 대역을 편다. */
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
 * 토막을 커서 자리에 끼운다(선택 범위는 갈아 끼운다 — 맨 끝에 붙이면 문장 가운데를 고치던 사람이 다시 손본다).
 * 띄어쓰기는 필요할 때만 — 앞이 공백·줄바꿈·여는 괄호면 안 넣고, 문장부호로 시작하면 앞말에 붙인다.
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

// ─────────────────────────────────────────────────────────────────────────────
// §5.5 #17-38 ⑮ — 막힌 곳이 OS 마다 다르다: 사유를 말하는 것에서 **데려다 주는 것**으로
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 마이크가 안 열릴 때 가야 할 OS 설정 창 — 안내문만으로는 못 찾는다(win 은 스위치가 둘이고, unpackaged 앱이라 앱별 목록에 우리 이름이 없다).
 * 여는 주소가 OS 마다 달라 `platform` 을 인자로 받는다(세 OS 단위 테스트).
 */
export interface VoiceMicSettingsTarget {
  /**
   * OS 설정을 여는 주소. win 은 `ms-settings:` URI, mac 은 `x-apple.systempreferences:`
   * 앵커, linux 는 데스크톱 환경마다 갈려 **주소가 없다**(`null`) — 없는 것을 지어내면
   * 눌러도 아무 일이 없는 버튼이 된다.
   */
  url: string | null;
  /**
   * 그 창에서 **무엇을 만져야 하는지** 가리키는 번역 키. 창만 띄우고 끝내면 사용자는 열린
   * 설정 화면에서 다시 길을 잃는다 — 특히 win 의 두 번째 스위치는 목록 위쪽에 접혀 있다.
   */
  hintKey: string;
}

/**
 * `platform` → 마이크 설정 창. win: `ms-settings:privacy-microphone` 의 "데스크톱 앱이 마이크에 액세스하도록 허용"(목록 맨 아래)이 판가름이라 힌트를 반드시 함께 준다.
 * mac: `Privacy_Microphone` 앵커까지(없으면 개인정보 보호 첫 장만 열린다, macOS 13+ 도 유효).
 * linux: `null` — 설정 앱이 데스크톱 환경마다 다르고 차단은 PulseAudio/PipeWire 기본 입력 장치 문제라 여는 척 대신 확인할 것을 글로 말한다.
 */
export function micSettingsTarget(platform: string): VoiceMicSettingsTarget {
  switch (platform) {
    case 'win32':
      return {
        url: 'ms-settings:privacy-microphone',
        hintKey: 'ide.mainArea.voiceMicSettingsHintWin',
      };
    case 'darwin':
      return {
        url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
        hintKey: 'ide.mainArea.voiceMicSettingsHintMac',
      };
    default:
      return { url: null, hintKey: 'ide.mainArea.voiceMicSettingsHintLinux' };
  }
}

/**
 * OS 설정으로 풀 수 있는 실패인가. `device`·`no-device` 도 태운다 — win 의 "데스크톱 앱 허용"이 꺼지면 `NotFoundError`·장치 0개로 보인다(OS 가 목록을 감춘다).
 * `no-device` 화면의 주된 안내는 "꽂으세요"다(⑯). `device-busy` 는 안 태운다 — 할 일이 다른 앱 끄기라 설정 창은 원인을 가린다.
 */
export function isMicAccessFixable(code: VoiceInputErrorCode): boolean {
  return code === 'permission' || code === 'device' || code === 'no-device';
}

/**
 * `device` 를 장치 수로 한 번 더 좁힌다 — win 은 "데스크톱 앱 허용"이 꺼지면 꽂혀 있어도 `NotFoundError` 라 실패만으로는 "없다"와 "막혔다"를 못 가른다.
 * `enumerateDevices()` 는 권한 없이도 개수는 준다. 0개 → 꽂으라고(설정 열기도 함께), 1개 이상 → 권한 쪽(다시 꽂게 하지 않는다).
 * @param count 입력 장치 수. 못 물었으면 `null` — 좁히지 않는다.
 */
export function refineDeviceError(
  code: VoiceInputErrorCode,
  count: number | null,
): VoiceInputErrorCode {
  // 좁히는 대상은 `device` 하나뿐이다. `permission` 은 이미 원인이 분명하고,
  //   `device-busy` 는 목록에 있다는 것이 전제라 여기서 뒤집으면 안 된다.
  if (code !== 'device') return code;
  if (count === null) return code;
  return count === 0 ? 'no-device' : code;
}

/** 이 실패가 **마이크를 꽂으라고 말해야 하는** 경우인가(설정을 켜라가 아니라). */
export function isNoDeviceError(code: VoiceInputErrorCode): boolean {
  return code === 'no-device';
}

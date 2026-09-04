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
  /**
   * 마이크를 못 찾았거나 열지 못했다 — **원인을 더 좁히지 못한 경우.**
   *
   * `no-device`·`device-busy` 가 갈라 나간 뒤 남는 자리다(장치 목록을 못 물어봤거나,
   * 목록엔 있는데 왜 안 열리는지 모를 때). 여기 남으면 화면은 두 가능성(권한·연결)을
   * 모두 말한다 — 좁히지 못했으면 좁혀서 말하지 않는 것이 맞다.
   */
  | 'device'
  /**
   * **이 PC 에 마이크가 아예 없다**(연결된 입력 장치 0개).
   *
   * `permission` 과 갈라 두는 이유는 `engine`/`network` 를 가른 것과 같다 — 사용자가 할 일이
   * 다르다. 권한은 설정을 켜는 일이고 이쪽은 **물건을 꽂는 일**이다. 뭉뚱그리면 마이크가 없는
   * 사람이 설정만 뒤지고(그 설정은 이미 켜져 있다), 반대로 권한이 막힌 사람이 멀쩡한 마이크를
   * 다시 꽂아 본다. 특히 Windows 는 연결되지 않은 장치도 소리 설정 목록에 회색으로 남겨 두어
   * 사용자에게는 "있음"으로 읽히므로, 화면이 **없다고 분명히 말해 주어야** 한다.
   */
  | 'no-device'
  /**
   * 마이크는 **있는데 다른 앱이 쥐고 있다**(`NotReadableError` — OS 가 장치를 못 넘겨준다).
   *
   * 종전에는 이것도 `device` 로 접혀 "마이크를 찾지 못했습니다"가 떴는데, 그 문장을 읽은
   * 사용자는 **연결된 마이크를 다시 꽂아 본다** — 실제로 할 일은 화상회의·녹음 앱을 끄는 것이다.
   */
  | 'device-busy'
  /** 인식 서비스에 닿지 못했다. */
  | 'network'
  /**
   * 받아 둔 인식기가 **이 PC 에서 뜨지 않았다**(⑫ — 엔진은 우리 것이고 밖에 있지 않다).
   *
   * `network` 와 갈라 두는 이유: 인식기가 내 PC 에서 도는 이상 "서비스에 닿지 못했다"는
   * 사실이 아니고, 사용자가 할 일도 다르다(회선을 보는 것이 아니라 다시 받는 것이다).
   * 뭉뚱그리면 화면이 원인을 가린다 — ⑬ "실패는 사유까지 말한다".
   */
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

// ─────────────────────────────────────────────────────────────────────────────
// §5.5 #17-38 ⑮ — 막힌 곳이 OS 마다 다르다: 사유를 말하는 것에서 **데려다 주는 것**으로
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 마이크가 안 열릴 때 **사용자가 실제로 가야 할 곳**.
 *
 * ⑥ 은 실패의 사유를 갈라 화면이 "할 수 있는 일"을 말하게 했지만, 거기서 멈췄다 — 문장은
 * 정확한데(“시스템 개인 정보 설정에서 허용해 주세요”) 그 설정이 **어디 있는지는 OS 마다
 * 다르고**, 특히 Windows 는 스위치가 둘이라(앱별 목록 + 그 위의 "데스크톱 앱 허용") 안내문만
 * 읽고 찾아가는 사람은 대개 앱별 목록에서 우리 이름을 못 찾고 되돌아온다(우리는 unpackaged 앱이라
 * 그 목록에 이름이 없다 — ⑫ 의 MSIX identity 부재와 같은 뿌리).
 *
 * 그래서 사유를 말하는 데서 한 걸음 더 간다: **그 설정 창을 우리가 연다.** 여는 주소는 세 OS 가
 * 전부 다르므로 판정을 여기 한 곳에 두고 `platform` 을 **인자로 받는다** — 실기(mac·linux) 없이
 * 세 OS 를 단위 테스트로 확인할 수 있는 유일한 방법이다([multiplatform.md] "플랫폼 분기는 인자로").
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
 * `platform` → 마이크 설정 창.
 *
 * **win 이 두 갈래인 이유**: `ms-settings:privacy-microphone` 한 장에 스위치가 둘 있다 —
 * ⓐ "마이크 액세스"(기기 전체) ⓑ "데스크톱 앱이 마이크에 액세스하도록 허용"(목록 맨 아래).
 * 우리처럼 nsis 로 깔린 앱은 ⓑ 하나로 판가름 나는데, 그 스위치는 앱 목록을 한참 내려야 나와
 * 안내 없이는 못 찾는다. 그래서 주소는 하나여도 **힌트를 반드시 함께 준다.**
 *
 * **mac 은 앵커까지 준다** — `Privacy_Microphone` 앵커가 없으면 개인정보 보호 첫 장만 열리고
 * 마이크 항목은 목록에서 다시 찾아야 한다. macOS 13+ 의 시스템 설정에서도 이 앵커는 유효하다.
 *
 * **linux 는 `null` 이 정답이다** — GNOME 은 `gnome-control-center`, KDE 는 `systemsettings`,
 * 그마저 배포판이 안 깔았을 수 있고 애초에 리눅스의 마이크 차단은 권한 UI 가 아니라
 * PulseAudio/PipeWire 의 기본 입력 장치 문제다(정본 표의 linux 칸과 같은 판정). 열 수 없는
 * 창을 여는 척하는 대신 **무엇을 확인해야 하는지**를 글로 말한다.
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
 * 이 실패가 **OS 설정으로 가서 풀 수 있는 것**인가.
 *
 * `permission` 은 당연하고, **`device` 도 포함한다** — Windows 에서 "데스크톱 앱 허용"이 꺼져
 * 있으면 `getUserMedia` 가 `NotAllowedError` 가 아니라 **`NotFoundError`** 로 온다(장치가 있는데
 * 목록 자체를 안 보여 준다 — 정본 표 win 칸에 적힌 그 자리다). 즉 화면에는 "마이크를 찾지
 * 못했습니다"가 뜨지만 실제 원인이 권한인 경우가 있고, 그 사람에게 설정 문을 안 열어 주면
 * 영영 장치만 다시 꽂아 보게 된다. 둘을 함께 태우는 것이 **사용자가 덜 헤매는 쪽**이다.
 *
 * **`no-device` 도 태운다 — 다만 그 화면의 주된 안내는 "꽂으세요"다.** 장치가 0개인 것이
 * 확인됐어도 win 에서는 그 0 이 **OS 가 감춘 결과**일 수 있어(같은 "데스크톱 앱 허용"), 설정
 * 문을 아예 닫아 두면 그 사람에게는 막다른 길이 된다. 그래서 문은 열어 두되 **문구의 무게를
 * 바꾼다**(⑯) — 오류 줄과 팝업 본문은 연결을 먼저 말하고, 설정은 곁들이는 선택지로 남긴다.
 *
 * **`device-busy` 는 태우지 않는다** — 그 사람이 할 일은 설정이 아니라 **다른 앱을 끄는 것**이다.
 * 설정 창을 열어 주면 이미 켜져 있는 스위치를 보게 되어 안내가 오히려 원인을 가린다.
 */
export function isMicAccessFixable(code: VoiceInputErrorCode): boolean {
  return code === 'permission' || code === 'device' || code === 'no-device';
}

/**
 * `device` 를 **장치 목록으로 한 번 더 좁힌다** — "없다"와 "막혔다"를 가르는 유일한 길.
 *
 * `getUserMedia` 의 실패만으로는 이 둘을 못 가른다. Windows 에서 "데스크톱 앱이 마이크에
 * 액세스하도록 허용" 이 꺼져 있으면 **장치가 멀쩡히 꽂혀 있어도 `NotFoundError`** 가 오기
 * 때문이다(OS 가 목록 자체를 감춘다 — 거절하지 않는다). 그래서 이름이 같은 실패 하나에
 * 서로 다른 두 원인이 들어온다.
 *
 * 가르는 근거는 `enumerateDevices()` 다. 이 API 는 **권한 없이도 목록의 길이는 알려 준다**
 * (label 만 빈 문자열이 된다 — 지문 채취를 막으려는 명세의 의도). 따라서:
 *
 * - 입력 장치가 **0개** → 물건이 없거나 OS 가 통째로 감췄다. 사용자가 할 일은 **꽂는 것**이고,
 *   설정이 원인이어도 그 화면은 [설정 열기] 를 함께 띄우므로 막다른 길이 되지 않는다.
 * - 입력 장치가 **1개 이상인데 못 열었다** → 물건은 있는데 못 쓴다 = 권한 쪽이 훨씬 유력하다.
 *   여기서 "연결해 주세요"라고 하면 **꽂혀 있는 마이크를 다시 꽂아 보게** 만든다.
 *
 * `count` 를 **인자로 받는다** — 이 판정은 순수 함수라 실기 없이 단위 테스트로 고정된다
 * (`navigator` 를 여기서 만지면 그 분기는 영영 검증되지 않는다 — 멀티플랫폼 규칙과 같은 규율).
 *
 * @param count 입력(오디오) 장치 수. 목록을 **못 물어봤으면 `null`** — 그때는 좁히지 않는다.
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

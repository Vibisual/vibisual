/**
 * platform.ts — **클라이언트 플랫폼 판정 SSOT.**
 *
 * 여태 클라이언트에는 플랫폼 감지가 한 곳도 없었다(`navigator.platform`·`isMac` 검색 0건).
 * 그래서 두 가지가 조용히 틀려 있었다:
 *
 *  ① **단축키 라벨** — 어디서나 `Ctrl+…` 로 굳어 macOS 사용자에게 없는 키를 알려 줬다.
 *     기능 자체는 이미 옳다(등록 15곳 전부 `e.ctrlKey || e.metaKey` 를 함께 본다) — **표시만** 틀렸다.
 *  ② **경로 대소문자** — 경로를 무조건 소문자로 접어 Map 키·비교에 썼다. Windows/macOS 에서는 맞지만
 *     Linux 에서는 `Feature-X` 와 `feature-x` 가 실재하는 서로 다른 폴더라 두 항목이 한 줄로 뭉개졌다.
 *
 * 둘 다 "지금 어느 OS 인가" 하나에 달려 있으므로 판정을 여기 한 곳에 둔다.
 * 실제 접기·비교 규칙은 발명하지 않고 `@vibisual/shared` 의 `pathCase` 헬퍼에 그대로 위임한다.
 */

import { pathKey, samePath, normalizePathShape, type PlatformName } from '@vibisual/shared';

/** 우리가 구분하는 OS. 판정할 수 없으면 `unknown`(= 종전 동작으로 안전하게 물러선다). */
export type ClientOs = 'darwin' | 'win32' | 'linux' | 'unknown';

/** `navigator.userAgentData` 는 아직 TS DOM lib 에 없다 — 우리가 쓰는 모양만 좁게 적는다. */
interface UserAgentDataLike {
  platform?: string;
}

/**
 * 판정에 쓸 원본 문자열.
 * `navigator.userAgentData.platform`('macOS'/'Windows'/'Linux'…)이 있으면 그것을 먼저 쓴다 —
 * `navigator.platform` 은 표준에서 폐기 예정이라 언젠가 고정 문자열로 굳을 수 있다.
 * SSR·단위 테스트처럼 `navigator` 자체가 없는 자리에서도 터지지 않아야 한다.
 */
function rawPlatformString(): string {
  if (typeof navigator === 'undefined') return '';
  const uaData = (navigator as Navigator & { userAgentData?: UserAgentDataLike }).userAgentData;
  const hinted = typeof uaData?.platform === 'string' ? uaData.platform : '';
  if (hinted) return hinted;
  return typeof navigator.platform === 'string' ? navigator.platform : '';
}

/**
 * 플랫폼 문자열 → OS(순수 함수 · 단위 테스트 대상).
 *
 * ⚠ mac 검사가 **반드시 먼저**다: `'Darwin'` 안에 `'win'` 이 들어 있어 순서를 바꾸면 mac 이 Windows 로 잡힌다.
 */
export function detectOs(raw: string): ClientOs {
  const s = raw.trim().toLowerCase();
  if (!s) return 'unknown';
  if (/mac|darwin|iphone|ipad|ipod/.test(s)) return 'darwin';
  if (/win/.test(s)) return 'win32';
  // Android 는 `navigator.platform` 이 'Linux armv8l' 이고 UA-CH 는 'Android' 다 — 둘 다 대소문자를 가린다.
  if (/linux|android|cros|x11|bsd/.test(s)) return 'linux';
  return 'unknown';
}

/** 지금 이 렌더러가 도는 OS. */
export function clientOs(): ClientOs {
  return detectOs(rawPlatformString());
}

/** macOS(및 iPadOS/iOS) 인가 — 단축키 라벨이 이 값으로 갈린다. */
export function isMac(): boolean {
  return clientOs() === 'darwin';
}

/**
 * 경로 키를 접어도 되는가(= 파일시스템이 대소문자를 가리지 않는가).
 *
 * 통합 데스크톱 앱에서는 렌더러와 서버가 **같은 머신**이므로 `navigator` 로 얻은 OS 가 곧 서버 OS 다.
 * ⚠ 한계: 휴대폰 브라우저로 원격 접속하면(§ 모바일 웹) 이 값은 **접속 기기**의 OS 라 서버 OS 와 다를 수
 * 있다. 그 경우 잘못 접거나 안 접을 수 있으므로, 언젠가 서버가 스냅샷에 `platform` 을 실어 보내면
 * 그 값을 우선 쓰도록 이 함수 하나만 바꾸면 된다.
 *
 * 판정 불가(`unknown`)면 **접는다** — 종전 동작이라 회귀가 없고, 안 접어서 "같은 폴더가 둘로 보이는"
 * 오작동보다 낫다.
 */
export function isCaseInsensitiveFsClient(): boolean {
  return clientOs() !== 'linux';
}

/** shared `pathCase` 헬퍼에 넘길 플랫폼 이름. 실제로 갈리는 것은 "접느냐 마느냐" 뿐이다. */
export function clientPathPlatform(): PlatformName {
  return isCaseInsensitiveFsClient() ? 'win32' : 'linux';
}

/** 경로를 비교·Map 키로 쓸 정규 형태로. Linux 에서는 케이스를 **보존**한다. */
export function clientPathKey(p: string): string {
  return pathKey(p, clientPathPlatform());
}

/** 두 경로가 같은 대상을 가리키는가(이 플랫폼 규칙 적용). */
export function sameClientPath(a: string, b: string): boolean {
  return samePath(a, b, clientPathPlatform());
}

/**
 * **길이를 바꾸지 않는** 케이스 접기 — 모양(구분자·중복 슬래시)은 손대지 않는다.
 *
 * `clientPathKey` 는 `//` 를 `/` 로 줄이므로 그 결과의 인덱스로 원문을 `slice` 하면 어긋난다.
 * "루트 길이만큼 잘라 상대 경로를 만든다" 같은 자리에서는 이 함수를 쓴다.
 */
export function foldPathCase(p: string): string {
  return isCaseInsensitiveFsClient() ? p.toLowerCase() : p;
}

/** 경로의 **모양**만 정규화(구분자·끝 슬래시). 케이스는 건드리지 않는다 — 표시·접두 비교용. */
export { normalizePathShape };

// ── 단축키 라벨 ────────────────────────────────────────────────────────────────

/** mac 에서 모디파이어가 서는 순서(Apple HIG: ⌃ ⌥ ⇧ ⌘). 정렬 키로만 쓴다. */
const MAC_MODIFIER_ORDER = ['⌃', '⌥', '⇧', '⌘'] as const;

/**
 * 모디파이어 토큰 → mac 기호.
 *
 * `Ctrl` 이 `⌘` 로 가는 것이 핵심이다 — 이 앱의 단축키는 전부 `ctrlKey || metaKey` 라
 * mac 에서 실제로 눌리는 키가 Command 이기 때문이다(Control 이 아니다).
 */
const MAC_MODIFIER: Record<string, string> = {
  ctrl: '⌘', control: '⌘', cmd: '⌘', command: '⌘', meta: '⌘', mod: '⌘',
  alt: '⌥', option: '⌥', opt: '⌥',
  shift: '⇧',
};

/** 모디파이어가 아닌 키 중 mac 이 기호로 그리는 것. 없으면 원문 그대로 둔다. */
const MAC_KEY: Record<string, string> = {
  enter: '↩', return: '↩',
  backspace: '⌫', delete: '⌦', del: '⌦',
  tab: '⇥', escape: 'Esc', esc: 'Esc',
  up: '↑', down: '↓', left: '←', right: '→',
};

/**
 * `'Ctrl+Shift+Z'` → `['Ctrl','Shift','Z']`.
 * 마지막 `+` 는 **키 자체**일 수 있으므로(`'Ctrl++'` = 확대) 끝에 붙은 것은 쪼개지 않는다.
 */
function splitCombo(combo: string): string[] {
  return combo
    .split(/\+(?!$)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * 단축키 조합을 그 플랫폼의 표기로(순수 함수 · 단위 테스트 대상).
 *
 * - mac: 기호를 이어 붙인다 — `Ctrl+S` → `⌘S`, `Ctrl+Shift+Z` → `⇧⌘Z`, `Ctrl+Enter` → `⌘↩`.
 * - 그 외: 받은 그대로 `+` 로 잇는다 — `Ctrl+S` → `Ctrl+S`.
 */
export function formatShortcut(combo: string, mac: boolean): string {
  const tokens = splitCombo(combo);
  if (tokens.length === 0) return combo;
  if (!mac) return tokens.join('+');

  const mods: string[] = [];
  const keys: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const symbol = MAC_MODIFIER[lower];
    if (symbol !== undefined) {
      // 같은 기호를 두 번 적지 않는다(`Ctrl+Cmd+S` 같은 표기도 `⌘S` 한 번으로).
      if (!mods.includes(symbol)) mods.push(symbol);
      continue;
    }
    keys.push(MAC_KEY[lower] ?? token);
  }
  mods.sort((a, b) => MAC_MODIFIER_ORDER.indexOf(a as typeof MAC_MODIFIER_ORDER[number])
    - MAC_MODIFIER_ORDER.indexOf(b as typeof MAC_MODIFIER_ORDER[number]));
  return [...mods, ...keys].join('');
}

/** 화면에 그릴 단축키 라벨. `formatShortcut` 의 얇은 래퍼(플랫폼만 붙여 준다). */
export function shortcutLabel(combo: string): string {
  return formatShortcut(combo, isMac());
}

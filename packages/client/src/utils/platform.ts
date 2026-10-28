/**
 * 클라이언트 플랫폼 판정 SSOT — 아래 둘이 "지금 어느 OS 인가"에 달려 있어 여기 한 곳에 둔다.
 *  ① 단축키 라벨 — 판정은 `e.ctrlKey || e.metaKey` 로 이미 옳고 표시만 OS 를 따른다(mac 에 `Ctrl+…` 를 보이면 없는 키를 알려 준다).
 *  ② 경로 대소문자 — Linux 에서는 `Feature-X` 와 `feature-x` 가 서로 다른 폴더라, 무조건 소문자로 접으면 두 항목이 한 줄로 뭉개진다.
 * 접기·비교 규칙은 발명하지 않고 `@vibisual/shared` 의 `pathCase` 헬퍼에 위임한다.
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
 * 통합 데스크톱 앱은 렌더러와 서버가 같은 머신이라 `navigator` 의 OS 가 곧 서버 OS 다. ⚠ 폰 브라우저 원격 접속(모바일 웹)에서는 접속 기기의 OS 라
 * 다를 수 있다 — 서버가 스냅샷에 `platform` 을 실으면 이 함수 하나만 바꾸면 된다. 판정 불가(`unknown`)면 접는다("같은 폴더가 둘로 보이는" 쪽보다 낫다).
 */
export function isCaseInsensitiveFsClient(): boolean {
  return clientOs() !== 'linux';
}

/** shared `pathCase` 헬퍼에 넘길 플랫폼 이름. 실제로 갈리는 것은 "접느냐 마느냐" 뿐이다. */
export function clientPathPlatform(): PlatformName {
  return isCaseInsensitiveFsClient() ? 'win32' : 'linux';
}

/**
 * §6 단축키 판정에 넘길 플랫폼 이름.
 * ⚠ `clientPathPlatform()` 과 다르다 — 그쪽은 케이스만 갈려 darwin 을 win32 로 접지만, OS 예약 조합(⌘Q·Alt+F4·⌘⇧4)은 세 OS 가 다르다.
 * 접으면 mac 에 ⌘Q 배정을 허락한다(누르면 앱이 종료된다). 판정 불가면 `win32` — 가장 흔하고, 틀려도 "막았어야 할 조합을 허용"일 뿐 동작이 깨지지 않는다.
 */
export function clientKeyPlatform(): PlatformName {
  const os = clientOs();
  return os === 'unknown' ? 'win32' : os;
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
 * 모디파이어 토큰 → mac 기호. `Ctrl` 이 `⌘` 로 간다 — 단축키는 전부 `ctrlKey || metaKey` 라 mac 에서 실제로 눌리는 키가 Command 다.
 * ⚠ `Control` 토큰만 진짜 Control(`⌃`) — §5.5 #17-37 의 `Ctrl+Tab` 처럼 mac 에서 `⌘` 가 OS 에 잡힌(⌘Tab = 앱 전환) 자리에 쓴다.
 * 그 자리는 판정도 `ctrlKey` 만 봐 라벨과 동작이 어긋나지 않는다. 그 외에는 `Ctrl`.
 */
const MAC_MODIFIER: Record<string, string> = {
  ctrl: '⌘', cmd: '⌘', command: '⌘', meta: '⌘', mod: '⌘',
  control: '⌃',
  alt: '⌥', option: '⌥', opt: '⌥',
  shift: '⇧',
};

/** 모디파이어가 아닌 키 중 mac 이 기호로 그리는 것. 없으면 원문 그대로 둔다. */
/**
 * 세 OS 공통으로 기호가 더 읽기 쉬운 키 — 방향키 넷. 글자로 적으면 네 방향 안내가 `Ctrl+Alt+LeftRightUpDown` 같은 덩어리가 되고,
 * Windows 앱도 이 자리는 화살표로 그리므로 세 OS 를 같게 둔다.
 */
const ARROW_KEY: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };

const MAC_KEY: Record<string, string> = {
  ...ARROW_KEY,
  enter: '↩', return: '↩',
  backspace: '⌫', delete: '⌦', del: '⌦',
  tab: '⇥', escape: 'Esc', esc: 'Esc',
  pageup: '⇞', pagedown: '⇟',
};

/** mac 이 아닌 곳의 표기 — 뜻이 갈리는 `Control` 만 사람이 쓰는 말(`Ctrl`)로 되돌린다. */
const WIN_MODIFIER: Record<string, string> = { control: 'Ctrl' };

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
 * - 그 외: 받은 그대로 `+` 로 잇는다 — `Ctrl+S` → `Ctrl+S`. 방향키만 기호로(`Left` → `←`).
 * - `Control` 토큰은 **진짜 Control** — `Control+Tab` → mac `⌃⇥`, 그 외 `Ctrl+Tab`(#17-37 ③).
 */
export function formatShortcut(combo: string, mac: boolean): string {
  const tokens = splitCombo(combo);
  if (tokens.length === 0) return combo;
  if (!mac) {
    return tokens
      .map((t) => WIN_MODIFIER[t.toLowerCase()] ?? ARROW_KEY[t.toLowerCase()] ?? t)
      .join('+');
  }

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

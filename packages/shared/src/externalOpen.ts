/**
 * 바깥 브라우저 열기 실패 판정 SSOT(§3.7) — 길은 `window.open` → `setWindowOpenHandler` → `shell.openExternal` 하나.
 * ⚠️ 리눅스는 `shell.openExternal` 이 브라우저가 없어도 resolve 한다(Electron 이 `xdg-open` 을 안 기다린다 — 실측 2026-08-31, WSL2+WSLg) — 그래서 리눅스만 따로 잰다.
 * 플랫폼은 인자(shared). 판정만 한다 — 탐침은 desktop main, 대신 띄우는 폴백은 없다("안 열렸다"를 말하는 데까지).
 */

import type { PlatformName } from './pathCase.js';

/** 안내를 띄우는 사유. */
export type ExternalOpenFailureReason =
  /** 리눅스에 링크를 열어 줄 프로그램이 아예 없다(탐침 결과). */
  | 'no-browser'
  /** `shell.openExternal` 이 실패를 보고했다(win/mac 에서 신뢰할 수 있는 신호). */
  | 'open-failed'
  /** 브라우저로 넘길 수 없는 스킴이라 아예 열지 않았다. */
  | 'blocked-scheme';

/**
 * 바깥으로 넘길 스킴 허용 목록 — `shell.openExternal` 은 OS 프로토콜 핸들러를 부르고(`ms-msdt:` 등이면 로컬 프로그램), 주소는 에이전트·훅·내부 앱이 쓴 문자열이다.
 * ⚠️ OS 설정 창 길(`micSettingsOpener`)은 여기를 안 지난다(서버 고정 표) — 합치면 정상 기능이 죽는다.
 */
export const ALLOWED_EXTERNAL_SCHEMES: readonly string[] = ['http:', 'https:', 'mailto:'];

/**
 * 이 주소를 바깥으로 넘겨도 되는가. 파싱 자체가 안 되는 값(상대 경로 등)도 **막는다** —
 * 바깥 핸들러에 넘길 수 있는 절대 주소가 아니면 열 일도 없다.
 */
export function isAllowedExternalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return ALLOWED_EXTERNAL_SCHEMES.includes(parsed.protocol.toLowerCase());
}

/** main → renderer 로 흐르는 실패 알림 payload(`vibisual:external-open-failed`). */
export interface ExternalOpenFailure {
  /** 열려던 주소. 안내창이 그대로 보여 주고 [복사] 대상이 된다. */
  url: string;
  reason: ExternalOpenFailureReason;
}

/** `xdg-open` generic 모드가 차례로 찾는 브라우저 실행본(실측 순서). PATH 에 하나라도 있으면 그것을 쓴다. */
export const LINUX_BROWSER_BINARIES = [
  'x-www-browser',
  'firefox',
  'iceweasel',
  'seamonkey',
  'mozilla',
  'epiphany',
  'konqueror',
  'chromium',
  'chromium-browser',
  'google-chrome',
  'www-browser',
  'links2',
  'elinks',
  'links',
  'lynx',
  'w3m',
] as const;

/** 사전 탐침이 필요한 플랫폼 — 리눅스만(win/mac 은 실패를 제대로 reject 한다). */
export function needsBrowserProbe(platform: PlatformName): boolean {
  return platform === 'linux';
}

/** 리눅스 탐침 결과(읽기 전용 사실). 못 구한 항목은 `undefined` — 모두 비어야 "없다". */
export interface LinuxBrowserProbe {
  /** `$BROWSER` 에 적힌 명령 중 **실제로 PATH 에서 찾아진** 것들. */
  browserEnvResolved?: readonly string[];
  /** `xdg-mime query default x-scheme-handler/https` 출력 그대로. ⚠️ 종료코드로 판정하지 마라 — 핸들러가 없어도 rc=0·빈 출력이다(실측, `xdg-settings` 도). */
  schemeHandler?: string | null;
  /** `LINUX_BROWSER_BINARIES` 중 PATH 에 있는 것들. */
  binariesOnPath?: readonly string[];
}

/** gio 계열이 "핸들러 없음"을 말할 때 쓰는 문구 — 출력을 그대로 먹여도 오판하지 않게. */
const NO_HANDLER_MARKERS = ['no default applications', 'no default application'];

function hasSchemeHandler(raw: string | null | undefined): boolean {
  const text = (raw ?? '').trim();
  if (!text) return false;
  const lowered = text.toLowerCase();
  return !NO_HANDLER_MARKERS.some((marker) => lowered.includes(marker));
}

/** 열어 줄 프로그램이 있나 — 셋 중 하나라도 있으면 참(탐침이 못 보는 스냅·플랫팩이 있다 — 헛안내보다 조용한 쪽). */
export function hasLinuxBrowserHandler(probe: LinuxBrowserProbe): boolean {
  if ((probe.browserEnvResolved?.length ?? 0) > 0) return true;
  if (hasSchemeHandler(probe.schemeHandler)) return true;
  return (probe.binariesOnPath?.length ?? 0) > 0;
}

export interface ExternalOpenNoticeInput {
  /** `process.platform` 값. 함수 안에서 직접 읽지 않는다 — 위 머리말 참조. */
  platform: PlatformName;
  /** `shell.openExternal` 이 reject 했는가. 리눅스에서는 이 값이 거의 항상 false 다. */
  openRejected: boolean;
  /** 리눅스 탐침 결과. 못 했으면 `null`/`undefined` — 모르면 안내하지 않는다. */
  linuxProbe?: LinuxBrowserProbe | null;
}

/** 안내 여부·사유의 단일 판정(`null` = 침묵). 열기는 판정과 무관하게 늘 시도한다(탐침이 틀려도 되던 열기를 막지 않게). */
export function resolveExternalOpenNotice({
  platform,
  openRejected,
  linuxProbe,
}: ExternalOpenNoticeInput): ExternalOpenFailureReason | null {
  if (openRejected) return 'open-failed';
  if (!needsBrowserProbe(platform)) return null;
  if (!linuxProbe) return null;
  return hasLinuxBrowserHandler(linuxProbe) ? null : 'no-browser';
}

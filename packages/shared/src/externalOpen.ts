/**
 * 바깥 브라우저 열기 실패 판정 SSOT (§3.7).
 *
 * 링크를 여는 길은 앱 전체에 하나다 — renderer 의 `window.open(url,'_blank')` 가
 * main 의 `setWindowOpenHandler` 를 거쳐 `shell.openExternal` 로 간다. 그런데 그 길은
 * **실패를 한 번도 말하지 않았다.**
 *
 * ⚠️ 리눅스에서 `shell.openExternal` 의 프라미스는 **믿을 수 없다.** 실측(2026-08-31,
 * WSL2 Ubuntu + WSLg, 브라우저가 한 개도 없는 배포판):
 *
 *   PROBE_RESULT resolved (성공으로 보고됨) elapsed=2ms
 *   /usr/bin/xdg-open: 882: x-www-browser: not found
 *   /usr/bin/xdg-open: 882: firefox: not found        ... (16종 전부)
 *
 * Electron 의 리눅스 구현이 `xdg-open` 을 **종료를 기다리지 않고**(wait=false) 띄우기
 * 때문이다. 즉 `.catch` 를 붙여도 리눅스에서는 영영 불리지 않는다 — 안내가 가장 필요한
 * 바로 그 플랫폼에서 정확히 무력하다. 그래서 리눅스만 **열어 줄 프로그램이 있는지**를
 * 따로 잰다.
 *
 * ⚠️ shared 는 브라우저에서도 로드되므로 `process.platform` 을 직접 읽지 않는다
 * (`pathCase.ts`·`updateDelivery.ts` 머리말과 같은 규약) — **플랫폼을 인자로 받는다.**
 * 그래야 실기 없는 세 OS 를 개발기 한 대에서 전부 단위 테스트할 수 있다.
 *
 * 이 파일은 **판정만** 한다. 실제 탐침(spawn)은 desktop main 이 하고, 무엇을 대신
 * 띄우는 폴백은 **어디에도 없다**(사용자 명시 결정 — 우리 몫은 "안 열렸다"를 말하는 것까지).
 */

import type { PlatformName } from './pathCase.js';

/** 안내를 띄우는 사유. */
export type ExternalOpenFailureReason =
  /** 리눅스에 링크를 열어 줄 프로그램이 아예 없다(탐침 결과). */
  | 'no-browser'
  /** `shell.openExternal` 이 실패를 보고했다(win/mac 에서 신뢰할 수 있는 신호). */
  | 'open-failed';

/** main → renderer 로 흐르는 실패 알림 payload(`vibisual:external-open-failed`). */
export interface ExternalOpenFailure {
  /** 열려던 주소. 안내창이 그대로 보여 주고 [복사] 대상이 된다. */
  url: string;
  reason: ExternalOpenFailureReason;
}

/**
 * `xdg-open` 이 generic 모드에서 차례로 찾는 브라우저 실행본 목록.
 *
 * 실측으로 뽑았다 — 브라우저가 없는 배포판에서 `xdg-open https://…` 를 돌리면 이 순서
 * 그대로 `not found` 를 흘린다. PATH 에 이 중 하나라도 있으면 xdg-open 이 그것을 쓴다.
 */
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

/**
 * 이 플랫폼에서 **사전 탐침이 필요한가.**
 *
 * 리눅스만 참이다. win/mac 은 `shell.openExternal` 이 실패를 제대로 reject 하므로
 * 그 신호를 그대로 믿으면 되고, 쓸데없이 프로세스를 띄우지 않는다.
 */
export function needsBrowserProbe(platform: PlatformName): boolean {
  return platform === 'linux';
}

/**
 * 리눅스 탐침 결과 — **전부 읽기 전용으로 얻은 사실**이다(아무것도 실행하지 않는다).
 *
 * 값을 못 구한 항목은 `undefined` 로 둔다. 모든 항목이 비어 있어야 "없다" 로 본다.
 */
export interface LinuxBrowserProbe {
  /** `$BROWSER` 에 적힌 명령 중 **실제로 PATH 에서 찾아진** 것들. */
  browserEnvResolved?: readonly string[];
  /**
   * `xdg-mime query default x-scheme-handler/https` 의 출력(다듬기 전 그대로).
   *
   * ⚠️ **종료코드로 판정하면 안 된다** — 실측에서 핸들러가 없어도 rc=0 에 빈 출력이었다
   * (`xdg-settings get default-web-browser` 도 같다). 판정 근거는 오직 출력 내용이다.
   */
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

/**
 * 리눅스에 링크를 열어 줄 프로그램이 있는가.
 *
 * 셋 중 **하나라도** 있으면 참이다 — 우리 탐침이 못 보는 핸들러(스냅·플랫팩 등)가
 * 있을 수 있으므로 판정은 넉넉한 쪽으로 기운다. 헛안내보다 조용한 쪽이 낫다.
 */
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
  /**
   * 리눅스 탐침 결과. 탐침을 못 했거나 실패했으면 `null`/`undefined` 로 준다 —
   * **모르는 것을 근거로 안내를 띄우지 않는다**(온보딩 게이트가 `pending` 에서
   * 아무것도 띄우지 않는 것과 같은 규약).
   */
  linuxProbe?: LinuxBrowserProbe | null;
}

/**
 * 안내를 띄울지, 띄운다면 어떤 사유인지 정하는 **단일 판정 지점**.
 *
 * `null` 이면 아무 말도 하지 않는다. 열기 자체는 이 판정과 무관하게 **항상 시도된다** —
 * 탐침이 틀렸을 때 되던 열기를 우리 손으로 막는 쪽이 훨씬 나쁘기 때문이다.
 */
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

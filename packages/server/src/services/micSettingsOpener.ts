/**
 * micSettingsOpener.ts — **§5.5 #17-38 ⑮ OS 의 마이크 설정 창을 여는 통로 한 곳.**
 *
 * ⑥ 이 실패 사유를 갈라 화면이 "할 수 있는 일"을 말하게 했다면, 이 파일은 그 다음 걸음이다 —
 * **말하는 대신 데려다 준다.** 안내문이 정확해도(“개인 정보 설정에서 허용해 주세요”) 그 창이
 * 어디 있는지는 OS 마다 다르고, 특히 Windows 의 결정적 스위치("데스크톱 앱이 마이크에
 * 액세스하도록 허용")는 앱 목록을 한참 내려야 나와 안내만으로는 대부분 못 찾는다.
 *
 * ### 왜 `/api/open-external` 을 그대로 못 쓰는가
 * 그 라우트는 **파일 경로**를 받아 `isWithinOpenableRoots` 로 막는다(§5.13 (R-6)). 우리가 여는
 * 것은 파일이 아니라 `ms-settings:` 같은 **OS 설정 URI** 라 그 가드를 통과할 수 없고, 가드를
 * 느슨하게 고치면 임의 URI 를 여는 문이 열린다(페어링된 모바일도 이 라우트에 닿는다 — 같은 주석).
 * 그래서 **여는 대상을 화이트리스트로 고정한** 별도 통로를 둔다: 이 파일이 아는 주소는
 * `micSettingsTarget()` 이 돌려주는 그 하나뿐이고, 요청 본문에서 URL 을 받지 않는다.
 *
 * ### 왜 `shell.openExternal` 을 주입받는가
 * 서버 코어는 Electron 을 import 하지 않는다(§3.7 — 웹 단독 실행 호환). 휴지통(`setWorkspaceTrash`)과
 * 같은 규율으로 desktop main 이 부팅 때 꽂고, 안 꽂혔으면 **열 수 없다고 정직하게 답한다**
 * (없는 것을 여는 척하면 눌러도 아무 일이 없는 버튼이 된다).
 */

import { micSettingsTarget } from '@vibisual/shared';
import { logger } from '../logger.js';

/** desktop main 이 꽂는 통로. 웹 단독 실행에서는 `null` 로 남는다. */
type OpenUrl = (url: string) => void;

let openUrl: OpenUrl | null = null;

/**
 * desktop main 이 부팅 때 `shell.openExternal` 을 꽂는다.
 * 휴지통(`setWorkspaceTrash`)과 같은 자리·같은 이유다.
 */
export function setMicSettingsOpener(fn: OpenUrl | null): void {
  openUrl = fn;
}

/** 이 실행 환경이 OS 설정 창을 열 수 있는가(화면이 버튼을 그릴지 정하는 근거). */
export function isMicSettingsOpenable(platform: string = process.platform): boolean {
  return openUrl !== null && micSettingsTarget(platform).url !== null;
}

export interface MicSettingsOpenResult {
  ok: boolean;
  /** 못 열었을 때 왜 못 열었는가 — 화면이 사유를 말할 수 있게(⑬ "실패는 사유까지"). */
  reason?: 'no-target' | 'no-opener';
  /** 그 창에서 무엇을 만져야 하는지 가리키는 번역 키. 열지 못했어도 글로는 안내한다. */
  hintKey: string;
}

/**
 * 마이크 설정 창을 연다.
 *
 * `platform` 을 **인자로 받는다** — 실기(mac·linux) 없이 세 OS 를 단위 테스트로 확인할 수 있는
 * 유일한 방법이다([docs/rules/multiplatform.md] "플랫폼 분기는 인자로 받는다").
 */
export function openMicSettings(platform: string = process.platform): MicSettingsOpenResult {
  const target = micSettingsTarget(platform);
  if (target.url === null) {
    // linux — 열 창이 데스크톱 환경마다 갈린다. 여는 척하지 않고 글로 안내한다.
    return { ok: false, reason: 'no-target', hintKey: target.hintKey };
  }
  if (openUrl === null) {
    return { ok: false, reason: 'no-opener', hintKey: target.hintKey };
  }
  logger.info(`openMicSettings: ${target.url}`);
  openUrl(target.url);
  return { ok: true, hintKey: target.hintKey };
}

/**
 * 이 플랫폼에서 무엇을 만져야 하는지 가리키는 번역 키.
 *
 * 라우트가 `@vibisual/shared` 를 따로 import 하지 않게 여기서 한 번 더 내보낸다 — 마이크 설정을
 * 아는 곳은 이 파일 하나라는 규율을 지키기 위해서다(판정이 두 곳으로 갈리면 한쪽만 고쳐진다).
 */
export function micSettingsHintKey(platform: string = process.platform): string {
  return micSettingsTarget(platform).hintKey;
}

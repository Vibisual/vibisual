/**
 * micSettingsOpener.ts — §5.5 #17-38 ⑮ OS 마이크 설정 창을 여는 통로 한 곳(Windows 의 스위치는 안내만으로 찾기 어렵다).
 * `/api/open-external`(파일 경로용 `isWithinOpenableRoots` 가드, §5.13 (R-6))을 느슨하게 고쳐 쓰지 마라 — 임의 URI 를 여는 문이 되고 페어링된 모바일도 닿는다.
 * 여는 주소는 `micSettingsTarget()` 하나뿐, 본문의 URL 은 받지 않는다. `shell.openExternal` 은 desktop main 이 주입한다(서버 코어는 Electron 을 모른다, §3.7) — 없으면 열 수 없다고 답한다.
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

/** `platform` 은 인자로 받는다 — 실기 없이 세 OS 를 시험하는 유일한 길이다. */
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

/** 이 플랫폼의 안내 번역 키. 마이크 설정을 아는 곳을 이 파일 하나로 두려고 라우트에 다시 내보낸다(갈리면 한쪽만 고쳐진다). */
export function micSettingsHintKey(platform: string = process.platform): string {
  return micSettingsTarget(platform).hintKey;
}

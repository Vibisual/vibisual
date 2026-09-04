import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isMicSettingsOpenable,
  micSettingsHintKey,
  openMicSettings,
  setMicSettingsOpener,
} from './micSettingsOpener.js';

/**
 * §5.5 #17-38 ⑮ — **여는 통로가 임의 URI 문이 되지 않는지**를 고정한다.
 *
 * 이 라우트가 위험해지는 길은 하나다: 어디선가 URL 을 받아서 여는 것. 그래서 이 모듈은
 * 주소를 **오직 `micSettingsTarget(platform)` 에서만** 얻고 밖에서 받지 않는다 — 그 성질을
 * 테스트로 못 박아 둔다(페어링된 모바일 기기도 이 라우트에 닿는다).
 *
 * 함께 고정하는 것: 주입이 없을 때(웹 단독 실행) **여는 척하지 않는 것**.
 */

afterEach(() => {
  setMicSettingsOpener(null);
  vi.restoreAllMocks();
});

describe('openMicSettings — 주소는 플랫폼이 정한 하나뿐', () => {
  it('win32 에서 개인 정보 마이크 설정만 연다', () => {
    const opened: string[] = [];
    setMicSettingsOpener((url) => opened.push(url));

    const result = openMicSettings('win32');

    expect(result.ok).toBe(true);
    expect(opened).toEqual(['ms-settings:privacy-microphone']);
  });

  it('darwin 에서 시스템 설정 마이크 앵커를 연다', () => {
    const opened: string[] = [];
    setMicSettingsOpener((url) => opened.push(url));

    expect(openMicSettings('darwin').ok).toBe(true);
    expect(opened[0]).toContain('Privacy_Microphone');
  });

  it('linux 는 **열지 않는다** — 열 창이 데스크톱 환경마다 갈린다', () => {
    const opened: string[] = [];
    setMicSettingsOpener((url) => opened.push(url));

    const result = openMicSettings('linux');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-target');
    // 여는 척하지 않는 것이 핵심이다 — 통로가 꽂혀 있어도 부르지 않는다.
    expect(opened).toEqual([]);
    // 열지 못해도 **무엇을 확인해야 하는지**는 말한다.
    expect(result.hintKey).toBe('ide.mainArea.voiceMicSettingsHintLinux');
  });

  it('주입이 없으면(웹 단독 실행) 사유를 남기고 물러선다', () => {
    setMicSettingsOpener(null);

    const result = openMicSettings('win32');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-opener');
    // 열 수 없어도 안내문은 남는다 — 화면이 글로 물러설 수 있게.
    expect(result.hintKey).toBe('ide.mainArea.voiceMicSettingsHintWin');
  });
});

describe('isMicSettingsOpenable — 화면이 버튼을 그릴 근거', () => {
  it('통로가 꽂히고 주소가 있는 플랫폼에서만 참', () => {
    setMicSettingsOpener(() => undefined);
    expect(isMicSettingsOpenable('win32')).toBe(true);
    expect(isMicSettingsOpenable('darwin')).toBe(true);
    // linux 는 통로가 있어도 열 곳이 없다 — 눌러도 아무 일 없는 버튼을 그리지 않는다.
    expect(isMicSettingsOpenable('linux')).toBe(false);
  });

  it('통로가 없으면 어느 OS 에서도 거짓', () => {
    setMicSettingsOpener(null);
    expect(isMicSettingsOpenable('win32')).toBe(false);
    expect(isMicSettingsOpenable('darwin')).toBe(false);
  });
});

describe('micSettingsHintKey — 판정이 두 곳으로 갈리지 않는다', () => {
  it('플랫폼별 힌트 키를 그대로 돌려준다', () => {
    expect(micSettingsHintKey('win32')).toBe('ide.mainArea.voiceMicSettingsHintWin');
    expect(micSettingsHintKey('darwin')).toBe('ide.mainArea.voiceMicSettingsHintMac');
    expect(micSettingsHintKey('linux')).toBe('ide.mainArea.voiceMicSettingsHintLinux');
  });
});

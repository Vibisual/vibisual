import { describe, expect, it } from 'vitest';
import {
  isMicAccessFixable,
  isNoDeviceError,
  micSettingsTarget,
  refineDeviceError,
  type VoiceInputErrorCode,
} from '@vibisual/shared';

/**
 * §5.5 #17-38 ⑮ 마이크 설정 데려다 주기 — **판정만 따로 고정한다.**
 *
 * 이 기능이 무너지는 자리는 전부 여기다: 엉뚱한 OS 의 설정 주소를 열거나(mac 사용자에게
 * `ms-settings:`), 열 수 없는 판에서 여는 척하거나(linux), 권한으로 풀 수 있는 실패인데
 * 문을 안 열어 주는 것.
 *
 * **실기(mac·linux)가 없으므로 이 테스트가 세 OS 를 확인하는 유일한 길이다** —
 * 그래서 `micSettingsTarget` 은 `process.platform` 을 안에서 읽지 않고 **인자로 받는다**
 * ([docs/rules/multiplatform.md] "플랫폼 분기는 인자로 받는다").
 */

describe('micSettingsTarget — OS 마다 여는 곳이 다르다', () => {
  it('win32 는 개인 정보 마이크 설정 URI 를 연다', () => {
    const t = micSettingsTarget('win32');
    expect(t.url).toBe('ms-settings:privacy-microphone');
    expect(t.hintKey).toBe('ide.mainArea.voiceMicSettingsHintWin');
  });

  it('darwin 은 **앵커까지** 준다 — 없으면 개인정보 첫 장만 열려 다시 찾아야 한다', () => {
    const t = micSettingsTarget('darwin');
    expect(t.url).toContain('x-apple.systempreferences:');
    expect(t.url).toContain('Privacy_Microphone');
    expect(t.hintKey).toBe('ide.mainArea.voiceMicSettingsHintMac');
  });

  it('linux 는 `null` 이 정답이다 — 열 창이 데스크톱 환경마다 갈린다', () => {
    // 여는 척하면 눌러도 아무 일이 없는 버튼이 된다. 대신 글로 안내한다.
    const t = micSettingsTarget('linux');
    expect(t.url).toBeNull();
    expect(t.hintKey).toBe('ide.mainArea.voiceMicSettingsHintLinux');
  });

  it('모르는 플랫폼도 linux 와 같이 안전하게 떨어진다(지어내지 않는다)', () => {
    expect(micSettingsTarget('freebsd').url).toBeNull();
    expect(micSettingsTarget('').url).toBeNull();
  });

  it('세 OS 의 힌트 키가 서로 다르다 — 한 벌로 뭉치면 안내가 거짓이 된다', () => {
    const keys = ['win32', 'darwin', 'linux'].map((p) => micSettingsTarget(p).hintKey);
    expect(new Set(keys).size).toBe(3);
  });
});

describe('isMicAccessFixable — OS 설정으로 풀 수 있는 실패인가', () => {
  it('permission 은 당연히 포함된다', () => {
    expect(isMicAccessFixable('permission')).toBe(true);
  });

  it('**device 도 포함된다** — win 의 "데스크톱 앱 허용" 이 꺼지면 NotFoundError 로 온다', () => {
    // 화면에는 "마이크를 찾지 못했습니다"가 뜨지만 실제 원인은 권한인 경우가 있다.
    // 이 한 줄이 빠지면 그 사람은 영영 장치만 다시 꽂아 본다.
    expect(isMicAccessFixable('device')).toBe(true);
  });

  it('설정과 무관한 실패는 문을 열지 않는다 — 엉뚱한 곳으로 보내지 않는다', () => {
    const notFixable: VoiceInputErrorCode[] = [
      'unsupported', 'network', 'engine', 'language', 'no-speech', 'aborted', 'unknown',
      // 마이크는 있는데 남이 쥔 것 — 설정이 아니라 그 앱을 끄는 일이다(⑯).
      'device-busy',
    ];
    for (const code of notFixable) {
      expect(isMicAccessFixable(code)).toBe(false);
    }
  });
});

describe('refineDeviceError — "없다" 와 "막혔다" 를 장치 목록으로 가른다', () => {
  it('장치 0개면 no-device 로 좁힌다 — 이때만 "연결해 주세요"다', () => {
    // 이 개발기 실측(2026-09-04): file:// 렌더러에서 audioinput 0개 · getUserMedia NotFoundError.
    // audiooutput 은 3개 잡히므로 열거 자체는 되고 있다 = 진짜로 마이크가 없는 것이다.
    expect(refineDeviceError('device', 0)).toBe('no-device');
  });

  it('장치가 있는데 못 열었으면 좁히지 않는다 — 꽂힌 마이크를 다시 꽂게 하지 않는다', () => {
    // win 에서 "데스크톱 앱 허용" 이 꺼지면 장치가 있어도 NotFoundError 가 온다.
    // 그 사람에게 필요한 것은 설정이지 케이블이 아니다.
    expect(refineDeviceError('device', 1)).toBe('device');
    expect(refineDeviceError('device', 3)).toBe('device');
  });

  it('목록을 못 물어봤으면(null) 좁히지 않는다 — 모름은 없음이 아니다', () => {
    // 0 으로 접으면 목록을 못 읽는 판에서 멀쩡한 마이크를 가진 사람에게 "연결해 주세요"가 뜬다.
    expect(refineDeviceError('device', null)).toBe('device');
  });

  it('device 가 아닌 사유는 건드리지 않는다 — 원인이 이미 분명한 것을 뒤집지 않는다', () => {
    expect(refineDeviceError('permission', 0)).toBe('permission');
    // 특히 device-busy 는 "목록에 있다"가 전제라 0 이 와도 뒤집으면 안 된다.
    expect(refineDeviceError('device-busy', 0)).toBe('device-busy');
    expect(refineDeviceError('engine', 0)).toBe('engine');
    expect(refineDeviceError('unknown', 0)).toBe('unknown');
  });
});

describe('no-device 가 화면에서 어떻게 다뤄지는가', () => {
  it('isNoDeviceError 는 no-device 에만 참', () => {
    expect(isNoDeviceError('no-device')).toBe(true);
    expect(isNoDeviceError('device')).toBe(false);
    expect(isNoDeviceError('device-busy')).toBe(false);
    expect(isNoDeviceError('permission')).toBe(false);
  });

  it('no-device 도 설정 문은 열어 둔다 — win 의 0 은 OS 가 감춘 결과일 수 있다', () => {
    expect(isMicAccessFixable('no-device')).toBe(true);
  });

  it('**device-busy 는 설정으로 보내지 않는다** — 할 일은 다른 앱을 끄는 것이다', () => {
    // 설정 창을 열어 주면 이미 켜져 있는 스위치를 보게 되어 안내가 원인을 가린다.
    expect(isMicAccessFixable('device-busy')).toBe(false);
  });
});

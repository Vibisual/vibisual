import { describe, it, expect } from 'vitest';
import {
  needsBrowserProbe,
  hasLinuxBrowserHandler,
  resolveExternalOpenNotice,
  LINUX_BROWSER_BINARIES,
} from '@vibisual/shared';

// shared 의 순수 판정 로직은 server 테스트에서 검증한다(pathCase.test.ts·updateDelivery.test.ts 선례).
//
// 이 파일의 존재 이유: 우리에게는 mac·linux 실기가 없다. 판정 함수가 `process.platform` 을
// 직접 읽지 않고 **인자로 받게** 만든 덕분에 Windows 개발기 한 대에서 세 OS 를 전부 잰다
// (CLAUDE.md 멀티플랫폼 규칙).
//
// 이 규칙이 지키는 실측 사실(2026-08-31, WSL2 Ubuntu + WSLg 설치본): 브라우저가 한 개도 없는
// 배포판에서 `shell.openExternal` 은 **2ms 만에 resolve** 했고 그 뒤 xdg-open 이 16종을 전부
// not found 로 흘렸다. 그래서 리눅스에서는 프라미스가 아니라 탐침으로 판정해야 한다.

describe('needsBrowserProbe — 어느 OS 에서 사전 탐침이 필요한가', () => {
  it('리눅스만 탐침이 필요하다 (openExternal 의 프라미스를 믿을 수 없는 유일한 플랫폼)', () => {
    expect(needsBrowserProbe('linux')).toBe(true);
  });

  it('Windows·macOS 는 탐침 없이 openExternal 의 실패 보고를 그대로 믿는다', () => {
    expect(needsBrowserProbe('win32')).toBe(false);
    expect(needsBrowserProbe('darwin')).toBe(false);
  });
});

describe('hasLinuxBrowserHandler — 열어 줄 프로그램이 있는가', () => {
  it('셋 다 비면 없다 (실측한 WSL 배포판의 상태)', () => {
    expect(hasLinuxBrowserHandler({})).toBe(false);
    expect(
      hasLinuxBrowserHandler({ browserEnvResolved: [], schemeHandler: '', binariesOnPath: [] }),
    ).toBe(false);
  });

  it('$BROWSER 가 실제로 풀리면 있다', () => {
    expect(hasLinuxBrowserHandler({ browserEnvResolved: ['/usr/bin/firefox'] })).toBe(true);
  });

  it('scheme 핸들러가 잡히면 있다', () => {
    expect(hasLinuxBrowserHandler({ schemeHandler: 'firefox.desktop' })).toBe(true);
    expect(hasLinuxBrowserHandler({ schemeHandler: '  google-chrome.desktop \n' })).toBe(true);
  });

  it('PATH 에 브라우저 실행본이 있으면 있다', () => {
    expect(hasLinuxBrowserHandler({ binariesOnPath: ['/usr/bin/chromium'] })).toBe(true);
  });

  it('gio 의 "No default applications" 출력을 그대로 먹여도 없다고 읽는다', () => {
    // 명령을 gio 계열로 바꿔 끼웠을 때 그 문구를 핸들러 이름으로 오독하지 않게 하는 방어.
    expect(
      hasLinuxBrowserHandler({
        schemeHandler: 'No default applications for “x-scheme-handler/https”',
      }),
    ).toBe(false);
  });

  it('종료코드가 아니라 출력 내용으로 판정한다 — 빈 출력은 "없다"', () => {
    // 실측: xdg-mime query / xdg-settings get 은 핸들러가 없어도 rc=0 에 빈 출력이었다.
    expect(hasLinuxBrowserHandler({ schemeHandler: '   \n  ' })).toBe(false);
  });
});

describe('resolveExternalOpenNotice — 안내를 띄울지 정하는 단일 판정 지점', () => {
  it('리눅스에 브라우저가 없으면 no-browser 로 안내한다', () => {
    expect(
      resolveExternalOpenNotice({ platform: 'linux', openRejected: false, linuxProbe: {} }),
    ).toBe('no-browser');
  });

  it('리눅스에 브라우저가 있으면 조용하다', () => {
    expect(
      resolveExternalOpenNotice({
        platform: 'linux',
        openRejected: false,
        linuxProbe: { binariesOnPath: ['/usr/bin/firefox'] },
      }),
    ).toBeNull();
  });

  it('탐침을 못 했으면 조용하다 — 모르는 것을 근거로 겁주지 않는다', () => {
    expect(
      resolveExternalOpenNotice({ platform: 'linux', openRejected: false, linuxProbe: null }),
    ).toBeNull();
    expect(resolveExternalOpenNotice({ platform: 'linux', openRejected: false })).toBeNull();
  });

  it('openExternal 이 reject 하면 플랫폼과 무관하게 open-failed', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(resolveExternalOpenNotice({ platform, openRejected: true })).toBe('open-failed');
    }
  });

  it('win/mac 은 열기가 성공 보고되면 탐침을 보지 않고 조용하다', () => {
    expect(resolveExternalOpenNotice({ platform: 'win32', openRejected: false })).toBeNull();
    expect(resolveExternalOpenNotice({ platform: 'darwin', openRejected: false })).toBeNull();
    // 리눅스가 아니면 탐침이 "없다"로 와도 무시한다(그 신호는 리눅스 전용이다).
    expect(
      resolveExternalOpenNotice({ platform: 'darwin', openRejected: false, linuxProbe: {} }),
    ).toBeNull();
  });
});

describe('LINUX_BROWSER_BINARIES — xdg-open 의 generic 탐색 목록', () => {
  it('실측에서 xdg-open 이 실제로 훑은 순서를 담고 있다', () => {
    // 실측 로그의 첫 줄과 마지막 줄 — 목록이 조용히 흐트러지면 탐침이 헛돈다.
    expect(LINUX_BROWSER_BINARIES[0]).toBe('x-www-browser');
    expect(LINUX_BROWSER_BINARIES[LINUX_BROWSER_BINARIES.length - 1]).toBe('w3m');
    expect(LINUX_BROWSER_BINARIES).toContain('firefox');
    expect(LINUX_BROWSER_BINARIES).toContain('google-chrome');
    expect(new Set(LINUX_BROWSER_BINARIES).size).toBe(LINUX_BROWSER_BINARIES.length);
  });
});

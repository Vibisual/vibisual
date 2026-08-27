import { describe, it, expect } from 'vitest';
import {
  resolveUpdateDelivery,
  releasesPageUrl,
  readUpdateDelivery,
  RELEASES_PAGE_BASE,
} from '@vibisual/shared';

// shared 의 순수 판정 로직은 server 테스트에서 검증한다(pathCase.test.ts·keyedSliceDelta.test.ts 선례).
//
// 이 파일의 존재 이유: 우리에게는 mac·linux 실기가 없다. `resolveUpdateDelivery` 가
// `process.platform` 을 직접 읽지 않고 **인자로 받게** 만든 덕분에, Windows 개발기 한 대에서
// 세 OS 판정을 전부 확인할 수 있다(CLAUDE.md 멀티플랫폼 규칙).

describe('resolveUpdateDelivery — 플랫폼별 업데이트 전달 방식', () => {
  it('무서명 macOS 는 notify-only (Squirrel.Mac 이 서명 검증을 강제해 적용이 반드시 실패한다)', () => {
    expect(resolveUpdateDelivery({ platform: 'darwin' })).toBe('notify-only');
    expect(resolveUpdateDelivery({ platform: 'darwin', macCodeSigned: false })).toBe('notify-only');
  });

  it('서명·공증을 붙인 macOS 는 auto-install 로 승격된다', () => {
    expect(resolveUpdateDelivery({ platform: 'darwin', macCodeSigned: true })).toBe('auto-install');
  });

  it('Windows 는 무서명이어도 auto-install (publisherName 검증이 선택이라 건너뛴다)', () => {
    expect(resolveUpdateDelivery({ platform: 'win32' })).toBe('auto-install');
    expect(resolveUpdateDelivery({ platform: 'win32', macCodeSigned: false })).toBe('auto-install');
  });

  it('Linux 는 auto-install', () => {
    expect(resolveUpdateDelivery({ platform: 'linux' })).toBe('auto-install');
  });

  it('macCodeSigned 는 macOS 판정에만 영향을 준다 (win/linux 는 값과 무관하게 동일)', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(resolveUpdateDelivery({ platform, macCodeSigned: true })).toBe(
        resolveUpdateDelivery({ platform, macCodeSigned: false }),
      );
    }
  });

  it('모르는 플랫폼은 auto-install (darwin 만 특별 취급한다)', () => {
    expect(resolveUpdateDelivery({ platform: 'freebsd' })).toBe('auto-install');
    expect(resolveUpdateDelivery({ platform: '' })).toBe('auto-install');
  });
});

describe('releasesPageUrl — notify-only 에서 열 주소', () => {
  it('버전이 없으면 latest 로 보낸다', () => {
    expect(releasesPageUrl()).toBe(`${RELEASES_PAGE_BASE}/latest`);
    expect(releasesPageUrl(undefined)).toBe(`${RELEASES_PAGE_BASE}/latest`);
    expect(releasesPageUrl(null)).toBe(`${RELEASES_PAGE_BASE}/latest`);
    expect(releasesPageUrl('   ')).toBe(`${RELEASES_PAGE_BASE}/latest`);
  });

  it('버전을 주면 그 태그로 보낸다', () => {
    expect(releasesPageUrl('0.1.12')).toBe(`${RELEASES_PAGE_BASE}/tag/v0.1.12`);
  });

  it('이미 v 가 붙은 버전에 v 를 겹쳐 붙이지 않는다', () => {
    expect(releasesPageUrl('v0.1.12')).toBe(`${RELEASES_PAGE_BASE}/tag/v0.1.12`);
  });

  it('앞뒤 공백은 다듬는다', () => {
    expect(releasesPageUrl('  0.1.12  ')).toBe(`${RELEASES_PAGE_BASE}/tag/v0.1.12`);
  });
});

describe('readUpdateDelivery — 하위 호환 폴백', () => {
  it('미설정이면 auto-install 로 읽는다 (구버전 main 이 보낸 상태와의 호환)', () => {
    expect(readUpdateDelivery(undefined)).toBe('auto-install');
  });

  it('실린 값은 그대로 존중한다', () => {
    expect(readUpdateDelivery('notify-only')).toBe('notify-only');
    expect(readUpdateDelivery('auto-install')).toBe('auto-install');
  });
});

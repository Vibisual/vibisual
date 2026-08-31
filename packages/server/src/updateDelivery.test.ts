import { describe, it, expect } from 'vitest';
import {
  resolveUpdateDelivery,
  releasesPageUrl,
  readUpdateDelivery,
  RELEASES_PAGE_BASE,
  macUpdateAssetName,
  macUpdateAssetUrl,
  RELEASES_DOWNLOAD_BASE,
} from '@vibisual/shared';

// shared 의 순수 판정 로직은 server 테스트에서 검증한다(pathCase.test.ts·keyedSliceDelta.test.ts 선례).
//
// 이 파일의 존재 이유: 우리에게는 mac·linux 실기가 없다. `resolveUpdateDelivery` 가
// `process.platform` 을 직접 읽지 않고 **인자로 받게** 만든 덕분에, Windows 개발기 한 대에서
// 세 OS 판정을 전부 확인할 수 있다(CLAUDE.md 멀티플랫폼 규칙).

describe('resolveUpdateDelivery — 플랫폼별 업데이트 전달 방식', () => {
  it('무서명 macOS 는 self-install (Squirrel 을 타지 않고 우리가 직접 받아 직접 교체한다)', () => {
    expect(resolveUpdateDelivery({ platform: 'darwin' })).toBe('self-install');
    expect(resolveUpdateDelivery({ platform: 'darwin', macCodeSigned: false })).toBe('self-install');
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

describe('releasesPageUrl — self-install 이 실패했을 때 복구 손잡이가 열 주소', () => {
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
    expect(readUpdateDelivery('self-install')).toBe('self-install');
    expect(readUpdateDelivery('auto-install')).toBe('auto-install');
  });
});

// ── 받을 파일은 우리가 고른다 ───────────────────────────────────────────────
// `latest-mac.yml` 을 쓰지 않는 이유가 여기 걸려 있다: 두 mac 잡이 같은 이름의 피드를 각자
// 올려 서로 덮으므로 발행된 피드에는 한쪽 아키텍처만 남는다(실측: v0.1.14 에 arm64 없음).
describe('macUpdateAssetName — 아키텍처별 dmg 이름 규약', () => {
  it('arm64 는 -arm64 접미사, x64 는 접미사가 없다 (electron-builder 기본값과 짝)', () => {
    expect(macUpdateAssetName('0.1.15', 'arm64')).toBe('Vibisual-0.1.15-arm64.dmg');
    expect(macUpdateAssetName('0.1.15', 'x64')).toBe('Vibisual-0.1.15.dmg');
  });

  it('앞의 v 와 공백을 다듬는다 (태그 이름을 그대로 넘겨도 된다)', () => {
    expect(macUpdateAssetName('v0.1.15', 'arm64')).toBe('Vibisual-0.1.15-arm64.dmg');
    expect(macUpdateAssetName('  0.1.15 ', 'x64')).toBe('Vibisual-0.1.15.dmg');
  });

  it('두 아키텍처의 이름이 절대 같아질 수 없다 (같으면 한쪽이 다른 쪽을 받는다)', () => {
    expect(macUpdateAssetName('0.1.15', 'arm64')).not.toBe(macUpdateAssetName('0.1.15', 'x64'));
  });
});

describe('macUpdateAssetUrl — 그 dmg 의 다운로드 주소', () => {
  it('릴리스 태그 경로 아래로 간다', () => {
    expect(macUpdateAssetUrl('0.1.15', 'arm64')).toBe(
      `${RELEASES_DOWNLOAD_BASE}/v0.1.15/Vibisual-0.1.15-arm64.dmg`,
    );
  });

  it('v 를 겹쳐 붙이지 않는다', () => {
    expect(macUpdateAssetUrl('v0.1.15', 'x64')).toBe(
      `${RELEASES_DOWNLOAD_BASE}/v0.1.15/Vibisual-0.1.15.dmg`,
    );
  });
});

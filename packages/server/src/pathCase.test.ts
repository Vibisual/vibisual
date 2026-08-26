import { describe, it, expect } from 'vitest';
import {
  isCaseInsensitiveFs,
  normalizePathShape,
  pathKey,
  legacyLowerPathKey,
  lookupByPath,
  samePath,
} from '@vibisual/shared';

/**
 * 경로 대소문자 정책(`shared/src/pathCase.ts`)의 회귀 고정.
 *
 * 이 파일이 지키는 것은 한 문장이다 — **Linux 에서는 경로를 소문자로 접으면 안 된다.**
 * 접으면 `Feature-X` 와 `feature-x` 라는 실재하는 두 디렉터리가 한 Map 키로 뭉개져
 * 프로젝트 그래프·탭 목록·두뇌 설정이 에러 없이 섞인다.
 *
 * shared 패키지에는 테스트 러너가 없어서(빌드 전용) 여기 server 쪽에 둔다 —
 * `keyedSliceDelta.test.ts` 와 같은 선례다.
 */
describe('isCaseInsensitiveFs', () => {
  it('win32·darwin 은 대소문자를 가리지 않는 파일시스템으로 본다', () => {
    expect(isCaseInsensitiveFs('win32')).toBe(true);
    expect(isCaseInsensitiveFs('darwin')).toBe(true);
  });

  it('linux 및 그 밖의 POSIX 는 대소문자를 구분한다', () => {
    expect(isCaseInsensitiveFs('linux')).toBe(false);
    expect(isCaseInsensitiveFs('freebsd')).toBe(false);
    expect(isCaseInsensitiveFs('openbsd')).toBe(false);
  });
});

describe('normalizePathShape — 케이스는 건드리지 않는다', () => {
  it('backslash 를 슬래시로 바꾸고 끝 슬래시를 뗀다', () => {
    expect(normalizePathShape('C:\\Repos\\app\\proj\\')).toBe('C:/Repos/app/proj');
    expect(normalizePathShape('/repos/app/proj/')).toBe('/repos/app/proj');
  });

  it('연속 슬래시를 축약한다', () => {
    expect(normalizePathShape('C:\\\\Repos\\\\app')).toBe('C:/Repos/app');
    expect(normalizePathShape('/repos//app///proj')).toBe('/repos/app/proj');
  });

  it('대소문자를 절대 바꾸지 않는다', () => {
    expect(normalizePathShape('/repos/app/Feature-X')).toBe('/repos/app/Feature-X');
  });

  it('루트·드라이브루트·UNC 의 의미를 잃지 않는다', () => {
    expect(normalizePathShape('/')).toBe('/');
    // `C:` 로 떨어지면 Windows 에서 "C 드라이브의 현재 디렉터리"라는 다른 뜻이 된다.
    expect(normalizePathShape('C:/')).toBe('C:/');
    expect(normalizePathShape('C:\\')).toBe('C:/');
    // UNC 의 선행 이중 슬래시를 축약하면 루트 절대경로와 구분되지 않는다.
    expect(normalizePathShape('\\\\server\\share\\dir')).toBe('//server/share/dir');
  });
});

describe('pathKey — 플랫폼별 케이스 정책', () => {
  const upper = 'C:/Repos/app/Feature-X';
  const lower = 'c:/repos/app/feature-x';

  it('win32 는 접는다 — 케이스만 다른 경로는 같은 키', () => {
    expect(pathKey(upper, 'win32')).toBe(pathKey(lower, 'win32'));
  });

  it('darwin 도 접는다 — 기본 APFS 볼륨이 대소문자를 무시한다', () => {
    expect(pathKey(upper, 'darwin')).toBe(pathKey(lower, 'darwin'));
  });

  it('linux 는 접지 않는다 — 케이스만 다른 경로는 서로 다른 키', () => {
    const a = pathKey('/repos/app/Feature-X', 'linux');
    const b = pathKey('/repos/app/feature-x', 'linux');
    expect(a).not.toBe(b);
    expect(a).toBe('/repos/app/Feature-X');
  });

  it('구분자·끝 슬래시 차이는 어느 플랫폼에서든 같은 키로 만든다', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(pathKey('/repos/app/proj/', platform)).toBe(pathKey('/repos/app/proj', platform));
    }
    expect(pathKey('C:\\p\\q', 'win32')).toBe(pathKey('C:/p/q', 'win32'));
  });
});

describe('samePath', () => {
  it('linux 에서 케이스가 다르면 다른 경로다', () => {
    expect(samePath('/a/B', '/a/b', 'linux')).toBe(false);
    expect(samePath('/a/B', '/a/B', 'linux')).toBe(true);
  });

  it('win32·darwin 에서는 케이스가 달라도 같은 경로다', () => {
    expect(samePath('/a/B', '/a/b', 'win32')).toBe(true);
    expect(samePath('/a/B', '/a/b', 'darwin')).toBe(true);
  });
});

describe('legacyLowerPathKey / lookupByPath — 기존 사용자 저장분 하위호환', () => {
  it('예전 키는 플랫폼과 무관하게 무조건 소문자다', () => {
    expect(legacyLowerPathKey('/repos/app/Feature-X')).toBe('/repos/app/feature-x');
    expect(legacyLowerPathKey('C:\\Repos\\APP\\Proj\\')).toBe('c:/repos/app/proj');
  });

  it('linux 에서 예전 소문자 키로 저장된 값을 여전히 읽어낸다 (업그레이드 시 상태 소실 방지)', () => {
    // 업그레이드 이전 버전이 남긴 저장분 — 키가 소문자로 적혀 있다.
    const persisted: Record<string, string> = { '/repos/app/feature-x': '두뇌 설정' };
    // 새 코드는 원래 케이스로 조회하지만, 폴백 덕에 값을 찾는다.
    expect(lookupByPath(persisted, '/repos/app/Feature-X', 'linux')).toBe('두뇌 설정');
  });

  it('새 키로 저장된 값이 있으면 그쪽을 먼저 쓴다', () => {
    const persisted: Record<string, string> = {
      '/repos/app/Feature-X': '새 값',
      '/repos/app/feature-x': '예전 값',
    };
    expect(lookupByPath(persisted, '/repos/app/Feature-X', 'linux')).toBe('새 값');
  });

  it('Map 도 Record 와 똑같이 다룬다', () => {
    const m = new Map<string, number>([['/repos/app/proj', 7]]);
    expect(lookupByPath(m, '/repos/app/proj/', 'linux')).toBe(7);
  });

  it('없는 경로는 undefined', () => {
    expect(lookupByPath({}, '/nope', 'linux')).toBeUndefined();
  });
});

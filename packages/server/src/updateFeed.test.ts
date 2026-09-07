import { describe, expect, it } from 'vitest';
import { resolveUpdateFeed, updateFeedFileName } from '@vibisual/shared';

// shared 의 순수 판정 로직은 server 테스트에서 검증한다(updateDelivery.test.ts 선례).

/**
 * 업데이트 피드는 "다음에 무엇을 설치할지"를 정하는 채널이라, 여기서 잘못 고르면 대가가
 * 업데이트 실패(가벼움)부터 엉뚱한 것을 설치(무거움)까지 벌어진다. 그래서 판정을 순수
 * 함수로 떼어 두고 네 가지 실패 모양을 전부 여기서 잠근다 — 실기(세 OS · 죽은 프록시)를
 * 갖추지 않고도 재는 유일한 방법이다.
 */
describe('resolveUpdateFeed — 기본은 GitHub, 프록시는 조건이 맞을 때만', () => {
  it('비어 있으면 아무것도 하지 않는다 (배포 전 기본값 = 오늘 동작 그대로)', () => {
    expect(resolveUpdateFeed({})).toEqual({ kind: 'default', reason: 'not-configured' });
    expect(resolveUpdateFeed({ configured: '' })).toEqual({ kind: 'default', reason: 'not-configured' });
    // 공백만 있는 값도 "안 적은 것"이다 — 이걸 URL 로 받으면 파싱 실패로 얼굴이 바뀐다.
    expect(resolveUpdateFeed({ configured: '   ' })).toEqual({ kind: 'default', reason: 'not-configured' });
  });

  it('실행 시 덮어쓴 값이 빌드에 박힌 값을 이긴다', () => {
    const choice = resolveUpdateFeed({
      configured: 'https://baked.example',
      override: 'https://override.example',
    });
    expect(choice).toEqual({ kind: 'generic', url: 'https://override.example' });
  });

  it('평문 http 는 거절한다 (중간에서 yml 을 바꾸면 sha512 검사가 무력해진다)', () => {
    expect(resolveUpdateFeed({ configured: 'http://update.example' })).toEqual({
      kind: 'default',
      reason: 'insecure',
    });
  });

  it('loopback 은 예외 — 프록시를 손으로 시험하는 자리다', () => {
    expect(resolveUpdateFeed({ configured: 'http://127.0.0.1:8787' })).toEqual({
      kind: 'generic',
      url: 'http://127.0.0.1:8787',
    });
    expect(resolveUpdateFeed({ configured: 'http://localhost:8787' })).toEqual({
      kind: 'generic',
      url: 'http://localhost:8787',
    });
  });

  it('URL 이 아니면 거절한다', () => {
    expect(resolveUpdateFeed({ configured: 'update.example' })).toEqual({
      kind: 'default',
      reason: 'invalid',
    });
  });

  it('닿지 않으면 GitHub 으로 되돌아간다 (프록시가 죽어도 업데이트는 계속돼야 한다)', () => {
    expect(resolveUpdateFeed({ configured: 'https://update.example', reachable: false })).toEqual({
      kind: 'default',
      reason: 'unreachable',
    });
    // 확인하지 않은 상태(undefined)는 거절이 아니다 — 확인 전 1차 판정에서 쓰인다.
    expect(resolveUpdateFeed({ configured: 'https://update.example' })).toEqual({
      kind: 'generic',
      url: 'https://update.example',
    });
  });

  it('뒤 슬래시를 떼어 `<base>/latest.yml` 조립이 한 가지 모양이 되게 한다', () => {
    expect(resolveUpdateFeed({ configured: 'https://update.example/' })).toEqual({
      kind: 'generic',
      url: 'https://update.example',
    });
    expect(resolveUpdateFeed({ configured: 'https://update.example/feed//' })).toEqual({
      kind: 'generic',
      url: 'https://update.example/feed',
    });
  });
});

describe('updateFeedFileName — 플랫폼은 인자로 받는다', () => {
  it('세 플랫폼이 electron-builder 가 올리는 이름과 짝이다', () => {
    expect(updateFeedFileName('win32')).toBe('latest.yml');
    expect(updateFeedFileName('darwin')).toBe('latest-mac.yml');
    expect(updateFeedFileName('linux')).toBe('latest-linux.yml');
  });

  it('모르는 플랫폼은 linux 규약으로 떨어진다 (electron-builder 와 같은 취급)', () => {
    expect(updateFeedFileName('freebsd')).toBe('latest-linux.yml');
  });
});

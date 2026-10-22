/**
 * §5.23 「더블클릭」 · §7.11 — "로컬 프리뷰냐 인터넷 페이지냐" 판정을 못 박는다.
 *
 *  1. shared `isLocalPreviewHost` 는 서버 iframe 프록시의 SSRF 가드(`isAllowedProxyHost`)와 **같은 답**을 낸다 —
 *     어긋나면 클라가 프록시로 보낸 주소를 서버가 403 으로 돌려보내거나, 로컬 화면이 다리 없이 웹뷰로 뜬다.
 *     호스트는 실제 쓰임과 같게 WHATWG `URL` 을 한 번 지나 정규화한 값으로 견준다.
 *  2. `isRemoteWebUrl` — http(s) + 공인 호스트만 인터넷 페이지다. 못 읽는 주소·다른 스킴은 아니다.
 *
 * 러너가 shared 에 없으므로 여기 둔다(`webToolEntry.test.ts` 와 같은 자리).
 */
import { describe, it, expect } from 'vitest';
import { isHttpUrl, isLocalPreviewHost, isRemoteWebUrl } from '@vibisual/shared';
import { isAllowedProxyHost } from './iframeProxy.js';

/** 주소창에 적힐 법한 호스트 표기들 — 정규화 전 모양 그대로. */
const HOSTS = [
  'localhost',
  'LOCALHOST',
  '127.0.0.1',
  '127.1',
  '0x7f.0.0.1',
  '2130706433',
  '127.255.255.254',
  '10.0.0.5',
  '172.16.0.1',
  '172.31.255.255',
  '172.15.0.1',
  '172.32.0.1',
  '192.168.0.10',
  '192.169.0.10',
  '169.254.169.254',
  '0.0.0.0',
  '8.8.8.8',
  '[::1]',
  '[::ffff:127.0.0.1]',
  '[::ffff:8.8.8.8]',
  '[fe80::1]',
  '[2001:db8::1]',
  'rustfoundation.org',
  'docs.rs',
  'github.com',
  'localhost.example.com',
  'my-dev-box',
  'web-search',
];

function hostnameOf(host: string): string {
  return new URL(`http://${host}/`).hostname;
}

describe('§5.23 로컬 프리뷰 판정 — 서버 프록시 가드와 같은 답', () => {
  for (const host of HOSTS) {
    it(`${host}`, () => {
      const h = hostnameOf(host);
      expect(isLocalPreviewHost(h)).toBe(isAllowedProxyHost(h));
    });
  }

  it('루프백·사설은 로컬, 공인·링크로컬·이름은 아니다', () => {
    expect(isLocalPreviewHost(hostnameOf('localhost'))).toBe(true);
    expect(isLocalPreviewHost(hostnameOf('0x7f.1'))).toBe(true);
    expect(isLocalPreviewHost(hostnameOf('[::1]'))).toBe(true);
    expect(isLocalPreviewHost(hostnameOf('192.168.1.2'))).toBe(true);
    expect(isLocalPreviewHost(hostnameOf('169.254.169.254'))).toBe(false);
    expect(isLocalPreviewHost(hostnameOf('8.8.8.8'))).toBe(false);
    expect(isLocalPreviewHost(hostnameOf('rustfoundation.org'))).toBe(false);
  });
});

describe('§5.23 인터넷 페이지 판정', () => {
  it('공인 http(s) 주소는 인터넷 페이지다', () => {
    expect(isRemoteWebUrl('https://rustfoundation.org/')).toBe(true);
    expect(isRemoteWebUrl('http://example.com/a?b=c#d')).toBe(true);
    expect(isRemoteWebUrl('https://8.8.8.8/')).toBe(true);
  });

  it('로컬 프리뷰 주소는 아니다', () => {
    expect(isRemoteWebUrl('http://localhost:5173/')).toBe(false);
    expect(isRemoteWebUrl('http://127.0.0.1:3456/app')).toBe(false);
    expect(isRemoteWebUrl('http://[::1]:8080/')).toBe(false);
    expect(isRemoteWebUrl('http://192.168.0.7:3000/')).toBe(false);
  });

  it('못 읽는 주소·다른 스킴은 아니다(넘겨짚지 않는다)', () => {
    expect(isRemoteWebUrl('')).toBe(false);
    expect(isRemoteWebUrl('not a url')).toBe(false);
    expect(isRemoteWebUrl('/api/workspace-site/x/index.html')).toBe(false);
    expect(isRemoteWebUrl('file:///C:/a.html')).toBe(false);
    expect(isRemoteWebUrl('vibproxy://proxy/iframe-proxy/localhost:5173/')).toBe(false);
    expect(isRemoteWebUrl('javascript:alert(1)')).toBe(false);
    expect(isRemoteWebUrl('ftp://example.com/')).toBe(false);
  });

  it('isHttpUrl 은 스킴만 본다(로컬이어도 http(s) 면 참)', () => {
    expect(isHttpUrl('http://localhost:5173/')).toBe(true);
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('mailto:a@b.c')).toBe(false);
    expect(isHttpUrl('about:blank')).toBe(false);
  });
});

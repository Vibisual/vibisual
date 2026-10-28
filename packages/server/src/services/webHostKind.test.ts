/** §5.23 — 사이트(`webSiteOf`)·종류(`webKindOfHost`·`webKindOfSite`) 판정(shared `webHostKind.ts`) 고정. 모르면 지어내지 않는다(`undefined`). */
import { describe, it, expect } from 'vitest';
import { WEB_SEARCH_HOST, webKindOfHost, webKindOfSite, webKindOfUrl, webSiteOf } from '@vibisual/shared';

describe('§5.23 (A) webSiteOf — 사이트', () => {
  it('끝 두 칸이 사이트다', () => {
    expect(webSiteOf('docs.github.com')).toBe('github.com');
    expect(webSiteOf('www.npmjs.com')).toBe('npmjs.com');
    expect(webSiteOf('github.com')).toBe('github.com');
    expect(webSiteOf('a.b.c.example.org')).toBe('example.org');
  });

  it('나라별 두 칸 접미사는 한 칸 더 붙인다', () => {
    expect(webSiteOf('bbc.co.uk')).toBe('bbc.co.uk');
    expect(webSiteOf('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(webSiteOf('blog.example.co.kr')).toBe('example.co.kr');
    expect(webSiteOf('co.uk')).toBe('co.uk');
  });

  it('칸마다 주인이 다른 호스팅은 그 칸까지가 사이트다 — 다른 사람의 페이지가 한 사이트로 묶이지 않게', () => {
    expect(webSiteOf('alice.github.io')).toBe('alice.github.io');
    expect(webSiteOf('docs.alice.github.io')).toBe('alice.github.io');
    expect(webSiteOf('my-app.vercel.app')).toBe('my-app.vercel.app');
    expect(webSiteOf('alice.github.io')).not.toBe(webSiteOf('bob.github.io'));
  });

  it('IP·localhost·한 칸 이름·검색 의사 호스트는 그 자체가 사이트다', () => {
    expect(webSiteOf('127.0.0.1')).toBe('127.0.0.1');
    expect(webSiteOf('[::1]')).toBe('[::1]');
    expect(webSiteOf('localhost')).toBe('localhost');
    expect(webSiteOf(WEB_SEARCH_HOST)).toBe(WEB_SEARCH_HOST);
  });

  it('대소문자와 끝 점을 접는다', () => {
    expect(webSiteOf('Docs.GitHub.com.')).toBe('github.com');
  });
});

describe('§5.23 (B) webKindOfHost — 종류', () => {
  it('검색 의사 호스트는 검색이다', () => {
    expect(webKindOfHost(WEB_SEARCH_HOST)).toBe('search');
  });

  it('호스트 그대로 표가 먼저다 — 같은 사이트라도 하는 일이 다르다', () => {
    expect(webKindOfHost('pkg.go.dev')).toBe('package');
    expect(webKindOfHost('go.dev')).toBe('docs');
    expect(webKindOfHost('news.ycombinator.com')).toBe('qa');
  });

  it('검색 엔진은 호스트로만 — 같은 사이트의 다른 호스트는 검색이 아니다', () => {
    expect(webKindOfHost('www.google.com')).toBe('search');
    expect(webKindOfHost('cloud.google.com', ['https://cloud.google.com/docs/run'])).toBe('docs');
    expect(webKindOfHost('cloud.google.com')).toBeUndefined();
  });

  it('하위 도메인 머리가 하는 일을 말한다 — 사이트 표보다 먼저', () => {
    expect(webKindOfHost('docs.github.com')).toBe('docs');
    expect(webKindOfHost('developer.mozilla.org')).toBe('docs');
    expect(webKindOfHost('blog.example.com')).toBe('article');
    expect(webKindOfHost('forum.example.com')).toBe('qa');
    expect(webKindOfHost('gist.github.com')).toBe('code');
    expect(webKindOfHost('raw.githubusercontent.com')).toBe('code');
  });

  it('`www` 는 머리로 치지 않는다', () => {
    expect(webKindOfHost('www.example.com')).toBeUndefined();
    expect(webKindOfHost('www.npmjs.com')).toBe('package');
  });

  it('머리가 말하지 않으면 사이트(와 그 위 접미사) 표를 따른다', () => {
    expect(webKindOfHost('en.wikipedia.org')).toBe('article');
    expect(webKindOfHost('github.com')).toBe('code');
    expect(webKindOfHost('electronjs.org')).toBe('docs');
    expect(webKindOfHost('stackoverflow.com')).toBe('qa');
    expect(webKindOfHost('www.youtube.com')).toBe('video');
    expect(webKindOfHost('www.w3.org')).toBe('spec');
    expect(webKindOfHost('myproject.readthedocs.io')).toBe('docs');
  });

  it('표에 없으면 읽은 주소의 경로 다수결 — 같은 수면 최근(앞) 주소를 따른다', () => {
    expect(webKindOfHost('unknown.example', [
      'https://unknown.example/docs/a', 'https://unknown.example/docs/b', 'https://unknown.example/blog/c',
    ])).toBe('docs');
    expect(webKindOfHost('unknown.example', ['https://unknown.example/blog/a', 'https://unknown.example/docs/b'])).toBe('article');
  });

  it('모르면 지어내지 않는다', () => {
    expect(webKindOfHost('unknown.example')).toBeUndefined();
    expect(webKindOfHost('unknown.example', ['https://unknown.example/about'])).toBeUndefined();
  });

  it('프로토타입 이름이 종류로 새지 않는다', () => {
    expect(webKindOfHost('constructor.example.com')).toBeUndefined();
    expect(webKindOfHost('tostring.example')).toBeUndefined();
  });
});

describe('§5.23 (B) webKindOfUrl — 주소 경로', () => {
  it('경로가 하는 일을 말한다', () => {
    expect(webKindOfUrl('https://example.com/docs/intro')).toBe('docs');
    expect(webKindOfUrl('https://nodejs.org/api/fs.html')).toBe('docs');
    expect(webKindOfUrl('https://react.dev/reference/react')).toBe('docs');
    expect(webKindOfUrl('https://react.dev/blog/2024/04/25')).toBe('article');
    expect(webKindOfUrl('https://example.com/questions/12/how')).toBe('qa');
    expect(webKindOfUrl('https://git.example.com/a/b/blob/main/x.ts')).toBe('code');
    expect(webKindOfUrl('https://example.com/package/left-pad')).toBe('package');
    expect(webKindOfUrl('https://example.com/watch')).toBe('video');
    expect(webKindOfUrl('https://example.com/rfc/9110')).toBe('spec');
  });

  it('`/TR/` 는 대문자만 표준이다 — `/tr/` 는 터키어 로케일 경로다', () => {
    expect(webKindOfUrl('https://www.w3.org/TR/css-grid-1/')).toBe('spec');
    expect(webKindOfUrl('https://example.com/tr/docs/x')).toBe('docs');
    expect(webKindOfUrl('https://example.com/tr/about')).toBeUndefined();
  });

  it('http(s) 가 아니거나 깨진 주소는 모른다', () => {
    expect(webKindOfUrl('ftp://example.com/docs/x')).toBeUndefined();
    expect(webKindOfUrl('not a url')).toBeUndefined();
  });
});

describe('§5.23 (B) webKindOfSite — 같은 사이트 묶음의 종류', () => {
  it('사이트가 표에 있으면 그것이다 — github.com 안의 docs.github.com 도 코드 묶음에 든다', () => {
    expect(webKindOfSite('github.com', [{ host: 'docs.github.com' }, { host: 'github.com' }])).toBe('code');
  });

  it('표에 없으면 구성원 다수결 — 호스트 표(검색 엔진)는 사이트에 쓰지 않는다', () => {
    expect(webKindOfSite('google.com', [
      { host: 'www.google.com' },
      { host: 'cloud.google.com', urls: ['https://cloud.google.com/docs/run'] },
      { host: 'developers.google.com' },
    ])).toBe('docs');
  });

  it('검색 의사 호스트는 사이트로도 검색이다', () => {
    expect(webKindOfSite(WEB_SEARCH_HOST, [{ host: WEB_SEARCH_HOST }])).toBe('search');
  });
});

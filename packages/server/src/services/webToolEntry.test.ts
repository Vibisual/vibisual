/**
 * webToolEntry.test.ts — §5.23 도메인 버블 추출기.
 *
 * 추출기는 shared 순수 함수지만 shared 패키지에는 러너가 없으므로(`bashWritePaths.test.ts` 와
 * 같은 자리에서 돌린다) 여기서 고정한다.
 *
 * 지키는 것은 하나다 — **모르는 것을 도메인으로 넘겨짚지 않는다.** 오탐 하나가 디스크에 없는
 * 가짜 버블을 만들고, 그 버블은 존재 확인 스윕이 걷어 주지도 못한다(§5.23).
 */
import { describe, it, expect } from 'vitest';
import {
  webNodeKey,
  webHostFromNodeKey,
  webHostFromUrl,
  clampWebText,
  readWebResponseText,
  readWebResponseError,
  extractResultHosts,
  extractResultCount,
  extractWebEntry,
  WEB_SEARCH_HOST,
} from '@vibisual/shared';

describe('webHostFromUrl — 화이트리스트 밖은 버린다', () => {
  it('http/https 호스트를 뽑는다', () => {
    expect(webHostFromUrl('https://github.com/a/b?q=1')).toBe('github.com');
    expect(webHostFromUrl('http://example.org')).toBe('example.org');
  });

  it('선행 www. 를 뗀다 — 안 떼면 같은 사이트가 버블 둘로 갈린다', () => {
    expect(webHostFromUrl('https://www.example.com/x')).toBe('example.com');
  });

  it('포트는 남긴다 — 다른 포트는 다른 서버다', () => {
    expect(webHostFromUrl('http://localhost:5173/')).toBe('localhost:5173');
  });

  it('대소문자를 접는다', () => {
    expect(webHostFromUrl('https://GitHub.COM/x')).toBe('github.com');
  });

  it('스킴이 없으면 https 로 보정한다', () => {
    expect(webHostFromUrl('example.com/docs')).toBe('example.com');
  });

  it('http/https 가 아니면 버린다', () => {
    expect(webHostFromUrl('file:///c:/tmp/x.html')).toBeNull();
    expect(webHostFromUrl('data:text/html,<b>x</b>')).toBeNull();
    expect(webHostFromUrl('ftp://example.com/f')).toBeNull();
  });

  it('빈 값·파싱 실패는 버린다', () => {
    expect(webHostFromUrl('')).toBeNull();
    expect(webHostFromUrl('   ')).toBeNull();
    expect(webHostFromUrl('https://')).toBeNull();
    expect(webHostFromUrl(undefined as unknown as string)).toBeNull();
  });
});

describe('노드 키 — 조립과 해체가 짝이다', () => {
  it('왕복한다', () => {
    expect(webHostFromNodeKey(webNodeKey('github.com'))).toBe('github.com');
  });
  it('우리 키가 아니면 null', () => {
    expect(webHostFromNodeKey('packages/shared/src/x.ts')).toBeNull();
    expect(webHostFromNodeKey('__ext__/c/tmp')).toBeNull();
    expect(webHostFromNodeKey('__web__')).toBeNull();
  });
});

describe('clampWebText — 자르고, 잘렸는지 말한다', () => {
  it('상한 안이면 그대로', () => {
    expect(clampWebText('hello', 10)).toEqual({ text: 'hello' });
  });
  it('넘치면 자르고 표시한다', () => {
    expect(clampWebText('abcdefghij', 4)).toEqual({ text: 'abcd', truncated: true });
  });
  it('문자열이 아니거나 비면 아무것도 안 준다 — 빈 문자열로 채우지 않는다', () => {
    expect(clampWebText(undefined)).toEqual({});
    expect(clampWebText('   ')).toEqual({});
    expect(clampWebText(42)).toEqual({});
  });
});

describe('readWebResponseText — 판본마다 다른 모양을 넓게 받는다', () => {
  it('content 배열', () => {
    expect(readWebResponseText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }))
      .toBe('a\nb');
  });
  it('content 문자열', () => {
    expect(readWebResponseText({ content: 'plain' })).toBe('plain');
  });
  it('result / output 폴백', () => {
    expect(readWebResponseText({ result: 'r' })).toBe('r');
    expect(readWebResponseText({ output: 'o' })).toBe('o');
  });
  it('통짜 문자열', () => {
    expect(readWebResponseText('raw')).toBe('raw');
  });
  it('못 뽑으면 빈 문자열', () => {
    expect(readWebResponseText(undefined)).toBe('');
    expect(readWebResponseText({ nothing: 1 })).toBe('');
  });
});

describe('readWebResponseError — 성공이었다고 넘겨짚지 않는다', () => {
  it('error 필드', () => {
    expect(readWebResponseError({ error: 'blocked' })).toBe('blocked');
  });
  it('is_error 플래그면 본문을 사유로', () => {
    expect(readWebResponseError({ is_error: true, content: '404 Not Found' })).toBe('404 Not Found');
  });
  it('없으면 undefined', () => {
    expect(readWebResponseError({ content: 'ok' })).toBeUndefined();
    expect(readWebResponseError(undefined)).toBeUndefined();
  });
});

describe('결과 호스트·건수', () => {
  const text = 'see https://a.com/x and https://b.org/y and https://a.com/z';

  it('중복 없이 뽑는다', () => {
    expect(extractResultHosts(text)).toEqual(['a.com', 'b.org']);
  });
  it('상한까지만', () => {
    expect(extractResultHosts(text, 1)).toEqual(['a.com']);
  });
  it('명시 필드가 있으면 그것을 쓴다', () => {
    expect(extractResultCount({ resultCount: 7 }, text)).toBe(7);
    expect(extractResultCount({ results: [1, 2, 3] }, text)).toBe(3);
  });
  it('없으면 본문의 고유 URL 수로 근사한다', () => {
    expect(extractResultCount({}, text)).toBe(3);
  });
  it('셀 수 없으면 undefined — 0 으로 채우면 "결과가 없었다"는 거짓말이 된다', () => {
    expect(extractResultCount({}, '')).toBeUndefined();
  });
});

describe('extractWebEntry', () => {
  const NOW = 1_700_000_000_000;

  it('우리 축이 아닌 도구는 null', () => {
    expect(extractWebEntry('Read', { file_path: '/a' }, {}, NOW)).toBeNull();
    expect(extractWebEntry('Bash', { command: 'ls' }, {}, NOW)).toBeNull();
  });

  it('WebFetch — 호스트는 버블, URL 전문은 항목에', () => {
    const got = extractWebEntry(
      'WebFetch',
      { url: 'https://www.example.com/docs/a?x=1', prompt: 'what is a' },
      { content: [{ type: 'text', text: 'answer body' }] },
      NOW,
      'seed',
    );
    expect(got?.host).toBe('example.com');
    expect(got?.entry.kind).toBe('fetch');
    expect(got?.entry.url).toBe('https://www.example.com/docs/a?x=1');
    expect(got?.entry.prompt).toBe('what is a');
    expect(got?.entry.result).toBe('answer body');
    expect(got?.entry.at).toBe(NOW);
  });

  it('WebFetch — 호스트를 못 세우면 버블도 항목도 안 만든다', () => {
    expect(extractWebEntry('WebFetch', { url: 'file:///c:/x.html' }, {}, NOW)).toBeNull();
    expect(extractWebEntry('WebFetch', {}, {}, NOW)).toBeNull();
  });

  it('WebSearch — 의사 호스트 한 칸에 모은다(결과 도메인으로 버블 ❌)', () => {
    const got = extractWebEntry(
      'WebSearch',
      { query: 'vibisual vde' },
      { content: 'see https://a.com/1 and https://b.org/2' },
      NOW,
      'seed',
    );
    expect(got?.host).toBe(WEB_SEARCH_HOST);
    expect(got?.entry.kind).toBe('search');
    expect(got?.entry.query).toBe('vibisual vde');
    expect(got?.entry.resultHosts).toEqual(['a.com', 'b.org']);
    expect(got?.entry.resultCount).toBe(2);
  });

  it('WebSearch — 검색어가 없으면 줄만 늘리지 않는다', () => {
    expect(extractWebEntry('WebSearch', {}, { content: 'x' }, NOW)).toBeNull();
    expect(extractWebEntry('WebSearch', { query: '  ' }, { content: 'x' }, NOW)).toBeNull();
  });

  it('실패한 호출도 남긴다 — "왜 못 읽었나"가 정보다', () => {
    const got = extractWebEntry(
      'WebFetch',
      { url: 'https://example.com/x' },
      { error: 'blocked by robots.txt' },
      NOW,
    );
    expect(got?.host).toBe('example.com');
    expect(got?.entry.error).toBe('blocked by robots.txt');
  });

  it('결과를 못 읽으면 result 를 비운다 — 빈 문자열로 채우지 않는다', () => {
    const got = extractWebEntry('WebFetch', { url: 'https://example.com/x' }, undefined, NOW);
    expect(got?.entry.result).toBeUndefined();
    expect(got?.entry.resultTruncated).toBeUndefined();
  });

  it('같은 ms 라도 seed 가 다르면 id 가 갈린다', () => {
    const a = extractWebEntry('WebFetch', { url: 'https://e.com/1' }, {}, NOW, 'a');
    const b = extractWebEntry('WebFetch', { url: 'https://e.com/2' }, {}, NOW, 'b');
    expect(a?.entry.id).not.toBe(b?.entry.id);
  });
});

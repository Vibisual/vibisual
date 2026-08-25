import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildWebSearchUrl, normalizeQuery, openWebSearch, WEB_SEARCH_QUERY_LIMIT } from './webSearchUrl.js';

/**
 * §5.5 #17-3 (판올림 번호 발급 대기) — "웹에서 검색" 주소 조립 테스트.
 *
 * 우클릭 한 번으로 바깥 브라우저가 열리는 동작이라 화면으로 확인하기 번거롭다 — 무엇을 검색어로
 * 삼는지(공백 접기·상한·빈 선택)는 여기서 못 박는다.
 */

describe('normalizeQuery', () => {
  it('줄바꿈·연속 공백을 한 칸으로 접고 앞뒤를 다듬는다', () => {
    expect(normalizeQuery('  const  foo =\n  bar()  ')).toBe('const foo = bar()');
  });

  it('상한을 넘는 선택은 잘라낸다', () => {
    expect(normalizeQuery('a'.repeat(WEB_SEARCH_QUERY_LIMIT + 50))).toHaveLength(WEB_SEARCH_QUERY_LIMIT);
  });

  it('자른 끝에 걸린 공백은 남기지 않는다', () => {
    const long = `${'a'.repeat(WEB_SEARCH_QUERY_LIMIT - 1)} tail`;
    expect(normalizeQuery(long).endsWith('a')).toBe(true);
  });

  it('공백뿐이면 빈 문자열', () => {
    expect(normalizeQuery('  \n\t ')).toBe('');
  });
});

describe('buildWebSearchUrl', () => {
  it('검색어를 인코딩해 검색 주소를 만든다', () => {
    expect(buildWebSearchUrl('타입 오류 TS2345')).toBe(
      'https://www.google.com/search?q=' + encodeURIComponent('타입 오류 TS2345'),
    );
  });

  it('주소·따옴표 같은 글자도 그대로 담긴다(깨진 주소가 되지 않는다)', () => {
    const url = buildWebSearchUrl('"cannot find module" file:///c:/a&b?q=1');
    expect(url).not.toBeNull();
    expect(new URL(url!).searchParams.get('q')).toBe('"cannot find module" file:///c:/a&b?q=1');
  });

  it('고른 글자가 없으면 null — 빈 검색창을 띄우지 않는다', () => {
    expect(buildWebSearchUrl('')).toBeNull();
    expect(buildWebSearchUrl('   \n  ')).toBeNull();
  });
});

describe('openWebSearch', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('새 창(=Electron 이 기본 브라우저로 넘기는 그 길)으로 연다', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open } as unknown as Window & typeof globalThis);
    expect(openWebSearch('react flow  edge')).toBe(true);
    expect(open).toHaveBeenCalledWith(
      'https://www.google.com/search?q=' + encodeURIComponent('react flow edge'),
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('검색할 것이 없으면 창을 열지 않는다', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open } as unknown as Window & typeof globalThis);
    expect(openWebSearch('   ')).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

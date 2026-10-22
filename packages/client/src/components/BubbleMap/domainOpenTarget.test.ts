/**
 * §5.23 「더블클릭」 — 도메인 버블 더블클릭이 **어느 주소**를 여는가(순수 판정).
 *
 *  1. 그 버블에서 가장 최근 항목(`at`) — 목록 순서가 아니라 시각으로 고른다.
 *  2. 검색은 검색어로 만든 검색 주소(우클릭 [웹에서 검색]과 같은 함수), 탭 이름은 검색어.
 *  3. 묶인 버블은 구성원 호스트들의 항목 전체에서 고른다.
 *  4. 스킴 없는 가져오기 주소는 https 로 보정, http(s) 가 아닌 주소는 건너뛴다(그 다음으로 최근 것을 연다).
 *  5. 실패한 가져오기도 그 주소를 연다.
 *  6. 항목이 없으면 호스트의 첫 화면, 검색 버블뿐이면 열지 않는다(지어내지 않는다).
 */
import { describe, expect, it } from 'vitest';
import { WEB_SEARCH_HOST, webNodeKey, type BubbleData, type WebEntry, type WebFoldInfo } from '@vibisual/shared';
import { buildWebSearchUrl } from '../IDE/webSearchUrl.js';
import { domainOpenTarget, webEntryOpenTarget } from './domainOpenTarget.js';

function domain(id: string, host: string, webFold?: WebFoldInfo): Pick<BubbleData, 'id' | 'path' | 'webFold'> {
  return { id, path: webNodeKey(host), ...(webFold ? { webFold } : {}) };
}

function fetchEntry(id: string, at: number, url: string, extra: Partial<WebEntry> = {}): WebEntry {
  return { id, kind: 'fetch', url, at, ...extra };
}

function searchEntry(id: string, at: number, query: string): WebEntry {
  return { id, kind: 'search', query, at };
}

describe('webEntryOpenTarget — 항목 한 건', () => {
  it('가져오기는 그 주소, 탭 이름은 호스트', () => {
    expect(webEntryOpenTarget(fetchEntry('e1', 1, 'https://rustfoundation.org/policies/?x=1')))
      .toEqual({ url: 'https://rustfoundation.org/policies/?x=1', label: 'rustfoundation.org' });
  });

  it('검색은 검색어로 만든 검색 주소, 탭 이름은 검색어', () => {
    const target = webEntryOpenTarget(searchEntry('s1', 1, '  rust   foundation trademark '));
    expect(target).toEqual({ url: buildWebSearchUrl('rust foundation trademark'), label: 'rust foundation trademark' });
  });

  it('스킴 없는 주소는 https 로 보정한다(추출기와 같은 보정)', () => {
    expect(webEntryOpenTarget(fetchEntry('e1', 1, 'docs.rs/serde'))?.url).toBe('https://docs.rs/serde');
  });

  it('http(s) 가 아닌 주소·빈 주소·빈 검색어는 열지 않는다', () => {
    expect(webEntryOpenTarget(fetchEntry('e1', 1, 'ftp://example.com/a'))).toBeNull();
    expect(webEntryOpenTarget(fetchEntry('e2', 1, 'javascript:alert(1)'))).toBeNull();
    expect(webEntryOpenTarget(fetchEntry('e3', 1, '   '))).toBeNull();
    expect(webEntryOpenTarget({ id: 'e4', kind: 'fetch', at: 1 })).toBeNull();
    expect(webEntryOpenTarget(searchEntry('s1', 1, '   '))).toBeNull();
  });
});

describe('domainOpenTarget — 버블 하나', () => {
  it('목록 순서가 아니라 시각으로 가장 최근 항목을 고른다', () => {
    const data = domain('folder-1', 'rustfoundation.org');
    const entries = {
      'folder-1': [
        fetchEntry('old', 100, 'https://rustfoundation.org/old'),
        fetchEntry('new', 300, 'https://rustfoundation.org/new'),
        fetchEntry('mid', 200, 'https://rustfoundation.org/mid'),
      ],
    };
    expect(domainOpenTarget(data, entries)?.url).toBe('https://rustfoundation.org/new');
  });

  it('가장 최근 항목을 열 수 없으면 그 다음으로 최근 것을 연다', () => {
    const data = domain('folder-1', 'example.com');
    const entries = {
      'folder-1': [
        fetchEntry('bad', 300, 'ftp://example.com/x'),
        fetchEntry('ok', 200, 'https://example.com/ok'),
      ],
    };
    expect(domainOpenTarget(data, entries)?.url).toBe('https://example.com/ok');
  });

  it('실패한 가져오기도 그 주소를 연다(왜 못 읽었는지 직접 본다)', () => {
    const data = domain('folder-1', 'example.com');
    const entries = { 'folder-1': [fetchEntry('e1', 1, 'https://example.com/403', { error: 'HTTP 403' })] };
    expect(domainOpenTarget(data, entries)?.url).toBe('https://example.com/403');
  });

  it('검색 버블은 마지막 검색어의 검색 주소를 연다', () => {
    const data = domain('folder-search', WEB_SEARCH_HOST);
    const entries = {
      'folder-search': [searchEntry('s1', 10, 'serde derive'), searchEntry('s2', 20, 'tokio select')],
    };
    expect(domainOpenTarget(data, entries)).toEqual({ url: buildWebSearchUrl('tokio select'), label: 'tokio select' });
  });

  it('항목을 모두 지웠으면 그 호스트의 첫 화면을 연다', () => {
    expect(domainOpenTarget(domain('folder-1', 'rustfoundation.org'), {}))
      .toEqual({ url: 'https://rustfoundation.org/', label: 'rustfoundation.org' });
    expect(domainOpenTarget(domain('folder-1', 'localhost:5173'), { 'folder-1': [] })?.url)
      .toBe('https://localhost:5173/');
  });

  it('검색 버블에 항목이 없으면 열지 않는다(검색어를 지어내지 않는다)', () => {
    expect(domainOpenTarget(domain('folder-search', WEB_SEARCH_HOST), {})).toBeNull();
  });

  it('호스트를 모르는 노드는 첫 화면도 열지 않는다', () => {
    expect(domainOpenTarget({ id: 'x', path: 'not-a-web-key' }, {})).toBeNull();
  });
});

describe('domainOpenTarget — 묶인 버블', () => {
  const fold: WebFoldInfo = {
    agentId: 'agent-1',
    hosts: [
      { id: 'folder-gh', host: 'github.com', entryCount: 1, status: 'idle' },
      { id: 'folder-docs', host: 'docs.github.com', entryCount: 1, status: 'idle' },
      { id: 'folder-search', host: WEB_SEARCH_HOST, entryCount: 0, status: 'idle' },
    ],
  };
  const data = { id: 'webfold-agent-1~site~github.com', path: '__web__/agent-1', webFold: fold };

  it('구성원 호스트들의 항목 전체에서 가장 최근 것을 고른다', () => {
    const entries = {
      'folder-gh': [fetchEntry('a', 100, 'https://github.com/serde-rs/serde')],
      'folder-docs': [fetchEntry('b', 500, 'https://docs.github.com/en/actions')],
      'folder-search': [searchEntry('c', 300, 'serde')],
    };
    expect(domainOpenTarget(data, entries)).toEqual({ url: 'https://docs.github.com/en/actions', label: 'docs.github.com' });
  });

  it('구성원이 모두 비었으면 가장 최근 호스트(검색 의사 호스트 제외)의 첫 화면', () => {
    expect(domainOpenTarget(data, {})?.url).toBe('https://github.com/');
  });
});

/**
 * §5.23 — 도메인 버블 더블클릭이 어디서 여는가(배선만, 주소 판정은 `domainOpenTarget.test.ts`): 기본 `window.open`, 옵션이면 버블당 iframe 탭 하나,
 * iframe 탭 줄이 없는 창은 바깥 브라우저, 열 것이 없으면 아무것도 안 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEB_SEARCH_HOST, webNodeKey, type BubbleData, type WebEntry } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useWebOpenTargetStore } from '../../stores/webOpenTarget.js';
import { registerIframeTabHost } from '../../utils/iframeTabHost.js';
import { buildWebSearchUrl } from '../IDE/webSearchUrl.js';
import { openDomainBubble } from './openDomainBubble.js';

const DOMAIN = {
  id: 'folder-2526032125', label: 'rustfoundation.org', bubbleType: 'domain', path: webNodeKey('rustfoundation.org'),
  status: 'idle', activity: 1, lastActivity: 0, lastTool: 'WebFetch',
} as BubbleData;
const SEARCH = {
  id: 'folder-search', label: WEB_SEARCH_HOST, bubbleType: 'domain', path: webNodeKey(WEB_SEARCH_HOST),
  status: 'idle', activity: 1, lastActivity: 0, lastTool: 'WebSearch',
} as BubbleData;

function fetchEntry(id: string, at: number, url: string): WebEntry {
  return { id, kind: 'fetch', url, at };
}

let open: ReturnType<typeof vi.fn>;
let releaseHost: (() => void) | null = null;

beforeEach(() => {
  open = vi.fn();
  vi.stubGlobal('window', { open });
  useGraphStore.setState({
    iframeTabs: [],
    activeIframeId: null,
    domainEntries: { [DOMAIN.id]: [fetchEntry('e1', 100, 'https://rustfoundation.org/policies/')] },
  });
  useWebOpenTargetStore.setState({ target: 'external', loaded: true });
});

afterEach(() => {
  releaseHost?.();
  releaseHost = null;
  vi.unstubAllGlobals();
});

describe('openDomainBubble — 기본은 바깥 브라우저', () => {
  it('마지막 주소를 window.open 으로 연다(iframe 탭은 만들지 않는다)', () => {
    releaseHost = registerIframeTabHost();
    expect(openDomainBubble(DOMAIN)).toBe(true);
    expect(open).toHaveBeenCalledWith('https://rustfoundation.org/policies/', '_blank', 'noopener,noreferrer');
    expect(useGraphStore.getState().iframeTabs).toEqual([]);
  });

  it('검색 버블은 마지막 검색어의 검색 주소를 연다', () => {
    useGraphStore.setState({ domainEntries: { [SEARCH.id]: [{ id: 's1', kind: 'search', query: 'rust trademark', at: 5 }] } });
    expect(openDomainBubble(SEARCH)).toBe(true);
    expect(open).toHaveBeenCalledWith(buildWebSearchUrl('rust trademark'), '_blank', 'noopener,noreferrer');
  });

  it('열 것이 없으면 아무것도 하지 않는다', () => {
    useGraphStore.setState({ domainEntries: {} });
    expect(openDomainBubble(SEARCH)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('openDomainBubble — 옵션이 앱 안 iframe 탭', () => {
  beforeEach(() => {
    useWebOpenTargetStore.setState({ target: 'iframe', loaded: true });
  });

  it('버블마다 탭 하나를 열어 앞에 세운다', () => {
    releaseHost = registerIframeTabHost();
    expect(openDomainBubble(DOMAIN)).toBe(true);
    const s = useGraphStore.getState();
    expect(s.iframeTabs).toEqual([
      { id: `web-${DOMAIN.id}`, url: 'https://rustfoundation.org/policies/', label: 'rustfoundation.org', serverKind: 'frontend' },
    ]);
    expect(s.activeIframeId).toBe(`web-${DOMAIN.id}`);
    expect(open).not.toHaveBeenCalled();
  });

  it('다시 누르면 같은 탭이 그때의 마지막 주소·이름으로 옮겨 간다', () => {
    releaseHost = registerIframeTabHost();
    openDomainBubble(DOMAIN);
    useGraphStore.setState((s) => ({
      activeIframeId: null,
      domainEntries: {
        ...s.domainEntries,
        [DOMAIN.id]: [fetchEntry('e2', 200, 'https://www.rustfoundation.org/members/'), ...(s.domainEntries[DOMAIN.id] ?? [])],
      },
    }));
    openDomainBubble(DOMAIN);
    const s = useGraphStore.getState();
    expect(s.iframeTabs).toHaveLength(1);
    expect(s.iframeTabs[0]).toMatchObject({ url: 'https://www.rustfoundation.org/members/', label: 'www.rustfoundation.org' });
    expect(s.activeIframeId).toBe(`web-${DOMAIN.id}`);
  });

  it('iframe 탭 줄이 없는 창이면 바깥 브라우저로 연다(보이지 않는 탭을 만들지 않는다)', () => {
    expect(openDomainBubble(DOMAIN)).toBe(true);
    expect(useGraphStore.getState().iframeTabs).toEqual([]);
    expect(open).toHaveBeenCalledWith('https://rustfoundation.org/policies/', '_blank', 'noopener,noreferrer');
  });
});

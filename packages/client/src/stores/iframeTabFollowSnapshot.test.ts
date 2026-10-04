/**
 * §7.11 / §3.5 — 스냅샷이 오면 열어 둔 프리뷰 탭이 위성 주소를 따라간다(배선 시험).
 *
 * 순수 판정은 `utils/iframeTabFollow.test.ts` 가 고정한다. 여기서는 그 판정이 `loadSnapshot` 에 실제로
 * 물려 있는지만 본다 — 판정만 맞고 배선이 빠지면 열어 둔 탭은 여전히 남의 화면을 보여 준다.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { useGraphStore } from './graphStore.js';

const AGENT = {
  id: 'agent-a', label: 'A', bubbleType: 'agent', path: 'custom-a', status: 'idle', activity: 0, lastActivity: 0,
} as BubbleData;
const TAB_ID = 'sat-special-4108802361';

function satellite(url: string): BubbleData {
  return {
    id: 'special-4108802361', label: 'localhost:8080', bubbleType: 'iframe',
    path: '__special__iframe__custom-a__8080', status: 'active', activity: 1, lastActivity: 0, url,
  } as BubbleData;
}

function snapshot(satellites: Record<string, BubbleData[]>): void {
  const s = useGraphStore.getState();
  s.loadSnapshot({}, [AGENT], [], {}, [], {}, satellites, {}, {}, {}, {}, {}, {}, {}, {}, {},
    s.agentPhase, 0, {}, {}, {}, {}, {}, {}, {}, [], [], {}, {}, {});
}

beforeEach(() => {
  useGraphStore.setState({
    iframeTabs: [{ id: TAB_ID, url: 'http://localhost:8080', label: 'localhost:8080', serverKind: 'frontend' }],
    activeIframeId: TAB_ID,
  });
});

describe('loadSnapshot — 열어 둔 프리뷰 탭이 위성 주소를 따라간다', () => {
  it('서버가 위성을 우리 서버에 닿는 127.0.0.1 로 옮기면 탭 주소도 옮긴다', () => {
    snapshot({ [AGENT.id]: [satellite('http://127.0.0.1:8080/')] });
    expect(useGraphStore.getState().iframeTabs).toEqual([
      { id: TAB_ID, url: 'http://127.0.0.1:8080/', label: 'localhost:8080', serverKind: 'frontend' },
    ]);
  });

  it('위성이 그대로면 탭 배열도 그대로(같은 참조 — 구독자가 깨지 않는다)', () => {
    snapshot({ [AGENT.id]: [satellite('http://localhost:8080')] });
    const before = useGraphStore.getState().iframeTabs;
    snapshot({ [AGENT.id]: [satellite('http://localhost:8080')] });
    expect(useGraphStore.getState().iframeTabs).toBe(before);
  });

  it('스냅샷에 위성이 없으면(배경 프로젝트·지운 버블) 탭은 그대로', () => {
    snapshot({});
    expect(useGraphStore.getState().iframeTabs[0]?.url).toBe('http://localhost:8080');
  });
});

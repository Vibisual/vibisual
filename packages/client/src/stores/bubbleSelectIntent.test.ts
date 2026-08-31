import { beforeEach, describe, expect, it } from 'vitest';

import { isStoreChannelSelection, useGraphStore } from './graphStore.js';

/**
 * 선택 링 한 칸(`selectIntentId`) — 캔버스 전체가 나눠 쓴다.
 *
 * 에이전트 버블만 이 칸을 쓰고 앱·캡처·플레이·스펙·랩·선반 버블과 메모 상자는 각자 자기
 * `selectedXxxId` 로만 링을 켜던 시절에는, **더블클릭 지연**(§ `bubbleSelectGesture`) 동안
 * 링이 안 뜨고, 다른 store 버블로 옮겨 갈 때 링이 둘 다 켜져 보였다. 이 파일은 그 한 칸이
 * 어느 채널에서든 같은 규칙으로 옮겨 다니는지 고정한다.
 */

const STORE_CHANNEL_KEYS = [
  'selectedTaskEdgeId',
  'selectedCommentBoxId',
  'selectedCaptureBubbleId',
  'selectedAppBubbleId',
  'selectedPlayBubbleId',
  'selectedSpecDocId',
  'selectedLabRunId',
  'selectedShelfBubbleId',
] as const;

function reset(): void {
  const blank: Record<string, unknown> = { selectedNodeId: null, selectIntentId: null };
  for (const k of STORE_CHANNEL_KEYS) blank[k] = null;
  useGraphStore.setState(blank as never);
}

describe('선택 링 한 칸(selectIntentId)', () => {
  beforeEach(reset);

  it.each([
    ['selectAppBubble', 'selectedAppBubbleId'],
    ['selectCaptureBubble', 'selectedCaptureBubbleId'],
    ['selectCommentBox', 'selectedCommentBoxId'],
    ['selectPlayBubble', 'selectedPlayBubbleId'],
    ['selectSpecDoc', 'selectedSpecDocId'],
    ['selectLabRun', 'selectedLabRunId'],
    ['selectShelfBubble', 'selectedShelfBubbleId'],
  ] as const)('%s 는 링 한 칸도 자기 id 로 채운다', (fn, field) => {
    const s = useGraphStore.getState() as unknown as Record<string, (id: string | null) => void>;
    s[fn]?.('x-1');
    const after = useGraphStore.getState() as unknown as Record<string, unknown>;
    expect(after[field]).toBe('x-1');
    // 이 칸이 비어 있으면 더블클릭 지연 동안 "눌렀는데 아무 반응 없는" 버블이 된다.
    expect(after['selectIntentId']).toBe('x-1');
  });

  it('선택을 놓으면(null) 링도 함께 꺼진다', () => {
    useGraphStore.getState().selectAppBubble('app-1');
    useGraphStore.getState().selectAppBubble(null);
    expect(useGraphStore.getState().selectIntentId).toBeNull();
  });

  it('store 버블 → 에이전트 버블로 옮기면 링이 곧바로 넘어간다', () => {
    useGraphStore.getState().selectAppBubble('app-1');
    useGraphStore.getState().selectNode('agent-1');
    const after = useGraphStore.getState();
    expect(after.selectIntentId).toBe('agent-1');
    expect(after.selectedAppBubbleId).toBeNull();
  });

  it('작업 엣지를 고르면 버블 쪽 링은 내려간다(엣지는 선이라 링을 안 쓴다)', () => {
    useGraphStore.getState().selectAppBubble('app-1');
    useGraphStore.getState().selectTaskEdge('edge-1');
    expect(useGraphStore.getState().selectIntentId).toBeNull();
  });

  it('clearElementSelection — 링을 들고 있던 것이 store 채널이면 함께 비운다', () => {
    useGraphStore.getState().selectAppBubble('app-1');
    useGraphStore.getState().clearElementSelection();
    const after = useGraphStore.getState();
    expect(after.selectedAppBubbleId).toBeNull();
    // 선택이 사라진 버블에 링만 남으면 안 된다.
    expect(after.selectIntentId).toBeNull();
  });

  it('clearElementSelection — 네이티브 버블이 들고 있는 링은 건드리지 않는다', () => {
    useGraphStore.getState().selectNode('agent-1');
    useGraphStore.setState({ selectedAppBubbleId: 'app-1' });
    useGraphStore.getState().clearElementSelection();
    const after = useGraphStore.getState();
    expect(after.selectedAppBubbleId).toBeNull();
    expect(after.selectedNodeId).toBe('agent-1');
    expect(after.selectIntentId).toBe('agent-1');
  });
});

describe('isStoreChannelSelection', () => {
  it('null 은 어느 채널도 아니다', () => {
    expect(isStoreChannelSelection(useGraphStore.getState(), null)).toBe(false);
  });

  it('채널 중 하나라도 그 id 를 들고 있으면 true', () => {
    reset();
    useGraphStore.setState({ selectedShelfBubbleId: 'shelf-1' });
    const s = useGraphStore.getState();
    expect(isStoreChannelSelection(s, 'shelf-1')).toBe(true);
    expect(isStoreChannelSelection(s, 'agent-1')).toBe(false);
  });
});

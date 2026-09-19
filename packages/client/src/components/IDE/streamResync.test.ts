import { describe, expect, it } from 'vitest';

import type { SplitNode } from './splitLayout.js';
import { streamResyncTargets } from './streamResync.js';

/**
 * 재연결 뒤 **무엇을 다시 받을지** 고르는 판정을 못 박는다. 그리는 자리마다 받는 길이 다르다 —
 * 창의 활성 세션은 창이 깊은 복원 표식을 보고 스스로 받고, 메인 탭은 에이전트 벌크, 분할의 초점 밖 칸은
 * 그 세션의 깊은 창이다. 빠뜨리면 그 칸만 글이 중간에서 끊긴 채 남는다.
 */

const cell = (id: string, sessionId: string | null): SplitNode => ({ kind: 'cell', id, sessionId });
const row = (...children: SplitNode[]): SplitNode => ({
  kind: 'branch',
  id: 'b',
  axis: 'row',
  sizes: children.map(() => 1 / children.length),
  children,
});

const noCustom = (): boolean => false;

describe('재연결 뒤 스트림 재수신 대상 (§4 v3.16)', () => {
  it('메인 탭을 보고 있는 훅 버블은 에이전트 벌크를 다시 받는다', () => {
    const t = streamResyncTargets({
      overlays: [{ paneKey: 'p', agentId: 'hook', activeSessionId: null }],
      renderedPaneKeys: new Set(['p']),
      splits: {},
      isCustomAgent: noCustom,
    });
    expect(t).toEqual({ bulkAgentIds: ['hook'], deepCells: [] });
  });

  it('세션 탭을 보고 있으면 여기서는 받지 않는다 — 창이 깊은 복원 표식을 보고 받는다', () => {
    const t = streamResyncTargets({
      overlays: [{ paneKey: 'p', agentId: 'hook', activeSessionId: 's1' }],
      renderedPaneKeys: new Set(['p']),
      splits: {},
      isCustomAgent: noCustom,
    });
    expect(t).toEqual({ bulkAgentIds: [], deepCells: [] });
  });

  it('커스텀 버블은 메인 탭이 없으니 벌크를 받지 않는다', () => {
    const t = streamResyncTargets({
      overlays: [{ paneKey: 'p', agentId: 'custom', activeSessionId: null }],
      renderedPaneKeys: new Set(['p']),
      splits: {},
      isCustomAgent: (id) => id === 'custom',
    });
    expect(t.bulkAgentIds).toEqual([]);
  });

  it('접혀 안 그려지는 창은 건너뛴다 — 다시 펼 때 창이 제 벌크를 받는다', () => {
    const t = streamResyncTargets({
      overlays: [{ paneKey: 'p', agentId: 'hook', activeSessionId: null }],
      renderedPaneKeys: new Set(),
      splits: {},
      isCustomAgent: noCustom,
    });
    expect(t.bulkAgentIds).toEqual([]);
  });

  it('분할의 초점 밖 칸은 그 세션의 깊은 창을, 메인 탭 칸은 벌크를 다시 받는다', () => {
    const t = streamResyncTargets({
      overlays: [{ paneKey: 'p', agentId: 'hook', activeSessionId: 's1' }],
      renderedPaneKeys: new Set(['p']),
      splits: { p: { agentId: 'hook', layout: row(cell('c1', 's1'), cell('c2', 's2'), cell('c3', null)) } },
      isCustomAgent: noCustom,
    });
    expect(t.bulkAgentIds).toEqual(['hook']);
    // 활성 세션(s1)은 창이 받으므로 겹쳐 받지 않는다.
    expect(t.deepCells).toEqual([{ agentId: 'hook', sessionId: 's2' }]);
  });

  it('같은 세션을 두 칸에 띄워도 한 번만 받는다', () => {
    const t = streamResyncTargets({
      overlays: [{ paneKey: 'p', agentId: 'hook', activeSessionId: 's1' }],
      renderedPaneKeys: new Set(['p']),
      splits: { p: { agentId: 'hook', layout: row(cell('c1', 's2'), cell('c2', 's2')) } },
      isCustomAgent: noCustom,
    });
    expect(t.deepCells).toEqual([{ agentId: 'hook', sessionId: 's2' }]);
  });

  it('창이 다른 버블로 갈아 끼워졌으면 남은 분할은 무시한다', () => {
    const t = streamResyncTargets({
      overlays: [{ paneKey: 'p', agentId: 'other', activeSessionId: 's9' }],
      renderedPaneKeys: new Set(['p']),
      splits: { p: { agentId: 'hook', layout: row(cell('c1', 's2'), cell('c2', null)) } },
      isCustomAgent: noCustom,
    });
    expect(t).toEqual({ bulkAgentIds: [], deepCells: [] });
  });

  it('닫힌 창(agentId 없음)은 건너뛴다', () => {
    const t = streamResyncTargets({
      overlays: [{ paneKey: 'p', agentId: null, activeSessionId: null }],
      renderedPaneKeys: new Set(['p']),
      splits: {},
      isCustomAgent: noCustom,
    });
    expect(t).toEqual({ bulkAgentIds: [], deepCells: [] });
  });

  it('같은 버블을 두 창에 열어도 벌크는 한 번만 받는다', () => {
    const t = streamResyncTargets({
      overlays: [
        { paneKey: 'p1', agentId: 'hook', activeSessionId: null },
        { paneKey: 'p2', agentId: 'hook', activeSessionId: null },
      ],
      renderedPaneKeys: new Set(['p1', 'p2']),
      splits: {},
      isCustomAgent: noCustom,
    });
    expect(t.bulkAgentIds).toEqual(['hook']);
  });
});

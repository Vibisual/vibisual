import { describe, expect, it } from 'vitest';
import type { BubbleData } from '@vibisual/shared';

import { selectVisibleDockedPanes, selectDockSideOccupied, DEFAULT_IDE_OVERLAY } from './graphStore.js';
import type { IDEOverlayState } from './graphStore.js';

/**
 * §5.5 #17-1 — **그려지는 창만 자리를 먹는다.** 캔버스를 줄이는 쪽(App `main` 여백 · DetailPanel)과 그리는 쪽(`AgentIDEOverlay`)의 산식이
 * 다르면 IDE 없는 빈 도크가 캔버스를 가린다(북마크 숫자키 점프 뒤 우측 480px 빈 칸).
 */

const AGENT = 'agent-1';
const AGENT2 = 'agent-2';
const PROJ = 'alpha';

function node(id: string): BubbleData {
  return { id, label: id, bubbleType: 'agent', path: id, status: 'idle', activity: 0 };
}

function pane(over: Partial<IDEOverlayState>): IDEOverlayState {
  return { ...DEFAULT_IDE_OVERLAY, agentId: AGENT, paneKey: PROJ, projectId: PROJ, ...over };
}

function state(over: Partial<IDEOverlayState>, nodeMap: Record<string, BubbleData>) {
  return { activeProject: PROJ, ideOverlays: { [PROJ]: pane(over) }, nodeMap };
}

describe('selectVisibleDockedPanes', () => {
  it('도킹 + 에이전트 버블 생존 → 자리를 비운다', () => {
    const out = selectVisibleDockedPanes(state({ dockSide: 'right' }, { [AGENT]: node(AGENT) }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ paneKey: PROJ, side: 'right' });
  });

  it('도킹인데 그 에이전트가 스냅샷에 없으면 자리를 비우지 않는다 (빈 도크 회귀 방지)', () => {
    // AgentIDEOverlay 가 null 을 반환하는 바로 그 조건 — 여기서 자리를 주면 IDE 없는 빈 칸이 남는다.
    expect(selectVisibleDockedPanes(state({ dockSide: 'right' }, {}))).toHaveLength(0);
  });

  it('도킹이 아니면(모달/플로팅) 자리를 비우지 않는다', () => {
    expect(selectVisibleDockedPanes(state({ dockSide: null }, { [AGENT]: node(AGENT) }))).toHaveLength(0);
  });

  it('IDE 슬롯 자체가 없으면 빈 목록', () => {
    expect(selectVisibleDockedPanes({ activeProject: PROJ, ideOverlays: {}, nodeMap: {} })).toHaveLength(0);
  });

  it('다른 프로젝트 탭의 도킹 IDE 는 이 탭의 자리를 비우지 않는다', () => {
    const s = {
      activeProject: 'beta',
      ideOverlays: { [PROJ]: pane({ dockSide: 'right' }) },
      nodeMap: { [AGENT]: node(AGENT) },
    };
    expect(selectVisibleDockedPanes(s)).toHaveLength(0);
  });

  it('여러 창이 서로 다른 변에 붙으면 전부 자리를 먹는다(듀얼 창)', () => {
    const s = {
      activeProject: PROJ,
      ideOverlays: {
        [PROJ]: pane({ dockSide: 'right', z: 1 }),
        [`${PROJ}::ide-2`]: pane({ paneKey: `${PROJ}::ide-2`, agentId: AGENT2, dockSide: 'left', z: 2 }),
      },
      nodeMap: { [AGENT]: node(AGENT), [AGENT2]: node(AGENT2) },
    };
    expect(selectVisibleDockedPanes(s).map((p) => p.side).sort()).toEqual(['left', 'right']);
    expect(selectDockSideOccupied(s, 'left')).toBe(true);
    expect(selectDockSideOccupied(s, 'right')).toBe(true);
    expect(selectDockSideOccupied(s, 'top')).toBe(false);
  });

  it('한 창의 에이전트만 사라지면 그 창의 자리만 빠진다', () => {
    const s = {
      activeProject: PROJ,
      ideOverlays: {
        [PROJ]: pane({ dockSide: 'right', z: 1 }),
        [`${PROJ}::ide-2`]: pane({ paneKey: `${PROJ}::ide-2`, agentId: AGENT2, dockSide: 'left', z: 2 }),
      },
      nodeMap: { [AGENT]: node(AGENT) },
    };
    expect(selectVisibleDockedPanes(s).map((p) => p.side)).toEqual(['right']);
  });
});

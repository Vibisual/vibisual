import { describe, expect, it } from 'vitest';
import type { BubbleData } from '@vibisual/shared';

import { selectIDEDockVisible, DEFAULT_IDE_OVERLAY } from './graphStore.js';
import type { IDEOverlayState } from './graphStore.js';

/**
 * §5.5 #17-1 — "우측 도킹이 실제로 화면을 차지하는가" 판정.
 *
 * 캔버스를 줄이는 쪽(App `main` marginRight · DetailPanel 좌/우 미러링)과 IDE 를 그리는 쪽
 * (`AgentIDEOverlay` — `nodeMap[agentId]` 가 없으면 `null` 반환)이 **다른 산식**을 쓰면,
 * 슬롯만 도킹으로 남은 상태에서 **IDE 없는 빈 도크**가 캔버스를 가린다(사용자 보고: 북마크
 * 숫자키 점프 뒤 우측 480px 가 빈 칸). 그 배선이 조용히 돌아오지 않도록 여기서 못 박는다.
 */

const AGENT = 'agent-1';
const PROJ = 'alpha';

function node(id: string): BubbleData {
  return { id, label: id, bubbleType: 'agent', path: id, status: 'idle', activity: 0 };
}

function state(over: Partial<IDEOverlayState>, nodeMap: Record<string, BubbleData>) {
  return {
    activeProject: PROJ,
    ideOverlays: { [PROJ]: { ...DEFAULT_IDE_OVERLAY, agentId: AGENT, projectId: PROJ, ...over } },
    nodeMap,
  };
}

describe('selectIDEDockVisible', () => {
  it('도킹 + 에이전트 버블 생존 → 자리를 비운다', () => {
    expect(selectIDEDockVisible(state({ dockedRight: true }, { [AGENT]: node(AGENT) }))).toBe(true);
  });

  it('도킹인데 그 에이전트가 스냅샷에 없으면 자리를 비우지 않는다 (빈 도크 회귀 방지)', () => {
    // AgentIDEOverlay 가 null 을 반환하는 바로 그 조건 — 여기서 true 를 주면 IDE 없는 빈 칸이 남는다.
    expect(selectIDEDockVisible(state({ dockedRight: true }, {}))).toBe(false);
  });

  it('도킹이 아니면(모달/플로팅) 자리를 비우지 않는다', () => {
    expect(selectIDEDockVisible(state({ dockedRight: false }, { [AGENT]: node(AGENT) }))).toBe(false);
  });

  it('IDE 슬롯 자체가 없으면 false', () => {
    expect(selectIDEDockVisible({ activeProject: PROJ, ideOverlays: {}, nodeMap: {} })).toBe(false);
  });

  it('다른 프로젝트 탭의 도킹 IDE 는 이 탭의 자리를 비우지 않는다', () => {
    const s = {
      activeProject: 'beta',
      ideOverlays: {
        [PROJ]: { ...DEFAULT_IDE_OVERLAY, agentId: AGENT, projectId: PROJ, dockedRight: true },
      },
      nodeMap: { [AGENT]: node(AGENT) },
    };
    expect(selectIDEDockVisible(s)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { LINK_FOCUS } from '@vibisual/shared';
import {
  computeLinkGroup,
  linkRoleOf,
  linkEdgeRoleOf,
  linkFocusNodeStyle,
  linkFocusEdgeStyle,
  linkFocusStrength,
  EMPTY_LINK_GROUP,
  type LinkEdgeRef,
} from './linkedBubbles.js';

const e = (id: string, source: string, target: string): LinkEdgeRef => ({ id, source, target });

/**
 * 표준 그림 —
 *   agent ─e1→ folderA ─e3→ fileX      (fileX 는 folderA 의 위성)
 *   agent ─e2→ folderB
 *   other ─e4→ folderC                 (무리 밖)
 */
const EDGES: LinkEdgeRef[] = [
  e('e1', 'agent', 'folderA'),
  e('e2', 'agent', 'folderB'),
  e('e3', 'folderA', 'fileX'),
  e('e4', 'other', 'folderC'),
];
const SATS = [
  { parentId: 'folderA', id: 'fileX' },
  { parentId: 'agent', id: 'capture' },
  { parentId: 'folderC', id: 'fileZ' },
];

describe('computeLinkGroup', () => {
  it('1촉 이웃을 담는다 — 중심 자신은 넣지 않는다', () => {
    const g = computeLinkGroup('agent', EDGES);
    expect(g.nodeIds.has('folderA')).toBe(true);
    expect(g.nodeIds.has('folderB')).toBe(true);
    expect(g.nodeIds.has('agent')).toBe(false);
  });

  it('2촉은 담지 않는다 — 전이적으로 번지면 캔버스 전체가 한 덩어리가 된다', () => {
    const g = computeLinkGroup('agent', EDGES);
    // fileX 는 folderA 를 거쳐야 닿는다. 위성 정보 없이는 무리 밖.
    expect(g.nodeIds.has('fileX')).toBe(false);
  });

  it('이웃의 위성은 담는다 — 부모만 옮기면 덩어리가 찢어진다', () => {
    const g = computeLinkGroup('agent', EDGES, SATS);
    expect(g.nodeIds.has('fileX')).toBe(true);  // folderA 의 위성
    expect(g.nodeIds.has('capture')).toBe(true);  // 중심 자신의 위성
    expect(g.nodeIds.has('fileZ')).toBe(false); // 무리 밖 폴더의 위성
  });

  it('무리 안쪽 선만 담는다 — 이웃끼리 이어진 선도 포함', () => {
    const g = computeLinkGroup('agent', EDGES, SATS);
    expect(g.edgeIds.has('e1')).toBe(true);
    expect(g.edgeIds.has('e2')).toBe(true);
    expect(g.edgeIds.has('e3')).toBe(true);  // folderA ↔ fileX (둘 다 무리 안)
    expect(g.edgeIds.has('e4')).toBe(false); // 양 끝 모두 무리 밖
  });

  it('중심이 빈 문자열이면 빈 무리 — 같은 참조를 돌려준다', () => {
    expect(computeLinkGroup('', EDGES)).toBe(EMPTY_LINK_GROUP);
  });

  it('닿는 선이 없는 버블은 이웃 0 · 선 0', () => {
    const g = computeLinkGroup('lonely', EDGES, SATS);
    expect(g.nodeIds.size).toBe(0);
    expect(g.edgeIds.size).toBe(0);
    expect(g.focusId).toBe('lonely');
  });

  it('자기 자신을 가리키는 선은 이웃으로 세지 않는다', () => {
    const g = computeLinkGroup('a', [e('self', 'a', 'a')]);
    expect(g.nodeIds.size).toBe(0);
    expect(g.edgeIds.has('self')).toBe(true); // 그려진 선이므로 무리의 것으로 밝힌다
  });

  it('위성이 자기 자신인 어긋난 항목은 무시한다', () => {
    const g = computeLinkGroup('agent', [], [{ parentId: 'agent', id: 'agent' }]);
    expect(g.nodeIds.size).toBe(0);
  });
});

describe('linkRoleOf', () => {
  const g = computeLinkGroup('agent', EDGES, SATS);

  it('중심 · 연결 · 그 밖을 가른다', () => {
    expect(linkRoleOf(g, 'agent')).toBe('focus');
    expect(linkRoleOf(g, 'folderA')).toBe('linked');
    expect(linkRoleOf(g, 'fileX')).toBe('linked');
    expect(linkRoleOf(g, 'other')).toBe('dim');
  });

  it('무리가 없으면 전부 off — 강조 자체가 꺼진 상태', () => {
    expect(linkRoleOf(null, 'agent')).toBe('off');
    expect(linkRoleOf(EMPTY_LINK_GROUP, 'agent')).toBe('off');
  });
});

describe('linkEdgeRoleOf', () => {
  const g = computeLinkGroup('agent', EDGES, SATS);

  it('무리 안 선만 linked, 나머지는 dim', () => {
    expect(linkEdgeRoleOf(g, 'e1')).toBe('linked');
    expect(linkEdgeRoleOf(g, 'e4')).toBe('dim');
  });

  it('무리가 없으면 off', () => {
    expect(linkEdgeRoleOf(null, 'e1')).toBe('off');
  });
});

describe('linkFocusNodeStyle', () => {
  it('강조가 꺼져 있으면 아무것도 걸지 않는다 — 평소 렌더에 값이 새지 않게', () => {
    expect(linkFocusNodeStyle('off', 'grab')).toEqual({ opacityMul: 1, filter: null, boxShadow: null });
    expect(linkFocusNodeStyle('linked', 'off')).toEqual({ opacityMul: 1, filter: null, boxShadow: null });
  });

  it('무리 밖은 물러난다 — 투명도를 곱으로 돌려주고 색기를 뺀다', () => {
    const v = linkFocusNodeStyle('dim', 'grab');
    expect(v.opacityMul).toBeCloseTo(LINK_FOCUS.DIM_OPACITY, 5);
    expect(v.filter).toContain('saturate');
    expect(v.boxShadow).toBeNull(); // 물러난 것에 링을 두르지 않는다
  });

  it('무리 안은 투명도를 건드리지 않고 링만 두른다', () => {
    const v = linkFocusNodeStyle('linked', 'grab');
    expect(v.opacityMul).toBe(1);
    expect(v.boxShadow).toContain('rgba(255,255,255');
    expect(v.filter).toContain('brightness');
  });

  it('중심이 연결보다 세다 — 링이 더 두껍고 더 진하다', () => {
    const focus = linkFocusNodeStyle('focus', 'grab');
    const linked = linkFocusNodeStyle('linked', 'grab');
    expect(focus.boxShadow).toContain(`0 0 0 ${LINK_FOCUS.FOCUS_RING_WIDTH}px`);
    expect(linked.boxShadow).toContain(`0 0 0 ${LINK_FOCUS.RING_WIDTH}px`);
    expect(focus.boxShadow).not.toBe(linked.boxShadow);
  });

  it('미리보기는 확정보다 옅다 — 덜 물러나고 덜 떠오른다', () => {
    const hoverDim = linkFocusNodeStyle('dim', 'hover');
    const grabDim = linkFocusNodeStyle('dim', 'grab');
    expect(hoverDim.opacityMul).toBeGreaterThan(grabDim.opacityMul);
    expect(hoverDim.opacityMul).toBeLessThan(1);
  });

  it('세기는 off < hover < grab 순서로 오른다', () => {
    expect(linkFocusStrength('off')).toBe(0);
    expect(linkFocusStrength('hover')).toBeGreaterThan(0);
    expect(linkFocusStrength('hover')).toBeLessThan(linkFocusStrength('grab'));
    expect(linkFocusStrength('grab')).toBe(1);
  });
});

describe('linkFocusEdgeStyle', () => {
  it('꺼져 있으면 곱이 전부 1 — 굵기·투명도가 그대로다', () => {
    expect(linkFocusEdgeStyle('off', 'grab')).toEqual({ opacityMul: 1, widthMul: 1 });
    expect(linkFocusEdgeStyle('linked', 'off')).toEqual({ opacityMul: 1, widthMul: 1 });
  });

  it('무리 밖 선은 버블보다 더 물러난다 — 선이 남으면 시야가 어지럽다', () => {
    const edge = linkFocusEdgeStyle('dim', 'grab');
    const node = linkFocusNodeStyle('dim', 'grab');
    expect(edge.opacityMul).toBeLessThan(node.opacityMul);
    expect(edge.widthMul).toBe(1); // 물러나는 선을 굵게 만들지 않는다
  });

  it('무리 안 선은 굵어진다', () => {
    expect(linkFocusEdgeStyle('linked', 'grab').widthMul).toBeCloseTo(LINK_FOCUS.EDGE_LIT_WIDTH, 5);
  });
});

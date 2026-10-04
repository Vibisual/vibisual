import { describe, expect, it } from 'vitest';
import {
  computeSelectionDistances,
  liftSelectionDistances,
  nextSelectionFocusCenter,
  selectionEdgeDistance,
  selectionFocusIds,
  selectionIdentityIds,
} from './selectionFocus.js';

const bubble = (id: string, selected = false) => ({ id, type: 'bubble', selected });
const edge = (id: string, source: string, target: string) => ({ id, source, target });

describe('selectionFocusIds', () => {
  it('선택 의도가 없으면 네이티브 선택이 남아 있어도 포커싱을 해제한다', () => {
    expect(selectionFocusIds([bubble('agent', true)], null, null)).toEqual([]);
  });

  it('현재 화면에 없는 선택은 전체 캔버스를 흐리게 하지 않는다', () => {
    expect(selectionFocusIds([bubble('agent')], 'missing', null)).toEqual([]);
  });

  it('선택 의도를 현재 화면의 버블 id로 연결한다', () => {
    expect(selectionFocusIds([bubble('agent'), bubble('other')], 'agent', null)).toEqual(['agent']);
  });

  it('위성 선택의 정규 id를 실제 sat- 노드로 연결한다', () => {
    expect(selectionFocusIds([bubble('sat-file'), bubble('other')], 'file', null)).toEqual(['sat-file']);
  });

  it('폴더 내부 홈 버블은 현재 폴더의 선택을 이어받는다', () => {
    expect(selectionFocusIds([bubble('__root_home__'), bubble('child')], 'folder', 'folder'))
      .toEqual(['__root_home__']);
    expect(selectionFocusIds([bubble('__root_home__')], 'folder', null)).toEqual([]);
  });

  it('플레이 표지와 열린 프리뷰를 같은 선택의 두 표시 노드로 취급한다', () => {
    const nodes = [
      { id: 'play', type: 'playNode', selected: true },
      { id: 'play__preview', type: 'playPreviewNode', selected: true },
      bubble('other'),
    ];
    expect(selectionFocusIds(nodes, 'play', null)).toEqual(['play', 'play__preview']);
  });

  it('일반 버블 id의 __preview 접미사는 플레이 별칭으로 오인하지 않는다', () => {
    const nodes = [bubble('file__preview')];
    expect(selectionFocusIds(nodes, 'file', null)).toEqual([]);
    expect(selectionFocusIds(nodes, 'file__preview', null)).toEqual(['file__preview']);
  });

  it('일반 버블을 둘 이상 선택하면 마지막 선택 의도가 있어도 포커싱을 끈다', () => {
    const nodes = [bubble('agent', true), bubble('folder', true), bubble('other')];
    expect(selectionFocusIds(nodes, 'agent', null)).toEqual([]);
  });

  it('일반 버블이 하나만 선택된 경우에는 포커싱을 유지한다', () => {
    expect(selectionFocusIds([bubble('agent', true), bubble('folder')], 'agent', null)).toEqual(['agent']);
  });

  it('다른 버블 하나가 네이티브로 선택돼 있으면 일반 버블 중심을 놓는다(마퀴 선택)', () => {
    expect(selectionFocusIds([bubble('agent'), bubble('other', true)], 'agent', null)).toEqual([]);
  });

  it('더블클릭 창을 기다리는 클릭의 네이티브 선택은 붙든 중심과 어긋난 것으로 치지 않는다', () => {
    expect(selectionFocusIds([bubble('agent'), bubble('other', true)], 'agent', null, 'other')).toEqual(['agent']);
  });

  it('store 채널 버블이 중심이면 곧 내려갈 네이티브 선택 잔여를 보지 않는다', () => {
    const nodes = [bubble('agent', true), { id: 'app', type: 'appNode' }];
    expect(selectionFocusIds(nodes, 'app', null)).toEqual(['app']);
  });
});

describe('selectionIdentityIds', () => {
  it('하나의 선택이 그려진 노드를 모두 찾는다(위성·플레이 프리뷰)', () => {
    const nodes = [
      bubble('sat-file'),
      { id: 'play', type: 'playNode' },
      { id: 'play__preview', type: 'playPreviewNode' },
      { ...bubble('hidden'), hidden: true },
    ];
    expect(selectionIdentityIds(nodes, 'file', null)).toEqual(['sat-file']);
    expect(selectionIdentityIds(nodes, 'play', null)).toEqual(['play', 'play__preview']);
    expect(selectionIdentityIds(nodes, 'hidden', null)).toEqual([]);
    expect(selectionIdentityIds(nodes, null, null)).toEqual([]);
  });
});

describe('nextSelectionFocusCenter', () => {
  it('링이 없으면 붙든 중심도 놓는다', () => {
    expect(nextSelectionFocusCenter('agent', null, false)).toBeNull();
    expect(nextSelectionFocusCenter('agent', null, true)).toBeNull();
  });

  it('확정된 클릭은 링을 그대로 중심으로 쓴다', () => {
    expect(nextSelectionFocusCenter('agent', 'other', false)).toBe('other');
    expect(nextSelectionFocusCenter(null, 'other', false)).toBe('other');
  });

  it('두 번째 클릭을 기다리는 동안은 직전 중심을 붙든다(없었으면 계속 없음)', () => {
    expect(nextSelectionFocusCenter('agent', 'other', true)).toBe('agent');
    expect(nextSelectionFocusCenter(null, 'other', true)).toBeNull();
  });
});

describe('liftSelectionDistances', () => {
  it('눌린 버블만 중심 밝기로 올리고 원본 거리는 건드리지 않는다', () => {
    const distances = new Map([['agent', 0], ['folder', 1]]);
    const lifted = liftSelectionDistances(distances, ['other']);
    expect(lifted).toEqual(new Map([['agent', 0], ['folder', 1], ['other', 0]]));
    expect(distances.has('other')).toBe(false);
  });

  it('흐린 것이 없거나 올릴 것이 없으면 그대로 돌려준다', () => {
    const distances = new Map([['agent', 0]]);
    expect(liftSelectionDistances(null, ['other'])).toBeNull();
    expect(liftSelectionDistances(distances, [])).toBe(distances);
  });
});

describe('computeSelectionDistances', () => {
  it('화살표 방향에 관계없이 1차·2차·이후 연결을 따라가고 무관한 버블은 제외한다', () => {
    const nodes = ['agent', 'first', 'second', 'third', 'unrelated'].map((id) => bubble(id));
    const edges = [
      edge('incoming', 'first', 'agent'),
      edge('outgoing', 'first', 'second'),
      edge('third-hop', 'third', 'second'),
    ];
    const distances = computeSelectionDistances(['agent'], nodes, edges);
    expect(distances).toEqual(new Map([['agent', 0], ['first', 1], ['second', 2], ['third', 3]]));
    expect(distances?.has('unrelated')).toBe(false);
  });

  it('순환·중복·자기 연결이 있어도 최단거리를 구한다', () => {
    const nodes = ['agent', 'a', 'b', 'c'].map((id) => bubble(id));
    const edges = [
      edge('long-start', 'agent', 'a'),
      edge('long-middle', 'a', 'b'),
      edge('long-end', 'b', 'c'),
      edge('short', 'agent', 'c'),
      edge('duplicate', 'agent', 'a'),
      edge('self', 'agent', 'agent'),
    ];
    const distances = computeSelectionDistances(['agent'], nodes, edges);
    expect(distances?.get('agent')).toBe(0);
    expect(distances?.get('a')).toBe(1);
    expect(distances?.get('c')).toBe(1);
    expect(distances?.get('b')).toBe(2);
    expect(distances?.size).toBe(4);
  });

  it('같은 선택의 표지·프리뷰는 모두 중심이며 가까운 쪽의 거리를 사용한다', () => {
    const nodes = ['play', 'play__preview', 'owner', 'file'].map((id) => bubble(id));
    const distances = computeSelectionDistances(['play', 'play__preview'], nodes, [
      edge('owner', 'play__preview', 'owner'),
      edge('file', 'owner', 'file'),
      edge('cover-file', 'play', 'file'),
    ]);
    expect(distances?.get('play')).toBe(0);
    expect(distances?.get('play__preview')).toBe(0);
    expect(distances?.get('owner')).toBe(1);
    expect(distances?.get('file')).toBe(1);
  });

  it('숨긴 노드를 중간 연결로 사용하지 않는다', () => {
    const nodes = [bubble('agent'), { ...bubble('hidden'), hidden: true }, bubble('other')];
    const distances = computeSelectionDistances(['agent'], nodes, [
      edge('to-hidden', 'agent', 'hidden'),
      edge('from-hidden', 'hidden', 'other'),
    ]);
    expect(distances).toEqual(new Map([['agent', 0]]));
  });

  it('숨긴 엣지는 양 끝 노드가 보여도 연결로 세지 않는다', () => {
    const distances = computeSelectionDistances(['agent'], [bubble('agent'), bubble('other')], [
      { ...edge('hidden-edge', 'agent', 'other'), hidden: true },
    ]);
    expect(distances).toEqual(new Map([['agent', 0]]));
  });

  it('화면에 없는 끝점으로 이어지는 엣지를 통해 다른 버블에 도달하지 않는다', () => {
    const distances = computeSelectionDistances(['agent'], [bubble('agent'), bubble('other')], [
      edge('to-missing', 'agent', 'missing'),
      edge('from-missing', 'missing', 'other'),
    ]);
    expect(distances).toEqual(new Map([['agent', 0]]));
  });

  it('유효한 중심이 없으면 null로 강조를 해제한다', () => {
    const nodes = [bubble('agent'), { ...bubble('hidden'), hidden: true }];
    expect(computeSelectionDistances([], nodes, [])).toBeNull();
    expect(computeSelectionDistances(['missing'], nodes, [])).toBeNull();
    expect(computeSelectionDistances(['hidden'], nodes, [])).toBeNull();
    expect(computeSelectionDistances(['agent'], [], [])).toBeNull();
  });

  it('유효하지 않은 중심과 중복 중심을 제외하고 남은 중심에서 계산한다', () => {
    const nodes = [bubble('agent'), bubble('other')];
    expect(computeSelectionDistances(['missing', 'agent', 'agent'], nodes, [edge('link', 'agent', 'other')]))
      .toEqual(new Map([['agent', 0], ['other', 1]]));
  });

  it('연결이 없는 선택 버블도 중심으로 유지한다', () => {
    expect(computeSelectionDistances(['agent'], [bubble('agent'), bubble('other')], []))
      .toEqual(new Map([['agent', 0]]));
  });
});

describe('selectionEdgeDistance', () => {
  const distances = new Map([['agent', 0], ['preview', 0], ['first', 1], ['peer', 1], ['second', 2]]);

  it('중심에서 나가는 선은 1차, 그 다음 선은 2차로 표시한다', () => {
    expect(selectionEdgeDistance(distances, edge('direct', 'agent', 'first'))).toBe(1);
    expect(selectionEdgeDistance(distances, edge('indirect', 'first', 'second'))).toBe(2);
    expect(selectionEdgeDistance(distances, edge('reverse', 'second', 'first'))).toBe(2);
  });

  it('같은 거리의 버블끼리 연결된 선은 그 거리로 표시한다', () => {
    expect(selectionEdgeDistance(distances, edge('peers', 'first', 'peer'))).toBe(1);
  });

  it('두 중심 사이의 선과 중심의 자기 연결도 최소 1차로 표시한다', () => {
    expect(selectionEdgeDistance(distances, edge('centers', 'agent', 'preview'))).toBe(1);
    expect(selectionEdgeDistance(distances, edge('self', 'agent', 'agent'))).toBe(1);
  });

  it('한쪽 또는 양쪽이 미도달이면 배경 선으로 분류한다', () => {
    expect(selectionEdgeDistance(distances, edge('outgoing', 'agent', 'unrelated'))).toBeUndefined();
    expect(selectionEdgeDistance(distances, edge('incoming', 'unrelated', 'agent'))).toBeUndefined();
    expect(selectionEdgeDistance(distances, edge('disconnected', 'unrelated', 'missing'))).toBeUndefined();
  });
});

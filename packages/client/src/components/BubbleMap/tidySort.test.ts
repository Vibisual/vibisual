import { describe, it, expect } from 'vitest';
import { TIDY_LAYOUT, TIDY_SORTS, DEFAULT_TIDY_SORT, normalizeTidySort, tidyGeometryOf } from '@vibisual/shared';
import type { BubbleType, NodeStatus } from '@vibisual/shared';
import {
  computeTidyGrouping,
  TIDY_GROUP_NONE,
  TIDY_GROUP_UNMEASURED,
  tidyQuantileKey,
  type TidySortItem,
} from './tidySort.js';

/**
 * §5.4 #33 (I) 정리 기준 — **나눔은 값만 다루므로 렌더링 없이 확인하는 편이 정확하다**
 * (`tidyLayout`·`bubbleTextFit` 선례). 여기서 고정하는 것 넷:
 *  ① 기준마다 무리가 실제로 갈리는가 ② 동점이 같은 칸에 앉는가(분위의 유일한 함정)
 *  ③ 아무도 떨어지지 않는가(모든 버블이 `order` 안의 무리에 든다) ④ 같은 입력이 늘 같은 답인가.
 */

function item(
  id: string,
  bubbleType: BubbleType,
  opts: { status?: NodeStatus; heat?: number; lastActivity?: number } = {},
): TidySortItem {
  return {
    id,
    bubbleType,
    status: opts.status ?? 'idle',
    heat: opts.heat ?? 0,
    lastActivity: opts.lastActivity,
  };
}

/** 나눔의 불변식 — 모든 버블이 `order` 안의 어느 무리에 정확히 한 번 든다. */
function expectEveryoneSeated(items: readonly TidySortItem[], grouping: ReturnType<typeof computeTidyGrouping>): void {
  const known = new Set(grouping.order);
  for (const it of items) {
    const g = grouping.groupById.get(it.id);
    expect(g, `${it.id} 가 어느 무리에도 들지 않았다`).toBeDefined();
    expect(known.has(g!), `${it.id} 의 무리 ${g} 가 순서표에 없다`).toBe(true);
  }
}

describe('TIDY_SORTS — 기준 표 자체', () => {
  it('다섯 기준이 있고 id 가 겹치지 않는다', () => {
    expect(TIDY_SORTS).toHaveLength(5);
    expect(new Set(TIDY_SORTS.map((s) => s.id)).size).toBe(5);
  });

  it('순위 있는 셋은 줄 세우기, 분류 둘은 덩어리다 (§5.4 #33 I-1)', () => {
    expect(tidyGeometryOf('status')).toBe('rows');
    expect(tidyGeometryOf('heat')).toBe('rows');
    expect(tidyGeometryOf('recent')).toBe('rows');
    // 순위가 없는 분류를 줄로 세우면 "왜 파일이 윗줄인가"라는 뜻 없는 서열이 생긴다.
    expect(tidyGeometryOf('kind')).toBe('clusters');
    expect(tidyGeometryOf('lineage')).toBe('clusters');
  });

  it('기본값은 종전 동작(급한 순)이라 이 기능이 아무것도 빼앗지 않는다', () => {
    expect(DEFAULT_TIDY_SORT).toBe('status');
    expect(normalizeTidySort('heat')).toBe('heat');
    // 알 수 없는 값이 들어와도 화면이 비지 않는다.
    expect(normalizeTidySort('bogus')).toBe('status');
    expect(normalizeTidySort(undefined)).toBe('status');
  });
});

describe('status — 띠 순서', () => {
  it('맨 위부터 도는 것 → 봐야 할 것 → 쉬는 것 → 폴더 → 나머지', () => {
    const items = [
      item('file', 'file'),
      item('folder', 'internal_folder'),
      item('idle', 'agent', { status: 'idle' }),
      item('done', 'agent', { status: 'completed' }),
      item('run', 'agent', { status: 'active' }),
    ];
    const g = computeTidyGrouping(items, 'status');
    expect(g.order).toEqual(['running', 'attention', 'waiting', 'folder', 'other']);
    expect(g.groupById.get('run')).toBe('running');
    expect(g.groupById.get('done')).toBe('attention');
    expect(g.groupById.get('idle')).toBe('waiting');
    expect(g.groupById.get('folder')).toBe('folder');
    expect(g.groupById.get('file')).toBe('other');
    expectEveryoneSeated(items, g);
  });

  it('비어 있는 띠는 순서표에서 빠진다 — 안 그러면 빈 칸만큼 지도가 커진다', () => {
    const items = [item('a', 'agent', { status: 'active' }), item('b', 'agent', { status: 'active' })];
    expect(computeTidyGrouping(items, 'status').order).toEqual(['running']);
  });
});

describe('kind — 유사한 것끼리 (사용자 요구 ①)', () => {
  it('같은 종류가 같은 무리에 들고, 큰 무리가 앞에 선다', () => {
    const items = [
      item('f1', 'file'), item('f2', 'file'), item('f3', 'file'),
      item('d1', 'internal_folder'), item('d2', 'internal_folder'),
      item('a1', 'agent'),
    ];
    const g = computeTidyGrouping(items, 'kind');
    expect(g.order).toEqual(['file', 'internal_folder', 'agent']);
    expect(g.groupById.get('f1')).toBe('file');
    expect(g.groupById.get('f3')).toBe('file');
    expect(g.groupById.get('d2')).toBe('internal_folder');
    expectEveryoneSeated(items, g);
  });

  it('종류를 큰 갈래로 뭉치지 않는다 — 파일과 도메인은 다른 무리다', () => {
    const g = computeTidyGrouping([item('f', 'file'), item('w', 'domain')], 'kind');
    expect(g.groupById.get('f')).not.toBe(g.groupById.get('w'));
  });

  it('상태가 달라도 종류가 같으면 한 무리다 — 이 기준이 보는 것은 상태가 아니다', () => {
    const g = computeTidyGrouping([
      item('running', 'agent', { status: 'active' }),
      item('resting', 'agent', { status: 'idle' }),
    ], 'kind');
    expect(g.groupById.get('running')).toBe(g.groupById.get('resting'));
  });
});

describe('heat / recent — 연속값은 순위로 자른다 (I-2)', () => {
  it('가장 뜨거운 것이 맨 윗 칸(q0)이다', () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`n${i}`, 'file', { heat: i }));
    const g = computeTidyGrouping(items, 'heat');
    expect(g.groupById.get('n9')).toBe(tidyQuantileKey(0));
    expect(g.groupById.get('n0')).toBe(tidyQuantileKey(TIDY_LAYOUT.QUANTILE_BUCKETS - 1));
    expect(g.order[0]).toBe(tidyQuantileKey(0));
    expectEveryoneSeated(items, g);
  });

  it('동점은 반드시 같은 칸이다 — 같은 값이 다른 칸에 앉으면 지도가 거짓말을 한다', () => {
    // 경계에 동점을 일부러 몰아 둔다(5분위 · 10개면 두 칸마다 경계).
    const items = [
      item('a', 'file', { heat: 9 }), item('b', 'file', { heat: 5 }), item('c', 'file', { heat: 5 }),
      item('d', 'file', { heat: 5 }), item('e', 'file', { heat: 5 }), item('f', 'file', { heat: 1 }),
    ];
    const g = computeTidyGrouping(items, 'heat');
    const fives = ['b', 'c', 'd', 'e'].map((id) => g.groupById.get(id));
    expect(new Set(fives).size, '5회짜리 넷이 같은 칸에 앉지 않았다').toBe(1);
    expectEveryoneSeated(items, g);
  });

  it('값이 전부 같으면 한 칸이다 — 나눌 것이 없다는 뜻이 그대로 그림이 된다', () => {
    const items = ['a', 'b', 'c'].map((id) => item(id, 'file', { heat: 0 }));
    const g = computeTidyGrouping(items, 'heat');
    expect(g.order).toHaveLength(1);
  });

  it('칸 수는 분위 상한을 넘지 않는다', () => {
    const items = Array.from({ length: 200 }, (_, i) => item(`n${i}`, 'file', { heat: i }));
    expect(computeTidyGrouping(items, 'heat').order.length).toBeLessThanOrEqual(TIDY_LAYOUT.QUANTILE_BUCKETS);
  });

  it('recent — 잰 적 없는 것은 0 과 섞지 않고 맨 아랫 칸으로 모은다', () => {
    const items = [
      item('new', 'file', { lastActivity: 5_000 }),
      item('old', 'file', { lastActivity: 1_000 }),
      item('never', 'file'),
    ];
    const g = computeTidyGrouping(items, 'recent');
    expect(g.groupById.get('never')).toBe(TIDY_GROUP_UNMEASURED);
    expect(g.order[g.order.length - 1]).toBe(TIDY_GROUP_UNMEASURED);
    // 잰 적 없는 것이 "가장 오래전"으로 읽히면 안 되므로, 잰 것들과 같은 칸에 들지 않는다.
    expect(g.groupById.get('old')).not.toBe(TIDY_GROUP_UNMEASURED);
    expectEveryoneSeated(items, g);
  });

  it('recent — 최근일수록 앞 칸이다', () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`n${i}`, 'file', { lastActivity: 1000 + i }));
    const g = computeTidyGrouping(items, 'recent');
    expect(g.groupById.get('n9')).toBe(tidyQuantileKey(0));
  });
});

describe('lineage — 화면에 그려진 선이 무리를 정한다 (I-3)', () => {
  const edge = (id: string, source: string, target: string) => ({ id, source, target });

  it('에이전트마다 제 무리를 이루고, 닿은 버블이 그 무리에 든다', () => {
    const items = [
      item('A', 'agent', { lastActivity: 200 }),
      item('B', 'agent', { lastActivity: 100 }),
      item('a1', 'file'), item('a2', 'file'), item('b1', 'file'),
    ];
    const g = computeTidyGrouping(items, 'lineage', {
      edges: [edge('e1', 'A', 'a1'), edge('e2', 'a2', 'A'), edge('e3', 'B', 'b1')],
    });
    expect(g.groupById.get('a1')).toBe('A');
    expect(g.groupById.get('a2')).toBe('A'); // 방향은 상관없다 — 선이 닿았는가만 본다
    expect(g.groupById.get('b1')).toBe('B');
    expect(g.groupById.get('A')).toBe('A');
    // 활동이 최근인 에이전트가 앞(= 안쪽)에 선다.
    expect(g.order).toEqual(['A', 'B']);
    expectEveryoneSeated(items, g);
  });

  it('여러 에이전트에 걸친 버블은 활동이 최근인 쪽 하나에만 앉는다', () => {
    const items = [
      item('A', 'agent', { lastActivity: 200 }),
      item('B', 'agent', { lastActivity: 100 }),
      item('shared', 'file'),
    ];
    const g = computeTidyGrouping(items, 'lineage', {
      edges: [edge('e1', 'B', 'shared'), edge('e2', 'A', 'shared')],
    });
    expect(g.groupById.get('shared')).toBe('A');
    // 같은 버블이 두 자리에 그려지면 위성·엣지가 둘로 갈린다(§2.1) — 자리는 언제나 하나다.
    expect([...g.groupById.values()].filter((v) => v === 'A' || v === 'B')).toHaveLength(3);
  });

  it('에이전트는 다른 에이전트의 무리에 들지 않는다 — 위임 선이 있어도 제 무리의 중심이다', () => {
    const items = [item('A', 'agent', { lastActivity: 200 }), item('B', 'agent', { lastActivity: 100 })];
    const g = computeTidyGrouping(items, 'lineage', { edges: [edge('e1', 'A', 'B')] });
    expect(g.groupById.get('B')).toBe('B');
  });

  it('아무도 안 만진 것은 감추지 않고 마지막 덩어리로 모은다', () => {
    const items = [item('A', 'agent'), item('lonely', 'file'), item('lonely2', 'internal_folder')];
    const g = computeTidyGrouping(items, 'lineage', { edges: [] });
    expect(g.groupById.get('lonely')).toBe(TIDY_GROUP_NONE);
    expect(g.order[g.order.length - 1]).toBe(TIDY_GROUP_NONE);
    expectEveryoneSeated(items, g);
  });

  it('에이전트가 하나도 없으면 나눌 축이 없다 — 통째로 한 덩어리', () => {
    const items = [item('f1', 'file'), item('f2', 'file')];
    const g = computeTidyGrouping(items, 'lineage', { edges: [edge('e', 'f1', 'f2')] });
    expect(g.order).toEqual([TIDY_GROUP_NONE]);
    expectEveryoneSeated(items, g);
  });

  it('화면 밖 버블을 가리키는 선은 무리를 늘리지 않는다', () => {
    const items = [item('A', 'agent'), item('a1', 'file')];
    const g = computeTidyGrouping(items, 'lineage', {
      edges: [edge('e1', 'A', 'a1'), edge('e2', 'A', 'ghost-not-on-screen')],
    });
    expect(g.groupById.has('ghost-not-on-screen')).toBe(false);
    expectEveryoneSeated(items, g);
  });
});

describe('rankById — 칸 안에서도 줄을 세운다 (§5.4 #33 I-2)', () => {
  it('heat — 값이 큰 쪽이 앞(작은 rank)이다', () => {
    const items = [
      item('a', 'file', { heat: 1 }), item('b', 'file', { heat: 9 }), item('c', 'file', { heat: 5 }),
    ];
    const g = computeTidyGrouping(items, 'heat');
    expect(g.rankById.get('b')!).toBeLessThan(g.rankById.get('c')!);
    expect(g.rankById.get('c')!).toBeLessThan(g.rankById.get('a')!);
  });

  it('recent — 최근이 앞이고, 잰 적 없는 것에는 순위를 주지 않는다', () => {
    const items = [
      item('new', 'file', { lastActivity: 5_000 }),
      item('old', 'file', { lastActivity: 1_000 }),
      item('never', 'file'),
    ];
    const g = computeTidyGrouping(items, 'recent');
    expect(g.rankById.get('new')!).toBeLessThan(g.rankById.get('old')!);
    // 없는 순서를 지어내면 그 줄이 거짓말을 한다 — 기하가 id 순으로 세운다.
    expect(g.rankById.has('never')).toBe(false);
  });

  it('status — 같은 띠 안에서는 활동이 최근인 쪽이 앞이다', () => {
    const items = [
      item('stale', 'agent', { status: 'active', lastActivity: 100 }),
      item('fresh', 'agent', { status: 'active', lastActivity: 900 }),
    ];
    const g = computeTidyGrouping(items, 'status');
    expect(g.groupById.get('stale')).toBe(g.groupById.get('fresh'));
    expect(g.rankById.get('fresh')!).toBeLessThan(g.rankById.get('stale')!);
  });

  it('동점은 순위도 갈리지만 값은 같은 칸이다 — 칸이 거짓말하지 않는 선에서만 줄을 세운다', () => {
    const items = [item('x', 'file', { heat: 5 }), item('y', 'file', { heat: 5 })];
    const g = computeTidyGrouping(items, 'heat');
    expect(g.groupById.get('x')).toBe(g.groupById.get('y'));
    expect(g.rankById.get('x')).not.toBe(g.rankById.get('y'));
  });

  it('표가 정한 기하와 순위 유무가 어긋나지 않는다 — 어긋나면 한쪽만 고쳐진다', () => {
    const sample: TidySortItem[] = [
      item('A', 'agent', { status: 'active', heat: 4, lastActivity: 900 }),
      item('f1', 'file', { heat: 2, lastActivity: 500 }),
      item('d1', 'internal_folder', { heat: 1, lastActivity: 100 }),
    ];
    for (const { id, geometry } of TIDY_SORTS) {
      const g = computeTidyGrouping(sample, id, { edges: [] });
      if (geometry === 'rows') expect(g.rankById.size, `${id} 가 순위를 안 냈다`).toBeGreaterThan(0);
      else expect(g.rankById.size, `${id} 는 덩어리인데 순위를 냈다`).toBe(0);
    }
  });
});

describe('anchorByGroup — 무리의 주인 (§5.4 #33 I-3)', () => {
  const edge = (id: string, source: string, target: string) => ({ id, source, target });

  it('lineage — 에이전트가 제 무리의 주인이다', () => {
    const items = [item('A', 'agent', { lastActivity: 200 }), item('a1', 'file')];
    const g = computeTidyGrouping(items, 'lineage', { edges: [edge('e', 'A', 'a1')] });
    expect(g.anchorByGroup.get('A')).toBe('A');
  });

  it('주인 없는 마지막 덩어리는 비워 둔다 — 가운데에 세울 것이 없다는 사실도 그림의 일부다', () => {
    const items = [item('A', 'agent'), item('lonely', 'file')];
    const g = computeTidyGrouping(items, 'lineage', { edges: [] });
    expect(g.anchorByGroup.has(TIDY_GROUP_NONE)).toBe(false);
  });

  it('에이전트가 하나도 없으면 주인도 없다', () => {
    const g = computeTidyGrouping([item('f', 'file')], 'lineage', { edges: [] });
    expect(g.anchorByGroup.size).toBe(0);
  });

  it('주인은 언제나 그 무리의 구성원이다 — 아니면 기하가 가운데를 비워 둔다', () => {
    const items = [
      item('A', 'agent', { lastActivity: 200 }),
      item('B', 'auto', { lastActivity: 100 }),
      item('f', 'file'),
    ];
    const g = computeTidyGrouping(items, 'lineage', { edges: [edge('e', 'B', 'f')] });
    expect(g.anchorByGroup.size).toBeGreaterThan(0);
    for (const [group, anchor] of g.anchorByGroup) {
      expect(g.groupById.get(anchor)).toBe(group);
    }
  });

  it('kind 에는 주인이 없다 — 이 기준의 그림은 개편에서 바뀌지 않는다', () => {
    const g = computeTidyGrouping([item('f', 'file'), item('d', 'internal_folder')], 'kind');
    expect(g.anchorByGroup.size).toBe(0);
    expect(g.rankById.size).toBe(0);
  });
});

describe('모든 기준 공통 — 아무도 떨어지지 않고, 같은 입력이 늘 같은 답을 낸다', () => {
  const items: TidySortItem[] = [
    item('A', 'agent', { status: 'active', heat: 0, lastActivity: 900 }),
    item('B', 'auto', { status: 'completed', heat: 3, lastActivity: 500 }),
    item('f1', 'file', { heat: 12, lastActivity: 800 }),
    item('f2', 'file', { heat: 12 }),
    item('d1', 'external_folder', { heat: 1, lastActivity: 100 }),
    item('w1', 'domain', { heat: 7 }),
    item('t1', 'trash'),
  ];
  const edges = [{ id: 'e1', source: 'A', target: 'f1' }];

  for (const { id } of TIDY_SORTS) {
    it(`${id} — 전원이 자리를 얻는다`, () => {
      expectEveryoneSeated(items, computeTidyGrouping(items, id, { edges }));
    });

    it(`${id} — 입력 순서가 바뀌어도 같은 무리·같은 순서다`, () => {
      const a = computeTidyGrouping(items, id, { edges });
      const b = computeTidyGrouping([...items].reverse(), id, { edges });
      expect(b.order).toEqual(a.order);
      for (const it of items) {
        expect(b.groupById.get(it.id)).toBe(a.groupById.get(it.id));
      }
    });
  }

  it('빈 캔버스에서도 터지지 않는다', () => {
    for (const { id } of TIDY_SORTS) {
      const g = computeTidyGrouping([], id, { edges: [] });
      expect(g.order).toEqual([]);
      expect(g.groupById.size).toBe(0);
    }
  });
});

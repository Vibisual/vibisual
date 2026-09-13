import { describe, it, expect } from 'vitest';
import { TIDY_BAND_ORDER, TIDY_LAYOUT } from '@vibisual/shared';
import type { BubbleType, NodeStatus, TidyBand } from '@vibisual/shared';
import {
  computeTidyLayout,
  computeTidySatellites,
  tidyBandOf,
  type TidyPlacement,
  type TidyItem,
  type TidyParentSeat,
  type TidySatellite,
} from './tidyLayout.js';

/**
 * §5.4 #33 버블 정리 — 좌표·기하는 렌더링 없이 확인하는 편이 정확하다
 * (`physicsGeometry`·`bubbleTextFit` 선례). 여기서 고정하는 것은 세 가지다:
 * ① 겹치지 않는가 ② 띠 순서가 지켜지는가 ③ 가장 덜 움직이는 자리로 가는가.
 */

const CENTER = { x: 500, y: 400 };

function item(id: string, band: TidyBand, cx: number, cy: number, diameter = 80): TidyItem {
  // §5.4 #33 (I) 이후 무리 키는 일반 문자열이고 순서는 `groupOrder` 가 정한다. 띠 이름을
  // 그대로 키로 쓰면 기본 순서표(`TIDY_BAND_ORDER`)가 그대로 적용돼 종전 동작이 된다.
  return { id, group: band, cx, cy, diameter };
}

/** 배치 결과에서 가장 심한 겹침(양수면 겹친 것). */
function worstOverlap(
  placements: Array<{ id: string; cx: number; cy: number }>,
  diameterById: Map<string, number>,
): number {
  let worst = -Infinity;
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i]!;
      const b = placements[j]!;
      const ra = (diameterById.get(a.id) ?? 0) / 2;
      const rb = (diameterById.get(b.id) ?? 0) / 2;
      const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      worst = Math.max(worst, ra + rb - dist);
    }
  }
  return worst;
}

describe('tidyBandOf — 무엇이 어느 띠로 가는가', () => {
  it('에이전트는 상태가 띠를 정한다', () => {
    expect(tidyBandOf('agent', 'active')).toBe('running');
    expect(tidyBandOf('agent', 'awaiting_permission')).toBe('running');
    expect(tidyBandOf('agent', 'completed')).toBe('attention');
    // 실패는 완료가 아니다(§2.4) — 그래도 "봐 줘야 하는 것"이라 같은 띠에 선다.
    expect(tidyBandOf('agent', 'error')).toBe('attention');
    expect(tidyBandOf('agent', 'idle')).toBe('waiting');
    expect(tidyBandOf('agent', 'disappearing')).toBe('waiting');
  });

  it('파이프라인·Auto 도 에이전트와 같은 규칙을 탄다', () => {
    expect(tidyBandOf('pipeline', 'active')).toBe('running');
    expect(tidyBandOf('auto', 'completed')).toBe('attention');
  });

  it('폴더 계열은 상태와 무관하게 한 띠다 — worktree 도 "일하는 자리"라 함께', () => {
    for (const t of ['internal_folder', 'external_folder', 'worktree'] as BubbleType[]) {
      for (const s of ['active', 'idle', 'completed'] as NodeStatus[]) {
        expect(tidyBandOf(t, s)).toBe('folder');
      }
    }
  });

  it('탐색 손잡이와 안 그리는 타입은 자리를 옮기지 않는다', () => {
    expect(tidyBandOf('back', 'idle')).toBeNull();
    expect(tidyBandOf('root', 'idle')).toBeNull();
    expect(tidyBandOf('bash', 'active')).toBeNull();
  });

  it('나머지는 종류가 곧 띠다', () => {
    for (const t of ['file', 'ghost', 'iframe', 'domain', 'trash', 'conti', 'video'] as BubbleType[]) {
      expect(tidyBandOf(t, 'idle')).toBe('other');
    }
  });
});

describe('computeTidyLayout — 줄 세우기 배치 (§5.4 #33 I-5)', () => {
  /** 순위를 가진 항목 — 작을수록 앞(왼쪽). 무리 키는 임의 문자열이다(기하는 뜻을 모른다). */
  function ranked(id: string, group: string, rank: number, diameter = 80): TidyItem {
    return { id, group, rank, cx: 500, cy: 400, diameter };
  }

  /** 이 버블의 왼쪽 테두리 x — "모든 줄이 같은 선에서 시작하는가"를 재는 자. */
  const leftEdge = (s: { cx: number; id: string }, dia: Map<string, number>): number =>
    s.cx - (dia.get(s.id) ?? 0) / 2;

  /** 같은 무리끼리 묶어 평균 y 를 낸다. */
  function meanY(seats: TidyPlacement[], ids: readonly string[]): number {
    const picked = seats.filter((s) => ids.includes(s.id));
    return picked.reduce((a, s) => a + s.cy, 0) / picked.length;
  }

  it('아무것도 없으면 아무 자리도 만들지 않는다', () => {
    expect(computeTidyLayout([], { center: CENTER, aspect: 1 })).toEqual([]);
    expect(computeTidyLayout([], { center: CENTER, aspect: 1, groupOrder: [], geometry: 'rows' })).toEqual([]);
  });

  it('칸이 순서대로 위에서 아래로 쌓인다 — 순위가 곧 세로 자리다', () => {
    const items = [
      ranked('a1', 'a', 0), ranked('a2', 'a', 1),
      ranked('b1', 'b', 0), ranked('b2', 'b', 1),
      ranked('c1', 'c', 0), ranked('c2', 'c', 1),
    ];
    const seats = computeTidyLayout(items, {
      center: CENTER, aspect: 0.73, groupOrder: ['a', 'b', 'c'], geometry: 'rows',
    });
    expect(seats).toHaveLength(items.length);
    const ya = meanY(seats, ['a1', 'a2']);
    const yb = meanY(seats, ['b1', 'b2']);
    const yc = meanY(seats, ['c1', 'c2']);
    expect(ya).toBeLessThan(yb);
    expect(yb).toBeLessThan(yc);
  });

  it('칸 안은 rank 순으로 왼쪽부터 — 이게 기준이 보이는 자리다', () => {
    // 일부러 거꾸로 넣는다(입력 순서가 아니라 순위가 자리를 정하는지 본다).
    const items = [
      ranked('e', 'q0', 4), ranked('d', 'q0', 3), ranked('c', 'q0', 2),
      ranked('b', 'q0', 1), ranked('a', 'q0', 0),
    ];
    const seats = computeTidyLayout(items, {
      center: CENTER, aspect: 0.73, groupOrder: ['q0'], geometry: 'rows',
    });
    const byId = new Map(seats.map((s) => [s.id, s]));
    const xs = ['a', 'b', 'c', 'd', 'e'].map((id) => byId.get(id)!.cx);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });

  it('순위가 없으면 id 순이다 — 없는 순서를 지어내지 않으면서 흔들리지도 않게', () => {
    const items: TidyItem[] = [
      { id: 'c', group: 'g', cx: 100, cy: 900, diameter: 80 },
      { id: 'a', group: 'g', cx: 900, cy: 100, diameter: 80 },
      { id: 'b', group: 'g', cx: 300, cy: 700, diameter: 80 },
    ];
    const seats = new Map(
      computeTidyLayout(items, { center: CENTER, aspect: 1, groupOrder: ['g'], geometry: 'rows' })
        .map((s) => [s.id, s]),
    );
    expect(seats.get('a')!.cx).toBeLessThan(seats.get('b')!.cx);
    expect(seats.get('b')!.cx).toBeLessThan(seats.get('c')!.cx);
  });

  it('순위가 있는 것이 없는 것보다 앞선다 — 잰 적 없는 것이 앞자리를 먹지 않게', () => {
    const items: TidyItem[] = [
      { id: 'unmeasured', group: 'g', cx: 100, cy: 100, diameter: 80 },
      ranked('measured', 'g', 7),
    ];
    const seats = new Map(
      computeTidyLayout(items, { center: CENTER, aspect: 1, groupOrder: ['g'], geometry: 'rows' })
        .map((s) => [s.id, s]),
    );
    expect(seats.get('measured')!.cx).toBeLessThan(seats.get('unmeasured')!.cx);
  });

  it('모든 줄이 같은 왼쪽 선에서 시작한다 — 그 선 하나가 칸 경계를 그린다', () => {
    // 칸마다 개수가 다르고, 한 칸은 예산을 넘겨 두 줄로 접히게 만든다.
    const items: TidyItem[] = [];
    for (let i = 0; i < 9; i++) items.push(ranked(`a${i}`, 'a', i));
    items.push(ranked('b0', 'b', 0));
    for (let i = 0; i < 3; i++) items.push(ranked(`c${i}`, 'c', i));
    const dia = new Map(items.map((i) => [i.id, i.diameter]));
    const seats = computeTidyLayout(items, {
      center: CENTER, aspect: 0.73, groupOrder: ['a', 'b', 'c'], geometry: 'rows', width: 600,
    });
    // 줄의 첫 버블 = 그 줄에서 가장 왼쪽인 것. 줄은 y 로 갈린다.
    const byRow = new Map<number, TidyPlacement[]>();
    for (const s of seats) {
      const key = Math.round(s.cy);
      const row = byRow.get(key);
      if (row) row.push(s);
      else byRow.set(key, [s]);
    }
    expect(byRow.size).toBeGreaterThan(3); // 접힌 줄이 실제로 생겼는지 먼저 확인
    const lefts = [...byRow.values()].map((row) =>
      Math.min(...row.map((s) => leftEdge(s, dia))));
    for (const l of lefts) expect(l).toBeCloseTo(lefts[0]!, 6);
  });

  it('칸 사이가 줄 사이보다 확실히 넓다 — "여기서 갈렸다"가 읽히는 유일한 근거', () => {
    const items: TidyItem[] = [];
    for (let i = 0; i < 8; i++) items.push(ranked(`a${i}`, 'a', i));
    for (let i = 0; i < 8; i++) items.push(ranked(`b${i}`, 'b', i));
    const seats = computeTidyLayout(items, {
      center: CENTER, aspect: 0.73, groupOrder: ['a', 'b'], geometry: 'rows', width: 600,
    });
    const rows = [...new Set(seats.map((s) => Math.round(s.cy)))].sort((p, q) => p - q);
    expect(rows.length).toBeGreaterThanOrEqual(4); // 칸마다 두 줄 이상으로 접혔다
    const gaps = rows.slice(1).map((y, i) => y - rows[i]!);
    // 지름이 모두 같으므로 줄 사이는 지름+ROW_GAP, 칸 사이는 지름+BAND_GAP 이 정확히 나온다.
    expect(Math.min(...gaps)).toBeCloseTo(80 + TIDY_LAYOUT.ROW_GAP, 6);
    expect(Math.max(...gaps)).toBeCloseTo(80 + TIDY_LAYOUT.BAND_GAP, 6);
  });

  it('많이 넣어도 겹치지 않는다 — 지름이 제각각이어도', () => {
    const items: TidyItem[] = [];
    const groups = ['running', 'attention', 'waiting', 'folder', 'other'];
    for (let i = 0; i < 160; i++) {
      items.push(ranked(`n${i}`, groups[i % groups.length]!, i, 70 + (i % 6) * 18));
    }
    const seats = computeTidyLayout(items, {
      center: CENTER, aspect: 1100 / 1500, groupOrder: groups, geometry: 'rows', width: 3000,
    });
    expect(seats).toHaveLength(items.length);
    expect(worstOverlap(seats, new Map(items.map((i) => [i.id, i.diameter])))).toBeLessThanOrEqual(0);
  });

  it('한 줄은 상자 가로를 넘지 않는다 — 넘기면 물리 클램프가 도로 누른다', () => {
    const items: TidyItem[] = [];
    for (let i = 0; i < 40; i++) items.push(ranked(`n${i}`, 'g', i));
    const dia = new Map(items.map((i) => [i.id, i.diameter]));
    const width = 1000;
    const seats = computeTidyLayout(items, {
      center: CENTER, aspect: 0.73, groupOrder: ['g'], geometry: 'rows', width,
    });
    const spanX = Math.max(...seats.map((s) => s.cx + dia.get(s.id)! / 2))
      - Math.min(...seats.map((s) => s.cx - dia.get(s.id)! / 2));
    expect(spanX).toBeLessThanOrEqual(width * TIDY_LAYOUT.LANE_FILL + 1);
  });

  it('상자를 안 주면 가장 긴 칸이 한 줄로 선다 — 칸 하나가 한 줄이 기본이다', () => {
    const items: TidyItem[] = [];
    for (let i = 0; i < 12; i++) items.push(ranked(`n${i}`, 'g', i));
    const seats = computeTidyLayout(items, {
      center: CENTER, aspect: 0.73, groupOrder: ['g'], geometry: 'rows',
    });
    expect(new Set(seats.map((s) => Math.round(s.cy))).size).toBe(1);
  });

  it('어떤 폭으로도 안 들어가면 상자와 같은 비율로 넘친다 — 세로로만 무너지지 않게', () => {
    const items: TidyItem[] = [];
    for (let i = 0; i < 300; i++) items.push(ranked(`n${i}`, 'g', i));
    const dia = new Map(items.map((i) => [i.id, i.diameter]));
    const width = 600;
    const aspect = 0.73;
    const seats = computeTidyLayout(items, {
      center: CENTER, aspect, groupOrder: ['g'], geometry: 'rows', width,
    });
    const spanX = Math.max(...seats.map((s) => s.cx + dia.get(s.id)! / 2))
      - Math.min(...seats.map((s) => s.cx - dia.get(s.id)! / 2));
    const spanY = Math.max(...seats.map((s) => s.cy + dia.get(s.id)! / 2))
      - Math.min(...seats.map((s) => s.cy - dia.get(s.id)! / 2));
    // 상자 폭을 일부러 넘겼고(가로로 넓어졌다), 그 모양은 상자 비율을 닮았다.
    expect(spanX).toBeGreaterThan(width);
    expect(spanY / spanX).toBeGreaterThan(aspect * 0.5);
    expect(spanY / spanX).toBeLessThan(aspect * 1.8);
  });

  it('칸 번호는 순서를 따라간다 — 출발 시각을 어긋나게 하는 근거', () => {
    const items = [ranked('a', 'a', 0), ranked('b', 'b', 0), ranked('c', 'c', 0)];
    const seats = new Map(
      computeTidyLayout(items, {
        center: CENTER, aspect: 1, groupOrder: ['a', 'b', 'c'], geometry: 'rows',
      }).map((s) => [s.id, s]),
    );
    expect(seats.get('a')!.bandIndex).toBe(0);
    expect(seats.get('b')!.bandIndex).toBe(1);
    expect(seats.get('c')!.bandIndex).toBe(2);
  });

  it('빈 칸은 번호를 먹지 않는다 — 없는 칸 때문에 출발이 늦어지지 않게', () => {
    const items = [ranked('x', 'other', 0), ranked('y', 'other', 1)];
    const seats = computeTidyLayout(items, {
      center: CENTER, aspect: 1, groupOrder: TIDY_BAND_ORDER, geometry: 'rows',
    });
    for (const s of seats) expect(s.bandIndex).toBe(0);
  });

  it('전체가 캔버스 중심에 맞는다 — 정리했더니 한쪽으로 쏠려 있지 않게', () => {
    const items: TidyItem[] = [];
    for (let i = 0; i < 7; i++) items.push(ranked(`a${i}`, 'a', i));
    items.push(ranked('b0', 'b', 0));
    const dia = new Map(items.map((i) => [i.id, i.diameter]));
    const seats = computeTidyLayout(items, {
      center: CENTER, aspect: 0.73, groupOrder: ['a', 'b'], geometry: 'rows', width: 3000,
    });
    const minX = Math.min(...seats.map((s) => s.cx - dia.get(s.id)! / 2));
    const maxX = Math.max(...seats.map((s) => s.cx + dia.get(s.id)! / 2));
    const minY = Math.min(...seats.map((s) => s.cy - dia.get(s.id)! / 2));
    const maxY = Math.max(...seats.map((s) => s.cy + dia.get(s.id)! / 2));
    expect((minX + maxX) / 2).toBeCloseTo(CENTER.x, 6);
    expect((minY + maxY) / 2).toBeCloseTo(CENTER.y, 6);
  });

  it('순서표에 없는 무리도 떨어뜨리지 않는다', () => {
    const items = [ranked('a', 'known', 0), ranked('b', 'stray', 0)];
    const seats = computeTidyLayout(items, {
      center: CENTER, aspect: 1, groupOrder: ['known'], geometry: 'rows',
    });
    expect(seats.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('같은 입력은 늘 같은 그림을 낸다 — 입력 순서가 바뀌어도', () => {
    const items = [
      ranked('a', 'a', 0), ranked('b', 'a', 1), ranked('c', 'b', 0), ranked('d', 'b', 1),
    ];
    const opts = { center: CENTER, aspect: 0.73, groupOrder: ['a', 'b'], geometry: 'rows' as const, width: 3000 };
    const first = computeTidyLayout(items, opts);
    const second = computeTidyLayout([...items].reverse(), opts);
    expect(new Map(second.map((s) => [s.id, s]))).toEqual(new Map(first.map((s) => [s.id, s])));
  });

  it('예산보다 큰 버블도 빠뜨리지 않는다 — 자리는 좁아도 앉는다', () => {
    const items = [ranked('huge', 'g', 0, 900), ranked('small', 'g', 1, 60)];
    const seats = computeTidyLayout(items, {
      center: CENTER, aspect: 0.73, groupOrder: ['g'], geometry: 'rows', width: 200,
    });
    expect(seats).toHaveLength(2);
    expect(worstOverlap(seats, new Map(items.map((i) => [i.id, i.diameter])))).toBeLessThanOrEqual(0);
  });

  it('기하를 안 주면 줄 세우기다 — 새 기준이 빠뜨려도 순서가 읽히는 쪽에 앉는다', () => {
    const items = [ranked('a', 'a', 0), ranked('b', 'b', 0)];
    const withRows = computeTidyLayout(items, {
      center: CENTER, aspect: 0.73, groupOrder: ['a', 'b'], geometry: 'rows',
    });
    const bare = computeTidyLayout(items, { center: CENTER, aspect: 0.73, groupOrder: ['a', 'b'] });
    expect(new Map(bare.map((s) => [s.id, s]))).toEqual(new Map(withRows.map((s) => [s.id, s])));
  });
});

describe('computeTidyLayout — 덩어리 기하 (§5.4 #33 I-1)', () => {
  /** 무리 키를 그대로 쓰는 항목(띠가 아닌 임의 무리를 만들기 위한 것). */
  function member(id: string, group: string, cx: number, cy: number, diameter = 80): TidyItem {
    return { id, group, cx, cy, diameter };
  }

  /**
   * 덩어리는 **두 번 접어** 앉힌다(무리 안 배치 → 무리 자체 배치 → 평행이동). 그래서 딱 맞닿은
   * 이웃끼리 부동소수점 오차가 한 번 더 얹힌다(실측 2.8e-14px). 화면에서 이것은 원자보다 작은
   * 값이라 겹침이 아니다 — 동심 띠(한 번 접기)는 오차 없이 0 이하라 그쪽 검사는 그대로 둔다.
   */
  const FP_SLACK = 1e-9;

  /** 한 무리 안에서 가장 먼 두 버블의 거리 — 무리가 얼마나 퍼져 앉았나. */
  function spreadOf(seats: Map<string, { cx: number; cy: number }>, ids: readonly string[]): number {
    let worst = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = seats.get(ids[i]!)!;
        const b = seats.get(ids[j]!)!;
        worst = Math.max(worst, Math.hypot(a.cx - b.cx, a.cy - b.cy));
      }
    }
    return worst;
  }

  /** 무리 하나가 셋씩, 셋. 처음엔 전부 섞여 흩어져 있다. */
  function mixedItems(): TidyItem[] {
    const groups = ['file', 'folder', 'agent'];
    const out: TidyItem[] = [];
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * Math.PI * 2;
      out.push(member(`n${i}`, groups[i % 3]!, 500 + Math.cos(angle) * 600, 400 + Math.sin(angle) * 600));
    }
    return out;
  }
  const ORDER = ['file', 'folder', 'agent'];
  const idsOf = (items: TidyItem[], group: string): string[] =>
    items.filter((i) => i.group === group).map((i) => i.id);

  it('같은 무리가 서로 붙고, 다른 무리와는 멀어진다 — "유사한 것끼리 모이게"', () => {
    const items = mixedItems();
    const seats = new Map(
      computeTidyLayout(items, { center: CENTER, aspect: 0.73, groupOrder: ORDER, geometry: 'clusters' })
        .map((s) => [s.id, s]),
    );
    expect(seats.size).toBe(items.length);
    const spreads = ORDER.map((g) => spreadOf(seats, idsOf(items, g)));
    // 무리 안의 최대 거리보다, 무리끼리의 거리가 확실히 멀어야 "덩어리"로 읽힌다.
    const centroid = (g: string): { x: number; y: number } => {
      const ids = idsOf(items, g);
      let x = 0; let y = 0;
      for (const id of ids) { x += seats.get(id)!.cx; y += seats.get(id)!.cy; }
      return { x: x / ids.length, y: y / ids.length };
    };
    let nearestClusterGap = Infinity;
    for (let i = 0; i < ORDER.length; i++) {
      for (let j = i + 1; j < ORDER.length; j++) {
        const a = centroid(ORDER[i]!);
        const b = centroid(ORDER[j]!);
        nearestClusterGap = Math.min(nearestClusterGap, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    expect(nearestClusterGap).toBeGreaterThan(Math.max(...spreads));
  });

  it('덩어리로 앉혀도 겹치지 않는다', () => {
    const items = mixedItems();
    const seats = computeTidyLayout(items, { center: CENTER, aspect: 0.73, groupOrder: ORDER, geometry: 'clusters' });
    const dia = new Map(items.map((i) => [i.id, i.diameter]));
    expect(worstOverlap(seats, dia)).toBeLessThanOrEqual(FP_SLACK);
  });

  it('같은 무리가 동심 띠에서는 흩어지고 덩어리에서는 모인다 — 기하를 가른 이유', () => {
    const items = mixedItems();
    const ringSeats = new Map(
      computeTidyLayout(items, { center: CENTER, aspect: 0.73, groupOrder: ORDER })
        .map((s) => [s.id, s]),
    );
    const clusterSeats = new Map(
      computeTidyLayout(items, { center: CENTER, aspect: 0.73, groupOrder: ORDER, geometry: 'clusters' })
        .map((s) => [s.id, s]),
    );
    for (const g of ORDER) {
      const ids = idsOf(items, g);
      expect(spreadOf(clusterSeats, ids)).toBeLessThan(spreadOf(ringSeats, ids));
    }
  });

  it('무리가 하나뿐이면 정중앙에 선다', () => {
    const items = [member('a', 'only', 900, 900), member('b', 'only', 100, 200)];
    const seats = computeTidyLayout(items, { center: CENTER, aspect: 1, groupOrder: ['only'], geometry: 'clusters' });
    let x = 0; let y = 0;
    for (const s of seats) { x += s.cx; y += s.cy; }
    expect(x / seats.length).toBeCloseTo(CENTER.x, 0);
    expect(y / seats.length).toBeCloseTo(CENTER.y, 0);
  });

  it('한 장짜리 무리도 제자리를 얻는다', () => {
    const items = [
      member('solo', 'a', 200, 200),
      member('x', 'b', 800, 300), member('y', 'b', 810, 320),
    ];
    const seats = computeTidyLayout(items, { center: CENTER, aspect: 0.8, groupOrder: ['b', 'a'], geometry: 'clusters' });
    expect(seats.map((s) => s.id).sort()).toEqual(['solo', 'x', 'y']);
    expect(worstOverlap(seats, new Map(items.map((i) => [i.id, i.diameter])))).toBeLessThanOrEqual(FP_SLACK);
  });

  it('순서표에 없는 무리도 떨어뜨리지 않는다 — 나눔이 어긋나도 제자리에 남지 않게', () => {
    const items = [member('a', 'known', 300, 300), member('b', 'stray', 700, 500)];
    const seats = computeTidyLayout(items, { center: CENTER, aspect: 1, groupOrder: ['known'], geometry: 'clusters' });
    expect(seats.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('덩어리 순서가 곧 출발 박자다 — 앞 무리가 먼저 앉는다', () => {
    const items = mixedItems();
    const seats = computeTidyLayout(items, { center: CENTER, aspect: 0.73, groupOrder: ORDER, geometry: 'clusters' });
    const bandOf = (group: string): number => seats.find((s) => s.id === idsOf(items, group)[0]!)!.bandIndex;
    expect(bandOf('file')).toBe(0);
    expect(bandOf('folder')).toBe(1);
    expect(bandOf('agent')).toBe(2);
  });

  it('같은 입력이면 늘 같은 그림이다', () => {
    const items = mixedItems();
    const opts = { center: CENTER, aspect: 0.73, groupOrder: ORDER, geometry: 'clusters' as const };
    const first = computeTidyLayout(items, opts);
    const second = computeTidyLayout([...items].reverse(), opts);
    expect(new Map(second.map((s) => [s.id, s]))).toEqual(new Map(first.map((s) => [s.id, s])));
  });

  it('빈 캔버스에서도 터지지 않는다', () => {
    expect(computeTidyLayout([], { center: CENTER, aspect: 1, groupOrder: [], geometry: 'clusters' })).toEqual([]);
  });
});

describe('computeTidyLayout — 덩어리의 주인 고정 (§5.4 #33 I-3)', () => {
  const FP_SLACK = 1e-9;

  function member(id: string, group: string, cx: number, cy: number, diameter = 80): TidyItem {
    return { id, group, cx, cy, diameter };
  }

  /** 에이전트 하나 + 그가 건드린 것들, 두 무리. 처음엔 전부 섞여 흩어져 있다. */
  function lineageItems(): TidyItem[] {
    const out: TidyItem[] = [member('A', 'A', 520, 380, 120), member('B', 'B', 480, 420, 120)];
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      out.push(member(`a${i}`, 'A', 500 + Math.cos(angle) * 700, 400 + Math.sin(angle) * 700));
      out.push(member(`b${i}`, 'B', 500 + Math.sin(angle) * 500, 400 + Math.cos(angle) * 500, 60));
    }
    return out;
  }
  const ORDER = ['A', 'B'];
  const ANCHORS = new Map([['A', 'A'], ['B', 'B']]);
  const OPTS = { center: CENTER, aspect: 0.73, groupOrder: ORDER, geometry: 'clusters' as const };

  const seatMap = (items: TidyItem[], anchors?: ReadonlyMap<string, string>): Map<string, TidyPlacement> =>
    new Map(computeTidyLayout(items, { ...OPTS, anchorByGroup: anchors }).map((s) => [s.id, s]));

  it('주인이 제 무리의 가운데에 앉는다 — 가운데 한 장이 그 무리의 이름표다', () => {
    const items = lineageItems();
    const seats = seatMap(items, ANCHORS);
    for (const hub of ORDER) {
      const ids = items.filter((i) => i.group === hub).map((i) => i.id);
      /** 이 버블에서 같은 무리의 나머지까지의 평균 거리 — 작을수록 가운데다. */
      const meanDist = (from: string): number => {
        const others = ids.filter((id) => id !== from);
        const sum = others.reduce((acc, id) => acc + Math.hypot(
          seats.get(from)!.cx - seats.get(id)!.cx,
          seats.get(from)!.cy - seats.get(id)!.cy,
        ), 0);
        return sum / others.length;
      };
      const hubMean = meanDist(hub);
      for (const id of ids.filter((i) => i !== hub)) {
        expect(hubMean).toBeLessThan(meanDist(id));
      }
    }
  });

  it('주인 둘레에 궤도로 앉고 주인을 밟지 않는다', () => {
    const items = lineageItems();
    const seats = seatMap(items, ANCHORS);
    const dia = new Map(items.map((i) => [i.id, i.diameter]));
    for (const hub of ORDER) {
      const hubSeat = seats.get(hub)!;
      for (const it of items.filter((i) => i.group === hub && i.id !== hub)) {
        const d = Math.hypot(hubSeat.cx - seats.get(it.id)!.cx, hubSeat.cy - seats.get(it.id)!.cy);
        expect(d).toBeGreaterThanOrEqual(
          (dia.get(hub)! + it.diameter) / 2 + TIDY_LAYOUT.RING_GAP - 1e-6,
        );
      }
    }
    expect(worstOverlap([...seats.values()], dia)).toBeLessThanOrEqual(FP_SLACK);
  });

  it('주인을 안 넘기면 덩어리 그림이 그대로다 — `kind` 가 이 개편에서 안 바뀌는 이유', () => {
    const items = lineageItems();
    // 빈 표와 아예 안 넘긴 것이 같은 그림이어야 `kind` 경로가 갈리지 않는다.
    expect(seatMap(items, new Map())).toEqual(seatMap(items));
    // 주인을 넘기면 달라진다 — 안 바뀌었다면 고정이 아무것도 안 했다는 뜻이다.
    expect(seatMap(items, ANCHORS)).not.toEqual(seatMap(items));
  });

  it('주인이 그 무리에 없으면 조용히 종전 그림이다 — 어긋난 표가 버블을 떨어뜨리지 않게', () => {
    const items = lineageItems();
    const stray = new Map([['A', 'not-on-screen']]);
    const seats = seatMap(items, stray);
    expect(seats.size).toBe(items.length);
    expect(seats).toEqual(seatMap(items));
  });

  it('구성원이 없는 주인은 혼자 제자리에 앉는다', () => {
    const items = [member('A', 'A', 900, 100, 120), member('x', 'B', 200, 700)];
    const seats = new Map(
      computeTidyLayout(items, { ...OPTS, anchorByGroup: new Map([['A', 'A']]) })
        .map((s) => [s.id, s]),
    );
    expect(seats.size).toBe(2);
    expect(worstOverlap([...seats.values()], new Map(items.map((i) => [i.id, i.diameter]))))
      .toBeLessThanOrEqual(FP_SLACK);
  });
});

describe('computeTidyLayout — groupOrder (§5.4 #33 I)', () => {
  it('안 주면 종전대로 띠 순서(TIDY_BAND_ORDER)를 따른다', () => {
    const items = [item('f', 'folder', 200, 200), item('r', 'running', 900, 900)];
    const seats = new Map(computeTidyLayout(items, { center: CENTER, aspect: 1 }).map((s) => [s.id, s]));
    expect(seats.get('r')!.bandIndex).toBeLessThan(seats.get('f')!.bandIndex);
    expect(seats.get('r')!.cy).toBeLessThan(seats.get('f')!.cy);
  });

  it('순서를 주면 그 순서가 위→아래를 정한다 — 기하는 기준의 뜻을 알지 못한다', () => {
    const items: TidyItem[] = [
      { id: 'hot', group: 'q0', cx: 900, cy: 900, diameter: 80 },
      { id: 'cold', group: 'q4', cx: 200, cy: 200, diameter: 80 },
    ];
    const seats = new Map(
      computeTidyLayout(items, { center: CENTER, aspect: 1, groupOrder: ['q0', 'q4'] }).map((s) => [s.id, s]),
    );
    expect(seats.get('hot')!.cy).toBeLessThan(seats.get('cold')!.cy);
  });
});

describe('computeTidySatellites — 부모 곁 궤도', () => {
  const parents = new Map<string, TidyParentSeat>([
    ['p1', { cx: 1000, cy: 1000, diameter: 120, bandIndex: 2 }],
  ]);

  it('부모가 정리 대상이 아니면 위성도 그대로 둔다', () => {
    const sats: TidySatellite[] = [{ id: 's1', parentId: 'ghost-parent', diameter: 30, cx: 0, cy: 0 }];
    expect(computeTidySatellites(sats, parents)).toEqual([]);
  });

  it('부모 바깥에 걸리고 서로 겹치지 않는다', () => {
    const sats: TidySatellite[] = [];
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      sats.push({ id: `s${i}`, parentId: 'p1', diameter: 30 + (i % 3) * 10, cx: 1000 + Math.cos(angle) * 90, cy: 1000 + Math.sin(angle) * 90 });
    }
    const seats = computeTidySatellites(sats, parents);
    expect(seats).toHaveLength(sats.length);
    const dia = new Map(sats.map((s) => [s.id, s.diameter]));
    expect(worstOverlap(seats, dia)).toBeLessThanOrEqual(0);
    // 부모 원 안으로 파고들지 않는다.
    for (const seat of seats) {
      const r = Math.hypot(seat.cx - 1000, seat.cy - 1000);
      expect(r - (dia.get(seat.id)! / 2)).toBeGreaterThanOrEqual(60);
    }
  });

  it('위성의 띠 번호는 부모의 것을 물려받는다 — 부모와 같은 박자로 움직이게', () => {
    const sats: TidySatellite[] = [{ id: 's1', parentId: 'p1', diameter: 30, cx: 1100, cy: 1000 }];
    expect(computeTidySatellites(sats, parents)[0]!.bandIndex).toBe(2);
  });
});

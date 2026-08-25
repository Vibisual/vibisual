import { describe, it, expect } from 'vitest';
import {
  IDE_SPLIT,
  adjacentCellId,
  canSplit,
  cellCount,
  cellIdForSession,
  cellSessionIds,
  closeCell,
  dropOnCell,
  evenSplitSizes,
  findCell,
  listCells,
  makeCell,
  moveSplitter,
  normalizeNode,
  normalizeSizes,
  pruneCells,
  setBranchSizes,
  setCellSession,
  type SplitIdFactory,
  type SplitNode,
} from './splitLayout.js';

/**
 * §5.5 #17-34 — 창 안 분할 트리 회귀.
 *
 * 고정하는 약속: ① 같은 축으로 계속 나눠도 트리는 **한 겹**으로 펴진다(비율이 층층이 곱해져 마지막
 * 칸만 좁아지는 것 방지) ② 칸을 닫으면 남은 쪽이 가지를 대신한다 ③ 사라진 세션을 문 칸은 스스로
 * 걷힌다 ④ 비율 합은 언제나 1. 이게 어긋나면 화면이 무너지거나 빈 칸이 남는다.
 */

/** 시험용 결정적 id — 트리를 통째로 비교할 수 있게. */
function seqIds(): SplitIdFactory {
  let n = 0;
  return (kind) => { n += 1; return `${kind}${n}`; };
}

const near = (v: number | undefined, expected: number): void => {
  expect(v ?? -1).toBeCloseTo(expected, 6);
};

describe('splitLayout — 만들기·읽기', () => {
  it('칸 하나면 그 칸이 곧 트리', () => {
    const cell = makeCell('s1', seqIds());
    expect(cellCount(cell)).toBe(1);
    expect(listCells(cell).map((c) => c.sessionId)).toEqual(['s1']);
    expect(findCell(cell, cell.id)?.sessionId).toBe('s1');
    expect(findCell(cell, 'nope')).toBeNull();
  });

  it('메인 탭(null)도 칸이 될 수 있고, 세션 집합에서는 빠진다', () => {
    const ids = seqIds();
    const main = makeCell(null, ids);
    const dropped = dropOnCell(main, main.id, 'right', 's2', ids);
    expect(dropped).not.toBeNull();
    const layout = dropped?.layout as SplitNode;
    expect(cellSessionIds(layout)).toEqual(new Set(['s2']));
    expect(cellIdForSession(layout, null)).toBe(main.id);
    expect(cellIdForSession(layout, 'nope')).toBeNull();
  });
});

describe('splitLayout — 떨구기', () => {
  it('오른쪽에 떨구면 좌우 가지, 새 칸이 뒤에 서고 초점을 받는다', () => {
    const ids = seqIds();
    const root = makeCell('a', ids);
    const res = dropOnCell(root, root.id, 'right', 'b', ids);
    expect(res).not.toBeNull();
    const layout = res?.layout as SplitNode;
    expect(layout.kind).toBe('branch');
    if (layout.kind !== 'branch') return;
    expect(layout.axis).toBe('row');
    expect(layout.children.map((c) => (c.kind === 'cell' ? c.sessionId : '?'))).toEqual(['a', 'b']);
    near(layout.sizes[0], 0.5);
    near(layout.sizes[1], 0.5);
    expect(res?.focusCellId).toBe(listCells(layout)[1]?.id);
  });

  it('왼쪽/위에 떨구면 새 칸이 앞에 선다', () => {
    const ids = seqIds();
    const root = makeCell('a', ids);
    const left = dropOnCell(root, root.id, 'left', 'b', ids)?.layout as SplitNode;
    expect(listCells(left).map((c) => c.sessionId)).toEqual(['b', 'a']);

    const ids2 = seqIds();
    const root2 = makeCell('a', ids2);
    const top = dropOnCell(root2, root2.id, 'top', 'b', ids2)?.layout as SplitNode;
    expect(top.kind === 'branch' ? top.axis : null).toBe('col');
    expect(listCells(top).map((c) => c.sessionId)).toEqual(['b', 'a']);
  });

  it('같은 축이면 형제로 끼워지고, 몫은 대상 칸에서만 나온다(옆 칸 비율 불변)', () => {
    const ids = seqIds();
    const root = makeCell('a', ids);
    const first = dropOnCell(root, root.id, 'right', 'b', ids)?.layout as SplitNode;
    const bCell = listCells(first)[1];
    const second = dropOnCell(first, bCell?.id ?? '', 'right', 'c', ids)?.layout as SplitNode;
    expect(second.kind).toBe('branch');
    if (second.kind !== 'branch') return;
    // 한 겹으로 유지 — 자식 셋이 나란히.
    expect(second.children.every((c) => c.kind === 'cell')).toBe(true);
    expect(listCells(second).map((c) => c.sessionId)).toEqual(['a', 'b', 'c']);
    near(second.sizes[0], 0.5);
    near(second.sizes[1], 0.25);
    near(second.sizes[2], 0.25);
  });

  it('축이 다르면 그 칸만 감싸고 이웃은 그대로', () => {
    const ids = seqIds();
    const root = makeCell('a', ids);
    const row = dropOnCell(root, root.id, 'right', 'b', ids)?.layout as SplitNode;
    const bCell = listCells(row)[1];
    const mixed = dropOnCell(row, bCell?.id ?? '', 'bottom', 'c', ids)?.layout as SplitNode;
    expect(mixed.kind).toBe('branch');
    if (mixed.kind !== 'branch') return;
    expect(mixed.axis).toBe('row');
    expect(mixed.children[0]?.kind).toBe('cell');
    const nested = mixed.children[1];
    expect(nested?.kind).toBe('branch');
    if (nested?.kind !== 'branch') return;
    expect(nested.axis).toBe('col');
    expect(listCells(mixed).map((c) => c.sessionId)).toEqual(['a', 'b', 'c']);
  });

  it('가운데는 나누지 않고 그 칸의 내용만 갈아 끼운다', () => {
    const ids = seqIds();
    const root = makeCell('a', ids);
    const row = dropOnCell(root, root.id, 'right', 'b', ids)?.layout as SplitNode;
    const target = listCells(row)[0];
    const res = dropOnCell(row, target?.id ?? '', 'center', 'z', ids);
    expect(cellCount(res?.layout as SplitNode)).toBe(2);
    expect(listCells(res?.layout as SplitNode).map((c) => c.sessionId)).toEqual(['z', 'b']);
    expect(res?.focusCellId).toBe(target?.id);
  });

  it('없는 칸에 떨구면 아무 일도 없다(null)', () => {
    const ids = seqIds();
    const root = makeCell('a', ids);
    expect(dropOnCell(root, 'ghost', 'right', 'b', ids)).toBeNull();
  });

  it('칸 상한에 닿으면 더 나누지 않는다', () => {
    const ids = seqIds();
    let layout: SplitNode = makeCell('s0', ids);
    for (let i = 1; i < IDE_SPLIT.maxCells; i++) {
      const last = listCells(layout).at(-1);
      const res = dropOnCell(layout, last?.id ?? '', 'right', `s${String(i)}`, ids);
      expect(res).not.toBeNull();
      layout = res?.layout as SplitNode;
    }
    expect(cellCount(layout)).toBe(IDE_SPLIT.maxCells);
    expect(canSplit(layout)).toBe(false);
    const overflow = dropOnCell(layout, listCells(layout)[0]?.id ?? '', 'right', 'over', ids);
    expect(overflow).toBeNull();
    // 가운데(교체)는 상한과 무관하게 계속 된다.
    expect(dropOnCell(layout, listCells(layout)[0]?.id ?? '', 'center', 'over', ids)).not.toBeNull();
  });
});

describe('splitLayout — 닫기·정리', () => {
  it('둘 중 하나를 닫으면 남은 칸이 가지를 대신한다', () => {
    const ids = seqIds();
    const root = makeCell('a', ids);
    const row = dropOnCell(root, root.id, 'right', 'b', ids)?.layout as SplitNode;
    const survivor = closeCell(row, listCells(row)[1]?.id ?? '');
    expect(survivor?.kind).toBe('cell');
    expect(survivor && survivor.kind === 'cell' ? survivor.sessionId : null).toBe('a');
  });

  it('마지막 칸을 닫으면 분할 자체가 사라진다(null)', () => {
    const cell = makeCell('a', seqIds());
    expect(closeCell(cell, cell.id)).toBeNull();
    expect(closeCell(cell, 'other')).toEqual(cell);
  });

  it('셋 중 하나를 닫으면 남은 둘이 비율을 나눠 갖는다(합 1)', () => {
    const ids = seqIds();
    let layout: SplitNode = makeCell('a', ids);
    layout = dropOnCell(layout, layout.id, 'right', 'b', ids)?.layout as SplitNode;
    layout = dropOnCell(layout, listCells(layout)[1]?.id ?? '', 'right', 'c', ids)?.layout as SplitNode;
    const closed = closeCell(layout, listCells(layout)[1]?.id ?? '');
    expect(closed).not.toBeNull();
    if (!closed || closed.kind !== 'branch') { expect(closed?.kind).toBe('branch'); return; }
    expect(listCells(closed).map((c) => c.sessionId)).toEqual(['a', 'c']);
    near(closed.sizes.reduce((a, b) => a + b, 0), 1);
  });

  it('사라진 세션을 문 칸은 걷히고, 메인 탭 칸은 남는다', () => {
    const ids = seqIds();
    let layout: SplitNode = makeCell(null, ids);
    layout = dropOnCell(layout, layout.id, 'right', 'gone', ids)?.layout as SplitNode;
    layout = dropOnCell(layout, listCells(layout)[1]?.id ?? '', 'right', 'alive', ids)?.layout as SplitNode;
    const pruned = pruneCells(layout, (id) => id === 'alive');
    expect(pruned).not.toBeNull();
    expect(listCells(pruned as SplitNode).map((c) => c.sessionId)).toEqual([null, 'alive']);
  });

  it('전부 사라지면 분할도 사라진다', () => {
    const ids = seqIds();
    const root = makeCell('a', ids);
    const row = dropOnCell(root, root.id, 'right', 'b', ids)?.layout as SplitNode;
    expect(pruneCells(row, () => false)).toBeNull();
  });

  it('이웃 칸은 앞을, 없으면 뒤를 물려받는다', () => {
    const ids = seqIds();
    const root = makeCell('a', ids);
    const row = dropOnCell(root, root.id, 'right', 'b', ids)?.layout as SplitNode;
    const [first, second] = listCells(row);
    expect(adjacentCellId(row, second?.id ?? '')).toBe(first?.id);
    expect(adjacentCellId(row, first?.id ?? '')).toBe(second?.id);
    expect(adjacentCellId(row, 'ghost')).toBeNull();
  });
});

describe('splitLayout — 비율', () => {
  it('normalizeSizes 는 깨진 값을 고르게 펴고 합을 1로 만든다', () => {
    const fixed = normalizeSizes([Number.NaN, -1, 3], 3);
    expect(fixed.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(normalizeSizes([], 2)).toEqual([0.5, 0.5]);
    expect(normalizeSizes([1], 0)).toEqual([]);
  });

  it('손잡이는 최소 비율에서 멈춘다', () => {
    const ids = seqIds();
    const root = makeCell('a', ids);
    const row = dropOnCell(root, root.id, 'right', 'b', ids)?.layout as SplitNode;
    if (row.kind !== 'branch') return;
    const pushed = moveSplitter(row, row.id, 0, -0.9);
    if (pushed.kind !== 'branch') return;
    near(pushed.sizes[0], IDE_SPLIT.minCellRatio);
    near(pushed.sizes[1], 1 - IDE_SPLIT.minCellRatio);
    // 손잡이가 없는 자리·다른 가지 id 는 무시.
    expect(moveSplitter(row, row.id, 5, 0.1)).toEqual(row);
    expect(moveSplitter(row, 'ghost', 0, 0.1)).toEqual(row);
  });

  it('setBranchSizes 는 그 가지만 바꾸고 합을 1로 맞춘다', () => {
    const ids = seqIds();
    const root = makeCell('a', ids);
    const row = dropOnCell(root, root.id, 'right', 'b', ids)?.layout as SplitNode;
    if (row.kind !== 'branch') return;
    const next = setBranchSizes(row, row.id, [3, 1]);
    if (next.kind !== 'branch') return;
    near(next.sizes[0], 0.75);
    near(next.sizes[1], 0.25);
  });

  it('같은 축 중첩은 펴지고 비율은 곱해져 전달된다', () => {
    const nested: SplitNode = {
      kind: 'branch',
      id: 'outer',
      axis: 'row',
      sizes: [0.5, 0.5],
      children: [
        { kind: 'cell', id: 'c1', sessionId: 'a' },
        {
          kind: 'branch',
          id: 'inner',
          axis: 'row',
          sizes: [0.5, 0.5],
          children: [
            { kind: 'cell', id: 'c2', sessionId: 'b' },
            { kind: 'cell', id: 'c3', sessionId: 'c' },
          ],
        },
      ],
    };
    const flat = normalizeNode(nested);
    if (!flat || flat.kind !== 'branch') { expect(flat?.kind).toBe('branch'); return; }
    expect(flat.children.map((c) => (c.kind === 'cell' ? c.id : '?'))).toEqual(['c1', 'c2', 'c3']);
    near(flat.sizes[0], 0.5);
    near(flat.sizes[1], 0.25);
    near(flat.sizes[2], 0.25);
  });

  it('더블클릭 균등 분배는 칸 수만큼 고르게 나눈다', () => {
    expect(evenSplitSizes(2)).toEqual([0.5, 0.5]);
    const three = evenSplitSizes(3);
    expect(three).toHaveLength(3);
    for (const v of three) near(v, 1 / 3);
    expect(evenSplitSizes(0)).toEqual([]);
  });

  it('손잡이는 보이는 것보다 넓게 잡힌다 — 4px 표적을 정확히 겨누게 하지 않는다', () => {
    expect(IDE_SPLIT.splitterHitPadPx).toBeGreaterThan(0);
    const grabbable = IDE_SPLIT.splitterPx + IDE_SPLIT.splitterHitPadPx * 2;
    expect(grabbable).toBeGreaterThanOrEqual(12);
  });

  it('setCellSession 은 그 칸만 바꾼다', () => {
    const ids = seqIds();
    const root = makeCell('a', ids);
    const row = dropOnCell(root, root.id, 'right', 'b', ids)?.layout as SplitNode;
    const target = listCells(row)[1];
    const next = setCellSession(row, target?.id ?? '', 'z');
    expect(listCells(next).map((c) => c.sessionId)).toEqual(['a', 'z']);
    expect(setCellSession(root, 'ghost', 'z')).toEqual(root);
  });
});

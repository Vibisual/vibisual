/**
 * §5.5 #17-17 ⑫(c)·⑭(c)(d)·⑰(a)·⑲(c)·⑳·㉖ — 캔버스 선·자리 판정 회귀.
 *
 * 이 판정이 한 칸 어긋나도 화면에는 아무 실패가 뜨지 않는다 — 사용자가 노린 자리가 아닌 곳에
 * 조용히 들어갈 뿐이다. 자유 배치(⑭(d))가 되고 나서는 격자가 없어져 눈으로는 더더욱 확인되지
 * 않으므로, 경계(위·아래·같은 높이·빈 캔버스·이미 이어진 선)를 숫자로 못박는다.
 */
import { describe, expect, it } from 'vitest';
import {
  NEW_POINT_ID, addCut, addCuts, addWire, canBreakAt, derivePositions, drawableWires, entriesOf,
  hasOutgoing, hasWiresAt, isCut, placeNewAt, pruneWires, removeWire, removeWiresOf, rowWires,
  rowWiresAt, rowsOf, sameRows,
  wireAfter, type GoalWire,
} from './goalDropTarget.js';

const P = (id: string, y: number, x = 40): { id: string; x: number; y: number } => ({ id, x, y });
/** 저장 형식 한 줄 — `parallel:true` 는 "바로 앞 단계와 같은 행". */
const E = (id: string, parallel = false): { id: string; parallel: boolean } => ({ id, parallel });
const ids = (entries: { id: string }[]): string[] => entries.map((e) => e.id);

describe('⑰(a) 행은 저장 형식(순서 + 표식)과 서로 편지고 접힌다', () => {
  it('표식 붙은 단계는 앞 행에 붙고, 표식 없는 단계는 새 행이다', () => {
    expect(rowsOf([E('a'), E('b'), E('c', true), E('d')])).toEqual([['a'], ['b', 'c'], ['d']]);
  });

  it('첫 단계는 표식이 있어도 제 행이다 — 앞 행이 없으므로', () => {
    expect(rowsOf([E('a', true), E('b', true)])).toEqual([['a', 'b']]);
  });

  it('행의 첫 노드는 표식이 없고 뒤따르는 노드에 붙는다', () => {
    expect(entriesOf([['a'], ['b', 'c'], ['d']])).toEqual([E('a'), E('b'), E('c', true), E('d')]);
  });

  it('펴고 접으면 제자리다', () => {
    const entries = [E('a'), E('b', true), E('c'), E('d', true), E('e', true)];
    expect(entriesOf(rowsOf(entries))).toEqual(entries);
  });

  it('빈 목록은 빈 행 목록이다', () => {
    expect(rowsOf([])).toEqual([]);
    expect(entriesOf([])).toEqual([]);
  });

  it('행 표식만 바뀌어도 다르다 — 같은 순서라도 나란히 붙인 것은 보내야 한다', () => {
    const seq = [E('a'), E('b')];
    const row = [E('a'), E('b', true)];
    expect(sameRows(seq, seq)).toBe(true);
    expect(sameRows(seq, row)).toBe(false);
    expect(sameRows(seq, [E('b'), E('a')])).toBe(false);
    expect(sameRows(seq, [E('a')])).toBe(false);
  });
});

/**
 * ⑳ — **선을 끌어 꽂으면 그 단계가 바로 다음에 선다.** 블루프린트의 실행 선이다.
 */
describe('⑳ 핀을 끌어 꽂으면 꽂힌 단계가 바로 다음 행에 선다', () => {
  const chain = [E('a'), E('b'), E('c'), E('d')];

  it('뒤에 있던 단계를 앞으로 끌어 잇는다 — a → d 면 a, d, b, c', () => {
    expect(ids(wireAfter(chain, 'a', 'd')!)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('앞에 있던 단계를 뒤로 끌어 잇는다 — d → a 면 b, c, d, a', () => {
    expect(ids(wireAfter(chain, 'd', 'a')!)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('꽂힌 단계는 제 행 하나로 선다 — 표식이 붙지 않는다', () => {
    const next = wireAfter(chain, 'a', 'd')!;
    expect(next.every((e) => !e.parallel)).toBe(true);
  });

  it('원래 행에 형제가 있었으면 그 행에서 빠지고 형제는 남는다', () => {
    // [a] [b] [c d] 에서 a → d: d 가 a 바로 다음에 제 행으로, c 는 홀로 남아 b 뒤에.
    const rows = [E('a'), E('b'), E('c'), E('d', true)];
    expect(rowsOf(wireAfter(rows, 'a', 'd')!)).toEqual([['a'], ['d'], ['b'], ['c']]);
  });

  it('원래 행이 비면 그 행은 사라진다 — 빈 행이 남아 선이 끊기지 않는다', () => {
    const rows = [E('a'), E('b'), E('c', true), E('d')];
    // d 를 a 다음에: [a] [d] [b c]
    expect(rowsOf(wireAfter(rows, 'a', 'd')!)).toEqual([['a'], ['d'], ['b', 'c']]);
  });

  it('출발 행에 형제가 있어도 출발 단계의 행 바로 다음이다', () => {
    // [a] [b c] [d] 에서 c → a: a 가 [b c] 바로 다음에.
    const rows = [E('a'), E('b'), E('c', true), E('d')];
    expect(rowsOf(wireAfter(rows, 'c', 'a')!)).toEqual([['b', 'c'], ['a'], ['d']]);
  });

  it('같은 행의 형제에게 잇는다 — 형제가 줄에서 떨어져 바로 다음에 선다', () => {
    const rows = [E('a'), E('b', true), E('c')];
    expect(rowsOf(wireAfter(rows, 'a', 'b')!)).toEqual([['a'], ['b'], ['c']]);
    expect(rowsOf(wireAfter(rows, 'b', 'a')!)).toEqual([['b'], ['a'], ['c']]);
  });

  it('이미 바로 다음 행에 서 있으면 보낼 것이 없다(null) — 그 선은 이미 그려져 있다', () => {
    expect(wireAfter(chain, 'a', 'b')).toBeNull();
    // 형제가 있어도 "이미 이어졌다"다 — 떼는 손잡이는 노드 메뉴다.
    expect(wireAfter([E('a'), E('b'), E('c', true)], 'a', 'c')).toBeNull();
  });

  it('자기 자신에게는 잇지 않는다', () => {
    expect(wireAfter(chain, 'b', 'b')).toBeNull();
  });

  it('모르는 id 는 아무것도 바꾸지 않는다', () => {
    expect(wireAfter(chain, 'a', 'zzz')).toBeNull();
    expect(wireAfter(chain, 'zzz', 'a')).toBeNull();
  });

  it('두 단계뿐이어도 뒤집힌다', () => {
    expect(ids(wireAfter([E('a'), E('b')], 'b', 'a')!)).toEqual(['b', 'a']);
  });

  it('선을 하나씩 이어 차례를 통째로 다시 짤 수 있다 — 꽂을 때마다 앞의 답 위에 쌓인다', () => {
    let cur = chain;
    cur = wireAfter(cur, 'd', 'a')!; // b c d a
    cur = wireAfter(cur, 'a', 'c')!; // b d a c
    cur = wireAfter(cur, 'c', 'b')!; // d a c b
    expect(ids(cur)).toEqual(['d', 'a', 'c', 'b']);
  });
});

describe('⑭(c)·⑳ 누른 자리에 새 노드가 서면 — 가장 가까운 노드에 기대어 끼운다', () => {
  const BAND = 24;
  const entries = [E('a'), E('b'), E('c')];
  const nodes = [P('a', 100), P('b', 200), P('c', 300)];

  it('두 노드 사이(아래쪽에 가까움)면 가까운 노드의 다음 행이다', () => {
    const next = placeNewAt(entries, nodes, { x: 40, y: 160 }, BAND);
    expect(ids(next)).toEqual(['a', NEW_POINT_ID, 'b', 'c']);
    expect(next.every((e) => !e.parallel)).toBe(true);
  });

  it('두 노드 사이(위쪽에 가까움)면 가까운 노드의 앞 행이다 — 답은 같다', () => {
    expect(ids(placeNewAt(entries, nodes, { x: 40, y: 240 }, BAND))).toEqual(['a', 'b', NEW_POINT_ID, 'c']);
  });

  it('어느 노드 옆(같은 높이 띠)이면 그 노드와 한 행에 선다', () => {
    expect(placeNewAt(entries, nodes, { x: 400, y: 210 }, BAND)).toEqual([
      E('a'), E('b'), E(NEW_POINT_ID, true), E('c'),
    ]);
  });

  it('노드의 왼쪽에 놓으면 새 노드가 행의 첫 노드가 되고 원래 노드가 표식을 받는다', () => {
    const next = placeNewAt(entries, nodes, { x: -300, y: 205 }, BAND);
    expect(ids(next)).toEqual(['a', NEW_POINT_ID, 'b', 'c']);
    expect(next.find((e) => e.id === NEW_POINT_ID)?.parallel).toBe(false);
    expect(next.find((e) => e.id === 'b')?.parallel).toBe(true);
  });

  it('맨 위보다 위는 맨 앞이다', () => {
    expect(ids(placeNewAt(entries, nodes, { x: 40, y: -500 }, BAND))).toEqual([NEW_POINT_ID, 'a', 'b', 'c']);
  });

  it('마지막보다 아래는 꼬리다', () => {
    expect(ids(placeNewAt(entries, nodes, { x: 40, y: 9_999 }, BAND))).toEqual(['a', 'b', 'c', NEW_POINT_ID]);
  });

  it('⑳ 좌표가 차례와 어긋나 있어도 있는 차례는 흔들리지 않는다 — 선으로 짠 차례가 좌표 순으로 되돌아가지 않는다', () => {
    // 목록은 a, b, c 인데 c 를 맨 위로 끌어 올려 두었다(자리는 자리 — 차례는 그대로).
    const moved = [P('c', -200), P('a', 100), P('b', 200)];
    // c 바로 아래를 누르면 c 의 다음 행 — 목록에서 c 는 맨 뒤라 꼬리에 붙고, a·b 의 차례는 그대로다.
    expect(ids(placeNewAt(entries, moved, { x: 40, y: -150 }, BAND))).toEqual(['a', 'b', 'c', NEW_POINT_ID]);
    // a 위를 누르면 a 의 앞 — c 가 화면상 더 위에 있어도 c 는 목록 뒤라 그 자리에 남는다.
    expect(ids(placeNewAt(entries, moved, { x: 40, y: 50 }, BAND))).toEqual([NEW_POINT_ID, 'a', 'b', 'c']);
  });

  it('행 안에 놓으면 행의 형제 사이 자리는 가로가 정한다', () => {
    const rowEntries = [E('a'), E('b'), E('c', true), E('d')];
    const rowNodes = [P('a', 100), P('b', 200, 40), P('c', 200, 300), P('d', 300)];
    // b 와 c 사이 높이에서 가로로 b 오른쪽·c 왼쪽 — 새 노드는 b 와 c 사이다.
    expect(ids(placeNewAt(rowEntries, rowNodes, { x: 150, y: 205 }, BAND))).toEqual(['a', 'b', NEW_POINT_ID, 'c', 'd']);
    // c 오른쪽이면 행의 끝이다.
    expect(ids(placeNewAt(rowEntries, rowNodes, { x: 600, y: 205 }, BAND))).toEqual(['a', 'b', 'c', NEW_POINT_ID, 'd']);
  });

  it('빈 캔버스는 어디를 눌러도 첫 칸이고 표식이 없다', () => {
    expect(placeNewAt([], [], { x: 500, y: 500 }, BAND)).toEqual([E(NEW_POINT_ID)]);
  });

  it('자리를 모르는 목록이면 꼬리에 붙는다 — 아무것도 흔들지 않는다', () => {
    expect(ids(placeNewAt(entries, [], { x: 0, y: 0 }, BAND))).toEqual(['a', 'b', 'c', NEW_POINT_ID]);
  });

  it('가짜 노드의 id 는 단계 id(gs-…) 와 겹치지 않는 꼴이다', () => {
    expect(NEW_POINT_ID.startsWith('gs-')).toBe(false);
  });
});

/**
 * §5.5 #17-17 ⑲(c) — **파생 배치는 손이 놓은 자리를 덮지 않는다.**
 *
 * 종전 산식(`행 번호 × 간격`)은 손으로 옮긴 노드를 보지 않아 그 위로 격자가 그대로 지나갔다 —
 * 카드가 서로를 덮어 목록이 뒤섞여 보였다(사용자 지적 "중간에 마음대로 섞여 버리던데").
 * 겹침은 렌더로만 드러나는데 클라 테스트에는 DOM 이 없으므로, 세로 구간을 숫자로 못박는다.
 */
describe('⑲(c) 파생 배치는 겹치지 않는다', () => {
  const M = { nodeW: 210, nodeH: 64, gapX: 28, gapY: 92, originX: 40 };
  const S = (id: string, parallel?: boolean): { id: string; parallel?: boolean } =>
    (parallel ? { id, parallel } : { id });
  /** 두 노드의 세로 구간이 겹치는가 — 겹치면 화면에서 카드가 서로를 덮는다. */
  const overlaps = (a: { y: number }, b: { y: number }): boolean =>
    a.y < b.y + M.nodeH && b.y < a.y + M.nodeH;

  it('아무도 손대지 않은 목록은 종전 격자와 한 픽셀도 다르지 않다', () => {
    const pos = derivePositions([S('a'), S('b'), S('c')], undefined, M);
    expect([...pos.values()].map((p) => p.y)).toEqual([0, 92, 184]);
    expect([...pos.values()].every((p) => p.x === 40)).toBe(true);
  });

  it('나란히 놓인 노드는 왼쪽 이웃 옆에 서고 다음 행은 그 아래로 간다', () => {
    const pos = derivePositions([S('a'), S('b', true), S('c')], undefined, M);
    expect(pos.get('b')).toEqual({ x: 40 + 210 + 28, y: 0 });
    expect(pos.get('c')).toEqual({ x: 40, y: 92 });
  });

  it('손으로 놓은 자리 **아래로** 다음 행이 흐른다 — 격자가 그 위를 지나가지 않는다', () => {
    // 우클릭으로 끼워 넣으면 누른 자리(임의의 y)에 못 박힌다 — 격자와 어긋난 값이 정상이다.
    const pos = derivePositions([S('a'), S('b'), S('c')], { b: { x: 40, y: 150 } }, M);
    expect(pos.get('b')).toEqual({ x: 40, y: 150 });
    expect(pos.get('c')?.y).toBe(150 + 64 + 28);
    expect(overlaps(pos.get('b')!, pos.get('c')!)).toBe(false);
    // 종전 산식이었다면 c 는 184 에 서서 b(150..214) 를 덮었다.
    expect(pos.get('c')?.y).toBeGreaterThan(184);
  });

  it('손으로 놓은 자리가 여럿 섞여도 **파생 자리**는 앞의 무엇도 덮지 않는다', () => {
    // 손이 놓은 자리끼리 겹치는 것은 사용자가 그렇게 놓은 것이다(⑳ 뒤로 자리는 차례를 바꾸지 않는다).
    //   여기서 못 박을 것은 **아무도 놓은 적 없는 노드가 남의 자리로 들어가는 것**이다.
    const steps = [S('a'), S('b'), S('c'), S('d'), S('e')];
    const stored: Record<string, { x: number; y: number }> = { b: { x: 40, y: 40 }, d: { x: 40, y: 300 } };
    const pos = derivePositions(steps, stored, M);
    steps.forEach((s, i) => {
      if (stored[s.id]) return; // 손이 놓은 자리는 진실이다
      const mine = pos.get(s.id)!;
      for (let j = 0; j < i; j++) {
        expect(overlaps(mine, pos.get(steps[j]!.id)!), `${s.id} 가 ${steps[j]!.id} 를 덮는다`).toBe(false);
      }
    });
    // 종전 산식이었다면 c 는 184 에 서서 b(40..104) 와 사이가 뜨고, e 는 368 에 서서 d(300..364) 를 스치고 간다.
    expect(pos.get('e')!.y).toBeGreaterThanOrEqual(300 + M.nodeH + (M.gapY - M.nodeH));
  });

  it('위로 끌어 올린 노드가 뒤의 행들을 위로 빨아들이지 않는다 — 바닥은 물러나지 않는다', () => {
    // c 를 맨 위로 끌어 올렸다. 그래도 d 는 앞 행들(a·b)보다 아래에 선다.
    const pos = derivePositions([S('a'), S('b'), S('c'), S('d')], { c: { x: 40, y: -500 } }, M);
    expect(pos.get('c')).toEqual({ x: 40, y: -500 });
    expect(pos.get('d')?.y).toBe(184);
    expect(overlaps(pos.get('b')!, pos.get('d')!)).toBe(false);
  });

  it('행 표식이 붙은 노드는 손으로 옮긴 이웃을 따라간다(⑰(a) 불변)', () => {
    const pos = derivePositions([S('a'), S('b', true)], { a: { x: 500, y: 700 } }, M);
    expect(pos.get('b')).toEqual({ x: 500 + 210 + 28, y: 700 });
  });

  it('빈 목록은 빈 답이다', () => {
    expect(derivePositions([], undefined, M).size).toBe(0);
  });
});

describe('㉖ 선은 사용자가 그은 것만 — 그은 목록이 진실이다', () => {
  const W = (source: string, target: string): GoalWire => ({ source, target });

  it('같은 선을 두 번 그어도 하나다 — 바뀐 것이 없으면 **받은 배열 그대로**', () => {
    const wires = [W('a', 'b')];
    expect(addWire(wires, 'a', 'b')).toBe(wires);
  });

  it('자기 자신에게는 긋지 않는다', () => {
    const wires = [W('a', 'b')];
    expect(addWire(wires, 'c', 'c')).toBe(wires);
  });

  it('반대 방향 선이 있으면 그것을 걷고 새 선을 넣는다 — 방향을 뒤집는 손짓', () => {
    expect(addWire([W('a', 'b')], 'b', 'a')).toEqual([W('b', 'a')]);
  });

  it('순환을 만드는 선은 긋지 않는다 — 차례는 언제나 한 줄이라 뜻을 가질 수 없다', () => {
    const wires = [W('a', 'b'), W('b', 'c')];
    expect(addWire(wires, 'c', 'a')).toBe(wires);
  });

  it('순환이 아니면 갈래가 여럿이어도 긋는다 — 한 핀에서 갈라지는 것이 병렬이다', () => {
    expect(addWire([W('a', 'b')], 'a', 'c')).toEqual([W('a', 'b'), W('a', 'c')]);
  });

  it('선 하나를 끊는다 — 없는 선을 끊으면 받은 배열 그대로', () => {
    const wires = [W('a', 'b'), W('b', 'c')];
    expect(removeWire(wires, 'a', 'b')).toEqual([W('b', 'c')]);
    expect(removeWire(wires, 'x', 'y')).toBe(wires);
  });

  it('그 단계에 붙은 선을 전부 끊는다 — 들어오는 것도 나가는 것도', () => {
    const wires = [W('a', 'b'), W('b', 'c'), W('c', 'd')];
    expect(removeWiresOf(wires, 'b')).toEqual([W('c', 'd')]);
  });

  it('양 끝 중 하나가 목록에서 사라지면 그 선도 사라진다', () => {
    const wires = [W('a', 'b'), W('b', 'c')];
    expect(pruneWires(wires, ['a', 'b'])).toEqual([W('a', 'b')]);
  });

  it('전부 살아 있으면 받은 배열 그대로 — 무변화 프레임에 새 배열을 만들지 않는다', () => {
    const wires = [W('a', 'b')];
    expect(pruneWires(wires, ['a', 'b', 'c'])).toBe(wires);
  });

  it('그릴 수 있는 선만 골라 내고, 같은 선이 두 번 들어와도 한 번만 그린다', () => {
    const wires = [W('a', 'b'), W('a', 'b'), W('a', 'zzz'), W('c', 'c')];
    expect(drawableWires(wires, ['a', 'b', 'c'])).toEqual([W('a', 'b')]);
  });

  it('이 핀에서 이미 나가는 선이 있는가 — 지금 꽂는 끝은 세지 않는다', () => {
    const wires = [W('a', 'b')];
    expect(hasOutgoing(wires, 'a', 'c')).toBe(true);
    expect(hasOutgoing(wires, 'a', 'b')).toBe(false);
    expect(hasOutgoing(wires, 'z', 'c')).toBe(false);
  });
});

describe('㉖(d) 한 핀에서 갈라진 선은 같은 행이다 — 병렬', () => {
  it('첫 선은 종전대로 바로 다음 행에 제 행으로 선다', () => {
    const rows = wireAfter([E('a'), E('b'), E('c')], 'a', 'c');
    expect(rows).toEqual([E('a'), E('c'), E('b')]);
  });

  it('두 번째로 나간 선의 끝은 그 행에 **합류**한다 — `A→B` 뒤의 `A→C`', () => {
    // a → b 로 이미 이어진 목록에서 a → c 를 그으면 c 는 b 를 밀어내지 않고 옆에 선다.
    const rows = wireAfter([E('a'), E('b'), E('c')], 'a', 'c', { joinRow: true });
    expect(rows).toEqual([E('a'), E('b'), E('c', true)]);
    expect(rowsOf(rows!)).toEqual([['a'], ['b', 'c']]);
  });

  it('합류를 청해도 이미 그 행에 서 있으면 보낼 것이 없다', () => {
    expect(wireAfter([E('a'), E('b'), E('c', true)], 'a', 'c', { joinRow: true })).toBeNull();
  });

  it('다음 행이 아직 없으면 합류를 청해도 새 행을 세운다', () => {
    const rows = wireAfter([E('a', false), E('b')], 'b', 'a', { joinRow: true });
    expect(rowsOf(rows!)).toEqual([['b'], ['a']]);
  });
});

describe('㉖(h)-3 차례가 그리는 선 — 끊은 자리는 끊긴 채로 남는다', () => {
  const W = (source: string, target: string): GoalWire => ({ source, target });

  it('차례 선은 행 단위 팬아웃·팬인 그대로다', () => {
    // [a] [b,c] [d] — 앞 행의 모두에서 다음 행의 모두로.
    expect(rowWires([E('a'), E('b'), E('c', true), E('d')])).toEqual([
      W('a', 'b'), W('a', 'c'), W('b', 'd'), W('c', 'd'),
    ]);
  });

  it('위 핀에 걸린 차례 선은 들어오는 것만, 아래 핀은 나가는 것만', () => {
    const rows = [E('a'), E('b'), E('c')];
    expect(rowWiresAt(rows, 'b', 'in')).toEqual([W('a', 'b')]);
    expect(rowWiresAt(rows, 'b', 'out')).toEqual([W('b', 'c')]);
    expect(rowWiresAt(rows, 'b')).toEqual([W('a', 'b'), W('b', 'c')]);
  });

  it('한 핀에 여럿이 걸리면 전부 걷는다(팬인)', () => {
    // [a,b] [c] — c 의 위 핀에는 선이 둘이다.
    expect(rowWiresAt([E('a'), E('b', true), E('c')], 'c', 'in')).toEqual([W('a', 'c'), W('b', 'c')]);
  });

  it('끊은 자리는 **차례는 그대로 둔 채** 그 선만 뺀다', () => {
    const rows = [E('a'), E('b'), E('c'), E('d')];
    const cuts = addCuts([], rowWiresAt(rows, 'c', 'in'));
    const drawn = rowWires(rows).filter((w) => !isCut(cuts, w.source, w.target));
    // b→c 만 사라진다. 차례가 흔들리지 않으므로 **끊은 그 핀에 새 선이 서지 않는다**
    // (종전 행 합치기는 [a][b,c][d] 를 만들어 a→c 를 그 자리에 도로 그렸다).
    expect(drawn).toEqual([W('a', 'b'), W('c', 'd')]);
    expect(rowWiresAt(rows, 'c', 'in').every((w) => isCut(cuts, w.source, w.target))).toBe(true);
  });

  it('같은 자리를 두 번 끊어도 목록은 하나 — 받은 배열 그대로 돌려준다', () => {
    const cuts = addCut([], 'a', 'b');
    expect(addCut(cuts, 'a', 'b')).toBe(cuts);
    expect(addCuts(cuts, [W('a', 'b')])).toBe(cuts);
  });

  it('자기 자신·빈 id 는 끊은 자리로 남지 않는다', () => {
    const cuts: GoalWire[] = [];
    expect(addCut(cuts, 'a', 'a')).toBe(cuts);
    expect(addCut(cuts, '', 'b')).toBe(cuts);
  });

  it('끊은 자리는 **방향까지** 같아야 같다', () => {
    const cuts = addCut([], 'a', 'b');
    expect(isCut(cuts, 'a', 'b')).toBe(true);
    expect(isCut(cuts, 'b', 'a')).toBe(false);
  });

  it('그은 선도 끊은 자리에 걸리면 그려지지 않는다', () => {
    const wires = [W('a', 'c')];
    expect(drawableWires(wires, ['a', 'b', 'c'])).toEqual([W('a', 'c')]);
    expect(drawableWires(wires, ['a', 'b', 'c'], [W('a', 'c')])).toEqual([]);
  });

  it('양 끝이 목록에 없는 끊은 자리는 저장고에서도 걷힌다', () => {
    expect(pruneWires([W('a', 'b'), W('a', 'zzz')], ['a', 'b'])).toEqual([W('a', 'b')]);
  });
});

describe('㉖(h)·(h)-3 끊을 것이 있는 핀만 칸을 세운다', () => {
  const W = (source: string, target: string): GoalWire => ({ source, target });

  it('앞 행이 있으면 위 핀에 끊을 것이 있다', () => {
    expect(canBreakAt([E('a'), E('b')], [], 'b', 'in')).toBe(true);
    expect(canBreakAt([E('a'), E('b')], [], 'a', 'in')).toBe(false);
  });

  it('다음 행이 있으면 아래 핀에 끊을 것이 있다', () => {
    expect(canBreakAt([E('a'), E('b')], [], 'a', 'out')).toBe(true);
    expect(canBreakAt([E('a'), E('b')], [], 'b', 'out')).toBe(false);
  });

  it('차례로는 이어지지 않아도 그은 선이 걸려 있으면 끊을 것이 있다', () => {
    expect(canBreakAt([E('a'), E('b')], [W('b', 'a')], 'a', 'in')).toBe(true);
  });

  it('이미 끊은 핀에는 칸을 세우지 않는다 — 눌러도 아무 일 없는 칸은 없는 칸보다 나쁘다', () => {
    expect(canBreakAt([E('a'), E('b')], [], 'b', 'in', [W('a', 'b')])).toBe(false);
  });

  it('팬인 중 하나만 끊었으면 아직 끊을 것이 남아 있다', () => {
    // [a,b] [c] — a→c 만 끊으면 b→c 가 남는다.
    expect(canBreakAt([E('a'), E('b', true), E('c')], [], 'c', 'in', [W('a', 'c')])).toBe(true);
  });

  it('모르는 id 는 끊을 것이 없다', () => {
    expect(canBreakAt([E('a')], [], 'zzz', 'in')).toBe(false);
  });
});

describe('㉖(h) 그은 선은 핀의 방향대로만 걷힌다', () => {
  const W = (source: string, target: string): GoalWire => ({ source, target });

  it('위 핀은 들어오는 선만, 아래 핀은 나가는 선만 걷는다', () => {
    const wires = [W('a', 'b'), W('b', 'c')];
    expect(removeWiresOf(wires, 'b', 'in')).toEqual([W('b', 'c')]);
    expect(removeWiresOf(wires, 'b', 'out')).toEqual([W('a', 'b')]);
  });

  it('방향을 주지 않으면 양쪽 전부다(노드 메뉴 [선 끊기])', () => {
    expect(removeWiresOf([W('a', 'b'), W('b', 'c')], 'b')).toEqual([]);
  });

  it('걷을 것이 없으면 받은 배열 그대로', () => {
    const wires = [W('a', 'b')];
    expect(removeWiresOf(wires, 'b', 'out')).toBe(wires);
  });

  it('걸린 선이 있는지도 방향을 가린다', () => {
    const wires = [W('a', 'b')];
    expect(hasWiresAt(wires, 'b', 'in')).toBe(true);
    expect(hasWiresAt(wires, 'b', 'out')).toBe(false);
    expect(hasWiresAt(wires, 'b')).toBe(true);
  });
});

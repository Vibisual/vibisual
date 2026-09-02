import { describe, it, expect } from 'vitest';
import { SESSION_MEMO, SESSION_MEMO_DEFAULT_COLOR, SESSION_MEMO_PALETTE, sanitizeSessionMemos, type SessionMemo } from '@vibisual/shared';
import {
  activateMemoTab,
  canAddMemo,
  compositeOver,
  detachMemo,
  memoCards,
  mergeMemos,
  hasHiddenMemoHeaders,
  hasMemoName,
  raiseNextUnder,
  spreadOverlappingMemos,
  stackedUnderCounts,
  memoAlpha,
  memoSurface,
  memoTitle,
  clampMemoRect,
  clampMemos,
  moveMemo,
  newMemoId,
  patchMemo,
  raiseMemo,
  removeMemo,
  resizeMemo,
  spawnMemo,
} from './sessionMemo.js';

/**
 * §5.5 #17-36 스티키 메모 — 순수 계산 회귀 테스트.
 *
 * 못 박는 것 넷: (a) 메모는 판 밖으로 못 나간다(창이 좁아져도 잡을 수 있어야 한다),
 * (b) 같은 자리에 겹쳐 만들면 계단식으로 밀린다, (c) 배열 순서가 z-order 라 "맨 앞으로"가
 * 순서를 바꾼다, (d) 안 바뀌면 같은 참조 — 헛 저장·헛 리렌더가 나가지 않는다.
 */

const board = { w: 800, h: 600 };

function memo(over: Partial<SessionMemo> = {}): SessionMemo {
  return {
    id: 'memo-1',
    text: '',
    x: 100,
    y: 100,
    w: SESSION_MEMO.DEFAULT_W,
    h: SESSION_MEMO.DEFAULT_H,
    color: SESSION_MEMO_DEFAULT_COLOR,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('clampMemoRect', () => {
  it('판 안에 있으면 같은 객체를 그대로 돌려준다(헛 저장 방지)', () => {
    const m = memo();
    expect(clampMemoRect(m, board)).toBe(m);
  });

  it('오른쪽/아래로 넘치면 판 안으로 되돌린다', () => {
    const m = memo({ x: 5000, y: 5000 });
    const out = clampMemoRect(m, board);
    expect(out.x).toBe(board.w - SESSION_MEMO.DEFAULT_W);
    expect(out.y).toBe(board.h - SESSION_MEMO.DEFAULT_H);
  });

  it('음수 좌표는 0 으로 — 판 왼쪽/위로 사라지지 않는다', () => {
    const out = clampMemoRect(memo({ x: -400, y: -80 }), board);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('판이 메모보다 좁아도 좌표는 0 이상 — 제목줄을 잡을 수 있다', () => {
    const out = clampMemoRect(memo({ x: 300, y: 300 }), { w: 120, h: 60 });
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.w).toBe(SESSION_MEMO.MIN_W);
    expect(out.h).toBe(SESSION_MEMO.MIN_H);
  });

  it('접힌 메모는 제목줄 높이만 있으면 된다 — 판 바닥에 더 가까이 둘 수 있다', () => {
    const open = clampMemoRect(memo({ y: 590 }), board);
    const folded = clampMemoRect(memo({ y: 590, collapsed: true }), board);
    expect(folded.y).toBeGreaterThan(open.y);
    expect(folded.y).toBe(board.h - SESSION_MEMO.HEADER_H);
  });

  it('크기 상한/하한을 지킨다', () => {
    const big = clampMemoRect(memo({ w: 99999, h: 99999 }), { w: 5000, h: 5000 });
    expect(big.w).toBe(SESSION_MEMO.MAX_W);
    expect(big.h).toBe(SESSION_MEMO.MAX_H);
    const small = clampMemoRect(memo({ w: 10, h: 10 }), board);
    expect(small.w).toBe(SESSION_MEMO.MIN_W);
    expect(small.h).toBe(SESSION_MEMO.MIN_H);
  });
});

describe('clampMemos', () => {
  it('한 장도 안 바뀌면 같은 배열 참조', () => {
    const list = [memo()];
    expect(clampMemos(list, board)).toBe(list);
  });

  it('[회귀] 판 크기를 모르는 순간(0)에는 손대지 않는다 — 감췄다 켜면 다 쌓여 있으면 안 된다', () => {
    const list = [memo({ x: 700, y: 500 })];
    expect(clampMemos(list, { w: 0, h: 0 })).toBe(list);
  });

  it('판이 줄면 넘친 장만 되돌린다', () => {
    const list = [memo({ id: 'a' }), memo({ id: 'b', x: 700, y: 500 })];
    const out = clampMemos(list, { w: 400, h: 400 });
    expect(out).not.toBe(list);
    expect(out[0]).toBe(list[0]);
    expect(out[1]?.x).toBeLessThanOrEqual(400);
  });
});

describe('spawnMemo', () => {
  it('우클릭 지점에 기본 크기로 놓인다', () => {
    const m = spawnMemo({ x: 40, y: 60 }, [], board, 1000, () => 0.5);
    expect(m).toMatchObject({ x: 40, y: 60, w: SESSION_MEMO.DEFAULT_W, h: SESSION_MEMO.DEFAULT_H, text: '' });
    expect(m.color).toBe(SESSION_MEMO_DEFAULT_COLOR);
    expect(m.createdAt).toBe(1000);
  });

  it('같은 자리에 겹쳐 만들면 계단식으로 밀린다', () => {
    const first = spawnMemo({ x: 40, y: 60 }, [], board, 1000, () => 0.5);
    const second = spawnMemo({ x: 40, y: 60 }, [first], board, 1001, () => 0.6);
    expect(second.x).toBe(40 + SESSION_MEMO.CASCADE_STEP);
    expect(second.y).toBe(60 + SESSION_MEMO.CASCADE_STEP);
  });

  it('판 오른쪽 끝을 눌러도 판 안에 들어온다', () => {
    const m = spawnMemo({ x: board.w - 10, y: board.h - 10 }, [], board, 1000, () => 0.5);
    expect(m.x + m.w).toBeLessThanOrEqual(board.w);
    expect(m.y + m.h).toBeLessThanOrEqual(board.h);
  });

  it('발급 id 는 서버 정화(sanitize)를 통과한다', () => {
    const m = spawnMemo({ x: 0, y: 0 }, [], board, 1712345678901, () => 0.987654);
    expect(sanitizeSessionMemos([m])).toHaveLength(1);
  });
});

describe('canAddMemo', () => {
  it('상한까지만 허용한다', () => {
    const full = Array.from({ length: SESSION_MEMO.MAX_PER_OWNER }, (_, i) => memo({ id: `m${i}` }));
    expect(canAddMemo(full.slice(0, -1))).toBe(true);
    expect(canAddMemo(full)).toBe(false);
  });
});

describe('raiseMemo / patchMemo / removeMemo', () => {
  it('맨 앞으로 = 배열 끝으로(순서가 곧 z-order)', () => {
    const list = [memo({ id: 'a' }), memo({ id: 'b' }), memo({ id: 'c' })];
    expect(raiseMemo(list, 'a').map((m) => m.id)).toEqual(['b', 'c', 'a']);
    // 이미 맨 앞이면 같은 배열 — 헛 저장이 나가지 않는다.
    expect(raiseMemo(list, 'c')).toBe(list);
    expect(raiseMemo(list, 'none')).toBe(list);
  });

  it('갱신은 updatedAt 을 올리고, 값이 같으면 같은 배열', () => {
    const list = [memo({ id: 'a' })];
    const out = patchMemo(list, 'a', { text: '할 일' }, 555);
    expect(out[0]?.text).toBe('할 일');
    expect(out[0]?.updatedAt).toBe(555);
    expect(patchMemo(list, 'a', { text: '' }, 555)).toBe(list);
    expect(patchMemo(list, 'none', { text: 'x' }, 555)).toBe(list);
  });

  it('접기 해제는 collapsed 키를 남기지 않는다(저장 비교 안정)', () => {
    const list = [memo({ id: 'a', collapsed: true })];
    const out = patchMemo(list, 'a', { collapsed: false }, 2);
    expect(out[0] && 'collapsed' in out[0]).toBe(false);
  });

  it('제거는 그 장만 뺀다', () => {
    const list = [memo({ id: 'a' }), memo({ id: 'b' })];
    expect(removeMemo(list, 'a').map((m) => m.id)).toEqual(['b']);
    expect(removeMemo(list, 'none')).toBe(list);
  });

  it('이름은 한 줄로 접혀 저장되고, 비우면 키가 사라진다(= 자동 제목으로 복귀)', () => {
    const list = [memo({ id: 'a' })];
    const named = patchMemo(list, 'a', { name: '  배포\n전\t점검  ' }, 10);
    expect(named[0]?.name).toBe('배포 전 점검');
    const cleared = patchMemo(named, 'a', { name: '   ' }, 11);
    expect(cleared[0] && 'name' in cleared[0]).toBe(false);
  });

  it('없는 이름과 공백뿐인 이름은 같다 — 헛 저장이 나가지 않는다', () => {
    const list = [memo({ id: 'a' })];
    expect(patchMemo(list, 'a', { name: '  ' }, 10)).toBe(list);
    const named = patchMemo(list, 'a', { name: '점검' }, 10);
    expect(patchMemo(named, 'a', { name: ' 점검 ' }, 11)).toBe(named);
  });

  it('이름은 상한까지만 저장한다(제목줄 한 줄이 무한히 자라지 않게)', () => {
    const list = [memo({ id: 'a' })];
    const out = patchMemo(list, 'a', { name: 'ㄱ'.repeat(SESSION_MEMO.NAME_MAX + 40) }, 10);
    expect(out[0]?.name).toHaveLength(SESSION_MEMO.NAME_MAX);
  });
});

describe('memoTitle — 제목줄에 서는 한 줄', () => {
  it('우선순위는 이름 → 본문 첫 줄 → 라벨', () => {
    expect(memoTitle(memo({ name: '배포 점검', text: '첫 줄\n둘째 줄' }), '메모')).toBe('배포 점검');
    expect(memoTitle(memo({ text: '첫 줄\n둘째 줄' }), '메모')).toBe('첫 줄');
    expect(memoTitle(memo({ text: '   \n둘째 줄' }), '메모')).toBe('메모');
    expect(memoTitle(memo({ text: '' }), '메모')).toBe('메모');
  });

  it('이름을 지우면 본문 첫 줄이 다시 제목이 된다(되돌리기 스위치가 따로 없는 이유)', () => {
    const list = [memo({ id: 'a', name: '배포 점검', text: '빌드부터' })];
    const cleared = patchMemo(list, 'a', { name: '' }, 9);
    expect(memoTitle(cleared[0]!, '메모')).toBe('빌드부터');
  });

  it('자르지 않고 전문을 돌려준다 — 줄이는 것은 폭을 아는 화면(CSS)의 몫이다', () => {
    const long = '아주 긴 이름'.repeat(6);
    expect(memoTitle(memo({ name: long }), '메모')).toBe(memoTitle(memo({ name: long }), '메모'));
    expect(memoTitle(memo({ text: `${long}\n다음 줄` }), '메모')).toBe(long);
  });

  it('hasMemoName 은 사람이 붙인 이름만 참으로 본다', () => {
    expect(hasMemoName(memo({ name: '점검' }))).toBe(true);
    expect(hasMemoName(memo({ name: '   ' }))).toBe(false);
    expect(hasMemoName(memo({ text: '첫 줄' }))).toBe(false);
  });
});

describe('합침 — 합쳤다 떼었다', () => {
  const at = (id: string, x: number, y: number, over: Partial<SessionMemo> = {}): SessionMemo => memo({ id, x, y, ...over });
  const rand = (): number => 0.5;

  it('두 장을 합치면 한 카드가 되고, 자리·크기는 받는 쪽이 정한다', () => {
    const list = [at('a', 10, 10), at('b', 400, 300)];
    const out = mergeMemos(list, 'b', 'a', true, 7, rand);
    const cards = memoCards(out);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.members.map((m) => m.id)).toEqual(['a', 'b']);
    // 끌어온 장이 활성 탭 — 방금까지 보던 것이 합치자마자 사라지면 안 된다.
    expect(cards[0]!.active.id).toBe('b');
    for (const m of out) expect([m.x, m.y]).toEqual([10, 10]);
  });

  it('이미 같은 카드면 아무 일도 하지 않는다(같은 배열)', () => {
    const merged = mergeMemos([at('a', 0, 0), at('b', 40, 40)], 'b', 'a', true, 7, rand);
    expect(mergeMemos(merged, 'a', 'b', true, 8, rand)).toBe(merged);
    expect(mergeMemos(merged, 'a', 'none', true, 8, rand)).toBe(merged);
  });

  it('카드째 합치면 그 카드의 탭이 전부 따라온다', () => {
    const ab = mergeMemos([at('a', 0, 0), at('b', 50, 50)], 'b', 'a', true, 7, rand);
    const list = [...ab, at('c', 300, 300)];
    const out = mergeMemos(list, 'a', 'c', true, 8, rand);
    const cards = memoCards(out);
    expect(cards).toHaveLength(1);
    expect(new Set(cards[0]!.members.map((m) => m.id))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('탭 한 장만 옮기면 나머지는 원래 카드에 남는다', () => {
    const ab = mergeMemos([at('a', 0, 0), at('b', 50, 50)], 'b', 'a', true, 7, rand);
    const list = [...ab, at('c', 300, 300)];
    const out = mergeMemos(list, 'b', 'c', false, 8, rand);
    const cards = memoCards(out);
    expect(cards).toHaveLength(2);
    const byActive = Object.fromEntries(cards.map((c) => [c.active.id, c.members.map((m) => m.id)]));
    expect(byActive['b']).toEqual(['c', 'b']);
    // a 는 혼자 남았으므로 묶음이 풀린다 — 탭 하나짜리 탭 줄은 없다.
    expect(out.find((m) => m.id === 'a')?.groupId).toBeUndefined();
  });

  it('떼어내면 놓은 자리에 혼자 서고, 크기는 떠나온 카드의 것을 물려받는다', () => {
    const ab = mergeMemos([at('a', 0, 0, { w: 400, h: 300 }), at('b', 50, 50)], 'b', 'a', true, 7, rand);
    const out = detachMemo(ab, 'b', { x: 300, y: 220 }, board, 9);
    const solo = out.find((m) => m.id === 'b')!;
    expect(solo.groupId).toBeUndefined();
    expect([solo.x, solo.y]).toEqual([300, 220]);
    expect([solo.w, solo.h]).toEqual([400, 300]);
    expect(memoCards(out)).toHaveLength(2);
  });

  it('떼어낸 자리는 판 안으로 접힌다 — 화면 밖으로 떨어뜨릴 수 없다', () => {
    const ab = mergeMemos([at('a', 0, 0), at('b', 50, 50)], 'b', 'a', true, 7, rand);
    const out = detachMemo(ab, 'b', { x: 99999, y: -50 }, board, 9);
    const solo = out.find((m) => m.id === 'b')!;
    expect(solo.y).toBe(0);
    expect(solo.x + solo.w).toBeLessThanOrEqual(board.w);
  });

  it('혼자인 장은 떼어낼 것이 없다(같은 배열)', () => {
    const list = [at('a', 0, 0)];
    expect(detachMemo(list, 'a', { x: 10, y: 10 }, board, 9)).toBe(list);
  });

  it('탭 전환은 활성만 옮기고 자리·순서는 건드리지 않는다', () => {
    const ab = mergeMemos([at('a', 0, 0), at('b', 50, 50)], 'b', 'a', true, 7, rand);
    expect(memoCards(ab)[0]!.active.id).toBe('b');
    const out = activateMemoTab(ab, 'a', 9);
    expect(memoCards(out)[0]!.active.id).toBe('a');
    expect(out.map((m) => m.id)).toEqual(ab.map((m) => m.id));
    // 이미 활성이면 같은 배열.
    expect(activateMemoTab(out, 'a', 10)).toBe(out);
  });

  it('맨 앞으로 올리면 묶음 전원이 함께 간다 — 탭 순서는 그대로', () => {
    const ab = mergeMemos([at('a', 0, 0), at('b', 50, 50)], 'b', 'a', true, 7, rand);
    const list = [...ab, at('c', 300, 300)];
    expect(list.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    const out = raiseMemo(list, 'a');
    expect(out.map((m) => m.id)).toEqual(['c', 'a', 'b']);
    // 이미 맨 앞이면 같은 배열.
    expect(raiseMemo(out, 'b')).toBe(out);
  });

  it('자리·크기·접힘은 묶음 전체가 함께 움직인다(본문·이름·색은 탭마다 따로)', () => {
    const ab = mergeMemos([at('a', 0, 0), at('b', 50, 50)], 'b', 'a', true, 7, rand);
    const moved = patchMemo(ab, 'b', { x: 200, y: 120 }, 11);
    for (const m of moved) expect([m.x, m.y]).toEqual([200, 120]);
    const folded = patchMemo(moved, 'b', { collapsed: true }, 12);
    for (const m of folded) expect(m.collapsed).toBe(true);
    // 본문은 그 탭만.
    const typed = patchMemo(folded, 'b', { text: '나만' }, 13);
    expect(typed.find((m) => m.id === 'b')?.text).toBe('나만');
    expect(typed.find((m) => m.id === 'a')?.text).toBe('');
  });

  it('마지막 한 장이 남으면 묶음은 저절로 풀린다 — 탭 하나짜리 탭 줄은 없다', () => {
    const ab = mergeMemos([at('a', 0, 0), at('b', 50, 50)], 'b', 'a', true, 7, rand);
    const out = removeMemo(ab, 'b');
    expect(out).toHaveLength(1);
    expect(out[0]?.groupId).toBeUndefined();
    expect(out[0]?.groupActive).toBeUndefined();
  });

  it('합쳐진 탭끼리는 서로를 가린 것으로 세지 않는다 — 같은 자리에 포갠 한 몸이다', () => {
    const ab = mergeMemos([at('a', 0, 0), at('b', 50, 50)], 'b', 'a', true, 7, rand);
    expect(hasHiddenMemoHeaders(ab)).toBe(false);
    expect([...stackedUnderCounts(ab).values()].every((n) => n === 0)).toBe(true);
  });

  it('[펼치기]는 합쳐진 카드를 통째로 옮긴다 — 탭이 뒤에 남지 않는다', () => {
    const ab = mergeMemos([at('a', 100, 100), at('b', 50, 50)], 'b', 'a', true, 7, rand);
    const list = [at('z', 100, 100), ...ab];
    const out = spreadOverlappingMemos(list, board, 999);
    const a = out.find((m) => m.id === 'a')!;
    const b = out.find((m) => m.id === 'b')!;
    expect([a.x, a.y]).toEqual([b.x, b.y]);
    expect(hasHiddenMemoHeaders(out)).toBe(false);
  });
});

describe('겹침 — 덮은 쪽이 배지를 단다', () => {
  /** 좌상단 (x,y) 에 놓인 기본 크기(260x190) 한 장. */
  const at = (id: string, x: number, y: number, over: Partial<SessionMemo> = {}): SessionMemo => memo({ id, x, y, ...over });

  it('제목줄이 가려질 때만 겹친 것으로 센다 — 본문만 스치는 것은 소음이다', () => {
    // b 는 a 의 **아래쪽**(제목줄보다 훨씬 밑)에만 걸친다 → a 의 이름은 그대로 읽힌다.
    const bodyOnly = [at('a', 0, 0), at('b', 0, 150)];
    expect(stackedUnderCounts(bodyOnly).get('b')).toBe(0);
    // 제목줄을 덮으면 그때가 진짜 겹침이다.
    const headerHit = [at('a', 0, 0), at('b', 0, 10)];
    expect(stackedUnderCounts(headerHit).get('b')).toBe(1);
  });

  it('배열 순서가 z-order — 밑장은 위를 덮지 않는다', () => {
    const list = [at('a', 0, 0), at('b', 0, 10)];
    expect(stackedUnderCounts(list).get('a')).toBe(0);
    expect(stackedUnderCounts(list).get('b')).toBe(1);
  });

  it('접은 장은 제목줄 높이만 차지한다 — 펼침 높이로 재면 없는 겹침을 신고한다', () => {
    const list = [at('a', 0, 100), at('b', 0, 0, { collapsed: true })];
    // 접힌 b(28px)는 y=100 의 a 제목줄에 닿지 않는다.
    expect(stackedUnderCounts(list).get('b')).toBe(0);
    const expanded = [at('a', 0, 100), at('b', 0, 0)];
    expect(stackedUnderCounts(expanded).get('b')).toBe(1);
  });

  it('배지를 누르면 바로 밑장이 위로 — 자리는 그대로, 순서만 바뀐다', () => {
    const list = [at('a', 0, 0), at('b', 0, 5), at('c', 0, 10)];
    const next = raiseNextUnder(list, 'c');
    expect(next.map((m) => m.id)).toEqual(['a', 'c', 'b']);
    // 자리는 한 픽셀도 안 움직인다.
    expect(next.map((m) => [m.x, m.y])).toEqual([[0, 0], [0, 10], [0, 5]]);
    // 반복하면 한 겹씩 벗겨진다 — 이제 맨 위인 b 가 바로 밑장(c)을 올린다.
    expect(raiseNextUnder(next, 'b').map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('덮은 것이 없으면 같은 배열 — 헛 저장이 나가지 않는다', () => {
    const list = [at('a', 0, 0), at('b', 400, 0)];
    expect(raiseNextUnder(list, 'b')).toBe(list);
    expect(raiseNextUnder(list, 'none')).toBe(list);
    expect(hasHiddenMemoHeaders(list)).toBe(false);
    expect(hasHiddenMemoHeaders([at('a', 0, 0), at('b', 0, 10)])).toBe(true);
  });
});

describe('spreadOverlappingMemos — 떼어 놓기', () => {
  const at = (id: string, x: number, y: number, over: Partial<SessionMemo> = {}): SessionMemo => memo({ id, x, y, ...over });

  it('겹친 것이 없으면 같은 배열(잘 놓아둔 판을 건드리지 않는다)', () => {
    const list = [at('a', 0, 0), at('b', 400, 0)];
    expect(spreadOverlappingMemos(list, board)).toBe(list);
    const alone = [at('a', 0, 0)];
    expect(spreadOverlappingMemos(alone, board)).toBe(alone);
  });

  it('판 크기를 모르면 아무것도 하지 않는다 — 첫 렌더에 전부 좌상단으로 몰리는 사고 방지', () => {
    const list = [at('a', 0, 0), at('b', 0, 10)];
    expect(spreadOverlappingMemos(list, { w: 0, h: 0 })).toBe(list);
  });

  it('겹친 것을 풀어 놓는다 — 끝나면 가려진 이름이 하나도 없다', () => {
    const list = [at('a', 0, 0), at('b', 0, 10), at('c', 20, 20)];
    const out = spreadOverlappingMemos(list, board, 999);
    expect(hasHiddenMemoHeaders(out)).toBe(false);
    // 순서(z-order)는 보존된다 — 펼치기는 자리를 바꾸는 일이지 순서를 바꾸는 일이 아니다.
    expect(out.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('뭉치의 맨 아래 장은 자리를 지킨다 — 위에 얹은 것이 비켜선다', () => {
    const list = [at('a', 100, 100), at('b', 100, 110)];
    const out = spreadOverlappingMemos(list, board, 999);
    expect(out[0]).toMatchObject({ id: 'a', x: 100, y: 100 });
    expect(out[1]?.x === 100 && out[1]?.y === 110).toBe(false);
  });

  it('겹치지 않은 장은 손대지 않고 장애물로만 쓴다', () => {
    const still = at('still', 500, 400);
    const out = spreadOverlappingMemos([still, at('a', 0, 0), at('b', 0, 10)], board, 999);
    // 같은 객체 그대로 — 안 엉킨 장은 updatedAt 조차 안 흔든다.
    expect(out[0]).toBe(still);
  });

  it('움직인 장만 updatedAt 이 올라간다', () => {
    const out = spreadOverlappingMemos([at('a', 0, 0), at('b', 0, 10)], board, 4242);
    expect(out[0]?.updatedAt).toBe(1);
    expect(out[1]?.updatedAt).toBe(4242);
  });

  it('판 안에 남는다 — 떼어 놓다가 화면 밖으로 밀어내지 않는다', () => {
    const many = Array.from({ length: 6 }, (_, i) => at(`m${i}`, 4 * i, 4 * i));
    const out = spreadOverlappingMemos(many, board, 999);
    for (const m of out) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.x + m.w).toBeLessThanOrEqual(board.w);
      expect(m.y + m.h).toBeLessThanOrEqual(board.h);
    }
  });

  it('판이 꽉 차면 제자리에 둔다 — 잃는 장은 없다', () => {
    // 한 장이 겨우 들어가는 판에 두 장을 겹쳐 두면 뗄 자리가 없다.
    const tight = { w: SESSION_MEMO.DEFAULT_W, h: SESSION_MEMO.DEFAULT_H };
    const list = [at('a', 0, 0), at('b', 0, 0)];
    const out = spreadOverlappingMemos(list, tight, 999);
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('moveMemo / resizeMemo', () => {
  it('이동은 시작 위치 + 델타, 판 밖으로는 못 나간다', () => {
    const m = memo();
    expect(moveMemo(m, { x: 100, y: 100 }, 50, 30, board)).toMatchObject({ x: 150, y: 130 });
    expect(moveMemo(m, { x: 100, y: 100 }, -9999, -9999, board)).toMatchObject({ x: 0, y: 0 });
  });

  it('크기 조절은 하한을 지키고 판 오른쪽/아래를 넘지 않는다', () => {
    const m = memo({ x: 600, y: 500 });
    const out = resizeMemo(m, { w: m.w, h: m.h }, 9999, 9999, board);
    expect(out.w).toBe(board.w - 600);
    expect(out.h).toBe(board.h - 500);
    const min = resizeMemo(m, { w: m.w, h: m.h }, -9999, -9999, board);
    expect(min.w).toBe(SESSION_MEMO.MIN_W);
    expect(min.h).toBe(SESSION_MEMO.MIN_H);
  });
});

describe('newMemoId', () => {
  it('같은 ms 라도 난수로 갈린다', () => {
    expect(newMemoId(1000, () => 0.1)).not.toBe(newMemoId(1000, () => 0.9));
  });
});

describe('팔레트 규약', () => {
  it('기본색은 팔레트 첫 칸이다', () => {
    expect(SESSION_MEMO_PALETTE[0]?.color).toBe(SESSION_MEMO_DEFAULT_COLOR);
  });

  it('팔레트 색은 전부 #RRGGBB — style 로 그대로 나가도 안전하다', () => {
    for (const c of SESSION_MEMO_PALETTE) expect(c.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe('불투명도(alpha) — 유리판의 두께', () => {
  it('필드가 없으면 기본값이다(기본값은 저장하지 않는다)', () => {
    expect(memoAlpha(memo())).toBe(SESSION_MEMO.DEFAULT_ALPHA);
  });

  it('범위 밖 값은 접힌다 — 완전 투명한 유령 카드가 생기지 않는다', () => {
    expect(memoAlpha(memo({ alpha: 0 }))).toBe(SESSION_MEMO.MIN_ALPHA);
    expect(memoAlpha(memo({ alpha: 9 }))).toBe(SESSION_MEMO.MAX_ALPHA);
  });

  it('기본값으로 되돌리면 alpha 키를 남기지 않는다(collapsed 와 같은 규약)', () => {
    const list = [memo({ id: 'a', alpha: 0.4 })];
    const out = patchMemo(list, 'a', { alpha: SESSION_MEMO.DEFAULT_ALPHA }, 3);
    expect(out[0] && 'alpha' in out[0]).toBe(false);
  });
});

describe('memoSurface — 글자색은 "고른 색"이 아니라 "보이는 색"으로 정한다', () => {
  it('합성은 알파 0 이면 바닥색, 1 이면 고른 색 그대로', () => {
    expect(compositeOver('#FFFFFF', 0, '#000000')).toBe('#000000');
    expect(compositeOver('#FFFFFF', 1, '#000000')).toBe('#FFFFFF');
  });

  it('[회귀] 밝은 종이를 투명하게 낮추면 글자색이 흰색으로 뒤집힌다', () => {
    // 색만 보고 판정하면 어두운 바닥 위 어두운 판에 **검은 글씨**를 얹어 아무것도 안 읽힌다.
    const solid = memoSurface('#E2E8F0', 1);
    const sheer = memoSurface('#E2E8F0', 0.2);
    expect(solid.text).toBe('#0F172A');
    expect(sheer.text).toBe('#F8FAFC');
  });

  it('거의 불투명하면 뒤를 흐리지 않는다(비칠 것이 없는데 합성기만 돈다)', () => {
    expect(memoSurface(SESSION_MEMO_DEFAULT_COLOR, 1).blur).toBe(false);
    expect(memoSurface(SESSION_MEMO_DEFAULT_COLOR, SESSION_MEMO.DEFAULT_ALPHA).blur).toBe(true);
  });

  it('배경은 rgba 로 나가고 알파가 그대로 실린다', () => {
    expect(memoSurface('#334155', 0.5).background).toBe('rgba(51, 65, 85, 0.5)');
  });

  it('망가진 색이 style 로 새지 않는다 — 기본색으로 떨어진다', () => {
    expect(memoSurface('red; background:url(x)', 1).background)
      .toBe(memoSurface(SESSION_MEMO_DEFAULT_COLOR, 1).background);
  });
});

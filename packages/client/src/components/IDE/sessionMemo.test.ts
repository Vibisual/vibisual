import { describe, it, expect } from 'vitest';
import { SESSION_MEMO, SESSION_MEMO_DEFAULT_COLOR, SESSION_MEMO_PALETTE, sanitizeSessionMemos, type SessionMemo } from '@vibisual/shared';
import {
  canAddMemo,
  compositeOver,
  memoAlpha,
  memoSurface,
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

import { describe, it, expect } from 'vitest';
import {
  normalizeIDEActivityBarPrefs,
  resolveActivityOrder,
  moveActivityItem,
  applyVisibleOrder,
} from '@vibisual/shared';

/**
 * §5.5 #16-1 — 활동바 배치 로직. **순서를 합치는 규칙이 하나여야 한다**는 것이 이 파일의 요지다:
 * 서버가 정규화하고 클라가 다시 해석하는데 둘이 다른 답을 내면, 사용자가 끌어 둔 자리가 창을
 * 다시 열 때마다 조금씩 달라진다.
 */

const DEFAULTS = ['mcp', 'hooks', 'plugins', 'files', 'context', 'skills', 'goal', 'brain'];

describe('normalizeIDEActivityBarPrefs', () => {
  it('둘 다 비면 undefined — 안 만진 사용자의 app-state 에 빈 칸을 새로 만들지 않는다', () => {
    expect(normalizeIDEActivityBarPrefs(undefined)).toBeUndefined();
    expect(normalizeIDEActivityBarPrefs({})).toBeUndefined();
    expect(normalizeIDEActivityBarPrefs({ order: [], hidden: [] })).toBeUndefined();
    expect(normalizeIDEActivityBarPrefs([])).toBeUndefined();
    expect(normalizeIDEActivityBarPrefs('nope')).toBeUndefined();
  });

  it('문자열만 남기고 중복은 접는다(순서 보존)', () => {
    const prefs = normalizeIDEActivityBarPrefs({
      order: ['files', 'files', 3, '', null, 'goal'],
      hidden: ['brain'],
    });
    expect(prefs).toEqual({ order: ['files', 'goal'], hidden: ['brain'] });
  });

  it('한쪽만 있으면 그 칸만 담는다', () => {
    expect(normalizeIDEActivityBarPrefs({ hidden: ['brain'] })).toEqual({ hidden: ['brain'] });
  });
});

describe('resolveActivityOrder', () => {
  it('저장된 것이 없으면 기본 순서 그대로', () => {
    expect(resolveActivityOrder(undefined, DEFAULTS)).toEqual(DEFAULTS);
    expect(resolveActivityOrder([], DEFAULTS)).toEqual(DEFAULTS);
  });

  it('저장된 순서를 존중한다', () => {
    const saved = ['brain', 'goal', 'skills', 'context', 'files', 'plugins', 'hooks', 'mcp'];
    expect(resolveActivityOrder(saved, DEFAULTS)).toEqual(saved);
  });

  it('판올림에서 사라진 이름은 버린다', () => {
    const saved = ['brain', 'ghostView', 'mcp'];
    const out = resolveActivityOrder(saved, DEFAULTS);
    expect(out).not.toContain('ghostView');
    expect(out).toHaveLength(DEFAULTS.length);
  });

  it('새로 생긴 칸은 버리지 않고 **기본 순서의 앞 이웃 뒤**에 끼운다', () => {
    // 사용자가 `plugins` 를 모르던 때 저장한 순서(그 칸이 없다).
    const saved = ['mcp', 'hooks', 'files', 'context', 'skills', 'goal', 'brain'];
    const out = resolveActivityOrder(saved, DEFAULTS);
    expect(out).toHaveLength(DEFAULTS.length);
    // 기본에서 `plugins` 의 앞 이웃은 `hooks` 다 — 꼬리가 아니라 그 뒤에 선다.
    expect(out.indexOf('plugins')).toBe(out.indexOf('hooks') + 1);
  });

  it('맨 앞 칸이 새로 생기면 맨 앞에 선다', () => {
    const saved = ['hooks', 'plugins', 'files', 'context', 'skills', 'goal', 'brain'];
    expect(resolveActivityOrder(saved, DEFAULTS)[0]).toBe('mcp');
  });

  it('새 칸 여럿이 연속이면 기본 순서대로 이어 붙는다', () => {
    const saved = ['mcp', 'files', 'context', 'skills', 'goal', 'brain'];
    const out = resolveActivityOrder(saved, DEFAULTS);
    expect(out.indexOf('hooks')).toBe(out.indexOf('mcp') + 1);
    expect(out.indexOf('plugins')).toBe(out.indexOf('hooks') + 1);
  });

  it('중복이 섞여 들어와도 한 번만 선다', () => {
    const out = resolveActivityOrder(['brain', 'brain', 'mcp'], DEFAULTS);
    expect(out.filter((v) => v === 'brain')).toHaveLength(1);
    expect(new Set(out).size).toBe(DEFAULTS.length);
  });
});

describe('moveActivityItem', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('아래로 — `to` 는 "이 칸 앞에 놓는다" 기준이라 한 칸 내리려면 from+2', () => {
    expect(moveActivityItem(list, 0, 2)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('위로', () => {
    expect(moveActivityItem(list, 2, 0)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('맨 끝으로', () => {
    expect(moveActivityItem(list, 0, 4)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('제자리면 그대로', () => {
    expect(moveActivityItem(list, 1, 1)).toEqual(list);
    expect(moveActivityItem(list, 1, 2)).toEqual(list);
  });

  it('범위를 벗어난 목표는 양 끝으로 접는다(끌다가 바 밖으로 나가는 일이 잦다)', () => {
    expect(moveActivityItem(list, 1, -5)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveActivityItem(list, 1, 99)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('없는 자리를 뽑으려 하면 아무 일도 하지 않는다', () => {
    expect(moveActivityItem(list, 9, 0)).toEqual(list);
    expect(moveActivityItem(list, -1, 0)).toEqual(list);
  });
});

describe('applyVisibleOrder', () => {
  // 전체 순서에 내려놓은 칸(`x`)이 섞여 있고, 화면에는 나머지만 서 있다.
  const order = ['a', 'x', 'b', 'c', 'y'];
  const visible = ['a', 'b', 'c'];

  it('안 보이는 칸의 자리는 그대로 두고 보이는 자리들만 새 순서로 채운다', () => {
    expect(applyVisibleOrder(order, visible, ['c', 'a', 'b'])).toEqual(['c', 'x', 'a', 'b', 'y']);
  });

  it('제외했다 도로 올려도 그 칸이 제자리에 남는다 — 끌 때마다 끝으로 쓸려 가지 않는다', () => {
    const moved = applyVisibleOrder(order, visible, ['b', 'c', 'a']);
    expect(moved.indexOf('x')).toBe(1);
    expect(moved.indexOf('y')).toBe(4);
  });

  it('길이가 어긋나면 아무것도 하지 않는다(절반만 채우면 항목이 중복·소실된다)', () => {
    expect(applyVisibleOrder(order, visible, ['a', 'b'])).toEqual(order);
  });

  it('보이는 것이 전부면 그냥 그 순서다', () => {
    expect(applyVisibleOrder(visible, visible, ['c', 'b', 'a'])).toEqual(['c', 'b', 'a']);
  });
});

describe('드래그 한 판을 통째로 — 화면에서 끈 결과가 저장분이 된다', () => {
  it('내려놓은 칸을 건너뛰고 끌어도 전체 순서가 온전하다', () => {
    const saved = ['mcp', 'hooks', 'plugins', 'files', 'context', 'skills', 'goal', 'brain'];
    const hidden = new Set(['hooks', 'context']);
    const visible = saved.filter((v) => !hidden.has(v));
    // 화면 맨 아래의 `brain` 을 맨 위로 끈다(사용자가 하는 일).
    const nextVisible = moveActivityItem(visible, visible.indexOf('brain'), 0);
    const next = applyVisibleOrder(saved, visible, nextVisible);

    expect(next[0]).toBe('brain');
    expect(new Set(next)).toEqual(new Set(saved)); // 잃은 칸도 늘어난 칸도 없다.
    // 다시 읽어도 같은 답 — 저장 → 복원이 사용자의 자리를 흔들지 않는다.
    expect(resolveActivityOrder(next, saved)).toEqual(next);
  });
});

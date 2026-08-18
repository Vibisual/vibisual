/**
 * §5.5 #17-28 v4.96 — 주입원 목록 화면 로직(정렬·검색·묶음) 테스트.
 * 화면이 흔들리면 토글을 못 누른다 — 같은 값일 때의 **안정 순서**까지 못 박는다.
 */
import { describe, it, expect } from 'vitest';
import type { ContextSourceItem } from '@vibisual/shared';
import {
  CONTEXT_CATEGORY_ORDER,
  formatTokens,
  groupByCategory,
  matchesQuery,
  sortItems,
  sumTokens,
} from './contextInventoryView.js';

function item(over: Partial<ContextSourceItem> & { id: string }): ContextSourceItem {
  return {
    category: 'vibisual',
    title: over.id,
    chars: 0,
    tokens: 0,
    control: 'session',
    defaultEnabled: true,
    enabled: true,
    ...over,
  } as ContextSourceItem;
}

const titleOf = (i: ContextSourceItem): string => i.title;

describe('정렬', () => {
  const items = [
    item({ id: 'b', tokens: 300, updatedAt: 100, category: 'skills' }),
    item({ id: 'a', tokens: 100, updatedAt: 300, category: 'vibisual' }),
    item({ id: 'c', tokens: 200, updatedAt: 200, category: 'system' }),
  ];

  it('토큰 내림차순', () => {
    expect(sortItems(items, 'tokens', true, titleOf).map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('날짜 내림차순 = 최근 수정이 먼저', () => {
    expect(sortItems(items, 'updated', true, titleOf).map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('이름 오름차순', () => {
    expect(sortItems(items, 'name', false, titleOf).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('분류 정렬은 표 순서를 따르고, 같은 분류 안에서는 무거운 것부터', () => {
    const two = [
      item({ id: 'light', tokens: 10, category: 'vibisual' }),
      item({ id: 'heavy', tokens: 90, category: 'vibisual' }),
      item({ id: 'sys', tokens: 999, category: 'system' }),
    ];
    expect(sortItems(two, 'category', false, titleOf).map((i) => i.id)).toEqual(['heavy', 'light', 'sys']);
  });

  it('값이 같으면 id 로 못 박아 목록이 새로고침마다 흔들리지 않는다', () => {
    const same = [item({ id: 'z', tokens: 5 }), item({ id: 'a', tokens: 5 })];
    expect(sortItems(same, 'tokens', true, titleOf).map((i) => i.id)).toEqual(['a', 'z']);
    expect(sortItems(same, 'tokens', true, titleOf).map((i) => i.id)).toEqual(['a', 'z']);
  });
});

describe('검색', () => {
  const it1 = item({
    id: 'cc.claude-md',
    title: 'CLAUDE.md',
    detail: 'CLAUDE.md, AGENTS.md',
    children: [{ title: 'CLAUDE.md', path: '/repo/CLAUDE.md', chars: 10, tokens: 3 }],
  });

  it('빈 질의는 전부 통과', () => {
    expect(matchesQuery(it1, '지시 파일', '')).toBe(true);
  });

  it('번역된 제목으로도 찾힌다', () => {
    expect(matchesQuery(it1, '지시 파일', '지시')).toBe(true);
  });

  it('내역의 경로 조각으로도 찾힌다', () => {
    expect(matchesQuery(it1, 'Instruction files', 'repo/cl')).toBe(true);
  });

  it('없는 말은 안 걸린다', () => {
    expect(matchesQuery(it1, 'Instruction files', 'mcp')).toBe(false);
  });
});

describe('묶음·합계·표기', () => {
  it('분류 묶음은 표 순서대로, 빈 분류는 세우지 않는다', () => {
    const groups = groupByCategory([
      item({ id: 'a', category: 'system' }),
      item({ id: 'b', category: 'vibisual' }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(['vibisual', 'system']);
    expect(CONTEXT_CATEGORY_ORDER.indexOf('vibisual')).toBeLessThan(CONTEXT_CATEGORY_ORDER.indexOf('system'));
  });

  it('합계는 켜진 것과 전체를 따로 센다', () => {
    const s = sumTokens([
      item({ id: 'a', tokens: 100 }),
      item({ id: 'b', tokens: 50, enabled: false }),
    ]);
    expect(s).toEqual({ enabled: 100, total: 150 });
  });

  it('토큰 표기는 만 단위부터 줄인다', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(9_999)).toBe('9,999');
    expect(formatTokens(12_340)).toBe('12.3K');
  });
});

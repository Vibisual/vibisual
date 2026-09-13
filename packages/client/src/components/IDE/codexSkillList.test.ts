import { describe, expect, it } from 'vitest';
import type { CodexSkillEntry } from '@vibisual/shared';
import {
  CODEX_FAVORITE_PREFIX,
  codexFavoriteKey,
  codexFavoriteNames,
  codexSkillInsertText,
  codexSkillMatches,
  codexSkillSourceOf,
  groupCodexSkills,
  toggleCodexFavorite,
} from './codexSkillList.js';

/**
 * §5.25 (M-1) — 코덱스 스킬 칸의 판정.
 *
 * 못 박는 것 넷: ① **즐겨찾기 저장고를 클로드와 나눠 쓰되 서로를 덮지 않는다**(접두), ② 출처가
 * 없는 옛 항목은 `user` 로 읽는다(그 시절 목록은 전부 홈 것이었다), ③ 검색은 이름·설명·플러그인
 * 이름에 걸린다, ④ 즐겨찾기는 출처 그룹에서 빠진다(같은 것을 두 번 그리지 않는다).
 */

function skill(name: string, over: Partial<CodexSkillEntry> = {}): CodexSkillEntry {
  return { name, path: `/root/${name}`, ...over };
}

describe('codexSkillInsertText', () => {
  it('클로드 칸과 같은 모양 — `/이름 ` 뒤에 공백 하나(사용자가 이어 쓴다)', () => {
    expect(codexSkillInsertText('imagegen')).toBe('/imagegen ');
  });
});

describe('즐겨찾기 — 클로드와 같은 저장고를 접두로 나눈다', () => {
  it('코덱스 항목에만 접두가 붙는다', () => {
    expect(codexFavoriteKey('imagegen')).toBe(`${CODEX_FAVORITE_PREFIX}imagegen`);
  });

  it('저장된 목록에서 코덱스 것만 골라 접두를 뗀다', () => {
    expect(codexFavoriteNames(['release', 'codex:imagegen', 'codex:pdf'])).toEqual(['imagegen', 'pdf']);
  });

  it('별을 켜고 꺼도 **클로드 항목은 그대로 남는다** — 전체 치환 저장이라 여기서 지키지 않으면 사라진다', () => {
    const before = ['release', 'codex:imagegen'];
    const on = toggleCodexFavorite(before, 'pdf');
    expect(on).toEqual(['release', 'codex:imagegen', 'codex:pdf']);
    const off = toggleCodexFavorite(on, 'imagegen');
    expect(off).toEqual(['release', 'codex:pdf']);
  });

  it('같은 이름이 두 엔진에 있어도 서로의 별을 켜지 않는다', () => {
    // 클로드 쪽 `release` 가 이미 즐겨찾기여도 코덱스 `release` 는 꺼진 상태다.
    expect(codexFavoriteNames(['release'])).toEqual([]);
    expect(toggleCodexFavorite(['release'], 'release')).toEqual(['release', 'codex:release']);
  });
});

describe('codexSkillSourceOf', () => {
  it('출처가 없는 옛 항목은 `user` — 홈만 읽던 시절 목록은 전부 홈 것이었다', () => {
    expect(codexSkillSourceOf(skill('old'))).toBe('user');
  });

  it('있으면 그대로 쓴다', () => {
    expect(codexSkillSourceOf(skill('imagegen', { source: 'system' }))).toBe('system');
  });
});

describe('codexSkillMatches', () => {
  const s = skill('visualize', { description: 'Draw charts', source: 'plugin', pluginName: 'charts-kit' });

  it('빈 검색어는 전부 통과', () => {
    expect(codexSkillMatches(s, '')).toBe(true);
    expect(codexSkillMatches(s, '   ')).toBe(true);
  });

  it('이름·설명·플러그인 이름 셋에 걸린다', () => {
    expect(codexSkillMatches(s, 'visu')).toBe(true);
    expect(codexSkillMatches(s, 'chart')).toBe(true);
    expect(codexSkillMatches(s, 'kit')).toBe(true);
  });

  it('대소문자를 가리지 않는다', () => {
    expect(codexSkillMatches(s, 'DRAW')).toBe(true);
  });

  it('안 걸리면 false', () => {
    expect(codexSkillMatches(s, 'zzz')).toBe(false);
  });
});

describe('groupCodexSkills', () => {
  const list: CodexSkillEntry[] = [
    skill('mine', { source: 'user' }),
    skill('imagegen', { source: 'system', description: 'Generate images' }),
    skill('pdf', { source: 'plugin', pluginName: 'pdf' }),
    skill('legacy'), // 출처 없음 — user 로 읽힌다.
  ];

  it('출처로 나눈다', () => {
    const g = groupCodexSkills(list, [], '');
    expect(g.user.map((s) => s.name)).toEqual(['mine', 'legacy']);
    expect(g.system.map((s) => s.name)).toEqual(['imagegen']);
    expect(g.plugin.map((s) => s.name)).toEqual(['pdf']);
  });

  it('즐겨찾기는 위로 올라가고 **출처 그룹에서는 빠진다**', () => {
    const g = groupCodexSkills(list, ['imagegen'], '');
    expect(g.favorites.map((s) => s.name)).toEqual(['imagegen']);
    expect(g.system).toEqual([]);
  });

  it('즐겨찾기는 별 누른 순서 — 이름순이 아니다', () => {
    const g = groupCodexSkills(list, ['pdf', 'mine'], '');
    expect(g.favorites.map((s) => s.name)).toEqual(['pdf', 'mine']);
  });

  it('검색은 즐겨찾기에도 걸린다 — 안 맞는 것이 남으면 "찾은 것"이 흐려진다', () => {
    const g = groupCodexSkills(list, ['imagegen'], 'pdf');
    expect(g.favorites).toEqual([]);
    expect(g.plugin.map((s) => s.name)).toEqual(['pdf']);
  });

  it('전체 개수와 걸러진 개수를 따로 말한다 — 헤더는 전체를, 빈 화면은 검색을 말한다', () => {
    const g = groupCodexSkills(list, [], 'pdf');
    expect(g.total).toBe(4);
    expect(g.shown).toBe(1);
  });

  it('아무것도 안 걸리면 shown 이 0 — 화면이 "이 기계엔 없다" 대신 "이 검색어엔 없다"를 말한다', () => {
    expect(groupCodexSkills(list, [], 'zzz').shown).toBe(0);
    expect(groupCodexSkills(list, [], 'zzz').total).toBe(4);
  });

  it('이름이 같고 자리가 다른 스킬은 둘 다 남는다(실측: `spreadsheets` 가 둘이었다)', () => {
    const twins: CodexSkillEntry[] = [
      { name: 'spreadsheets', path: '/a/spreadsheets', source: 'plugin', pluginName: 'spreadsheets' },
      { name: 'spreadsheets', path: '/b/excel-live-control', source: 'plugin', pluginName: 'spreadsheets' },
    ];
    expect(groupCodexSkills(twins, [], '').plugin).toHaveLength(2);
    // 즐겨찾기로 올려도 둘 다 — 이름만으로는 어느 쪽인지 가를 수 없으니 감추지 않는다.
    expect(groupCodexSkills(twins, ['spreadsheets'], '').favorites).toHaveLength(2);
  });
});

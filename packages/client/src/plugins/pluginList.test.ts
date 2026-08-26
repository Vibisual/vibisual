/**
 * §5.11 v4.24 — Plugins 창 목록 계산 고정 테스트.
 *
 * 111종을 고르는 화면이라 "찾기"와 "켠 것 먼저"가 곧 사용성이다. 규칙이 흔들리면 사용자는 켜 둔 카드를
 * 다시 찾지 못한다. 순수 함수로 떼어 여기서 못 박는다.
 */
import { describe, it, expect } from 'vitest';
import type { PluginManifest } from '@vibisual/shared';
import { groupPlugins, resolveSelection, PLUGIN_CATEGORY_ORDER } from './pluginList.js';

const m = (id: string, name: string, category: PluginManifest['category']): PluginManifest => ({
  id,
  name,
  version: '1.0.0',
  category,
  descriptionKey: `panel.plugins.${id}.desc`,
  enabledByDefault: false,
  contributes: ['panelSection'],
  clientOnly: true,
});

const ALL = [
  m('alpha', 'Alpha', 'workflow'),
  m('bravo', 'Bravo', 'security'),
  m('charlie', 'Charlie', 'security'),
  m('delta', 'Delta', 'observability'),
];

const DESC: Record<string, string> = {
  alpha: '작업 순서를 본다',
  bravo: '권한이 얼마나 열려 있는지 본다',
  charlie: '되돌릴 수 없는 명령을 본다',
  delta: '토큰 비용을 본다',
};
const describe_ = (x: PluginManifest): string => DESC[x.id] ?? '';

// 종전 테스트는 "거르고 묶는" 규칙을 보는 것이라 노출 게이트를 열어 둔다(게이트 자체는 아래에서 따로 본다).
const base = { query: '', onlyEnabled: false, enabled: new Set<string>(), describe: describe_, showDraft: true };

describe('플러그인 목록 묶기', () => {
  it('분류 순서는 위험한 것부터 고정이다', () => {
    const groups = groupPlugins(ALL, base);
    expect(groups.map((g) => g.category)).toEqual(['security', 'observability', 'workflow']);
    expect(PLUGIN_CATEGORY_ORDER[0]).toBe('security');
  });

  it('빈 분류는 머리글을 내지 않는다', () => {
    const groups = groupPlugins(ALL, { ...base, query: 'delta' });
    expect(groups.map((g) => g.category)).toEqual(['observability']);
  });

  it('켠 것이 같은 분류 안에서 위로 온다', () => {
    const groups = groupPlugins(ALL, { ...base, enabled: new Set(['charlie']) });
    const security = groups.find((g) => g.category === 'security');
    expect(security?.items.map((x) => x.id)).toEqual(['charlie', 'bravo']);
  });

  it('같은 상태끼리는 이름순 — 켤 때마다 자리가 흔들리면 다시 못 찾는다', () => {
    const groups = groupPlugins(ALL, base);
    expect(groups.find((g) => g.category === 'security')?.items.map((x) => x.id)).toEqual(['bravo', 'charlie']);
  });
});

describe('플러그인 찾기', () => {
  it('이름으로 찾는다', () => {
    const groups = groupPlugins(ALL, { ...base, query: 'Brav' });
    expect(groups.flatMap((g) => g.items).map((x) => x.id)).toEqual(['bravo']);
  });

  it('id 로도 찾는다 — 화면 이름과 코드 이름이 다를 수 있다', () => {
    const groups = groupPlugins(ALL, { ...base, query: 'charlie' });
    expect(groups.flatMap((g) => g.items).map((x) => x.id)).toEqual(['charlie']);
  });

  it('설명 본문으로도 찾는다 — 사람은 이름이 아니라 하려는 일로 찾는다', () => {
    const groups = groupPlugins(ALL, { ...base, query: '권한' });
    expect(groups.flatMap((g) => g.items).map((x) => x.id)).toEqual(['bravo']);
  });

  it('대소문자와 앞뒤 공백을 무시한다', () => {
    const groups = groupPlugins(ALL, { ...base, query: '  ALPHA ' });
    expect(groups.flatMap((g) => g.items).map((x) => x.id)).toEqual(['alpha']);
  });

  it('켠 것만 보기와 찾기는 함께 걸린다', () => {
    const groups = groupPlugins(ALL, {
      ...base, onlyEnabled: true, enabled: new Set(['bravo', 'delta']), query: '본다',
    });
    expect(groups.flatMap((g) => g.items).map((x) => x.id)).toEqual(['bravo', 'delta']);
  });

  it('맞는 것이 없으면 빈 목록', () => {
    expect(groupPlugins(ALL, { ...base, query: '없는말' })).toEqual([]);
  });
});

describe('선택 유지', () => {
  it('걸러진 뒤에도 남아 있으면 선택을 유지한다', () => {
    const groups = groupPlugins(ALL, { ...base, query: 'a' });
    expect(resolveSelection(groups, 'delta')).toBe('delta');
  });

  it('선택이 걸러져 사라지면 첫 항목으로 옮긴다 — 빈 오른쪽 화면을 남기지 않는다', () => {
    const groups = groupPlugins(ALL, { ...base, query: 'bravo' });
    expect(resolveSelection(groups, 'delta')).toBe('bravo');
  });

  it('아무것도 없으면 빈 선택', () => {
    expect(resolveSelection([], 'delta')).toBe('');
  });
});

/**
 * §5.11 노출 게이트 — "켜면 실제로 프로젝트에 손대는 것"만 기본 목록에 선다.
 *
 * 111칸이 다 서 있으면 사용자는 "다 만들어졌다"로 읽는다. 실제로 프로젝트를 훑는 것은 한 장뿐이었고,
 * 나머지는 켜도 고정 문장만 실렸다. 그래서 기본 목록은 만들어진 것만 세우고 나머지는 §7.7 디버그
 * 모드에서만 보인다 — 다만 **켜 둔 것은 언제나 보인다**(안 보이면 끌 자리가 없어진다).
 */
const live = (id: string, name: string, category: PluginManifest['category']): PluginManifest =>
  ({ ...m(id, name, category), enforcesProject: true });

const MIXED = [
  live('ssot', 'Ssot', 'observability'),
  m('draft1', 'Draft One', 'observability'),
  m('draft2', 'Draft Two', 'security'),
];

const ids = (groups: ReturnType<typeof groupPlugins>): string[] =>
  groups.flatMap((g) => g.items.map((x) => x.id));

describe('노출 게이트', () => {
  const gateBase = { query: '', onlyEnabled: false, enabled: new Set<string>(), describe: () => '' };

  it('기본으로는 실제로 집행하는 것만 선다', () => {
    expect(ids(groupPlugins(MIXED, gateBase))).toEqual(['ssot']);
  });

  it('디버그 모드에서는 전부 선다 — 하나씩 만들려면 보여야 한다', () => {
    expect(ids(groupPlugins(MIXED, { ...gateBase, showDraft: true })).sort())
      .toEqual(['draft1', 'draft2', 'ssot']);
  });

  it('켜 둔 것은 아직 안 만들어졌어도 보인다 — 안 보이면 끌 자리가 없어진다', () => {
    const groups = groupPlugins(MIXED, { ...gateBase, enabled: new Set(['draft2']) });
    expect(ids(groups).sort()).toEqual(['draft2', 'ssot']);
  });

  it('게이트가 빈 분류를 남기지 않는다', () => {
    // draft2 하나뿐인 security 는 게이트에 걸려 사라지므로 머리글도 안 나온다.
    expect(groupPlugins(MIXED, gateBase).map((g) => g.category)).toEqual(['observability']);
  });

  it('찾기와 함께 걸린다 — 디버그가 꺼져 있으면 이름이 맞아도 안 나온다', () => {
    expect(ids(groupPlugins(MIXED, { ...gateBase, query: 'draft' }))).toEqual([]);
    expect(ids(groupPlugins(MIXED, { ...gateBase, query: 'draft', showDraft: true })).sort())
      .toEqual(['draft1', 'draft2']);
  });
});

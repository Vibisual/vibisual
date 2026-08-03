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

const base = { query: '', onlyEnabled: false, enabled: new Set<string>(), describe: describe_ };

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

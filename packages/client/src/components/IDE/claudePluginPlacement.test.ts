/**
 * §5.5 #17-33 ① — "이 플러그인이 지금 이 세션에 오는가" 판정 테스트.
 *
 * `claude plugin list --json` 은 **이 컴퓨터에 깔린 전부**를 준다 — 실측에서 7개 중 5개가 남의
 * 프로젝트에 매인 것이었다. 이 판정이 틀리면 화면이 두 방향 중 하나로 거짓말한다:
 * 남의 것을 이 프로젝트 것처럼 세우거나("왜 안 먹지"), 내 것을 남의 것으로 밀어낸다("깔았는데 왜 없지").
 */
import { describe, expect, it } from 'vitest';

import {
  classifyMarketplace,
  normalizePluginPath,
  placementAppliesHere,
  resolvePluginPlacement,
  splitPluginId,
  suggestedMarketplaces,
} from '@vibisual/shared';

// 경로는 실측 모양(드라이브 문자·역슬래시·대소문자 갈림)만 남긴 가공값이다.
const HERE = 'C:\\work\\projects\\vibisual';

describe('splitPluginId', () => {
  it('<이름>@<마켓플레이스> 를 가른다', () => {
    expect(splitPluginId('hookify@claude-plugins-official')).toEqual({
      name: 'hookify', marketplace: 'claude-plugins-official',
    });
  });

  it('마켓이 없으면 이름만 남는다', () => {
    expect(splitPluginId('local-thing')).toEqual({ name: 'local-thing', marketplace: '' });
  });

  it('이름 안의 @ 는 마지막 것만 구분자로 본다', () => {
    expect(splitPluginId('@scope/pkg@market')).toEqual({ name: '@scope/pkg', marketplace: 'market' });
  });
});

describe('normalizePluginPath', () => {
  it('구분자·대소문자·끝 구분자를 지운다', () => {
    // 실측: 같은 폴더가 `c:\…`(소문자 드라이브)와 `C:\…` 로 함께 들어 있었다.
    expect(normalizePluginPath('c:\\work\\Proj\\')).toBe(normalizePluginPath('C:/work/Proj'));
  });
});

describe('resolvePluginPlacement', () => {
  it('user 범위는 언제나 글로벌이다', () => {
    expect(resolvePluginPlacement('user', undefined, HERE)).toBe('global');
    // user 범위에 경로가 딸려 와도 글로벌이다(범위가 답이지 경로가 답이 아니다).
    expect(resolvePluginPlacement('user', 'D:\\somewhere', HERE)).toBe('global');
  });

  it('같은 프로젝트에 매인 것은 이 프로젝트다 — 표기가 갈려도', () => {
    expect(resolvePluginPlacement('project', HERE, HERE)).toBe('this-project');
    expect(resolvePluginPlacement('project', HERE.toLowerCase().replace(/\\/g, '/'), HERE)).toBe('this-project');
    expect(resolvePluginPlacement('local', `${HERE}\\`, HERE)).toBe('this-project');
  });

  it('다른 프로젝트에 매인 것은 이 세션에 오지 않는다', () => {
    expect(resolvePluginPlacement('project', 'C:\\work\\projects\\other-app', HERE))
      .toBe('other-project');
  });

  it('프로젝트 범위인데 경로가 없으면 이곳 것으로 본다', () => {
    // CLI 를 이 프로젝트에서 물었으므로 그 답은 이 폴더 기준이다.
    expect(resolvePluginPlacement('project', undefined, HERE)).toBe('this-project');
  });
});

describe('placementAppliesHere', () => {
  it('남의 프로젝트 것만 빼고 이 세션에 실린다 — 배지가 세는 대상', () => {
    expect(placementAppliesHere('global')).toBe(true);
    expect(placementAppliesHere('this-project')).toBe(true);
    expect(placementAppliesHere('other-project')).toBe(false);
  });
});

// §5.5 #17-42 — 마켓 갈래 판정과 추천 목록. 화면·서버가 같은 규칙을 써야 칩과 목록이 어긋나지 않는다.
describe('마켓 갈래(#17-42)', () => {
  it('Anthropic 이 운영하는 둘만 갈래를 갖고, 나머지는 보증 없음(custom)', () => {
    expect(classifyMarketplace('claude-plugins-official')).toBe('official');
    expect(classifyMarketplace('claude-community')).toBe('community');
    expect(classifyMarketplace('claude-code-harness-marketplace')).toBe('custom');
    expect(classifyMarketplace('')).toBe('custom');
  });

  it('추천은 아직 안 붙은 것만 — 같은 것을 두 번 붙일 자리를 주지 않는다', () => {
    // 공식만 붙어 있는 상태(= Claude Code 가 스스로 붙인 실측 기본값).
    const s = suggestedMarketplaces([{ name: 'claude-plugins-official' }]);
    expect(s.map((m) => m.name)).toEqual(['claude-community']);
    // 붙일 때 넘길 인자는 마켓 이름이 아니라 owner/repo 다(섞으면 추천이 영영 안 사라진다).
    expect(s[0]?.source).toBe('anthropics/claude-plugins-community');
  });

  it('둘 다 붙어 있으면 추천은 비고, 하나도 없으면 둘 다 뜬다', () => {
    expect(suggestedMarketplaces([
      { name: 'claude-plugins-official' }, { name: 'claude-community' },
    ])).toEqual([]);
    expect(suggestedMarketplaces([]).map((m) => m.name)).toEqual([
      'claude-plugins-official', 'claude-community',
    ]);
  });
});

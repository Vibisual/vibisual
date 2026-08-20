/**
 * §5.5 #17-33 ① — "이 플러그인이 지금 이 세션에 오는가" 판정 테스트.
 *
 * `claude plugin list --json` 은 **이 컴퓨터에 깔린 전부**를 준다 — 실측에서 7개 중 5개가 남의
 * 프로젝트에 매인 것이었다. 이 판정이 틀리면 화면이 두 방향 중 하나로 거짓말한다:
 * 남의 것을 이 프로젝트 것처럼 세우거나("왜 안 먹지"), 내 것을 남의 것으로 밀어낸다("깔았는데 왜 없지").
 */
import { describe, expect, it } from 'vitest';

import { normalizePluginPath, placementAppliesHere, resolvePluginPlacement, splitPluginId } from '@vibisual/shared';

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

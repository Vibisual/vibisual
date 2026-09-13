/**
 * §5.5 #17-33 ⑦ — 스킬 상태 태그 판정 테스트.
 *
 * 이 판정이 이 파일로 옮겨 온 이유가 곧 이 테스트가 지키는 것이다. 종전 화면은
 * `installed === false || enabled === false` 로 직접 갈랐고, 그 식은 **서로 다른 두 사정을 같은
 * `꺼짐` 한 칸에 담았다** — 사용자가 끈 것과 남의 프로젝트에 매인 것. 처방이 각각 `enable` 과
 * `install --scope user` 로 다른데 한 칸이라 뒤쪽에 `enable` 이 나갔고, user 범위엔 켤 설치본이
 * 없으니 **눌러도 아무 일도 일어나지 않았다.**
 *
 * 실측(2026-09-09) `installed_plugins.json` 이 정확히 그 상태였다 — 공식 플러그인 4개가
 * `scope: project` 로 다른 프로젝트에 매여 있었다. 그래서 이 갈래는 예외가 아니라 **기본값**이다.
 */
import { describe, expect, it } from 'vitest';

import {
  resolveSkillPluginState,
  skillFixAction,
  skillLoadsNow,
  type AvailableSkill,
} from '@vibisual/shared';

/** 플러그인 스킬 한 줄 — 재는 칸만 넘기고 나머지는 고정. */
function skill(over: Partial<AvailableSkill> = {}): AvailableSkill {
  return {
    name: 'brand-guidelines',
    description: '',
    source: 'plugin',
    pluginName: 'frontend-design',
    pluginId: 'frontend-design@claude-plugins-official',
    ...over,
  };
}

describe('resolveSkillPluginState — 다섯 상태(#17-33 ⑦)', () => {
  it('깔렸고 켜졌고 이 자리면 `ready`', () => {
    expect(resolveSkillPluginState(skill({ installed: true, enabled: true, placement: 'global' })))
      .toBe('ready');
  });

  it('이 프로젝트에 깔린 것도 `ready`', () => {
    expect(resolveSkillPluginState(skill({ installed: true, enabled: true, placement: 'this-project' })))
      .toBe('ready');
  });

  it('안 깔렸으면 `not-installed`', () => {
    expect(resolveSkillPluginState(skill({ installed: false, enabled: false })))
      .toBe('not-installed');
  });

  it('깔렸는데 꺼 두었으면 `disabled`', () => {
    expect(resolveSkillPluginState(skill({ installed: true, enabled: false, placement: 'global' })))
      .toBe('disabled');
  });

  it('남의 프로젝트에 매였으면 `other-project` — `disabled` 로 접히면 안 된다', () => {
    // 서버는 이 경우 `enabled` 를 이미 false 로 접어 보낸다(placementAppliesHere).
    // 그 false 만 보고 갈랐던 것이 종전의 그 결함이다.
    expect(resolveSkillPluginState(skill({ installed: true, enabled: false, placement: 'other-project' })))
      .toBe('other-project');
  });

  it('남의 프로젝트 것은 CLI 가 켜졌다고 해도 `other-project`', () => {
    expect(resolveSkillPluginState(skill({ installed: true, enabled: true, placement: 'other-project' })))
      .toBe('other-project');
  });

  it('CLI 에 못 물었으면 `unknown` — 두 칸이 통째로 비어 온다', () => {
    expect(resolveSkillPluginState(skill())).toBe('unknown');
  });

  it('한 칸만 비어도 `unknown` — 반쪽 정보로 태그를 달지 않는다', () => {
    expect(resolveSkillPluginState(skill({ installed: true }))).toBe('unknown');
    expect(resolveSkillPluginState(skill({ enabled: true }))).toBe('unknown');
  });

  it('프로젝트·글로벌 스킬은 이 축이 없어 `unknown`(= 태그 없음)', () => {
    expect(resolveSkillPluginState({ source: 'project', installed: true, enabled: true })).toBe('unknown');
    expect(resolveSkillPluginState({ source: 'global', installed: true, enabled: true })).toBe('unknown');
  });

  it('`placement` 가 없으면 `disabled` 로 본다 — 남의 자리라는 증거가 없다', () => {
    // 안 시킨 설치를 권하는 쪽이 더 나쁘다. 증거가 없으면 여기 것으로 본다.
    expect(resolveSkillPluginState(skill({ installed: true, enabled: false })))
      .toBe('disabled');
  });

  it('안 깔린 것이 먼저다 — `placement` 가 남의 자리로 적혀 있어도 `not-installed`', () => {
    expect(resolveSkillPluginState(skill({ installed: false, enabled: false, placement: 'other-project' })))
      .toBe('not-installed');
  });
});

describe('skillFixAction — 상태마다 다른 처방(#17-33 ⑦)', () => {
  it('안 깔린 것은 `install`', () => {
    expect(skillFixAction('not-installed')).toBe('install');
  });

  it('꺼 둔 것은 `enable`', () => {
    expect(skillFixAction('disabled')).toBe('enable');
  });

  it('**남의 프로젝트 것은 `install`** — user 범위엔 켤 설치본이 아예 없다', () => {
    // 이 한 줄이 이번에 고친 결함이다. 종전엔 여기로 `enable` 이 나갔다.
    expect(skillFixAction('other-project')).toBe('install');
    expect(skillFixAction('other-project')).not.toBe('enable');
  });

  it('실리고 있는 것은 고칠 것이 없다', () => {
    expect(skillFixAction('ready')).toBeNull();
  });

  it('모르는 것도 고칠 것이 없다 — 멀쩡한 스킬에 설치를 권하지 않는다', () => {
    expect(skillFixAction('unknown')).toBeNull();
  });
});

describe('skillLoadsNow — 지금 고르면 슬래시가 풀리는가', () => {
  it('`ready` 는 풀린다', () => {
    expect(skillLoadsNow('ready')).toBe(true);
  });

  it('`unknown` 도 풀리는 쪽으로 본다 — 못 물었다고 멀쩡한 스킬을 못 쓴다고 하지 않는다', () => {
    expect(skillLoadsNow('unknown')).toBe(true);
  });

  it('나머지 셋은 안 풀린다', () => {
    expect(skillLoadsNow('not-installed')).toBe(false);
    expect(skillLoadsNow('disabled')).toBe(false);
    expect(skillLoadsNow('other-project')).toBe(false);
  });
});

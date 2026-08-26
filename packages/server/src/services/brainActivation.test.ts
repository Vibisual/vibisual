/**
 * §5.10 v2 (H) — 활성화 게이트 회귀.
 *
 * 이 개편의 안전 속성은 **"껐을 때 토큰 0"** 이고, 그것은 게이트 네 겹이 전부
 * 같은 판정 함수를 통과할 때만 성립한다. 그래서 판정 자체를 여기서 못 박는다.
 * (게이트가 붙는 자리는 각각 index.ts·projectGraph.ts 지만, 판정이 새면 네 곳이 함께 샌다.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_BRAIN_AXES,
  isBrainAxisEnabled,
  isBrainEnabled,
  resolveBrainActivation,
  resolveBrainProjectKey,
  shouldPromptBrainActivation,
  type BrainActivation,
} from '@vibisual/shared';

const ROOT = 'C:/proj/demo';
/** Windows 표기의 같은 경로. 정규화가 실제로 도는지 보려면 구분자가 달라야 한다. */
const WIN_ROOT = ['C:', 'proj', 'demo'].join(String.fromCharCode(92));

describe('§5.10 v2 (H) — 기본 off', () => {
  it('키가 아예 없으면 꺼짐이다 (기본 off 는 여기서 성립한다)', () => {
    expect(isBrainEnabled(undefined, ROOT)).toBe(false);
    expect(isBrainEnabled({}, ROOT)).toBe(false);
    expect(isBrainEnabled(null, ROOT)).toBe(false);
  });

  it('다른 프로젝트만 켜져 있어도 이 프로젝트는 꺼짐이다', () => {
    const by = { 'C:/proj/other': { enabled: true } };
    expect(isBrainEnabled(by, ROOT)).toBe(false);
  });

  it('enabled: false 로 명시된 칸도 꺼짐이다', () => {
    expect(isBrainEnabled({ [ROOT]: { enabled: false } }, ROOT)).toBe(false);
  });

  it('projectPath 가 없으면 꺼짐이다 (프로젝트를 못 고른 상태에서 새지 않는다)', () => {
    expect(isBrainEnabled({ [ROOT]: { enabled: true } }, null)).toBe(false);
    expect(isBrainEnabled({ [ROOT]: { enabled: true } }, undefined)).toBe(false);
  });

  it('enabled: true 면 켜짐이다', () => {
    expect(isBrainEnabled({ [ROOT]: { enabled: true } }, ROOT)).toBe(true);
  });
});

describe('§5.10 v2 (H) — 경로 키 정규화', () => {
  it('역슬래시·대소문자·끝 슬래시가 달라도 같은 프로젝트로 본다', () => {
    const by = { [WIN_ROOT]: { enabled: true } };
    expect(isBrainEnabled(by, 'c:/proj/demo')).toBe(true);
    expect(isBrainEnabled(by, 'C:/PROJ/DEMO/')).toBe(true);
  });

  it('저장 키는 이미 있는 칸 이름을 재사용한다 (부분 저장이 새 칸을 만들지 않는다)', () => {
    const by: Record<string, BrainActivation> = { [WIN_ROOT]: { enabled: true } };
    expect(resolveBrainProjectKey(by, 'c:/proj/demo/')).toBe(WIN_ROOT);
  });

  it('없는 프로젝트면 준 경로를 그대로 키로 쓴다', () => {
    expect(resolveBrainProjectKey({}, ROOT)).toBe(ROOT);
  });

  it('레코드 자체를 정규화된 경로로 찾아 준다', () => {
    const act = { enabled: true, enabledAt: 42 };
    expect(resolveBrainActivation({ [WIN_ROOT + String.fromCharCode(92)]: act }, 'c:/proj/demo')).toEqual(act);
  });
});

describe('§5.10 v2 (H) — 축 판정', () => {
  it('마스터가 꺼져 있으면 축을 켜 놔도 false 다 (축이 마스터를 우회하지 못한다)', () => {
    const by = { [ROOT]: { enabled: false, axes: { skills: true, recall: true } } };
    expect(isBrainAxisEnabled(by, ROOT, 'skills')).toBe(false);
    expect(isBrainAxisEnabled(by, ROOT, 'recall')).toBe(false);
  });

  it('축을 지정하지 않으면 권장 조합을 따른다', () => {
    const by = { [ROOT]: { enabled: true } };
    expect(isBrainAxisEnabled(by, ROOT, 'skills')).toBe(DEFAULT_BRAIN_AXES.skills);
    expect(isBrainAxisEnabled(by, ROOT, 'nudge')).toBe(DEFAULT_BRAIN_AXES.nudge);
  });

  it('넛지는 권장 조합에서 꺼져 있다 (켠 직후 체감되는 유일한 축이라 사용자가 직접 켠다)', () => {
    expect(DEFAULT_BRAIN_AXES.nudge).toBe(false);
  });

  it('축 재정의가 권장 조합을 이긴다 — 양방향 모두', () => {
    expect(isBrainAxisEnabled({ [ROOT]: { enabled: true, axes: { nudge: true } } }, ROOT, 'nudge')).toBe(true);
    expect(isBrainAxisEnabled({ [ROOT]: { enabled: true, axes: { skills: false } } }, ROOT, 'skills')).toBe(false);
  });
});

describe('§5.10 v2 (H) — 첫 실행 1회 안내', () => {
  it('잠든 카드가 없으면 묻지 않는다', () => {
    expect(shouldPromptBrainActivation({}, ROOT, 0)).toBe(false);
  });

  it('잠든 카드가 있고 아직 물은 적 없으면 묻는다', () => {
    expect(shouldPromptBrainActivation({}, ROOT, 327)).toBe(true);
  });

  it('이미 물었으면 다시 묻지 않는다 — 거절해도 promptedAt 이 남기 때문', () => {
    const by = { [ROOT]: { enabled: false, promptedAt: 1 } };
    expect(shouldPromptBrainActivation(by, ROOT, 327)).toBe(false);
  });

  it('이미 켜져 있으면 묻지 않는다', () => {
    expect(shouldPromptBrainActivation({ [ROOT]: { enabled: true } }, ROOT, 327)).toBe(false);
  });

  it('어느 프로젝트인지 모르면 묻지 않는다 — 거절 기록을 찾을 키가 없기 때문', () => {
    const by = { [ROOT]: { enabled: false, promptedAt: 1 } };
    expect(shouldPromptBrainActivation(by, null, 327)).toBe(false);
    expect(shouldPromptBrainActivation(by, undefined, 327)).toBe(false);
    expect(shouldPromptBrainActivation(by, '', 327)).toBe(false);
  });

  it('거절 기록은 저장 키(절대경로)로만 읽힌다 — 표시명으로 조회하면 매번 다시 묻는다', () => {
    // 실사용 회귀: 클라가 `activeProject`(표시명 "demo")로 조회해 `promptedAt` 을 못 찾고,
    // 거절한 배너가 열 때마다 다시 떴다. 판정 키는 반드시 프로젝트 루트 경로여야 한다.
    const by = { [ROOT]: { enabled: false, promptedAt: 1 } };
    expect(shouldPromptBrainActivation(by, 'demo', 327)).toBe(true);
    expect(shouldPromptBrainActivation(by, ROOT, 327)).toBe(false);
    expect(shouldPromptBrainActivation(by, WIN_ROOT, 327)).toBe(false);
  });
});

describe('§5.10 v2 (H) — 서버 관문 래퍼', () => {
  beforeEach(() => { vi.resetModules(); });

  it('userDefaults 를 읽어 같은 판정을 낸다 (판정이 두 벌이 되지 않는다)', async () => {
    vi.doMock('./userDefaultsService.js', () => ({
      userDefaultsService: { get: () => ({ brainByProject: { [ROOT]: { enabled: true, axes: { nudge: true } } } }) },
    }));
    const mod = await import('./brainActivation.js');
    expect(mod.brainEnabledFor(ROOT)).toBe(true);
    expect(mod.brainAxisEnabledFor(ROOT, 'nudge')).toBe(true);
    expect(mod.brainEnabledFor('C:/proj/other')).toBe(false);
    expect(mod.brainActivationFor(ROOT)?.enabled).toBe(true);
  });

  it('설정이 비어 있으면 전부 꺼짐이다 (설치 직후 = 토큰 0)', async () => {
    vi.doMock('./userDefaultsService.js', () => ({
      userDefaultsService: { get: () => ({}) },
    }));
    const mod = await import('./brainActivation.js');
    expect(mod.brainEnabledFor(ROOT)).toBe(false);
    expect(mod.brainAxisEnabledFor(ROOT, 'skills')).toBe(false);
    expect(mod.brainActivationFor(ROOT)).toBeUndefined();
  });
});

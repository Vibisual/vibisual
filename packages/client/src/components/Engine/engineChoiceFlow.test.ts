/**
 * §5.25 (C) — 첫 진입 엔진 선택 관문 판정 고정 시험.
 *
 * 이 판정이 틀리는 방향은 둘 다 나쁘다:
 *  - 너무 자주 뜨면 **이미 쓰고 있던 사람**에게 난데없이 엔진을 고르라는 창이 뜬다.
 *  - 너무 안 뜨면 갓 깐 사람이 아무 안내 없이 빈 캔버스와 마주한다.
 * 그래서 발화 조건을 렌더 없이 검사할 수 있게 떼어 두고, 여기서 못박는다.
 */
import { describe, it, expect } from 'vitest';
import type { EngineChoice, UserDefaults } from '@vibisual/shared';
import {
  engineForGating,
  isEngineChooserOpen,
  handoffForEngine,
  claudeGatesMayAutoOpen,
  codexGatesMayAutoOpen,
} from './engineChoiceFlow.js';

const EMPTY = { projects: {}, stubProjects: {} };
const HAS_FOLDER = { projects: { '/work/proj': {} }, stubProjects: {} };
const FRESH: UserDefaults = { updatedAt: 1 };
const CHOSE = (kind: EngineChoice['kind']): UserDefaults => ({ engineChoice: { kind, chosenAt: 1 }, updatedAt: 1 });

describe('engineForGating — 기록이 없으면 클로드다', () => {
  it('고른 적이 없으면 클로드로 읽는다', () => {
    // 이 앱은 클로드 전용으로 시작했다. 여기서 "미정"으로 읽으면 기존 사용자의 설치·로그인
    //   게이트가 전부 침묵해, CLI 가 없어도 아무 안내가 뜨지 않는다.
    expect(engineForGating(undefined)).toBe('claude');
  });

  it('고른 기록이 있으면 그 엔진이다', () => {
    expect(engineForGating({ kind: 'codex', chosenAt: 1 })).toBe('codex');
    expect(engineForGating({ kind: 'local', chosenAt: 1 })).toBe('local');
  });
});

describe('isEngineChooserOpen — 첫 진입 한 번만', () => {
  it('설정이 아직 안 왔으면 뜨지 않는다', () => {
    // 모르는 상태로 물으면 이미 고른 사람에게도 한 번씩 뜬다.
    expect(isEngineChooserOpen({ userDefaults: null, presence: EMPTY, forced: false, dismissed: false })).toBe(false);
  });

  it('갓 깐 기계(설정 비어 있고 폴더도 없음)에서는 뜬다', () => {
    expect(isEngineChooserOpen({ userDefaults: FRESH, presence: EMPTY, forced: false, dismissed: false })).toBe(true);
  });

  it('이미 고른 기록이 있으면 뜨지 않는다', () => {
    for (const kind of ['claude', 'codex', 'local'] as const) {
      expect(isEngineChooserOpen({ userDefaults: CHOSE(kind), presence: EMPTY, forced: false, dismissed: false })).toBe(
        false,
      );
    }
  });

  it('쓰고 있던 사람(폴더가 이미 있음)에게는 뜨지 않는다', () => {
    // 기록이 없어도 폴더가 있으면 첫 진입이 아니다. 그 사람들에게 이 관문은 옵션창 안에 있다.
    expect(isEngineChooserOpen({ userDefaults: FRESH, presence: HAS_FOLDER, forced: false, dismissed: false })).toBe(
      false,
    );
  });

  it('유휴로 내려간 프로젝트(stub)도 "있는 것"으로 센다', () => {
    const presence = { projects: {}, stubProjects: { '/work/proj': {} } };
    expect(isEngineChooserOpen({ userDefaults: FRESH, presence, forced: false, dismissed: false })).toBe(false);
  });

  it('닫으면 자동으로는 다시 뜨지 않는다', () => {
    expect(isEngineChooserOpen({ userDefaults: FRESH, presence: EMPTY, forced: false, dismissed: true })).toBe(false);
  });

  it('직접 열면(옵션창) 위 조건을 전부 건너뛴다', () => {
    expect(isEngineChooserOpen({ userDefaults: null, presence: HAS_FOLDER, forced: true, dismissed: true })).toBe(true);
    expect(isEngineChooserOpen({ userDefaults: CHOSE('codex'), presence: HAS_FOLDER, forced: true, dismissed: true })).toBe(
      true,
    );
  });
});

describe('handoffForEngine — 고른 다음 칸', () => {
  it('클로드·코덱스는 각자의 설치 게이트로 간다', () => {
    expect(handoffForEngine('claude')).toBe('claude-setup');
    expect(handoffForEngine('codex')).toBe('codex-setup');
  });

  it('로컬은 마지막 칸(폴더)으로 바로 간다', () => {
    // All Model 창은 **버블에 매여** 있는데 첫 진입에는 버블이 없다. 없는 창을 여는 척하지 않는다.
    expect(handoffForEngine('local')).toBe('project-folder');
  });
});

describe('자동 발화 권한 — 고르지 않은 엔진의 창이 사용자를 막지 않는다', () => {
  it('클로드 게이트는 클로드를 고른 사람에게만 저절로 뜬다', () => {
    expect(claudeGatesMayAutoOpen({ kind: 'claude', chosenAt: 1 })).toBe(true);
    expect(claudeGatesMayAutoOpen({ kind: 'codex', chosenAt: 1 })).toBe(false);
    expect(claudeGatesMayAutoOpen({ kind: 'local', chosenAt: 1 })).toBe(false);
  });

  it('기록이 없는 기존 사용자에게는 클로드 게이트가 그대로 뜬다', () => {
    // 무변경의 근거 — 코덱스를 넣었다고 쓰던 사람의 온보딩이 조용해지면 안 된다.
    expect(claudeGatesMayAutoOpen(undefined)).toBe(true);
  });

  it('코덱스 게이트는 코덱스를 고른 사람에게만 뜬다(기록 없음은 코덱스가 아니다)', () => {
    expect(codexGatesMayAutoOpen({ kind: 'codex', chosenAt: 1 })).toBe(true);
    expect(codexGatesMayAutoOpen(undefined)).toBe(false);
    expect(codexGatesMayAutoOpen({ kind: 'claude', chosenAt: 1 })).toBe(false);
    expect(codexGatesMayAutoOpen({ kind: 'local', chosenAt: 1 })).toBe(false);
  });
});

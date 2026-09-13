/**
 * §5.25 (D)(E) — 코덱스 게이트 발화 판정 고정 시험.
 *
 * 클로드 게이트와 **다른 축이 하나** 있고, 그것이 이 파일의 요점이다: 코덱스 창은 코덱스를 고른
 * 적 있는 사람에게만 저절로 뜬다. 이 규칙이 무너지면 코덱스를 모르는 사용자 화면에 설치 창이
 * 하나 더 생긴다.
 */
import { describe, it, expect } from 'vitest';
import type { CodexAuthStatus, CodexSetupState, EngineChoice } from '@vibisual/shared';
import {
  isCodexSetupPending,
  isCodexSetupGateOpen,
  shouldSummonCodexLogin,
  isCodexLoginGateOpen,
} from './codexGateFlow.js';

const setup = (phase: CodexSetupState['phase']): CodexSetupState => ({
  phase,
  canAutoInstall: true,
  installCommand: 'npm install -g @openai/codex',
  docsUrl: 'https://example.invalid',
  checkedAt: 1,
});
const CHOSE = (kind: EngineChoice['kind']): EngineChoice => ({ kind, chosenAt: 1 });
const IN: CodexAuthStatus = { loggedIn: true, checkedAt: 1 };
const OUT: CodexAuthStatus = { loggedIn: false, checkedAt: 1 };
const UNKNOWN: CodexAuthStatus = { loggedIn: false, error: 'cli-missing', checkedAt: 1 };

describe('isCodexSetupPending', () => {
  it('손이 필요한 단계만 참이다', () => {
    expect(isCodexSetupPending(setup('missing'))).toBe(true);
    expect(isCodexSetupPending(setup('failed'))).toBe(true);
    expect(isCodexSetupPending(setup('installing'))).toBe(true);
  });

  it('준비됐거나 판정 전이면 거짓이다', () => {
    expect(isCodexSetupPending(setup('ready'))).toBe(false);
    expect(isCodexSetupPending(null)).toBe(false);
  });
});

describe('isCodexSetupGateOpen', () => {
  const base = { setup: setup('missing'), justCompleted: false, forced: false, dismissed: false };

  it('코덱스를 고른 사람에게는 저절로 뜬다', () => {
    expect(isCodexSetupGateOpen({ ...base, engineChoice: CHOSE('codex') })).toBe(true);
  });

  it('고른 적 없는 사람에게는 뜨지 않는다 — 기록 없음은 코덱스가 아니다', () => {
    expect(isCodexSetupGateOpen({ ...base, engineChoice: undefined })).toBe(false);
    expect(isCodexSetupGateOpen({ ...base, engineChoice: CHOSE('claude') })).toBe(false);
    expect(isCodexSetupGateOpen({ ...base, engineChoice: CHOSE('local') })).toBe(false);
  });

  it('직접 열면 엔진 선택과 무관하게 열린다 — 지금부터 준비해 보려는 사람의 입구다', () => {
    expect(isCodexSetupGateOpen({ ...base, forced: true, engineChoice: CHOSE('claude') })).toBe(true);
    expect(isCodexSetupGateOpen({ ...base, forced: true, dismissed: true, engineChoice: undefined })).toBe(true);
  });

  it('닫아 두면 자동으로는 다시 뜨지 않는다(배너는 남는다)', () => {
    expect(isCodexSetupGateOpen({ ...base, dismissed: true, engineChoice: CHOSE('codex') })).toBe(false);
  });

  it('판정 전(null)에는 아무것도 하지 않는다', () => {
    expect(isCodexSetupGateOpen({ ...base, setup: null, engineChoice: CHOSE('codex') })).toBe(false);
    // 직접 열었더라도 그릴 내용이 없다.
    expect(isCodexSetupGateOpen({ ...base, setup: null, forced: true, engineChoice: CHOSE('codex') })).toBe(false);
  });

  it('준비가 끝나면 닫히되, 완료 표시 구간에는 열려 있다', () => {
    expect(isCodexSetupGateOpen({ ...base, setup: setup('ready'), engineChoice: CHOSE('codex') })).toBe(false);
    expect(isCodexSetupGateOpen({ ...base, setup: setup('ready'), justCompleted: true, engineChoice: CHOSE('codex') })).toBe(
      true,
    );
  });
});

describe('shouldSummonCodexLogin — 설치 → 로그인 인계', () => {
  it('로그인된 것이 확인된 경우만 부르지 않는다', () => {
    expect(shouldSummonCodexLogin(IN)).toBe(false);
  });

  it('로그아웃도 "모름"도 부른다 — 갓 깐 실행본에 자격증명이 있을 리 없다', () => {
    expect(shouldSummonCodexLogin(OUT)).toBe(true);
    expect(shouldSummonCodexLogin(UNKNOWN)).toBe(true);
    expect(shouldSummonCodexLogin(null)).toBe(true);
    expect(shouldSummonCodexLogin(undefined)).toBe(true);
  });
});

describe('isCodexLoginGateOpen', () => {
  const base = { forced: false, dismissed: false, engineChoice: CHOSE('codex') };

  it('로그아웃이면 뜬다', () => {
    expect(isCodexLoginGateOpen({ ...base, auth: OUT })).toBe(true);
  });

  it('"모름"으로는 뜨지 않는다 — 일하던 사용자를 모달로 막지 않는다', () => {
    expect(isCodexLoginGateOpen({ ...base, auth: UNKNOWN })).toBe(false);
  });

  it('로그인돼 있거나 판정 전이면 뜨지 않는다', () => {
    expect(isCodexLoginGateOpen({ ...base, auth: IN })).toBe(false);
    expect(isCodexLoginGateOpen({ ...base, auth: null })).toBe(false);
  });

  it('코덱스를 고르지 않은 사람에게는 저절로 뜨지 않는다', () => {
    expect(isCodexLoginGateOpen({ ...base, auth: OUT, engineChoice: undefined })).toBe(false);
    expect(isCodexLoginGateOpen({ ...base, auth: OUT, engineChoice: CHOSE('claude') })).toBe(false);
  });

  it('설치 게이트의 인계(forced)는 "모름"도 뚫고 연다', () => {
    // 갓 깐 실행본의 로그인 상태는 아직 `cli-missing` 으로 캐시돼 있다 — 그 자리에서만의 예외다.
    expect(isCodexLoginGateOpen({ ...base, auth: UNKNOWN, forced: true })).toBe(true);
    expect(isCodexLoginGateOpen({ ...base, auth: null, forced: true, engineChoice: undefined })).toBe(true);
  });

  it('닫아 두면 자동으로는 다시 뜨지 않는다', () => {
    expect(isCodexLoginGateOpen({ ...base, auth: OUT, dismissed: true })).toBe(false);
  });
});

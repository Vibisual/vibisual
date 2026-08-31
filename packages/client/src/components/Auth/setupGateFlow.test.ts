import { describe, it, expect } from 'vitest';
import type { ClaudeAuthStatus, ClaudeSetupPhase, ClaudeSetupState } from '@vibisual/shared';
import { isSetupPending, isSetupGateOpen, shouldSummonLogin } from './setupGateFlow.js';

// §4 (첫 실행 설치 온보딩) — 게이트 표시/인계 판정. 화면 없이 규칙만 고정한다.

function setup(phase: ClaudeSetupPhase): ClaudeSetupState {
  return {
    phase,
    canAutoInstall: true,
    installCommand: 'installer',
    docsUrl: 'https://code.claude.com/docs/en/setup',
    checkedAt: 0,
  };
}

function auth(patch: Partial<ClaudeAuthStatus> = {}): ClaudeAuthStatus {
  return { loggedIn: false, checkedAt: 0, ...patch };
}

describe('isSetupPending', () => {
  it('아직 손이 필요한 세 단계에서만 참', () => {
    expect(isSetupPending(setup('missing'))).toBe(true);
    expect(isSetupPending(setup('failed'))).toBe(true);
    expect(isSetupPending(setup('installing'))).toBe(true);
    expect(isSetupPending(setup('ready'))).toBe(false);
  });

  it('아직 판정 전(null)이면 아무것도 띄우지 않는다', () => {
    expect(isSetupPending(null)).toBe(false);
  });
});

describe('isSetupGateOpen', () => {
  const base = { justCompleted: false, forced: false, dismissed: false };

  it('판정 전에는 열리지 않는다 — 부팅 직후 깜빡임 방지', () => {
    expect(isSetupGateOpen({ ...base, setup: null })).toBe(false);
  });

  it('미설치면 저절로 열린다', () => {
    expect(isSetupGateOpen({ ...base, setup: setup('missing') })).toBe(true);
  });

  it('[나중에]로 닫으면 다시 열리지 않는다(권장형 — 배너만 남는다)', () => {
    expect(isSetupGateOpen({ ...base, setup: setup('missing'), dismissed: true })).toBe(false);
  });

  it('배너로 강제로 열면 닫아 뒀어도 열린다', () => {
    expect(isSetupGateOpen({ ...base, setup: setup('missing'), dismissed: true, forced: true })).toBe(true);
  });

  it('준비 완료면 평소엔 닫혀 있다', () => {
    expect(isSetupGateOpen({ ...base, setup: setup('ready') })).toBe(false);
  });

  /**
   * 회귀 고정 — 설치를 막 끝낸 사람에게 확인을 보여 주는 구간.
   * `justCompleted` 는 **화면 열림을 스스로 뒤집는 값**이라, 이 값을 만료 타이머의 deps 에
   * 섞으면 타이머가 자기 자신을 지워 게이트가 "Continuing…" 에서 영원히 멈춘다(실제 발생).
   * 판정을 여기 고정해 두고, 화면 쪽은 만료를 `justCompleted` 하나에만 매단다.
   */
  it('준비 완료 직후 확인 구간에는 열려 있다', () => {
    expect(isSetupGateOpen({ ...base, setup: setup('ready'), justCompleted: true })).toBe(true);
  });

  it('확인 구간이 끝나면 닫힌다 — 다음 단계로 넘어갈 수 있어야 한다', () => {
    expect(isSetupGateOpen({ ...base, setup: setup('ready'), justCompleted: false })).toBe(false);
  });
});

describe('shouldSummonLogin', () => {
  it('로그아웃 상태면 부른다', () => {
    expect(shouldSummonLogin(auth({ loggedIn: false }))).toBe(true);
  });

  it('판정 불가(cli-missing)여도 부른다 — 갓 설치한 실행본엔 자격증명이 없다', () => {
    expect(shouldSummonLogin(auth({ loggedIn: false, error: 'cli-missing' }))).toBe(true);
  });

  it('아직 판정이 안 왔어도 부른다 — 설치 직후 캐시는 설치 전 값이다', () => {
    expect(shouldSummonLogin(null)).toBe(true);
    expect(shouldSummonLogin(undefined)).toBe(true);
  });

  it('이미 로그인된 것이 확인되면 부르지 않는다 — CLI 만 다시 깐 사람', () => {
    expect(shouldSummonLogin(auth({ loggedIn: true }))).toBe(false);
  });
});

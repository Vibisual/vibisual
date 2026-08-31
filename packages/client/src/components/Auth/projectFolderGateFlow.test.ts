import { describe, expect, it } from 'vitest';
import type { ClaudeAuthStatus, ClaudeSetupState } from '@vibisual/shared';
import {
  hasProjectFolder,
  isProjectFolderBannerOpen,
  isProjectFolderGateOpen,
  shouldSummonProjectFolder,
} from './projectFolderGateFlow.js';

/**
 * §4 (첫 실행 온보딩) ③ — 폴더 게이트의 발화 규칙.
 *
 * 지키는 것은 셋이다: **순서**(설치·로그인 뒤에만 스스로 뜬다) · **권장형**(닫으면 배너로 잔류) ·
 * **목적 달성 시 소멸**(폴더가 생기면 어떤 경로로 열렸든 닫힌다).
 */

const setup = (phase: ClaudeSetupState['phase']): ClaudeSetupState => ({
  phase,
  canAutoInstall: true,
  installCommand: 'irm https://claude.ai/install.ps1 | iex',
  docsUrl: 'https://code.claude.com/docs/en/setup',
  checkedAt: 0,
});
const authed: ClaudeAuthStatus = { loggedIn: true, checkedAt: 0 };
const loggedOut: ClaudeAuthStatus = { loggedIn: false, checkedAt: 0 };

const base = { setup: setup('ready'), auth: authed, hasFolder: false, forced: false, dismissed: false };

describe('hasProjectFolder', () => {
  it('열린 프로젝트가 하나라도 있으면 참', () => {
    expect(hasProjectFolder({ projects: {}, stubProjects: {} })).toBe(false);
    expect(hasProjectFolder({ projects: { app: {} }, stubProjects: {} })).toBe(true);
  });

  it('유휴로 내려간(stub) 프로젝트도 있는 것으로 센다 — 탭은 그대로 남아 있다', () => {
    // 이걸 "없음"으로 세면 앱을 오래 켜 둔 사람에게 폴더 선택 모달이 난데없이 뜬다.
    expect(hasProjectFolder({ projects: {}, stubProjects: { app: {} } })).toBe(true);
  });
});

describe('isProjectFolderGateOpen', () => {
  it('설치·로그인이 끝나고 폴더가 없을 때 스스로 뜬다', () => {
    expect(isProjectFolderGateOpen(base)).toBe(true);
  });

  it('앞칸이 안 끝났으면 뜨지 않는다 — 창 두 개가 겹치면 안 된다', () => {
    expect(isProjectFolderGateOpen({ ...base, setup: setup('missing') })).toBe(false);
    expect(isProjectFolderGateOpen({ ...base, auth: loggedOut })).toBe(false);
    expect(isProjectFolderGateOpen({ ...base, setup: null })).toBe(false);
    expect(isProjectFolderGateOpen({ ...base, auth: null })).toBe(false);
  });

  it('폴더가 생기면 닫힌다 — 사용자가 직접 열어 둔 창이어도', () => {
    expect(isProjectFolderGateOpen({ ...base, hasFolder: true })).toBe(false);
    expect(isProjectFolderGateOpen({ ...base, hasFolder: true, forced: true })).toBe(false);
  });

  it('[나중에] 로 닫으면 자동으로는 다시 안 뜨고, 직접 열면 앞칸과 무관하게 뜬다', () => {
    expect(isProjectFolderGateOpen({ ...base, dismissed: true })).toBe(false);
    // 생성이 막혀 강제로 연 경우 — 로그인 판정이 아직 안 왔어도 이유를 보여 줘야 한다.
    expect(isProjectFolderGateOpen({ ...base, auth: null, forced: true, dismissed: true })).toBe(true);
  });
});

describe('isProjectFolderBannerOpen — 권장형의 나머지 절반', () => {
  it('닫아 둔 동안에만 뜬다', () => {
    expect(isProjectFolderBannerOpen({ ...base, dismissed: true })).toBe(true);
    expect(isProjectFolderBannerOpen(base)).toBe(false); // 모달이 떠 있으면 배너는 없다
    expect(isProjectFolderBannerOpen({ ...base, dismissed: true, forced: true })).toBe(false);
  });

  it('폴더가 생기거나 앞칸이 안 끝났으면 뜨지 않는다', () => {
    expect(isProjectFolderBannerOpen({ ...base, dismissed: true, hasFolder: true })).toBe(false);
    expect(isProjectFolderBannerOpen({ ...base, dismissed: true, setup: setup('missing') })).toBe(false);
  });
});

describe('shouldSummonProjectFolder — 로그인 창의 인계', () => {
  it('폴더 유무 하나로만 정한다', () => {
    // 앞칸 판정을 다시 묻지 않는다: 로그인 직후의 스냅샷은 한 박자 옛것일 수 있어
    // 순서 판정이 'pending' 으로 떨어지고, 그러면 인계가 끊긴다.
    expect(shouldSummonProjectFolder({ hasFolder: false })).toBe(true);
    expect(shouldSummonProjectFolder({ hasFolder: true })).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClaudeCliRunResult } from './claudeCliRun.js';

// 탐침 실행은 갈아끼운다 — 진짜 CLI 를 부르면 시험이 개발기의 로그인 상태에 딸려 간다.
let cliResult: ClaudeCliRunResult = { code: 0, out: '{"loggedIn":true}' };
vi.mock('./claudeCliRun.js', () => ({ runClaudeCli: () => Promise.resolve(cliResult) }));
const { parseAuthStatus, claudeAuthService } = await import('./claudeAuthService.js');

// §4 v4.82 — `claude auth status --json` 파싱. CLI 가 배너를 앞에 찍거나 형식을 바꿔도
// "모름"(null)과 "로그아웃"(loggedIn:false)을 헷갈리지 않는 것이 이 파서의 핵심이다.

const NOW = 1_700_000_000_000;

describe('parseAuthStatus', () => {
  it('실제 응답을 그대로 옮긴다', () => {
    const raw = JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      email: 'someone@example.com',
      orgId: 'org-1',
      orgName: "someone's Organization",
      subscriptionType: 'max',
    });
    expect(parseAuthStatus(raw, NOW)).toEqual({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      email: 'someone@example.com',
      orgId: 'org-1',
      orgName: "someone's Organization",
      subscriptionType: 'max',
      checkedAt: NOW,
    });
  });

  it('로그아웃 상태(loggedIn:false)는 정상 파싱이다 — null 이 아니다', () => {
    expect(parseAuthStatus('{"loggedIn":false}', NOW)).toEqual({ loggedIn: false, checkedAt: NOW });
  });

  it('배너·경고가 앞뒤에 붙어도 JSON 만 떼어 읽는다', () => {
    const raw = 'Warning: update available\n{"loggedIn":true,"email":"a@b.c"}\nbye';
    expect(parseAuthStatus(raw, NOW)?.email).toBe('a@b.c');
  });

  it('빈 문자열(옵션 필드)은 싣지 않는다', () => {
    const parsed = parseAuthStatus('{"loggedIn":true,"email":"","orgName":"Acme"}', NOW);
    expect(parsed).toEqual({ loggedIn: true, orgName: 'Acme', checkedAt: NOW });
  });

  it('JSON 이 아니거나 loggedIn 이 없으면 null(=모름)', () => {
    expect(parseAuthStatus('', NOW)).toBeNull();
    expect(parseAuthStatus('error: unknown command "auth"', NOW)).toBeNull();
    expect(parseAuthStatus('{"account":"x"}', NOW)).toBeNull();
    expect(parseAuthStatus('{"loggedIn":"yes"}', NOW)).toBeNull();
    expect(parseAuthStatus('{ not json }', NOW)).toBeNull();
  });
});

describe('탐침 실패는 마지막 정상 판정을 지우지 않는다', () => {
  beforeEach(async () => {
    cliResult = { code: 0, out: '{"loggedIn":true,"email":"a@b.c"}' };
    await claudeAuthService.refresh();
  });

  it('CLI 를 못 찾거나 응답이 없으면 모름이되 직전 판정을 싣는다', async () => {
    cliResult = { code: null, out: '', failure: 'spawn' };
    const missing = await claudeAuthService.refresh();
    expect(missing).toMatchObject({ loggedIn: false, error: 'cli-missing', staleLoggedIn: true });
    cliResult = { code: null, out: '', failure: 'timeout' };
    expect(await claudeAuthService.refresh()).toMatchObject({ error: 'timeout', staleLoggedIn: true });
    cliResult = { code: 1, out: 'unknown command' };
    expect(await claudeAuthService.refresh()).toMatchObject({ error: 'parse', staleLoggedIn: true });
  });

  it('로그아웃을 읽은 뒤의 실패는 로그인으로 되살리지 않는다', async () => {
    cliResult = { code: 0, out: '{"loggedIn":false}' };
    expect((await claudeAuthService.refresh()).staleLoggedIn).toBeUndefined();
    cliResult = { code: null, out: '', failure: 'timeout' };
    expect(await claudeAuthService.refresh()).toMatchObject({ loggedIn: false, staleLoggedIn: false });
  });

  it('판정이 돌아오면 모름 표시는 사라진다', async () => {
    cliResult = { code: null, out: '', failure: 'timeout' };
    await claudeAuthService.refresh();
    cliResult = { code: 0, out: '{"loggedIn":true}' };
    const back = await claudeAuthService.refresh();
    expect(back.error).toBeUndefined();
    expect(back.staleLoggedIn).toBeUndefined();
    expect(back.loggedIn).toBe(true);
  });
});

/**
 * §4 (Thinking on/off) — `alwaysThinkingEnabled` 는 끌 때만 생기고(켬은 무개입 — 사용자 settings 를 되켜지 않는다), 기억·Fast 와 한 파일에 들며
 * (`--settings` 를 두 번 주면 뒤엣것이 덮는다), 아무것도 안 골랐으면 파일이 없다. `os.homedir()` 은 임시 폴더로 돌린다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

let fakeHome: string;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => process.env.__VIBI_FAKE_HOME__ ?? actual.homedir() } };
});

const { prepareAgentSettings } = await import('./agentMemoryService.js');

beforeAll(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-thinking-'));
  process.env.__VIBI_FAKE_HOME__ = fakeHome;
});

afterAll(() => {
  delete process.env.__VIBI_FAKE_HOME__;
  try {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  } catch {
    /* 임시 폴더 정리 실패는 테스트 결과와 무관 */
  }
});

/** 생성된 설정 파일 본문을 읽어 파싱한다. */
const readSettings = (p: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;

describe('설정 파일 조립 — Thinking on/off', () => {
  it('끄면 `alwaysThinkingEnabled: false` 한 줄이 실린다', () => {
    const plan = prepareAgentSettings({ thinking: false, agentName: 'nothink' });
    expect(plan?.settingsPath).toBeTruthy();
    expect(readSettings(plan!.settingsPath!)).toEqual({ alwaysThinkingEnabled: false });
  });

  it('켜면(또는 안 고르면) 키 자체가 없다 — `true` 를 써 넣으면 사용자 settings 의 false 를 덮는다', () => {
    expect(prepareAgentSettings({ thinking: true, agentName: 'think' })).toBeNull();
    expect(prepareAgentSettings({ thinking: undefined, agentName: 'think' })).toBeNull();
    const plan = prepareAgentSettings({ memory: 'user', thinking: true, agentName: 'thinkmem' });
    expect(readSettings(plan!.settingsPath!)).not.toHaveProperty('alwaysThinkingEnabled');
  });

  it('기억·Fast·사고끔이 **한 파일**에 같이 담긴다 — `--settings` 는 한 장뿐이다', () => {
    const projectRoot = path.join(fakeHome, 'proj');
    const plan = prepareAgentSettings({
      memory: 'project',
      fastMode: true,
      thinking: false,
      agentName: 'all3',
      projectRoot,
    });
    expect(plan?.settingsPath).toBeTruthy();
    const body = readSettings(plan!.settingsPath!);
    expect(body.fastMode).toBe(true);
    expect(body.alwaysThinkingEnabled).toBe(false);
    expect(String(body.autoMemoryDirectory)).toContain('all3');
  });

  it("기억 `'off'` 는 env 로 가고, 그 와중에도 사고끔은 파일로 나간다 — 직교 축이다", () => {
    const plan = prepareAgentSettings({ memory: 'off', thinking: false, agentName: 'offmem' });
    expect(plan?.env).toEqual({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
    expect(readSettings(plan!.settingsPath!)).toEqual({ alwaysThinkingEnabled: false });
  });

  it('같은 조합은 같은 파일을 다시 쓰지 않는다 — 내용 해시 파일명이라 경로가 같다', () => {
    const a = prepareAgentSettings({ thinking: false, agentName: 'same' });
    const b = prepareAgentSettings({ thinking: false, agentName: 'other' });
    expect(a?.settingsPath).toBe(b?.settingsPath);
  });
});

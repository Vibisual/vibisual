/**
 * §4 (Fast 모드) — **설정 파일 한 장**이 지켜져야 하는 자리.
 *
 * Fast 모드는 CLI 플래그가 없다. 헤드리스 스폰은 CLI 가 Agent SDK 세션으로 분류해
 * `fast_mode_disabled_reason: 'sdk_opt_in_required'` 로 막아 버리고, 유일한 해제 창구가
 * `--settings` 가 만드는 `flagSettings` 층이다. 그런데 **`--settings` 는 두 번 주면 병합이 아니라
 * 뒤엣것이 앞엣것을 통째로 덮는다**(설치본 실측) — 그래서 자기 기억(`autoMemoryDirectory`)과
 * Fast 를 각각 한 장씩 내보내면 **먼저 붙은 쪽이 조용히 죽는다**. 화면·타입·저장은 전부 멀쩡한 채
 * 기능만 사라지는 종류의 사고라 어느 검사에도 안 걸린다.
 *
 * 그래서 여기서는 "값이 저장되는가"가 아니라 **"파일 한 장에 두 키가 같이 들어가는가"** 를 못 박는다.
 *
 * `os.homedir()` 을 임시 폴더로 돌려 사용자 홈(`~/.vibisual`)을 건드리지 않는다.
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
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-fastmode-'));
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

describe('설정 파일 조립 — Fast 모드', () => {
  it('Fast 만 켜도 파일이 생긴다 — 기억 설정이 없다고 Fast 가 같이 죽으면 안 된다', () => {
    const plan = prepareAgentSettings({ fastMode: true, agentName: 'solo' });
    expect(plan?.settingsPath).toBeTruthy();
    expect(readSettings(plan!.settingsPath!)).toEqual({ fastMode: true });
  });

  it('기억 + Fast 는 **한 파일**에 같이 담긴다 — `--settings` 는 두 번 주면 앞엣것이 죽는다', () => {
    const projectRoot = path.join(fakeHome, 'proj');
    const plan = prepareAgentSettings({
      memory: 'project',
      fastMode: true,
      agentName: 'both',
      projectRoot,
    });
    expect(plan?.settingsPath).toBeTruthy();
    const body = readSettings(plan!.settingsPath!);
    expect(body.fastMode).toBe(true);
    expect(typeof body.autoMemoryDirectory).toBe('string');
    expect(String(body.autoMemoryDirectory)).toContain('both');
  });

  it('Fast 를 끄면 키 자체가 없다 — `false` 를 써 넣으면 사용자 설정의 true 를 덮는다', () => {
    const plan = prepareAgentSettings({ memory: 'user', fastMode: false, agentName: 'nofast' });
    expect(plan?.settingsPath).toBeTruthy();
    expect(readSettings(plan!.settingsPath!)).not.toHaveProperty('fastMode');
  });

  it('둘 다 없으면 아무것도 만들지 않는다 — 종전과 같은 인자로 뜬다', () => {
    expect(prepareAgentSettings({ agentName: 'plain' })).toBeNull();
  });

  it("기억 `'off'` 는 env 로 가고, 그 와중에도 Fast 는 파일로 나간다 — 둘은 직교 축이다", () => {
    const plan = prepareAgentSettings({ memory: 'off', fastMode: true, agentName: 'offmem' });
    expect(plan?.env).toEqual({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
    expect(plan?.settingsPath).toBeTruthy();
    expect(readSettings(plan!.settingsPath!)).toEqual({ fastMode: true });
  });

  it("프로젝트 범위인데 루트를 모르면 기억만 건너뛴다 — Fast 는 그대로 실린다", () => {
    const plan = prepareAgentSettings({ memory: 'project', fastMode: true, agentName: 'norootagent' });
    expect(plan?.settingsPath).toBeTruthy();
    expect(readSettings(plan!.settingsPath!)).toEqual({ fastMode: true });
  });
});

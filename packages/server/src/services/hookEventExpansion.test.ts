/**
 * §3.6 / §3.6-1 / §4 — 훅 이벤트 확장에 딸린 서비스 테스트.
 *
 * 회귀 방지 대상 셋:
 *  1) 인스톨러가 CLI 이벤트 전수(33종)를 실제로 등록하는가(등록 안 되면 이벤트가 아예 안 온다).
 *     **등록 목록이 곧 기능 목록이다** — 빠뜨린 이벤트는 화면에서 "그 일이 일어나지 않은 것"이 된다.
 *  2) `InstructionsLoaded` 계측이 판본마다 다른 필드 이름을 견디는가.
 *  3) `subagentStatusLine` 수집이 쓰레기 행을 걸러내고 마지막 틱만 남기는가.
 */import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  recordInstructionsLoaded,
  getInstructionsLoaded,
  summarizeInstructionsLoaded,
  resetInstructionsLoaded,
  INSTRUCTIONS_LOADED_MAX,
} from './instructionsLoadedService.js';
import {
  recordSubagentStatusLine,
  getSubagentStatusLine,
  listSubagentStatusLines,
  resetSubagentStatusLine,
} from './subagentStatusLineService.js';

let fakeHome: string;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => process.env.__VIBI_FAKE_HOME__ ?? actual.homedir() } };
});

const { ensureClaudeHooksInstalled, HOOK_EVENTS } = await import('./hookInstaller.js');

// ─────────────────────────────────────────────────────────────
describe('§3.6 — 훅 이벤트 등록 전수', () => {
  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-hookexp-'));
    process.env.__VIBI_FAKE_HOME__ = fakeHome;
  });
  afterEach(() => {
    delete process.env.__VIBI_FAKE_HOME__;
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  function installed(): Record<string, unknown[]> {
    ensureClaudeHooksInstalled(51360, 'C:/app/out/hooks/handler.mjs', 'tok');
    const settings = JSON.parse(
      fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf-8'),
    ) as { hooks: Record<string, unknown[]> };
    return settings.hooks;
  }

  it('v4.89 신규 7종이 그대로 남아 있다', () => {
    const hooks = installed();
    for (const ev of [
      'StopFailure', 'PostToolUseFailure', 'SubagentStart',
      'PermissionRequest', 'PermissionDenied', 'PostCompact', 'InstructionsLoaded',
    ]) {
      expect(hooks[ev], `${ev} 미등록`).toHaveLength(1);
    }
  });

  it('CLI 2.1.251 추종으로 늘린 18종도 모두 등록된다', () => {
    const hooks = installed();
    for (const ev of [
      'SessionEnd', 'Setup', 'UserPromptExpansion', 'PostToolBatch', 'MessageDisplay',
      'TeammateIdle', 'TaskCreated', 'TaskCompleted', 'PreModelSwitch', 'PostModelSwitch',
      'Elicitation', 'ElicitationResult', 'ConfigChange', 'WorktreeCreate', 'WorktreeRemove',
      'CwdChanged', 'DirectoryAdded', 'FileChanged',
    ]) {
      expect(hooks[ev], `${ev} 미등록`).toHaveLength(1);
    }
  });

  it('설치되는 이벤트 수 = HOOK_EVENTS 길이(33종). 남거나 모자라면 실패', () => {
    const hooks = installed();
    expect(HOOK_EVENTS).toHaveLength(33);
    expect(Object.keys(hooks).sort()).toEqual([...HOOK_EVENTS].sort());
  });
});
// ─────────────────────────────────────────────────────────────
describe('§3.6-1 InstructionsLoaded 계측', () => {
  beforeEach(() => resetInstructionsLoaded());

  it('판본마다 다른 필드 이름에서 경로를 뽑는다', () => {
    expect(recordInstructionsLoaded('s1', { paths: ['/a/CLAUDE.md'] })).toBe(true);
    expect(recordInstructionsLoaded('s1', { file_path: '/a/.claude/rules/x.md' })).toBe(true);
    expect(recordInstructionsLoaded('s1', { instructions: [{ path: '/a/rules/y.md' }] })).toBe(true);

    const paths = getInstructionsLoaded('s1').flatMap((e) => e.paths);
    expect(paths).toEqual(['/a/CLAUDE.md', '/a/.claude/rules/x.md', '/a/rules/y.md']);
  });

  it('경로가 하나도 없으면 저장하지 않는다', () => {
    expect(recordInstructionsLoaded('s1', { reason: 'startup' })).toBe(false);
    expect(getInstructionsLoaded('s1')).toHaveLength(0);
  });

  it('세션 없이(빈 sessionId) 들어온 것은 버린다', () => {
    expect(recordInstructionsLoaded('', { paths: ['/a.md'] })).toBe(false);
  });

  it('같은 세션 기록이 상한을 넘으면 오래된 것부터 밀린다', () => {
    for (let i = 0; i < INSTRUCTIONS_LOADED_MAX + 10; i += 1) {
      recordInstructionsLoaded('s1', { paths: [`/f${i}.md`] });
    }
    const entries = getInstructionsLoaded('s1');
    expect(entries).toHaveLength(INSTRUCTIONS_LOADED_MAX);
    expect(entries[0]?.paths[0]).toBe('/f10.md');
  });

  it('요약은 세션별 경로 합집합을 준다', () => {
    recordInstructionsLoaded('s1', { paths: ['/a.md', '/b.md'] });
    recordInstructionsLoaded('s1', { paths: ['/a.md'] });
    recordInstructionsLoaded('s2', { paths: ['/c.md'] });

    const sum = summarizeInstructionsLoaded();
    expect(sum.totalSessions).toBe(2);
    const s1 = sum.sessions.find((s) => s.sessionId === 's1');
    expect(s1?.count).toBe(2);
    expect(s1?.paths.sort()).toEqual(['/a.md', '/b.md']);
  });

  it('reason 은 있을 때만 실린다', () => {
    recordInstructionsLoaded('s1', { paths: ['/a.md'], reason: 'path-match' });
    recordInstructionsLoaded('s1', { paths: ['/b.md'] });
    expect(getInstructionsLoaded('s1')[0]?.reason).toBe('path-match');
    expect(getInstructionsLoaded('s1')[1]?.reason).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
describe('§4 subagentStatusLine 수집', () => {
  beforeEach(() => resetSubagentStatusLine());

  it('토큰·모델·사고 깊이를 그대로 보관한다', () => {
    const ok = recordSubagentStatusLine('s1', [
      { id: 't1', name: 'Explore', status: 'running', model: 'claude-haiku-4-5', effort: 'high', tokenCount: 1234, contextWindowSize: 200000 },
    ], 'C:/repo');

    expect(ok).toBe(true);
    const snap = getSubagentStatusLine('s1');
    expect(snap?.cwd).toBe('C:/repo');
    expect(snap?.tasks[0]).toMatchObject({ id: 't1', tokenCount: 1234, effort: 'high', model: 'claude-haiku-4-5' });
  });

  it('id 없는 행은 버리고, 쓸 행이 하나도 없으면 저장하지 않는다', () => {
    expect(recordSubagentStatusLine('s1', [{ name: 'no id' }, 'garbage', null])).toBe(false);
    expect(getSubagentStatusLine('s1')).toBeNull();
  });

  it('마지막 틱만 남는다(이력을 쌓지 않는다)', () => {
    recordSubagentStatusLine('s1', [{ id: 't1', tokenCount: 10 }]);
    recordSubagentStatusLine('s1', [{ id: 't1', tokenCount: 99 }, { id: 't2' }]);

    const snap = getSubagentStatusLine('s1');
    expect(snap?.tasks).toHaveLength(2);
    expect(snap?.tasks[0]?.tokenCount).toBe(99);
    expect(listSubagentStatusLines()).toHaveLength(1);
  });

  it('배열이 아니거나 세션이 없으면 무시한다', () => {
    expect(recordSubagentStatusLine('s1', { id: 't1' } as unknown)).toBe(false);
    expect(recordSubagentStatusLine('', [{ id: 't1' }])).toBe(false);
  });

  it('숫자 effort(토큰 예산)도 그대로 받는다', () => {
    recordSubagentStatusLine('s1', [{ id: 't1', effort: 4096 }]);
    expect(getSubagentStatusLine('s1')?.tasks[0]?.effort).toBe(4096);
  });
});

/**
 * 프로세스 트리 종료의 **멀티플랫폼 회귀 고정**.
 *
 * 배경 — POSIX 의 트리 킬(`killTree`)은 `process.kill(-pid)` 로 프로세스 **그룹**을 죽인다.
 * 그런데 그룹 킬이 성립하려면 자식이 `detached: true` 로 떠서 그룹 리더여야 한다. claude 스폰 경로에
 * `detached` 가 하나도 없던 시절, mac/linux 에서는 `-pid` 가 **항상** ESRCH 로 떨어져 단일 pid 킬로
 * 강등됐고 claude 가 띄운 MCP 서버·worker(손자)가 조용히 살아남았다. 예외도 로그도 안 남는 결함이라
 * 눈으로는 절대 못 잡는다 — 그래서 스폰 옵션 조립을 순수 함수로 빼고 세 플랫폼을 여기서 고정한다.
 *
 * ⚠ 실제로 프로세스를 띄우거나 죽이는 테스트는 만들지 않는다(순수 함수 + 가짜 자식 + 소스 검사만).
 *   트리 종료는 `killTree`·그룹 신호를 주입받아, 가짜 pid 로 남의 프로세스를 건드리지 않는다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  processGroupSpawnOptions, terminateChildTree, forceCloseAfterExit, EXIT_CLOSE_GRACE_MS,
} from './processTree.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readService(file: string): string {
  const full = path.join(HERE, file);
  const src = fs.readFileSync(full, 'utf8');
  // 빈 문자열을 조용히 통과시키면 "검사했다"는 착각만 남는다 — 못 읽으면 실패해야 한다.
  expect(src.length, `${file} source should be readable`).toBeGreaterThan(0);
  return src;
}

describe('processGroupSpawnOptions — 플랫폼별 spawn 옵션 조립', () => {
  it('POSIX 는 detached:true (프로세스 그룹 리더)로 띄운다', () => {
    expect(processGroupSpawnOptions('darwin')).toEqual({ detached: true });
    expect(processGroupSpawnOptions('linux')).toEqual({ detached: true });
    expect(processGroupSpawnOptions('freebsd')).toEqual({ detached: true });
  });

  it('Windows 에는 detached 를 넣지 않는다 (새 콘솔 창이 뜨고, 트리 킬은 taskkill /T 담당)', () => {
    const opts = processGroupSpawnOptions('win32');
    expect(opts).toEqual({});
    expect('detached' in opts).toBe(false);
  });

  it('다른 spawn 옵션에 스프레드해도 나머지를 덮지 않는다', () => {
    const posix = { cwd: '/tmp', shell: false, stdio: ['pipe', 'pipe', 'pipe'], ...processGroupSpawnOptions('linux') };
    expect(posix).toEqual({ cwd: '/tmp', shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: true });

    const win = { cwd: 'C:/tmp', shell: false, ...processGroupSpawnOptions('win32') };
    expect(win).toEqual({ cwd: 'C:/tmp', shell: false });
    expect((win as { detached?: boolean }).detached).toBeUndefined();
  });
});

describe('killTree — POSIX 그룹 킬 유지', () => {
  it('POSIX 경로가 -pid(프로세스 그룹) 킬을 그대로 들고 있다', () => {
    // 이 줄이 사라지면 detached 스폰이 아무 의미가 없어지고 손자가 다시 살아남는다.
    expect(readService('processTree.ts')).toContain("process.kill(-pid, 'SIGKILL')");
  });
});

describe('장수명 claude 자식 스폰은 전부 processGroupSpawnOptions 를 통과한다', () => {
  // "detached 는 필요 없어 보인다"며 되돌리면 mac/linux 고아 프로세스 버그가 그대로 부활한다.
  const LONG_LIVED_SPAWNS: { file: string; sites: number; why: string }[] = [
    { file: 'subAgentManager.ts', sites: 1, why: 'claude 본체 execute' },
    { file: 'contiManager.ts', sites: 2, why: 'callClaude + runPatchAgent' },
    { file: 'claudeAgentViewService.ts', sites: 1, why: 'claude --bg 워커' },
    { file: 'claudeSetupService.ts', sites: 1, why: '네이티브 인스톨러(shell 파이프라인)' },
    { file: 'claudeVersionService.ts', sites: 1, why: 'claude update / npm install -g' },
    { file: 'feedbackDistillService.ts', sites: 1, why: 'haiku one-shot 증류' },
  ];

  for (const { file, sites, why } of LONG_LIVED_SPAWNS) {
    it(`${file} — ${why} (${sites}곳)`, () => {
      const src = readService(file);
      const spread = src.match(/\.\.\.processGroupSpawnOptions\(\)/g) ?? [];
      expect(spread.length, `${file} 의 장수명 spawn 에 ...processGroupSpawnOptions() 가 빠졌다`).toBeGreaterThanOrEqual(sites);
      expect(src).toContain("from './processTree.js'");
    });
  }

  it('짧은 probe 스폰(--version / --help / auth status / stop·rm)은 일부러 빼 두고 이유를 남긴다', () => {
    // 왜 안 붙였는지가 코드에 없으면 다음 사람이 "빠뜨렸다"고 보고 무의미하게 넓힌다.
    expect(readService('claudeVersionService.ts')).toMatch(/일부러 안 붙인다[\s\S]{0,200}--version/);
    expect(readService('modelRegistryService.ts')).toMatch(/일부러 안 붙인다/);
    // auth 의 spawn 은 claudeCliRun.ts 로 옮겨졌다(사용량 probe 와 공용) — 이유도 함께 옮겼다.
    expect(readService('claudeCliRun.ts')).toMatch(/일부러 안 붙인다/);
    expect(readService('claudeAuthService.ts')).toContain("from './claudeCliRun.js'");
    expect(readService('claudeAgentViewService.ts')).toMatch(/일부러 안 붙인다/);
  });

  it('feedbackDistillService 는 taskkill 을 재구현하지 않고 killTree 로 위임한다', () => {
    const src = readService('feedbackDistillService.ts');
    expect(src).toContain('killTree(child.pid)');
    // 중복 구현이 되살아나면 POSIX 쪽이 다시 트리 킬을 안 하게 된다.
    expect(src).not.toMatch(/spawn\(\s*'taskkill'/);
  });
});

// ─── §5.5 #17-18 — [중지]가 손자를 놓쳐 `close` 가 늦게 오던 사슬 ───

/** 트리 종료·강제 close 가 보는 것만 가진 가짜 자식. `exit`/`close` 는 시험이 직접 낸다. */
class FakeChild extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed: (string | undefined)[] = [];
  stdin = { ended: false, destroyed: false, end() { this.ended = true; }, destroy() { this.destroyed = true; } };
  stdout = { destroyed: false, destroy() { this.destroyed = true; } };
  stderr = { destroyed: false, destroy() { this.destroyed = true; } };
  constructor(pid: number | null = 4242) { super(); this.pid = pid ?? undefined; }
  kill(signal?: string): boolean { this.killed.push(signal); return true; }
  exitNow(code = 0): void { this.exitCode = code; this.emit('exit', code, null); }
  asChild(): ChildProcess { return this as unknown as ChildProcess; }
}

function spies() {
  const trees: number[] = [];
  const signals: [number, NodeJS.Signals][] = [];
  return {
    trees,
    signals,
    killTree: (pid: number) => { trees.push(pid); },
    signalGroup: (grouped: boolean) => (pid: number, signal: NodeJS.Signals) => { signals.push([pid, signal]); return grouped; },
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('terminateChildTree — Windows: 부모가 살아 있는 지금 트리째 끊는다', () => {
  it('창구를 먼저 닫고 곧바로 트리 종료 — 직접 자식만 먼저 죽여 손자를 고아로 만들지 않는다', () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const s = spies();
    terminateChildTree(child.asChild(), { platform: 'win32', killTree: s.killTree, signalGroup: s.signalGroup(true), graceMs: 1500 });

    expect(child.stdin.ended).toBe(true);
    expect(s.trees).toEqual([4242]);
    // Windows 의 child.kill 은 직접 자식만 즉사시킨다 — 그 순간 손자는 `/T` 가 못 찾는 고아가 된다.
    expect(child.killed).toEqual([]);
    // 그룹 신호는 POSIX 전용이다.
    expect(s.signals).toEqual([]);
  });

  it('트리 종료가 실패해 여유 뒤에도 살아 있으면 직접 자식이라도 끊는다', () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const s = spies();
    terminateChildTree(child.asChild(), { platform: 'win32', killTree: s.killTree, graceMs: 1500 });

    vi.advanceTimersByTime(1499);
    expect(child.killed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(child.killed).toHaveLength(1);
  });

  it('여유 안에 끝났으면 더 건드리지 않는다', () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const s = spies();
    terminateChildTree(child.asChild(), { platform: 'win32', killTree: s.killTree, graceMs: 1500 });

    child.exitNow();
    vi.advanceTimersByTime(5000);
    expect(child.killed).toEqual([]);
  });

  it('pid 가 없으면 트리를 찾을 수 없다 — 직접 자식만 끊는다', () => {
    const child = new FakeChild(null);
    const s = spies();
    terminateChildTree(child.asChild(), { platform: 'win32', killTree: s.killTree });
    expect(s.trees).toEqual([]);
    expect(child.killed).toHaveLength(1);
  });
});

describe('terminateChildTree — POSIX: 그룹에 SIGTERM, 여유 뒤 남은 것을 거둔다', () => {
  for (const platform of ['darwin', 'linux'] as const) {
    it(`${platform} — 그룹 전체에 SIGTERM, 리더에게 따로 보내지 않는다`, () => {
      vi.useFakeTimers();
      const child = new FakeChild();
      const s = spies();
      terminateChildTree(child.asChild(), { platform, killTree: s.killTree, signalGroup: s.signalGroup(true), graceMs: 1500 });

      expect(child.stdin.ended).toBe(true);
      expect(s.signals).toEqual([[4242, 'SIGTERM']]);
      expect(child.killed).toEqual([]);
      expect(s.trees).toEqual([]);
    });

    it(`${platform} — 리더가 먼저 끝나도 그룹에 남은 손자는 거둔다(리더의 exit 가 타이머를 지우지 않는다)`, () => {
      vi.useFakeTimers();
      const child = new FakeChild();
      const s = spies();
      terminateChildTree(child.asChild(), { platform, killTree: s.killTree, signalGroup: s.signalGroup(true), graceMs: 1500 });

      child.exitNow();
      vi.advanceTimersByTime(1500);
      expect(s.signals).toEqual([[4242, 'SIGTERM'], [4242, 'SIGKILL']]);
      // 리더 번호는 이미 재활용됐을 수 있다 — 단일 pid 킬은 하지 않는다.
      expect(s.trees).toEqual([]);
    });

    it(`${platform} — 여유 뒤에도 리더가 살아 있으면 트리째 강제 종료`, () => {
      vi.useFakeTimers();
      const child = new FakeChild();
      const s = spies();
      terminateChildTree(child.asChild(), { platform, killTree: s.killTree, signalGroup: s.signalGroup(true), graceMs: 1500 });

      vi.advanceTimersByTime(1500);
      expect(s.trees).toEqual([4242]);
    });

    it(`${platform} — 그룹이 없으면(detached 아님) 리더에게 SIGTERM, 끝났으면 더 보내지 않는다`, () => {
      vi.useFakeTimers();
      const child = new FakeChild();
      const s = spies();
      terminateChildTree(child.asChild(), { platform, killTree: s.killTree, signalGroup: s.signalGroup(false), graceMs: 1500 });

      expect(child.killed).toEqual(['SIGTERM']);
      child.exitNow();
      vi.advanceTimersByTime(1500);
      expect(s.signals).toEqual([[4242, 'SIGTERM']]);
      expect(s.trees).toEqual([]);
    });
  }
});

describe('forceCloseAfterExit — 본체가 끝났으면 close 를 오래 붙들지 않는다', () => {
  it('exit 뒤 여유 안에 close 가 안 오면 우리 쪽 파이프 끝을 닫는다', () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    forceCloseAfterExit(child.asChild());

    child.exitNow();
    vi.advanceTimersByTime(EXIT_CLOSE_GRACE_MS - 1);
    expect(child.stdout.destroyed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(child.stdin.destroyed).toBe(true);
  });

  it('여유 안에 close 가 오면 아무것도 닫지 않는다(남은 출력을 자르지 않는다)', () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    forceCloseAfterExit(child.asChild());

    child.exitNow();
    child.emit('close', 0, null);
    vi.advanceTimersByTime(EXIT_CLOSE_GRACE_MS * 2);
    expect(child.stdout.destroyed).toBe(false);
  });

  it('close 가 exit 보다 먼저 왔으면 여유 타이머를 걸지 않는다', () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    forceCloseAfterExit(child.asChild(), 10);

    child.emit('close', 0, null);
    child.exitNow();
    vi.advanceTimersByTime(100);
    expect(child.stdout.destroyed).toBe(false);
  });

  it('기본 여유는 코덱스 경로와 같은 2초다', () => {
    expect(EXIT_CLOSE_GRACE_MS).toBe(2000);
  });

  it('claude 본체 스폰은 close 마감을 이 규칙에 맡긴다', () => {
    const src = readService('subAgentManager.ts');
    expect(src).toContain('forceCloseAfterExit(child)');
    expect(src).toMatch(/import \{[^}]*forceCloseAfterExit[^}]*\} from '\.\/processTree\.js'/);
  });
});

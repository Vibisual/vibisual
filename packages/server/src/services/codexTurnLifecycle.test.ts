/**
 * §5.25 (F) — 코덱스 턴의 [중지]·마감 수명 고정 시험.
 *
 * 사고 — 사용자가 [중지]를 눌러도 코덱스 세션이 "실행 중"에서 안 내려왔다(14분). 코덱스가 띄운 명령 하나가
 * 우리 stdout 파이프를 물려받은 채 프로세스 트리에서 빠져나가 있었고, 러너는 Node 의 `close`(stdio 가
 * **전부** 닫혀야 온다) 하나만 기다렸다. 본체는 트리 종료로 죽었는데 `close` 가 안 와서 턴 표식이 남았고,
 * 이후 [중지]는 매번 이미 죽은 pid 에 트리 종료만 다시 보냈다.
 *
 * 앞쪽은 가짜 자식으로 마감 규칙을 하나씩 고정하고, 마지막은 **실제 프로세스**로 같은 모양
 * (본체 → 곧 끝나는 중간 → 파이프를 쥔 채 남는 손자)을 만들어 [중지]가 턴을 끝내는지 본다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { attachCodexTurn, isCodexTurnRunning, stopCodexTurn, type CodexTurnLifecycleOptions } from './codexRunner.js';
import { processGroupSpawnOptions } from './processTree.js';

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  constructor(readonly pid: number) { super(); }
  /** 본체 종료. 파이프는 그대로 둔다(물려받은 손자가 쥐고 있는 상황). */
  exit(code: number | null): void { this.emit('exit', code, null); }
  close(code: number | null): void { this.emit('close', code, null); }
  asChild(): ChildProcess { return this as unknown as ChildProcess; }
}

interface Done { error: string | undefined; finalText: string }

function attach(subAgentId: string, child: FakeChild, options: CodexTurnLifecycleOptions) {
  const done: Done[] = [];
  attachCodexTurn(child.asChild(), {
    subAgentId,
    onEvent: () => { /* test */ },
    onThread: () => { /* test */ },
    onUsage: () => { /* test */ },
    onFileWrites: () => { /* test */ },
    onDone: (error, finalText) => { done.push({ error, finalText }); },
  }, options);
  return done;
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ANSWER = '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"다 했습니다"}}\n';
const TURN_END = '{"type":"turn.completed"}\n';

const opened: string[] = [];
function sub(name: string): string {
  const id = `sub-lifecycle-${name}-${Math.random().toString(36).slice(2, 8)}`;
  opened.push(id);
  return id;
}

afterEach(() => {
  // 실패한 시험이 남긴 턴 표식이 다음 시험을 오염시키지 않게 — 멈추기만 하고 결과는 보지 않는다.
  while (opened.length > 0) stopCodexTurn(opened.pop()!);
});

describe('attachCodexTurn — 평소 마감', () => {
  it('close 로 끝나면 답을 싣고 한 번만 알린다', async () => {
    const id = sub('normal');
    const child = new FakeChild(101);
    const done = attach(id, child, { killTree: vi.fn(), exitCloseGraceMs: 30 });
    expect(isCodexTurnRunning(id)).toBe(true);
    child.stdout.write(ANSWER);
    child.stdout.write(TURN_END);
    await sleep(5);
    child.exit(0);
    child.close(0);
    await sleep(60);
    expect(done).toEqual([{ error: undefined, finalText: '다 했습니다' }]);
    expect(isCodexTurnRunning(id)).toBe(false);
  });

  it('spawn error 뒤에 close 가 따라와도 onDone 은 한 번이다', async () => {
    const id = sub('error');
    const child = new FakeChild(102);
    const done = attach(id, child, { killTree: vi.fn() });
    child.emit('error', new Error('ENOENT'));
    child.close(-4058);
    await sleep(5);
    expect(done).toEqual([{ error: 'spawn failed: ENOENT', finalText: '' }]);
    expect(isCodexTurnRunning(id)).toBe(false);
  });
});

describe('attachCodexTurn — close 가 안 오는 경우', () => {
  it('[중지] → 본체 exit, 파이프는 손자가 쥔 채 → close 없이 중지로 마감한다', async () => {
    const id = sub('stop-exit');
    const child = new FakeChild(201);
    const kill = vi.fn((pid: number | undefined) => { if (pid === 201) setTimeout(() => child.exit(1), 5); });
    const done = attach(id, child, { killTree: kill, stopSettleTimeoutMs: 5000 });
    child.stdout.write(ANSWER);
    await sleep(5);

    expect(stopCodexTurn(id)).toBe(true);
    await waitFor(() => done.length > 0, 1000);

    expect(done).toEqual([{ error: undefined, finalText: '다 했습니다' }]);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(isCodexTurnRunning(id)).toBe(false);
    // 멈춘 턴이다 — 남은 손자의 출력은 더 받지 않는다.
    expect(child.stdout.destroyed).toBe(true);
    // 뒤늦은 close 는 아무것도 다시 알리지 않는다.
    child.close(1);
    await sleep(5);
    expect(done).toHaveLength(1);
  });

  it('[중지]를 여러 번 눌러도 트리 종료는 한 번, 마감도 한 번이다', async () => {
    const id = sub('stop-repeat');
    const child = new FakeChild(202);
    const kill = vi.fn();
    const done = attach(id, child, { killTree: kill, stopSettleTimeoutMs: 40 });
    stopCodexTurn(id);
    stopCodexTurn(id);
    stopCodexTurn(id);
    expect(kill).toHaveBeenCalledTimes(1);
    await waitFor(() => done.length > 0, 1000);
    await sleep(60);
    expect(done).toHaveLength(1);
  });

  it('[중지] 뒤 exit 도 close 도 없으면 시한에 한 번 더 종료를 보내고 중지로 마감한다', async () => {
    const id = sub('stop-timeout');
    const child = new FakeChild(203);
    const kill = vi.fn();
    const done = attach(id, child, { killTree: kill, stopSettleTimeoutMs: 40 });
    stopCodexTurn(id);
    expect(done).toHaveLength(0);
    await waitFor(() => done.length > 0, 1000);
    expect(done).toEqual([{ error: undefined, finalText: '' }]);
    expect(kill.mock.calls).toEqual([[203], [203]]);
    expect(isCodexTurnRunning(id)).toBe(false);
  });

  it('본체가 이미 끝난 뒤의 [중지]는 죽은 pid 에 종료를 보내지 않고 바로 마감한다', async () => {
    const id = sub('stop-after-exit');
    const child = new FakeChild(204);
    const kill = vi.fn();
    const done = attach(id, child, { killTree: kill, exitCloseGraceMs: 10_000 });
    child.exit(0);
    await sleep(5);
    expect(isCodexTurnRunning(id)).toBe(true);

    expect(stopCodexTurn(id)).toBe(true);
    await waitFor(() => done.length > 0, 1000);
    expect(kill).not.toHaveBeenCalled();
    expect(done).toEqual([{ error: undefined, finalText: '' }]);
  });

  it('사용자가 안 멈춰도 본체 exit 뒤 close 가 안 오면 유예 후 같은 규칙으로 마감한다', async () => {
    const ok = sub('exit-ok');
    const okChild = new FakeChild(301);
    const okDone = attach(ok, okChild, { killTree: vi.fn(), exitCloseGraceMs: 30 });
    okChild.stdout.write(ANSWER);
    okChild.stdout.write(TURN_END);
    await sleep(5);
    okChild.exit(0);
    expect(okDone).toHaveLength(0);
    await waitFor(() => okDone.length > 0, 1000);
    expect(okDone).toEqual([{ error: undefined, finalText: '다 했습니다' }]);
    expect(isCodexTurnRunning(ok)).toBe(false);

    const bad = sub('exit-bad');
    const badChild = new FakeChild(302);
    const badDone = attach(bad, badChild, { killTree: vi.fn(), exitCloseGraceMs: 30 });
    badChild.stderr.write('stream disconnected\n');
    await sleep(5);
    badChild.exit(1);
    await waitFor(() => badDone.length > 0, 1000);
    expect(badDone).toEqual([{ error: 'stream disconnected', finalText: '' }]);
  });

  it('유예 안에 close 가 오면 close 가 마감한다(꼬리 줄까지 읽는다)', async () => {
    const id = sub('exit-then-close');
    const child = new FakeChild(303);
    const done = attach(id, child, { killTree: vi.fn(), exitCloseGraceMs: 200 });
    child.exit(0);
    // 개행 없이 끝난 마지막 줄 — close 가 남은 버퍼를 처리해야 답이 산다.
    child.stdout.write(ANSWER.trimEnd());
    await sleep(5);
    child.close(0);
    await sleep(5);
    expect(done).toEqual([{ error: undefined, finalText: '다 했습니다' }]);
  });
});

describe('attachCodexTurn — 같은 세션의 다음 턴', () => {
  it('중지로 마감한 옛 턴의 늦은 close 가 새 턴 표식을 지우지 않는다', async () => {
    const id = sub('next-turn');
    const oldChild = new FakeChild(401);
    const oldKill = vi.fn(() => { setTimeout(() => oldChild.exit(1), 5); });
    const oldDone = attach(id, oldChild, { killTree: oldKill });
    stopCodexTurn(id);
    await waitFor(() => oldDone.length > 0, 1000);

    // [즉시] 덧말 → 같은 세션에 새 턴이 뜬다.
    const newChild = new FakeChild(402);
    const newKill = vi.fn();
    attach(id, newChild, { killTree: newKill, stopSettleTimeoutMs: 5000 });
    expect(isCodexTurnRunning(id)).toBe(true);

    // 손자가 이제서야 끝나 옛 자식의 close 가 온다.
    oldChild.close(1);
    await sleep(5);
    expect(isCodexTurnRunning(id)).toBe(true);

    // 새 턴의 [중지]는 새 자식을 겨눈다.
    stopCodexTurn(id);
    expect(newKill).toHaveBeenCalledWith(402);
    expect(oldKill).toHaveBeenCalledTimes(1);
  });

  it('세션 스코프 — 한 세션을 멈춰도 다른 세션 턴은 그대로 돈다', async () => {
    const a = sub('scope-a');
    const b = sub('scope-b');
    const aChild = new FakeChild(501);
    const bChild = new FakeChild(502);
    const aKill = vi.fn(() => { setTimeout(() => aChild.exit(1), 5); });
    const bKill = vi.fn();
    const aDone = attach(a, aChild, { killTree: aKill });
    const bDone = attach(b, bChild, { killTree: bKill });
    stopCodexTurn(a);
    await waitFor(() => aDone.length > 0, 1000);
    expect(isCodexTurnRunning(b)).toBe(true);
    expect(bKill).not.toHaveBeenCalled();
    expect(bDone).toHaveLength(0);
  });
});

describe('attachCodexTurn — 실제 프로세스: 파이프를 쥔 손자가 트리에서 빠져나간 경우', () => {
  it('[중지]가 close 를 기다리지 않고 턴을 끝낸다', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-codex-stop-'));
    // 손자는 부모를 잃도록(중간이 먼저 끝남) + POSIX 에선 새 세션으로(프로세스 그룹 종료에서도 빠짐) 띄운다.
    fs.writeFileSync(path.join(dir, 'grand.cjs'), 'setTimeout(() => {}, 60000);\n');
    fs.writeFileSync(path.join(dir, 'middle.cjs'), [
      "const path = require('node:path');",
      "const c = require('node:child_process').spawn(process.execPath, [path.join(__dirname, 'grand.cjs')], { stdio: ['ignore', 'inherit', 'inherit'], detached: true });",
      "process.stdout.write('GRAND ' + c.pid + '\\n');",
      'c.unref();',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'top.cjs'), [
      "const path = require('node:path');",
      "const m = require('node:child_process').spawn(process.execPath, [path.join(__dirname, 'middle.cjs')], { stdio: ['ignore', 'inherit', 'inherit'] });",
      "m.on('exit', () => process.stdout.write('MIDDLE_EXITED\\n'));",
      'setTimeout(() => {}, 60000);',
      '',
    ].join('\n'));

    const child = spawn(process.execPath, [path.join(dir, 'top.cjs')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...processGroupSpawnOptions(),
    });
    let grandPid: number | undefined;
    let middleExited = false;
    let closeFired = false;
    let closeFiredAtDone: boolean | undefined;
    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      const match = /GRAND (\d+)/.exec(text);
      if (match) grandPid = Number(match[1]);
      if (text.includes('MIDDLE_EXITED')) middleExited = true;
    });
    child.on('close', () => { closeFired = true; });

    const id = sub('real');
    const done: Done[] = [];
    try {
      attachCodexTurn(child, {
        subAgentId: id,
        onEvent: () => { /* test */ },
        onThread: () => { /* test */ },
        onUsage: () => { /* test */ },
        onFileWrites: () => { /* test */ },
        onDone: (error, finalText) => { closeFiredAtDone = closeFired; done.push({ error, finalText }); },
      });
      await waitFor(() => middleExited && grandPid !== undefined, 10_000);

      expect(stopCodexTurn(id)).toBe(true);
      await waitFor(() => done.length > 0, 10_000);

      expect(done).toEqual([{ error: undefined, finalText: '' }]);
      expect(isCodexTurnRunning(id)).toBe(false);
      // 이 시험이 재현하려던 상황이 실제로 성립했나 — 마감 시점에 close 는 아직 오지 않았어야 한다.
      expect(closeFiredAtDone).toBe(false);
    } finally {
      if (grandPid) { try { process.kill(grandPid); } catch { /* 이미 끝남 */ } }
      if (child.pid && child.exitCode === null && child.signalCode === null) { try { child.kill(); } catch { /* 이미 끝남 */ } }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

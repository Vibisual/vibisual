/**
 * 진단 로그 정상상태 침묵(`debugLog.ts` — 달라졌을 때만 기록): `readAliveSessionIds` 지문은 버블 후보(vscode 진입점)가 바뀔 때만 달라진다.
 * 몇 초 살다 사라지는 비-vscode CLI 세션까지 지문에 넣으면 2초마다 약 2.5KB 가 쌓여 3일 만에 2MB 회전 상한에 닿고 `removeAgent` 같은 줄이 묻힌다(실측 2026-08-31).
 */
import { describe, it, expect } from 'vitest';
import { aliveDiagSignature } from './sessionDiscovery.js';
import type { SessionLiveness } from './sessionDiscovery.js';

function row(over: Partial<SessionLiveness>): SessionLiveness {
  return {
    file: 'x.json',
    sessionId: 'sid',
    pid: 1,
    cwd: 'C:/proj',
    entrypoint: 'cli',
    startedAt: 0,
    live: false,
    reason: 'not-vscode',
    ...over,
  };
}

/** 버블이 될 수 있는 세션(vscode 진입점, 살아 있음). */
function vscodeAlive(sessionId: string): SessionLiveness {
  return row({ sessionId, entrypoint: 'vscode', live: true, reason: 'ok', pid: 100 });
}

/** 스쳐 지나가는 CLI 세션 — 버블 후보가 아니다. */
function transientCli(sessionId: string, pid: number): SessionLiveness {
  return row({ sessionId, pid, file: `${pid}.json`, startedAt: Date.now() });
}

describe('aliveDiagSignature — 잡음에 침묵한다', () => {
  it('CLI 세션이 들락거려도 지문이 그대로다', () => {
    const before = [vscodeAlive('vs-1'), transientCli('cli-a', 111), transientCli('cli-b', 222)];
    const after = [vscodeAlive('vs-1'), transientCli('cli-c', 333)];

    expect(aliveDiagSignature(before)).toBe(aliveDiagSignature(after));
  });

  it('CLI 세션이 전부 사라져도 지문이 그대로다 — 개수조차 담지 않는다', () => {
    const before = [vscodeAlive('vs-1'), transientCli('cli-a', 111)];
    const after = [vscodeAlive('vs-1')];

    expect(aliveDiagSignature(before)).toBe(aliveDiagSignature(after));
  });

  it('목록 순서가 바뀌어도 지문이 그대로다 — 디렉터리 읽기 순서에 흔들리지 않는다', () => {
    const a = [vscodeAlive('vs-1'), vscodeAlive('vs-2')];
    const b = [vscodeAlive('vs-2'), vscodeAlive('vs-1')];

    expect(aliveDiagSignature(a)).toBe(aliveDiagSignature(b));
  });
});

describe('aliveDiagSignature — 진짜 변화는 놓치지 않는다', () => {
  it('버블 후보가 새로 생기면 지문이 달라진다', () => {
    const before = [vscodeAlive('vs-1')];
    const after = [vscodeAlive('vs-1'), vscodeAlive('vs-2')];

    expect(aliveDiagSignature(before)).not.toBe(aliveDiagSignature(after));
  });

  it('버블 후보가 사라지면 지문이 달라진다', () => {
    const before = [vscodeAlive('vs-1'), vscodeAlive('vs-2')];
    const after = [vscodeAlive('vs-1')];

    expect(aliveDiagSignature(before)).not.toBe(aliveDiagSignature(after));
  });

  it('같은 세션의 탈락 사유가 바뀌면 지문이 달라진다', () => {
    const alive = [vscodeAlive('vs-1')];
    const dead = [row({ sessionId: 'vs-1', entrypoint: 'vscode', live: false, reason: 'pid-dead' })];

    expect(aliveDiagSignature(alive)).not.toBe(aliveDiagSignature(dead));
  });

  it('아무 세션도 없으면 빈 지문 — 첫 vscode 세션 등장을 반드시 잡는다', () => {
    expect(aliveDiagSignature([])).toBe('');
    expect(aliveDiagSignature([transientCli('cli-a', 111)])).toBe('');
    expect(aliveDiagSignature([vscodeAlive('vs-1')])).not.toBe('');
  });
});

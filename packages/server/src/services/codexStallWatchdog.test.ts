/**
 * §5.25 (F) — **자식은 살아 있는데 출력만 멎은 코덱스 턴**, 그리고 **끝이 오지 않는 MCP 호출**.
 *
 * 2026-09-20 사용자 보고의 물증이 이 자리다. MCP 서버가 `CONNECT_TIMEOUT` 으로 죽자 코덱스는
 * `item.started` 한 줄만 남기고 조용해졌고, 화면에는 그 도구 카드가 영원히 "도는 중"으로,
 * 명령은 영원히 "실행 중"으로 남았다. 원인은 둘이었다:
 *
 *  ① 러너의 타이머가 `exit` 과 [중지] 두 곳에서만 걸렸다 — 자식이 살아 있으면 **아무 타이머도
 *     돌지 않아** 턴이 영원히 열려 있었다.
 *  ② 매퍼는 줄 하나만 보는 순수 함수라 "시작만 오고 끝이 안 온 호출"을 기억할 곳이 없었다.
 *
 * 여기서 고정하는 약속 —
 *  · 조용함이 1차 한계를 넘으면 **알리기만** 한다(조용한 것이 곧 멈춘 것은 아니다).
 *  · 2차 한계를 넘으면 트리를 걷고 마감 경로를 돈다. 그때 받는 쪽의 2차 마감 입구를 먼저 연다.
 *  · 뒤늦게 진짜 `close` 가 와도 **두 번 닫히지 않는다**.
 *  · 짝 없는 도구 호출은 시한이 지나면 합성 실패 `tool_result` 로 닫힌다. 턴이 끝날 때도 전부 닫는다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { attachCodexTurn, isCodexTurnRunning, stopCodexTurn, type CodexTurnLifecycleOptions } from './codexRunner.js';
import { createCodexPendingCallLedger } from './codexPendingCalls.js';
import type { CodexMappedEvent } from './codexStreamMap.js';

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  constructor(readonly pid: number) { super(); }
  close(code: number | null): void { this.emit('close', code, null); }
  asChild(): ChildProcess { return this as unknown as ChildProcess; }
}

interface Idle { idleMs: number; stalled: boolean }
interface Done { error: string | undefined; finalText: string }

const opened: string[] = [];
function sub(name: string): string {
  const id = `sub-stall-${name}-${Math.random().toString(36).slice(2, 8)}`;
  opened.push(id);
  return id;
}

function attach(subAgentId: string, child: FakeChild, options: CodexTurnLifecycleOptions) {
  const done: Done[] = [];
  const idle: Idle[] = [];
  const events: CodexMappedEvent[] = [];
  const activity: number[] = [];
  attachCodexTurn(child.asChild(), {
    subAgentId,
    onEvent: (ev) => { events.push(ev); },
    onThread: () => { /* test */ },
    onUsage: () => { /* test */ },
    onFileWrites: () => { /* test */ },
    onIdle: (info) => { idle.push(info); },
    onActivity: (at) => { activity.push(at); },
    onDone: (error, finalText) => { done.push({ error, finalText }); },
  }, options);
  return { done, idle, events, activity };
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const MCP_START = '{"type":"item.started","item":{"id":"call_1","type":"mcp_tool_call","server":"atlassian","tool":"getConfluencePage"}}\n';

afterEach(() => {
  while (opened.length > 0) stopCodexTurn(opened.pop()!);
});

describe('정지 워치독 — 자식이 살아 있어도 턴은 영원히 열려 있지 않다', () => {
  it('reports actual partial stdout and stderr activity without fabricating a heartbeat while quiet', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const child = new FakeChild(200);
    const { activity, events } = attach(sub('activity'), child, {
      killTree: vi.fn(), idleCheckMs: 15_000, idleNoticeMs: 300_000, idleSettleMs: 1_200_000,
    });
    try {
      child.stdout.write('{"type":');
      child.stderr.write('progress');
      expect(activity).toEqual([1_000]);
      expect(events).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(15_000);
      expect(activity).toEqual([1_000]); // being alive is not evidence of progress
      child.stderr.write('more progress');
      expect(activity).toEqual([1_000, 16_000]);
      expect(events).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(15_000);
      child.stdout.write('"future.event"}\n'); // no mapped UI event
      expect(activity).toEqual([1_000, 16_000, 31_000]);
      expect(events).toHaveLength(0);
      child.close(0);
      await vi.advanceTimersByTimeAsync(15_000);
      child.stderr.write('late progress');
      child.stdout.write('late output');
      expect(activity).toEqual([1_000, 16_000, 31_000]);
    } finally {
      child.close(0);
      vi.useRealTimers();
    }
  });

  it('1단계는 알리기만 한다 — 조용한 것이 곧 멈춘 것은 아니다', async () => {
    const id = sub('notice');
    const child = new FakeChild(201);
    const killTree = vi.fn();
    const { idle, done } = attach(id, child, {
      killTree, idleCheckMs: 5, idleNoticeMs: 20, idleSettleMs: 10_000,
    });

    await waitFor(() => idle.length > 0, 2_000);

    expect(idle[0]!.stalled).toBe(false);
    expect(idle[0]!.idleMs).toBeGreaterThanOrEqual(20);
    // 아무것도 걷지 않았다 — 턴은 그대로 돈다.
    expect(killTree).not.toHaveBeenCalled();
    expect(done).toHaveLength(0);
    expect(isCodexTurnRunning(id)).toBe(true);
  });

  it('2단계는 트리를 걷고 마감까지 간다 — 사유가 남는다', async () => {
    const id = sub('settle');
    const child = new FakeChild(202);
    const killTree = vi.fn();
    const { idle, done } = attach(id, child, {
      killTree, idleCheckMs: 5, idleNoticeMs: 10, idleSettleMs: 25,
    });

    await waitFor(() => done.length > 0, 2_000);

    expect(idle.some((i) => i.stalled)).toBe(true);
    expect(killTree).toHaveBeenCalled();
    expect(done[0]!.error).toContain('stalled');
    expect(isCodexTurnRunning(id)).toBe(false);
  });

  it('워치독이 마감한 뒤 진짜 close 가 와도 두 번 닫히지 않는다', async () => {
    const id = sub('idempotent');
    const child = new FakeChild(203);
    const { done } = attach(id, child, {
      killTree: vi.fn(), idleCheckMs: 5, idleNoticeMs: 10, idleSettleMs: 25,
    });

    await waitFor(() => done.length > 0, 2_000);
    child.close(143);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(done).toHaveLength(1);
  });

  // 가짜 시계로 잰다. 실시간으로 재면 이 시험은 **러너의 속도를 재는 시험**이 된다 — 10ms 간격으로
  // 여덟 줄을 흘리면서 40ms 침묵을 정지로 보는 구성이라 여유가 네 배뿐이고, 느린 windows 러너에서는
  // `setTimeout(…, 10)` 한 번이 그 여유를 통째로 먹는다(CI #49 가 여기서 빨갰다). 제품의 실제 비율은
  // 5분 알림 · 20분 마감이라 그런 상황 자체가 없다. 재는 대상은 "줄이 흐르는 동안 정지로 보지 않는가"
  // 하나뿐이므로, 시간은 우리가 준다.
  it('줄이 흐르는 동안에는 조용해지지 않는다 — 긴 턴을 죽이지 않는다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const id = sub('busy');
    const child = new FakeChild(204);
    const killTree = vi.fn();
    const { done } = attach(id, child, {
      killTree, idleCheckMs: 5, idleNoticeMs: 10_000, idleSettleMs: 40,
    });

    try {
      for (let i = 0; i < 8; i++) {
        child.stdout.write(`{"type":"item.completed","item":{"id":"i${i}","type":"reasoning","text":"생각"}}\n`);
        // 워치독 주기(5ms)보다 긴 간격이라 틱은 줄 사이마다 두 번씩 돈다 — 그런데도 걷지 않아야 한다.
        await vi.advanceTimersByTimeAsync(10);
      }

      expect(killTree, '줄이 흐르는데도 트리를 걷었다').not.toHaveBeenCalled();
      expect(done).toHaveLength(0);
      expect(isCodexTurnRunning(id)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('미결 도구 원장 — 짝 없는 호출은 시한이 닫는다', () => {
  const started = (over: Partial<CodexMappedEvent> = {}): CodexMappedEvent => ({
    eventType: 'tool_use', content: '{}', toolName: 'atlassian:getConfluencePage',
    toolUseId: 'call_1', awaitsResult: true, ...over,
  });

  it('시한 전에는 닫지 않고, 넘기면 합성 실패로 닫는다', () => {
    const ledger = createCodexPendingCallLedger(10_000);
    ledger.note(started(), 1_000);

    expect(ledger.overdue(5_000)).toHaveLength(0);
    const out = ledger.overdue(11_500);
    expect(out).toHaveLength(1);
    expect(out[0]!.eventType).toBe('tool_result');
    expect(out[0]!.toolUseId).toBe('call_1');
    expect(out[0]!.content).toContain('no result');
    // 한 번 닫은 것은 원장에서 빠진다 — 같은 카드를 두 번 닫지 않는다.
    expect(ledger.size()).toBe(0);
    expect(ledger.overdue(99_000)).toHaveLength(0);
  });

  it('짝이 오면 원장에서 빠진다 — 멀쩡한 호출은 시한에 걸리지 않는다', () => {
    const ledger = createCodexPendingCallLedger(10_000);
    ledger.note(started(), 1_000);
    ledger.note({ eventType: 'tool_result', content: 'done', toolName: 'x', toolUseId: 'call_1' }, 2_000);

    expect(ledger.size()).toBe(0);
    expect(ledger.overdue(99_000)).toHaveLength(0);
  });

  it('완료 줄이 원래 없는 도구는 등록하지 않는다 — 멀쩡한 호출을 실패로 물들이지 않는다', () => {
    const ledger = createCodexPendingCallLedger(10_000);
    // `web_search`·`command_execution` 은 `awaitsResult` 를 달지 않는다.
    ledger.note(started({ awaitsResult: undefined, toolUseId: 'call_web' }), 1_000);

    expect(ledger.size()).toBe(0);
    expect(ledger.overdue(99_000)).toHaveLength(0);
  });

  it('턴이 끝나면 남은 미결을 전부 닫는다 — 도는 중 카드를 남기지 않는다', () => {
    const ledger = createCodexPendingCallLedger(10 * 60_000);
    ledger.note(started({ toolUseId: 'a' }), 1_000);
    ledger.note(started({ toolUseId: 'b' }), 1_000);

    const out = ledger.flush('turn closed', 2_000);

    expect(out.map((e) => e.toolUseId).sort()).toEqual(['a', 'b']);
    expect(out.every((e) => e.eventType === 'tool_result')).toBe(true);
    expect(out[0]!.content).toContain('turn closed');
    expect(ledger.size()).toBe(0);
  });
});

describe('러너와 원장이 맞물린다 — 화면의 거짓 "도는 중"이 끝난다', () => {
  it('시작만 오고 끝이 안 온 MCP 호출은 시한이 지나면 합성 결과로 닫힌다', async () => {
    const id = sub('mcp-deadline');
    const child = new FakeChild(205);
    const { events } = attach(id, child, {
      killTree: vi.fn(), idleCheckMs: 5, idleNoticeMs: 10_000, idleSettleMs: 10_000, mcpCallDeadlineMs: 25,
    });

    child.stdout.write(MCP_START);
    await waitFor(() => events.some((e) => e.eventType === 'tool_result'), 2_000);

    const closed = events.find((e) => e.eventType === 'tool_result')!;
    expect(closed.toolUseId).toBe('call_1');
    expect(closed.content).toContain('no result');
    // 턴 자체는 아직 돈다 — 닫힌 것은 카드 하나지 턴이 아니다.
    expect(isCodexTurnRunning(id)).toBe(true);
  });

  it('턴이 닫힐 때 남은 미결 카드도 함께 닫힌다', async () => {
    const id = sub('mcp-flush');
    const child = new FakeChild(206);
    const { events, done } = attach(id, child, {
      killTree: vi.fn(), idleCheckMs: 5, idleNoticeMs: 10_000, idleSettleMs: 10_000,
      mcpCallDeadlineMs: 10 * 60_000, exitCloseGraceMs: 10,
    });

    child.stdout.write(MCP_START);
    await waitFor(() => events.length > 0, 2_000);
    child.close(0);
    await waitFor(() => done.length > 0, 2_000);

    expect(events.some((e) => e.eventType === 'tool_result' && e.toolUseId === 'call_1')).toBe(true);
  });
});

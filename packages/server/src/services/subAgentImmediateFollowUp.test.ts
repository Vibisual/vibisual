import { describe, it, expect, vi } from 'vitest';
import type { QueuedCommand } from '@vibisual/shared';
import { SubAgentManager, isChildStdinWritable } from './subAgentManager.js';
import { TURN_RESUME_GRACE_MS } from './turnSeal.js';

/**
 * §5.5 #17-18 — **[즉시] 덧말이 대화를 끝내 버리지 않는다.**
 *
 * 실측(2026-08-14 `crash.log` 2건)으로 드러난 사슬은 이랬다 — 그 턴이 이미 `result` 를 냈고 백단 여운
 * 때문에 봉인만 붙들려 있는데도 [즉시] 가 인터럽트를 쏘고, CLI 가 답할 턴이 없어 3초 뒤 하드 킬 폴백이
 * `terminateChildTree`(= **`stdin.end()` 먼저**, 그다음 SIGTERM)로 내려갔다. 그 직후 붙들린 봉인이 만료돼
 * `ready=true` → finalize → `onComplete` → `processNextCommand` 가 **창구가 닫힌 그 자식에게** 다음 턴을
 * 쓰면서 `ERR_STREAM_WRITE_AFTER_END` 가 났다. 그 예외는 `write()` 를 감싼 try/catch 를 지나쳐
 * `uncaughtException` 이 되므로 dispatch 체인이 그 자리에서 끊긴다 — 사용자 화면에서는 **방금 친 덧말이
 * 한 글자도 나가지 않은 채 대화가 끝나고 세션이 멈춘 것**으로 보인다.
 *
 * 여기서 고정하는 약속은 셋이다 —
 *   ① 재사용 판정은 "자식이 장부에 있는가"가 아니라 **"쓸 수 있는 창구인가"** 다.
 *   ② 창구가 닫힌 자식이 남아 있으면 그 턴은 **큐로 되돌린다**(덧말을 잃지 않고, 그 자식의 `close` 가
 *      부르는 다음 차례에서 `--resume` fresh spawn 으로 이어진다).
 *   ③ 봉인만 붙들린 턴에 [즉시] 가 오면 **죽이지 않고 그 봉인을 확정**한다.
 */

/** 테스트가 들여다보는 내부 칸만 구조적으로 드러낸다(전체 타입을 흉내 내지 않는다). */
type Innards = {
  runningChildren: Map<string, FakeChild>;
  persistentChildReady: Map<string, boolean>;
  persistentInFlightCmd: Map<string, { cmd: { id: string } }>;
  dispatchingSubs: Set<string>;
  currentTurnId: Map<string, string>;
  deferredSeals: Map<string, { timer: NodeJS.Timeout; seal: () => void }>;
  _executeViaLegacy: (
    cmd: QueuedCommand,
    sub: { id: string; parentAgentId: string; lastActivityAt: number },
    parentCwd: string,
    prompt: string,
    configArgs: string[],
    maxTurns: number,
  ) => void;
};

class FakeStdin {
  destroyed = false;
  writableEnded = false;
  writable = true;
  writes: string[] = [];
  write(chunk: string, _encoding?: string): boolean {
    this.writes.push(chunk);
    return true;
  }
  setDefaultEncoding(): this { return this; }
  end(): void {
    this.writableEnded = true;
    this.writable = false;
  }
  on(): this { return this; }
}

type FakeChild = {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdin: FakeStdin | null;
};

function liveChild(): FakeChild {
  return { exitCode: null, signalCode: null, stdin: new FakeStdin() };
}

const SUB = 'sub-immediate-1';
const AGENT = 'agent-immediate';

function innardsOf(m: SubAgentManager): Innards {
  return m as unknown as Innards;
}

/** `execute` 가 이 명령을 이미 내보낸 상태(= dispatch 직전 모습)를 만든다. */
function dispatchedCmd(id = 'cmd-follow-up'): QueuedCommand {
  return {
    id,
    text: '덧말 한마디',
    timestamp: Date.now(),
    subAgentId: SUB,
    status: 'executing',
    startedAt: Date.now(),
    dispatchMode: 'immediate',
  };
}

/** `_executeViaLegacy` 가 인자로 받는 sub — 이 경로가 실제로 읽는 세 칸만 든다. */
function subStub(): { id: string; parentAgentId: string; lastActivityAt: number } {
  return { id: SUB, parentAgentId: AGENT, lastActivityAt: 0 };
}

describe('isChildStdinWritable — 쓸 수 있는 창구만 true', () => {
  it('살아 있는 자식 + 열린 stdin 이면 true', () => {
    expect(isChildStdinWritable(liveChild())).toBe(true);
  });

  it('stdin.end() 를 받은 자식이면 false — 여기에 쓰는 순간 write-after-end 다', () => {
    const child = liveChild();
    child.stdin!.end();
    expect(isChildStdinWritable(child)).toBe(false);
  });

  it('stdin 이 파괴됐으면 false', () => {
    const child = liveChild();
    child.stdin!.destroyed = true;
    expect(isChildStdinWritable(child)).toBe(false);
  });

  it('이미 종료된 프로세스(exitCode/signalCode)면 false', () => {
    expect(isChildStdinWritable({ ...liveChild(), exitCode: 0 })).toBe(false);
    expect(isChildStdinWritable({ ...liveChild(), signalCode: 'SIGTERM' })).toBe(false);
  });

  it('stdin 이 없거나 자식 자체가 없으면 false', () => {
    expect(isChildStdinWritable({ exitCode: null, signalCode: null, stdin: null })).toBe(false);
    expect(isChildStdinWritable(undefined)).toBe(false);
    expect(isChildStdinWritable(null)).toBe(false);
  });
});

describe('재사용 경로 — 창구가 닫힌 자식에게는 쓰지 않는다', () => {
  it('stdin 이 닫힌 자식이면 write 없이 명령을 큐로 되돌린다', () => {
    const m = new SubAgentManager();
    const priv = innardsOf(m);
    const child = liveChild();
    child.stdin!.end(); // [중지]·[즉시] 폴백·앱 종료가 SIGTERM 앞에 하는 그 일.
    priv.runningChildren.set(SUB, child);
    priv.persistentChildReady.set(SUB, true);
    priv.dispatchingSubs.add(SUB);

    const cmd = dispatchedCmd();
    priv.currentTurnId.set(SUB, cmd.id);
    priv._executeViaLegacy(cmd, subStub(), 'C:\\tmp', '덧말 한마디', [], 0);

    // 죽은 창구에 한 글자도 쓰지 않았다 — 이 write 가 uncaughtException 의 발원지였다.
    expect(child.stdin!.writes).toHaveLength(0);
    // 사용자가 친 덧말은 살아서 큐로 돌아간다(그 자식의 close 가 다음 차례에 --resume 으로 보낸다).
    expect(cmd.status).toBe('queued');
    expect(cmd.startedAt).toBeUndefined();
    // dispatch 흔적은 걷힌다 — 안 걷으면 생존 대조가 이 sub 를 "곧 도는 중"으로 붙잡는다.
    expect(priv.dispatchingSubs.has(SUB)).toBe(false);
    expect(priv.currentTurnId.has(SUB)).toBe(false);
    expect(priv.persistentInFlightCmd.has(SUB)).toBe(false);
    expect(priv.persistentChildReady.has(SUB)).toBe(false);
  });

  it('직전 턴이 붙들려 있으면 그 in-flight 는 건드리지 않는다 — 그 마감의 대상이다', () => {
    const m = new SubAgentManager();
    const priv = innardsOf(m);
    const child = liveChild();
    child.stdin!.end();
    priv.runningChildren.set(SUB, child);
    priv.persistentChildReady.set(SUB, true);
    priv.persistentInFlightCmd.set(SUB, { cmd: { id: 'cmd-previous-turn' } });

    priv._executeViaLegacy(dispatchedCmd(), subStub(), 'C:\\tmp', '덧말 한마디', [], 0);

    expect(priv.persistentInFlightCmd.get(SUB)?.cmd.id).toBe('cmd-previous-turn');
  });

  it('창구가 열려 있으면 종전대로 재사용한다 — 가드가 정상 경로를 막지 않는다', () => {
    const m = new SubAgentManager();
    const priv = innardsOf(m);
    const child = liveChild();
    priv.runningChildren.set(SUB, child);
    priv.persistentChildReady.set(SUB, true);

    const cmd = dispatchedCmd();
    priv._executeViaLegacy(cmd, subStub(), 'C:\\tmp', '덧말 한마디', [], 0);

    expect(child.stdin!.writes).toHaveLength(1);
    const sent = JSON.parse(child.stdin!.writes[0] ?? '') as {
      type: string;
      message: { content: { text: string }[] };
    };
    expect(sent.type).toBe('user');
    expect(sent.message.content[0]?.text).toBe('덧말 한마디');
    // 재사용은 이 턴을 실제로 보냈다 — 큐로 되돌리지 않는다.
    expect(cmd.status).toBe('executing');
    expect(priv.persistentInFlightCmd.get(SUB)?.cmd.id).toBe(cmd.id);
  });
});

describe('sealHeldTurnNow — 붙들린 봉인은 죽이지 않고 확정한다', () => {
  it('붙든 봉인이 있으면 그 자리에서 seal 을 실행하고 true', () => {
    const m = new SubAgentManager();
    const priv = innardsOf(m);
    let sealed = 0;
    const timer = setTimeout(() => { sealed = -1; }, 60_000);
    timer.unref?.();
    priv.deferredSeals.set(SUB, { timer, seal: () => { sealed += 1; } });

    expect(m.sealHeldTurnNow(SUB)).toBe(true);
    expect(sealed).toBe(1);
    // 붙든 것을 넘겼으니 장부에서 내려가야 한다 — 남으면 만료 타이머가 한 번 더 봉인한다.
    expect(priv.deferredSeals.has(SUB)).toBe(false);
  });

  it('붙든 봉인이 없으면 false — 호출자가 종전 인터럽트 경로로 내려간다', () => {
    const m = new SubAgentManager();
    expect(m.sealHeldTurnNow(SUB)).toBe(false);
  });
});

describe('soft interrupt 폴백 — 봉인 유예보다 늦게 깨어나고, 응답한 세션은 죽이지 않는다', () => {
  it('봉인 유예가 지나는 순간에는 아직 깨어나지 않는다', () => {
    vi.useFakeTimers();
    try {
      const m = new SubAgentManager();
      const priv = innardsOf(m);
      const stopSpy = vi.spyOn(m, 'stop').mockReturnValue(false);
      priv.runningChildren.set(SUB, liveChild());
      priv.persistentInFlightCmd.set(SUB, { cmd: { id: 'cmd-running-turn' } });

      expect(m.softInterrupt(SUB)).toBe(true);

      // 두 창이 같은 값이면(종전 3,000ms/3,000ms) 바로 이 지점에서 경쟁이 나 응답한 세션이 죽었다.
      vi.advanceTimersByTime(TURN_RESUME_GRACE_MS);
      expect(stopSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('봉인이 붙들려 있으면 하드 킬 대신 그 봉인을 확정한다', () => {
    vi.useFakeTimers();
    try {
      const m = new SubAgentManager();
      const priv = innardsOf(m);
      const stopSpy = vi.spyOn(m, 'stop').mockReturnValue(false);
      priv.runningChildren.set(SUB, liveChild());
      priv.persistentInFlightCmd.set(SUB, { cmd: { id: 'cmd-running-turn' } });
      expect(m.softInterrupt(SUB)).toBe(true);

      // CLI 는 답을 냈고(= 인터럽트가 먹었다) 백단 여운 때문에 봉인만 붙들린 상태.
      let sealed = 0;
      const held = setTimeout(() => { sealed = -1; }, 600_000);
      priv.deferredSeals.set(SUB, { timer: held, seal: () => { sealed += 1; } });

      vi.advanceTimersByTime(TURN_RESUME_GRACE_MS + 5_000);
      expect(sealed).toBe(1);
      expect(stopSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('붙든 봉인도 없고 그 턴이 그대로면 종전 하드 킬로 폴백한다 — 안 멈추는 세션을 만들지 않는다', () => {
    vi.useFakeTimers();
    try {
      const m = new SubAgentManager();
      const priv = innardsOf(m);
      const stopSpy = vi.spyOn(m, 'stop').mockReturnValue(false);
      priv.runningChildren.set(SUB, liveChild());
      priv.persistentInFlightCmd.set(SUB, { cmd: { id: 'cmd-running-turn' } });
      expect(m.softInterrupt(SUB)).toBe(true);

      vi.advanceTimersByTime(TURN_RESUME_GRACE_MS + 5_000);
      expect(stopSpy).toHaveBeenCalledWith(SUB);
    } finally {
      vi.useRealTimers();
    }
  });
});

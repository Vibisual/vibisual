import { describe, it, expect } from 'vitest';
import { SubAgentManager } from './subAgentManager.js';

/**
 * §5.5 #17-18 · #17-9 ⑩ — **[즉시] 덧말은 프로세스를 죽이지 않는다.**
 *
 * 종전엔 도는 턴을 끊으려고 자식 트리를 SIGTERM 했는데, 그 트리 안에는 그 세션이 띄워 둔
 * 백그라운드 감시(`Monitor` · `Bash run_in_background`)도 들어 있어 **말 한마디 얹을 때마다
 * 감시가 함께 죽었다**. 그 사실은 통지로도 안 와서, 다음 명령에서 CLI 가
 * `No completion record was found …` 를 밀어 넣는 것으로만 드러났다.
 *
 * 여기서 고정하는 약속은 셋이다 —
 *   ① 끊을 턴이 있는 persistent 자식에게는 **stdin 으로 제어 메시지만** 보낸다(죽이지 않는다).
 *   ② 보낼 창구가 없으면(자식 없음) **false** 를 돌려 호출자가 종전 하드 킬로 내려가게 한다.
 *   ③ 턴 사이 idle(진행 중 명령 없음)에는 **아무것도 보내지 않는다** — 끊을 것이 없다.
 */

/** 테스트가 들여다보는 내부 두 칸만 구조적으로 드러낸다(전체 타입을 흉내 내지 않는다). */
type Innards = {
  runningChildren: Map<string, { stdin: FakeStdin | null }>;
  persistentInFlightCmd: Map<string, { cmd: { id: string } }>;
};

class FakeStdin {
  destroyed = false;
  writes: string[] = [];
  write(chunk: string, _encoding?: string): boolean {
    this.writes.push(chunk);
    return true;
  }
}

function innardsOf(m: SubAgentManager): Innards {
  return m as unknown as Innards;
}

const SUB = 'sub-soft-1';

describe('softInterrupt — 턴만 끊고 자식은 살린다', () => {
  it('persistent 자식 + 진행 중 턴이면 control_request 한 줄만 쓰고 true', () => {
    const m = new SubAgentManager();
    const stdin = new FakeStdin();
    const priv = innardsOf(m);
    priv.runningChildren.set(SUB, { stdin });
    priv.persistentInFlightCmd.set(SUB, { cmd: { id: 'cmd-1' } });

    expect(m.softInterrupt(SUB)).toBe(true);
    expect(stdin.writes).toHaveLength(1);

    const line = stdin.writes[0] ?? '';
    expect(line.endsWith('\n')).toBe(true);
    const sent = JSON.parse(line) as {
      type: string;
      request_id: string;
      request: { subtype: string };
    };
    expect(sent.type).toBe('control_request');
    expect(sent.request.subtype).toBe('interrupt');
    // request_id 는 CLI 응답을 짝지을 값 — 비어 있으면 안 된다.
    expect(sent.request_id.length).toBeGreaterThan(0);

    // 자식은 그대로 남아 있어야 한다 — 여기서 지워지면 감시도 함께 죽은 것과 같다.
    expect(priv.runningChildren.has(SUB)).toBe(true);
  });

  it('보낼 자식이 없으면 false — 호출자가 종전 하드 킬로 내려간다', () => {
    const m = new SubAgentManager();
    expect(m.softInterrupt(SUB)).toBe(false);
  });

  it('턴 사이 idle(진행 중 명령 없음)에는 아무것도 보내지 않는다', () => {
    const m = new SubAgentManager();
    const stdin = new FakeStdin();
    innardsOf(m).runningChildren.set(SUB, { stdin });

    expect(m.softInterrupt(SUB)).toBe(false);
    expect(stdin.writes).toHaveLength(0);
  });

  it('stdin 이 이미 닫힌 자식이면 false — 죽은 창구에 쓰지 않는다', () => {
    const m = new SubAgentManager();
    const stdin = new FakeStdin();
    stdin.destroyed = true;
    const priv = innardsOf(m);
    priv.runningChildren.set(SUB, { stdin });
    priv.persistentInFlightCmd.set(SUB, { cmd: { id: 'cmd-1' } });

    expect(m.softInterrupt(SUB)).toBe(false);
    expect(stdin.writes).toHaveLength(0);
  });

  it('요청 id 는 호출마다 달라진다 — 응답 짝짓기가 엉키지 않게', () => {
    const m = new SubAgentManager();
    const stdin = new FakeStdin();
    const priv = innardsOf(m);
    priv.runningChildren.set(SUB, { stdin });
    priv.persistentInFlightCmd.set(SUB, { cmd: { id: 'cmd-1' } });

    m.softInterrupt(SUB);
    m.softInterrupt(SUB);

    const ids = stdin.writes.map((l) => (JSON.parse(l) as { request_id: string }).request_id);
    expect(new Set(ids).size).toBe(2);
  });
});

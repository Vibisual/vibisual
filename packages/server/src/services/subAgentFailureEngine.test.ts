import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_AGENT_CONFIG, type AgentConfig, type QueuedCommand, type SubAgentStreamEvent } from '@vibisual/shared';

/**
 * §5.5 #17-12 ③-7 — **실패 사유는 자기 엔진의 이름과 함께 간다.**
 *
 * 사유 코드는 엔진 중립이다(`cli`·`spawn`·`exit` 은 클로드도 코덱스도 낸다). 그런데 화면 문장은
 * `Claude CLI` 를 글자로 박고 있어서, GPT 버블이 한도로 멈춘 자리에 **"Claude CLI 가 실패를
 * 알렸습니다"** 가 떴다(2026-09-22 사용자 보고). §5.25 (J) 에서 GPT 버블 아래에 `opus` 가 뜬 것과
 * 같은 부류 — **남의 이름**이다.
 *
 * 여기서 못박는 것은 둘이다:
 *  ① 사유에 `engine` 이 실리고 스트림 봉투가 `[code@engine]` 으로 나간다(모르면 비워 둔다).
 *  ② §2.4 한도 정지는 실패 경로로 들어와도 **`usageLimit` 이라는 제 이름**으로 불린다 —
 *     클로드는 exit 0 으로 끝나 `completed` 가 되는데(§5.5 #17-12 ③-6), 코덱스는 같은 사건을
 *     `{"type":"error"}` 로 신고해(§5.25 (F)) 실패로 들어오기 때문이다. 같은 사건이 엔진마다
 *     다른 말로 불리면 안 된다.
 */

const { SubAgentManager } = await import('./subAgentManager.js');

const PARENT = 'agent-failure-engine';
const LIMIT_TEXT = "You've hit your usage limit. Visit https://example.test/usage to purchase more credits.";
/** 코덱스 버블 한 개 — 엔진 판정이 읽는 것은 `kind` 뿐이지만 타입은 모델 id 까지 요구한다. */
const CODEX = { kind: 'codex-cli', modelId: 'gpt-5-codex' } as const;

let m: InstanceType<typeof SubAgentManager>;
let subId: string;
let emitted: SubAgentStreamEvent[];

const cmd = (id = 'cmd-1'): QueuedCommand => ({
  id, text: '일 시켜', timestamp: Date.now(), subAgentId: subId, status: 'executing',
});

/** 부모 에이전트의 프로바이더를 갈아 끼운다 — 엔진 판정의 **유일한** 근거(§5.25 (C)). */
const useProvider = (provider: AgentConfig['provider']): void => {
  m.setAgentConfigResolver(() => ({ ...DEFAULT_AGENT_CONFIG, ...(provider ? { provider } : {}) }));
};

beforeEach(() => {
  emitted = [];
  m = new SubAgentManager();
  m.setOnStreamEvent((e) => emitted.push(e));
  subId = m.create(PARENT).id;
});

describe('사유에 실리는 엔진', () => {
  it('코덱스 버블의 실패는 코덱스 이름을 달고 나간다', () => {
    useProvider(CODEX);
    const held = cmd();

    m.markCommandError(subId, held, { code: 'cli', detail: 'stream error: unexpected status 500' });

    expect(held.error).toEqual({
      code: 'cli', detail: 'stream error: unexpected status 500', engine: 'codex',
    });
    const line = emitted.find((e) => e.eventType === 'error');
    expect(line?.content).toContain('[cli@codex]');
  });

  it('설정이 없으면 클로드다 — 훅 버블처럼 실제로 Claude Code 세션인 자리', () => {
    const held = cmd();

    m.markCommandError(subId, held, { code: 'cli', detail: 'boom' });

    expect(held.error).toEqual({ code: 'cli', detail: 'boom', engine: 'claude' });
  });

  it('종료 코드가 있으면 `[code:exit@engine]` 으로 나간다', () => {
    useProvider(CODEX);
    const held = cmd();

    m.markCommandError(subId, held, { code: 'exit', exitCode: 137, detail: 'killed' });

    expect(held.error).toEqual({ code: 'exit', exitCode: 137, detail: 'killed', engine: 'codex' });
    expect(emitted.find((e) => e.eventType === 'error')?.content).toContain('[exit:137@codex]');
  });

  it('세션이 사라진 자리는 엔진을 비워 둔다 — 클로드로 단정하지 않는다', () => {
    // 부팅 reconcile 의 `[orphaned]` 처럼 물어볼 세션이 없는 자리. 화면은 이름 없이 `CLI` 라고만 말한다.
    const held: QueuedCommand = { id: 'cmd-gone', text: '끊긴 명령', timestamp: Date.now(), subAgentId: 'sub-gone', status: 'executing' };

    m.markCommandError('sub-gone', held, { code: 'orphaned' });

    expect(held.error).toEqual({ code: 'orphaned' });
    expect(held.error?.engine).toBeUndefined();
  });
});

describe('§2.4 — 한도 정지는 실패가 아니라 한도로 불린다', () => {
  it('턴에 한도 표식이 서 있으면 사유를 `usageLimit` 으로 적는다', () => {
    useProvider(CODEX);
    const sub = m.getSub(subId)!;
    sub.usageLimit = { kind: 'usage', at: Date.now(), message: LIMIT_TEXT };
    const held = cmd();

    m.markCommandError(subId, held, { code: 'cli', detail: LIMIT_TEXT });

    expect(held.error?.code).toBe('usageLimit');
    expect(held.error?.engine).toBe('codex');
    expect(emitted.find((e) => e.eventType === 'error')?.content).toContain('[usageLimit@codex]');
  });

  it('표식이 없어도 원문 자체가 한도 통지면 한도로 읽는다', () => {
    useProvider(CODEX);
    const held = cmd();

    m.markCommandError(subId, held, { code: 'cli', detail: LIMIT_TEXT });

    expect(held.error?.code).toBe('usageLimit');
  });

  it('한도를 **인용한 긴 글**은 한도가 아니다 — 멀쩡히 끝난 턴이 주황으로 물들지 않게', () => {
    useProvider(CODEX);
    const held = cmd();
    const quoted = `${LIMIT_TEXT} ${'그 문장을 인용해 설명하는 긴 글이 이어진다. '.repeat(12)}`;

    m.markCommandError(subId, held, { code: 'cli', detail: quoted });

    expect(held.error?.code).toBe('cli');
  });

  it('원인이 이미 분명한 사유는 한도로 고쳐 적지 않는다', () => {
    useProvider(CODEX);
    const sub = m.getSub(subId)!;
    sub.usageLimit = { kind: 'usage', at: Date.now(), message: LIMIT_TEXT };

    // 스폰 실패·턴 상한·프로세스 사망은 그쪽 이름이 더 정확하다.
    for (const code of ['spawn', 'stdin', 'crash', 'maxTurns', 'dispatchResult'] as const) {
      const held = cmd(`cmd-${code}`);
      m.markCommandError(subId, held, { code, detail: LIMIT_TEXT });
      expect(held.error?.code, `${code} 가 한도로 바뀌었다`).toBe(code);
    }
  });

  it('상태는 한 글자도 바뀌지 않는다 — 바뀌는 것은 사유 낱말뿐이다(③-1 표시 계층 한정)', () => {
    useProvider(CODEX);
    const held = cmd();

    m.markCommandError(subId, held, { code: 'cli', detail: LIMIT_TEXT });

    // `markCommandError` 는 사유만 적는다 — 명령·세션의 상태는 부르는 쪽이 정한다.
    expect(held.status).toBe('executing');
    expect(held.error?.detail).toBe(LIMIT_TEXT);
  });
});

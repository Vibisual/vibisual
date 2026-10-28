import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_AGENT_CONFIG, type AgentConfig, type QueuedCommand, type SubAgentStreamEvent } from '@vibisual/shared';

/** §5.5 #17-12 ③-7 — 실패 사유가 자기 엔진 이름을 단다(`[code@engine]`, 모르면 비움). 코덱스 한도 `{"type":"error"}` 도 `usageLimit` 으로 불린다(§5.25 (F)). */

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

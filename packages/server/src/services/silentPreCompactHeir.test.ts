import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_AGENT_CONFIG } from '@vibisual/shared';
import type { AgentConfig, QueuedCommand, SubAgent } from '@vibisual/shared';
import { SubAgentManager } from './subAgentManager.js';

/**
 * §5.3 #9-1 (P)(b) — 압축을 물려받은 명령은 실행 중 명령과 구별되지 않아야 한다(화면은 클라 `sessionRunTruth.test.ts`).
 * 서버 몫: `sub.lastCommand`·자동 제목이 `/compact` 가 아니라 그 명령 · 압축 중 [중지]면 그 명령이 중지됨으로 남는다.
 */

type Innards = {
  index: Map<string, SubAgent>;
  executeLocalProvider: (...args: unknown[]) => void;
};

/** 로컬 갈림에서 멈추는 매니저 — 보는 것은 갈림 **앞**에서 세션 칸에 적히는 것뿐이다(자식을 띄우지 않는다). */
function managerWith(sub: SubAgent): SubAgentManager {
  const m = new SubAgentManager();
  const priv = m as unknown as Innards;
  priv.index.set(sub.id, sub);
  priv.executeLocalProvider = () => {};
  return m;
}

const LOCAL = { ...DEFAULT_AGENT_CONFIG, provider: { kind: 'local-llama' } } as unknown as AgentConfig;

function session(label: string): SubAgent {
  return {
    id: 'sub-1', parentAgentId: 'agent-1', sessionId: '', label, status: 'idle', createdAt: 0, lastActivityAt: 0,
  } as SubAgent;
}

function command(over: Partial<QueuedCommand> & { id: string; text: string }): QueuedCommand {
  return { timestamp: 1, subAgentId: 'sub-1', status: 'queued', ...over } as QueuedCommand;
}

const silentCompact = (): QueuedCommand =>
  command({ id: 'cmd-precompact', text: '/compact', dispatchMode: 'wait', silent: true });

describe('① "마지막 명령"은 압축이 아니라 사용자가 넣은 명령이다', () => {
  it('조용한 압축의 실행은 마지막 명령도 탭 제목도 건드리지 않는다', () => {
    const sub = session('Sub #3');
    const m = managerWith(sub);
    m.execute(silentCompact(), 'C:/tmp', '', LOCAL);
    expect(sub.lastCommand).toBeUndefined();
    // 기본 라벨이던 탭이 "/compact" 라는 이름을 얻지 않는다.
    expect(sub.label).toBe('Sub #3');
    // 실행 자체는 평소 명령과 같은 길이다 — 세션은 도는 중이고 활동 시각도 찍힌다(생존 판정 유지).
    expect(sub.status).toBe('active');
    expect(sub.lastActivityAt).toBeGreaterThan(0);
  });

  it('끼우는 순간 적어 둔 명령의 글이 압축이 도는 내내 남는다', () => {
    const sub = session('Sub #1');
    const m = managerWith(sub);
    m.noteLastCommand('sub-1', '로그인 버그 고쳐줘');
    m.execute(silentCompact(), 'C:/tmp', '', LOCAL);
    expect(sub.lastCommand).toBe('로그인 버그 고쳐줘');
    // 기본 라벨이면 평소 실행과 똑같이 그 명령으로 제목이 붙는다.
    expect(sub.label).toBe('로그인 버그 고쳐줘');
  });

  it('평소 명령은 종전대로 자기 글을 적는다', () => {
    const sub = session('Sub #1');
    const m = managerWith(sub);
    m.execute(command({ id: 'cmd-1', text: '테스트 돌려줘' }), 'C:/tmp', '', LOCAL);
    expect(sub.lastCommand).toBe('테스트 돌려줘');
    expect(sub.label).toBe('테스트 돌려줘');
  });

  it('사용자가 붙인 이름은 덮지 않는다', () => {
    const sub = session('내 탭');
    const m = managerWith(sub);
    m.noteLastCommand('sub-1', '다른 일');
    expect(sub.lastCommand).toBe('다른 일');
    expect(sub.label).toBe('내 탭');
  });

  it('없는 세션이면 조용히 지나간다', () => {
    const m = managerWith(session('Sub #1'));
    expect(() => m.noteLastCommand('sub-missing', '무엇')).not.toThrow();
  });
});

/** 끼우는 자리·두 [중지]는 `index.ts` 클로저 안이라 배선을 소스로 고정한다(규칙 값은 `silentPreCompact.test.ts`). */
describe('배선 — 서버가 물려받은 명령을 두 자리에서 다룬다', () => {
  // 줄끝은 체크아웃마다 다를 수 있다(CRLF/LF) — 여러 줄 모양을 재기 전에 하나로 맞춘다.
  const src = readFileSync(new URL('../index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it('압축을 끼우는 순간 뒤에 선 명령의 글을 마지막 명령으로 적는다', () => {
    const start = src.indexOf('function injectSilentPreCompact(');
    const end = src.indexOf('function scheduleSessionLoop(');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toMatch(/const heir = queue\[slot\.index \+ 1\];/);
    expect(body).toMatch(/if \(heir && heir\.id === slot\.beforeCommandId\) subAgentManager\.noteLastCommand\(slot\.subAgentId, heir\.text\);/);
  });

  it('두 [중지]가 모두 물려받은 명령을 버리지 않고 봉합한다 — 같은 규칙으로 가려낸다', () => {
    expect(src.match(/const heirs = silentPreCompactHeirs\(queueBeforeStop\);/g)).toHaveLength(2);
    expect(src.match(/if \(heirs\.has\(c\)\) sealed\.push\(sealStoppedHeir\(c, heirs\.get\(c\)\)\);/g)).toHaveLength(2);
    // 봉합한 명령은 큐에서 빠진 그 자리에서 아카이브로 간다 — 대화에 "중지됨"으로 남는다.
    expect(src.match(/archiveCompletedCommands\(sessionId, sealed\);\n\s*\}\n\n\s*const stopped = subAgentManager\.stop(All)?\(/g)).toHaveLength(2);
  });

  it('봉합은 실행 중에 멈춘 명령과 같은 모양이고, 자리는 실행 중으로 그려지던 그 시각이다', () => {
    const start = src.indexOf('function sealStoppedHeir(');
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    expect(body).toMatch(/c\.status = 'completed';/);
    expect(body).toMatch(/c\.result = '\[Stopped by user\]';/);
    expect(body).toMatch(/c\.stopReason = 'cancelled';/);
    expect(body).toMatch(/if \(c\.startedAt === undefined && silentStartedAt !== undefined\) c\.startedAt = silentStartedAt;/);
  });

  /* [즉시] 덧말도 실행 중으로 보이던 명령을 끊는다 — 압축만 끊으면 그 명령이 그대로 나간다. */
  it('[즉시] 덧말은 끊기 전에 물려받은 명령을 중지됨으로 봉합한다 — 두 입구 모두 세션 큐를 넘긴다', () => {
    const start = src.indexOf('function interruptForImmediateCommand(');
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    const seal = body.indexOf('sealHeirCutByImmediate(cmd, sessionId);');
    expect(seal).toBeGreaterThan(0);
    // 처리 중인 턴이 있을 때만(끊을 것이 있을 때만) 봉합하고, 세 갈래 끊기보다 **먼저** 한다 —
    //   끊긴 압축의 마감이 곧바로 다음 차례를 집으므로 뒤에 두면 그 명령이 이미 나가 있다.
    expect(body.indexOf('isSubProcessingCommand(subId)')).toBeLessThan(seal);
    for (const cut of ['sealHeldTurnNow(subId)', 'softInterrupt(subId)', 'subAgentManager.stop(subId)']) {
      expect(body.indexOf(cut)).toBeGreaterThan(seal);
    }
    expect(src.match(/interruptForImmediateCommand\(cmd, sessionId\)/g)).toHaveLength(2);
  });

  it('즉시가 끊은 명령은 두 [중지]와 같은 규칙으로 고르고 같은 모양으로 봉합해 대화에 남긴다', () => {
    const start = src.indexOf('function sealHeirCutByImmediate(');
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    expect(body).toMatch(/const cut = heirCutByImmediate\(queue, cmd\);/);
    expect(body).toMatch(/queue\.splice\(idx, 1\);/);
    expect(body).toMatch(/neverStarted: true/);
    expect(body).toMatch(/archiveCompletedCommands\(sessionId, \[sealStoppedHeir\(cut\.heir, cut\.startedAt\)\]\);/);
  });
});

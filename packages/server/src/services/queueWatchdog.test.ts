import { describe, expect, it } from 'vitest';
import type { QueuedCommand } from '@vibisual/shared';
import { sessionsNeedingKick } from './queueWatchdog.js';

/** §5.5 #17-18 ⑪ — 줄만 서고 안 나가는 명령(`executing` 잠금을 쥔 턴이 완료 콜백 없이 사라진 경우)을 워치독이 다시 민다. */
function cmd(patch: Partial<QueuedCommand>): QueuedCommand {
  return { id: 'c1', text: 'hi', timestamp: 0, subAgentId: 'sub-A', status: 'queued', ...patch };
}

function queues(map: Record<string, QueuedCommand[]>): Map<string, QueuedCommand[]> {
  return new Map(Object.entries(map));
}

describe('sessionsNeedingKick', () => {
  it('좀비가 걷힌 뒤 홀로 남은 대기를 집어낸다 — 사고 그 자체', () => {
    expect(sessionsNeedingKick(queues({ s1: [cmd({ id: 'q' })] }))).toEqual(['s1']);
  });

  it('같은 슬롯이 진짜로 돌고 있으면 건드리지 않는다 — 끝나면 완료 콜백이 민다', () => {
    const q = [cmd({ id: 'e', status: 'executing' }), cmd({ id: 'q' })];
    expect(sessionsNeedingKick(queues({ s1: q }))).toEqual([]);
  });

  it('다른 슬롯이 도는 것은 이 덧말을 막지 못한다 — 자물쇠는 슬롯마다 따로다', () => {
    const q = [cmd({ id: 'e', status: 'executing', subAgentId: 'sub-A' }), cmd({ id: 'q', subAgentId: 'sub-B' })];
    expect(sessionsNeedingKick(queues({ s1: q }))).toEqual(['s1']);
  });

  it('주인 없는 명령(null)도 자기 슬롯을 가진다', () => {
    const blocked = [cmd({ id: 'e', status: 'executing', subAgentId: null }), cmd({ id: 'q', subAgentId: null })];
    expect(sessionsNeedingKick(queues({ s1: blocked }))).toEqual([]);
    const free = [cmd({ id: 'e', status: 'executing', subAgentId: 'sub-A' }), cmd({ id: 'q', subAgentId: null })];
    expect(sessionsNeedingKick(queues({ s1: free }))).toEqual(['s1']);
  });

  it('끝난 명령만 남은 큐는 밀지 않는다 — 아카이브 전 잔여가 매 5초 헛 스폰을 부르면 안 된다', () => {
    const q = [cmd({ id: 'c', status: 'completed' }), cmd({ id: 'x', status: 'error' })];
    expect(sessionsNeedingKick(queues({ s1: q }))).toEqual([]);
    expect(sessionsNeedingKick(queues({ s1: [] }))).toEqual([]);
    expect(sessionsNeedingKick(new Map())).toEqual([]);
  });

  it('여러 세션을 한 바퀴에 본다 — 막힌 세션 하나가 나머지를 가리지 않는다', () => {
    const got = sessionsNeedingKick(queues({
      busy: [cmd({ id: 'e', status: 'executing' })],
      stuck1: [cmd({ id: 'q' })],
      done: [cmd({ id: 'c', status: 'completed' })],
      stuck2: [cmd({ id: 'q2', subAgentId: 'sub-Z' })],
    }));
    expect(got.sort()).toEqual(['stuck1', 'stuck2']);
  });

  it('부작용이 없다 — 같은 큐를 두 번 물어도 같은 답이고 큐는 그대로다', () => {
    const q = [cmd({ id: 'q' })];
    const m = queues({ s1: q });
    expect(sessionsNeedingKick(m)).toEqual(sessionsNeedingKick(m));
    expect(q).toHaveLength(1);
    expect(q[0]?.status).toBe('queued');
  });
});

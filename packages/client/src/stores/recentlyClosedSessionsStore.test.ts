/** §5.5 #17-52 — 방금 닫은 세션을 앞에 세우고, 본 뒤에는 서버 순서로 돌아간다. */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addRecentlyClosed,
  orderRecentlyClosedFirst,
  selectRecentlyClosed,
  useRecentlyClosedSessionsStore,
} from './recentlyClosedSessionsStore.js';

const item = (subAgentId: string) => ({ subAgentId });
const ids = (list: readonly { subAgentId: string }[]) => list.map((it) => it.subAgentId);

describe('orderRecentlyClosedFirst', () => {
  const server = [item('a'), item('b'), item('c'), item('d')];

  it('방금 닫은 것이 없으면 받은 순서 그대로다', () => {
    expect(ids(orderRecentlyClosedFirst(server, []))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('방금 닫은 것을 닫은 역순으로 앞에 세우고 나머지는 순서를 지킨다', () => {
    expect(ids(orderRecentlyClosedFirst(server, ['d', 'b']))).toEqual(['d', 'b', 'a', 'c']);
  });

  it('목록에 없는 id 는 줄을 만들지 않는다', () => {
    expect(ids(orderRecentlyClosedFirst(server, ['zz', 'c']))).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('addRecentlyClosed', () => {
  it('다시 닫으면 앞으로 옮기고 겹치지 않는다', () => {
    expect(addRecentlyClosed(['a', 'b'], 'b')).toEqual(['b', 'a']);
  });

  it('상한을 넘으면 오래 닫은 것부터 버린다', () => {
    expect(addRecentlyClosed(['b', 'a'], 'c', 2)).toEqual(['c', 'b']);
  });
});

describe('useRecentlyClosedSessionsStore', () => {
  beforeEach(() => useRecentlyClosedSessionsStore.setState({ byAgent: {} }));
  const read = (agentId: string) => selectRecentlyClosed(agentId)(useRecentlyClosedSessionsStore.getState());

  it('부모 에이전트별로 따로 적는다', () => {
    const { noteClosed } = useRecentlyClosedSessionsStore.getState();
    noteClosed('A', 's1');
    noteClosed('A', 's2');
    noteClosed('B', 's3');
    expect(read('A')).toEqual(['s2', 's1']);
    expect(read('B')).toEqual(['s3']);
  });

  it('본 것만 풀고, 보지 못한 것은 남긴다', () => {
    const { noteClosed, forget } = useRecentlyClosedSessionsStore.getState();
    noteClosed('A', 's1');
    noteClosed('A', 's2');
    forget('A', ['s1']);
    expect(read('A')).toEqual(['s2']);
    forget('A', ['s2']);
    expect(useRecentlyClosedSessionsStore.getState().byAgent).toEqual({});
  });

  it('없는 것을 풀면 상태 참조가 바뀌지 않는다', () => {
    useRecentlyClosedSessionsStore.getState().noteClosed('A', 's1');
    const before = useRecentlyClosedSessionsStore.getState();
    before.forget('A', ['nope']);
    expect(useRecentlyClosedSessionsStore.getState()).toBe(before);
  });
});

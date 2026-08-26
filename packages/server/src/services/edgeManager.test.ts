import { describe, it, expect } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { EdgeManager } from './edgeManager.js';

function bubble(id: string): BubbleData {
  return { id, label: id, bubbleType: 'file', path: id, status: 'active', activity: 1 };
}

const GROUP = 'g1';
const agent = bubble('agent-1');
const file = bubble('file-1');

/** 이 쌍에 남아 있는 엣지들 (방향 판별용). */
function pairEdges(em: EdgeManager): { id: string; source: string; target: string; label?: string }[] {
  return em.getAll().map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label }));
}

describe('EdgeManager — 한 쌍에 방향은 하나', () => {
  it('쓰기 뒤 읽기가 오면 쓰기 엣지는 남지 않는다', () => {
    const em = new EdgeManager();
    em.upsert(GROUP, agent, file, 'Edit', 'agent-1');
    expect(pairEdges(em)).toHaveLength(1);

    em.upsert(GROUP, agent, file, 'Read', 'agent-1');
    const edges = pairEdges(em);
    expect(edges).toHaveLength(1);
    // 읽기는 파일 → 에이전트 (데이터가 올라옴)
    expect(edges[0]).toMatchObject({ source: 'file-1', target: 'agent-1', label: 'Read' });
  });

  it('읽기 뒤 쓰기가 오면 읽기 엣지는 남지 않는다', () => {
    const em = new EdgeManager();
    em.upsert(GROUP, agent, file, 'Read', 'agent-1');
    em.upsert(GROUP, agent, file, 'Edit', 'agent-1');
    const edges = pairEdges(em);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'agent-1', target: 'file-1', label: 'Edit' });
  });

  it('Grep/Glob 도 읽기 방향이다', () => {
    const em = new EdgeManager();
    em.upsert(GROUP, agent, file, 'Write', 'agent-1');
    em.upsert(GROUP, agent, file, 'Grep', 'agent-1');
    expect(pairEdges(em)[0]).toMatchObject({ source: 'file-1', target: 'agent-1' });
  });

  it('다른 에이전트가 아직 그 방향을 쓰고 있으면 지우지 않는다', () => {
    const em = new EdgeManager();
    em.upsert(GROUP, agent, file, 'Edit', 'agent-A');
    em.upsert(GROUP, agent, file, 'Edit', 'agent-B');

    // A 가 읽기로 돌아서도 B 의 쓰기 ref 가 남아 있으므로 두 방향이 공존한다.
    em.upsert(GROUP, agent, file, 'Read', 'agent-A');
    expect(pairEdges(em)).toHaveLength(2);

    // B 까지 읽기로 돌아서면 쓰기 방향은 사라진다.
    em.upsert(GROUP, agent, file, 'Read', 'agent-B');
    const edges = pairEdges(em);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'file-1', target: 'agent-1' });
  });

  it('agentId 없이 뒤집혀도 ref 가 없으면 반대 방향을 정리한다', () => {
    const em = new EdgeManager();
    em.upsert(GROUP, agent, file, 'Edit');
    em.upsert(GROUP, agent, file, 'Read');
    expect(pairEdges(em)).toHaveLength(1);
  });

  it('지운 엣지는 그룹 조회에서도 사라진다 (장부 3곳 동시 정리)', () => {
    const em = new EdgeManager();
    em.upsert(GROUP, agent, file, 'Edit', 'agent-1');
    em.upsert(GROUP, agent, file, 'Read', 'agent-1');
    expect(em.getByGroup(GROUP)).toHaveLength(1);
  });
});

describe('EdgeManager.pruneOppositePairs — 옛 체크포인트의 양방향 잔여쌍 정리', () => {
  /** 이 규칙이 생기기 전 포맷: 같은 쌍에 read·write 가 둘 다 들어 있는 스냅샷. */
  function legacySnapshot(opts: {
    readActive: boolean; writeActive: boolean; readAt: number; writeAt: number;
  }) {
    const readId = `${GROUP}-agent-1-file-1-read`;
    const writeId = `${GROUP}-agent-1-file-1-write`;
    return {
      edges: {
        [readId]: {
          id: readId, source: 'file-1', target: 'agent-1',
          label: 'Read', timestamp: opts.readAt, isActive: opts.readActive,
        },
        [writeId]: {
          id: writeId, source: 'agent-1', target: 'file-1',
          label: 'Edit', timestamp: opts.writeAt, isActive: opts.writeActive,
        },
      },
      groups: { [readId]: GROUP, [writeId]: GROUP },
      refs: {},
    };
  }

  it('복원 시 활성 쪽만 남긴다', () => {
    const em = new EdgeManager();
    em.restoreFromSnapshot(
      legacySnapshot({ readActive: false, writeActive: true, readAt: 300, writeAt: 100 }),
    );
    const edges = pairEdges(em);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.label).toBe('Edit');
  });

  it('둘 다 idle 이면 최신 timestamp 를 남긴다', () => {
    const em = new EdgeManager();
    em.restoreFromSnapshot(
      legacySnapshot({ readActive: false, writeActive: false, readAt: 500, writeAt: 100 }),
    );
    const edges = pairEdges(em);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.label).toBe('Read');
  });

  it('병합 복원에도 같은 규칙이 걸린다', () => {
    const em = new EdgeManager();
    em.mergeFromSnapshot(
      legacySnapshot({ readActive: true, writeActive: false, readAt: 100, writeAt: 900 }),
    );
    expect(pairEdges(em)).toHaveLength(1);
    expect(pairEdges(em)[0]!.label).toBe('Read');
  });

  it('한 방향만 있는 쌍은 건드리지 않는다', () => {
    const em = new EdgeManager();
    em.upsert(GROUP, agent, file, 'Edit', 'agent-1');
    expect(em.pruneOppositePairs()).toBe(0);
    expect(pairEdges(em)).toHaveLength(1);
  });
});

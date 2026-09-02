import { describe, it, expect } from 'vitest';
import { EdgeManager } from './edgeManager.js';
import type { BubbleData } from '@vibisual/shared';

/**
 * §9 — `getByGroup` 역색인과 ref 장부 정리의 회귀 고정.
 *
 * **왜 있는가.** `getSnapshot()` 은 폴더(부모)마다 `getByGroup` 을 한 번씩 부른다. 종전 구현은
 * 그때마다 엣지 **전부**를 훑어서, 실제 사용자 체크포인트(내부 엣지 2,426개 · 폴더 456개) 기준
 * 스냅샷 1건에 110만 6천 번을 돌았다 — 실측 **11.8ms**, Electron 메인 스레드라 그대로 프레임 하나다.
 *
 * 색인은 **무효화식**이라 엣지를 건드리는 자리 중 한 곳만 빠뜨려도 화살표가 조용히 사라진다.
 * 그래서 여기서 검사하는 것은 속도가 아니라 **모든 변경 경로가 색인을 갱신하는가** 다.
 */

function node(id: string): BubbleData {
  return { id, label: id, bubbleType: 'file', path: `/${id}`, status: 'idle', activity: 0 } as BubbleData;
}

describe('EdgeManager 그룹 역색인', () => {
  it('upsert 로 넣은 엣지가 즉시 그 그룹에서 보인다', () => {
    const m = new EdgeManager();
    m.upsert('g1', node('a'), node('b'), 'Read', 'agent-1');
    expect(m.getByGroup('g1').map((e) => e.id)).toHaveLength(1);
    expect(m.getByGroup('g2')).toHaveLength(0);
  });

  it('색인을 만든 **뒤에** 넣은 엣지도 보인다(무효화 누락 검출)', () => {
    const m = new EdgeManager();
    m.upsert('g1', node('a'), node('b'), 'Read', 'agent-1');
    expect(m.getByGroup('g1')).toHaveLength(1); // 여기서 색인이 만들어진다
    m.upsert('g1', node('c'), node('d'), 'Read', 'agent-1');
    expect(m.getByGroup('g1')).toHaveLength(2);
  });

  it('방향이 뒤집혀 반대 엣지가 지워지면 색인에서도 사라진다', () => {
    const m = new EdgeManager();
    m.upsert('g1', node('a'), node('b'), 'Read', 'agent-1');
    expect(m.getByGroup('g1')).toHaveLength(1);
    // 같은 쌍을 쓰기로 다시 만지면 읽기 엣지는 삭제되고 쓰기 하나만 남는다(§2.1 #3).
    m.upsert('g1', node('a'), node('b'), 'Write', 'agent-1');
    const after = m.getByGroup('g1');
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toContain('-write');
  });

  it('removeByPredicate 로 지운 엣지가 색인에서도 사라진다', () => {
    const m = new EdgeManager();
    m.upsert('g1', node('a'), node('b'), 'Read', 'agent-1');
    m.upsert('g1', node('c'), node('d'), 'Read', 'agent-1');
    expect(m.getByGroup('g1')).toHaveLength(2);
    m.removeByPredicate((e) => e.id.includes('-c-'));
    expect(m.getByGroup('g1')).toHaveLength(1);
  });

  it('스냅샷 복원 뒤에도 색인이 새 내용을 가리킨다', () => {
    const src = new EdgeManager();
    src.upsert('g1', node('a'), node('b'), 'Read', 'agent-1');
    src.upsert('g2', node('c'), node('d'), 'Read', 'agent-1');
    const snap = src.toSnapshot();

    const m = new EdgeManager();
    m.upsert('gOld', node('x'), node('y'), 'Read', 'agent-9');
    expect(m.getByGroup('gOld')).toHaveLength(1); // 색인을 미리 만들어 둔다
    m.restoreFromSnapshot(snap);
    expect(m.getByGroup('gOld')).toHaveLength(0);
    expect(m.getByGroup('g1')).toHaveLength(1);
    expect(m.getByGroup('g2')).toHaveLength(1);
  });

  it('id 재해싱(remapIds) 뒤에도 색인이 새 그룹 키를 가리킨다', () => {
    const m = new EdgeManager();
    m.upsert('oldGroup', node('a'), node('b'), 'Read', 'agent-1');
    expect(m.getByGroup('oldGroup')).toHaveLength(1);
    m.remapIds(new Map([['oldGroup', 'newGroup']]));
    expect(m.getByGroup('oldGroup')).toHaveLength(0);
    expect(m.getByGroup('newGroup')).toHaveLength(1);
  });

  it('없는 그룹은 항상 같은 빈 배열을 준다(호출마다 새 배열 ❌)', () => {
    const m = new EdgeManager();
    m.upsert('g1', node('a'), node('b'), 'Read', 'agent-1');
    expect(m.getByGroup('없음')).toBe(m.getByGroup('다른것'));
  });

  it('전체 엣지 수는 색인과 어긋나지 않는다', () => {
    const m = new EdgeManager();
    for (let i = 0; i < 20; i++) m.upsert(`g${i % 4}`, node(`a${i}`), node(`b${i}`), 'Read', 'agent-1');
    const viaIndex = [0, 1, 2, 3].reduce((n, g) => n + m.getByGroup(`g${g}`).length, 0);
    expect(viaIndex).toBe(m.getAll().length);
  });
});

describe('EdgeManager ref 장부 정리', () => {
  it('유휴로 내려간 엣지의 빈 ref 항목은 장부에 남지 않는다', () => {
    const m = new EdgeManager();
    m.upsert('g1', node('a'), node('b'), 'Read', 'agent-1');
    m.upsert('g1', node('c'), node('d'), 'Read', 'agent-1');
    expect(Object.keys(m.toSnapshot().refs)).toHaveLength(2);

    m.removeAgentRefs('agent-1');

    // 엣지는 그대로 남고(버블과 운명 공동체) ref 껍데기만 사라진다.
    expect(m.getAll()).toHaveLength(2);
    expect(m.getAll().every((e) => e.isActive === false)).toBe(true);
    expect(Object.keys(m.toSnapshot().refs)).toHaveLength(0);
  });

  it('다른 에이전트의 ref 가 남아 있으면 그 항목은 유지된다', () => {
    const m = new EdgeManager();
    m.upsert('g1', node('a'), node('b'), 'Read', 'agent-1');
    m.upsert('g1', node('a'), node('b'), 'Read', 'agent-2');

    m.removeAgentRefs('agent-1', new Set(['agent-2']));

    const refs = m.toSnapshot().refs;
    expect(Object.keys(refs)).toHaveLength(1);
    expect(Object.values(refs)[0]).toEqual(['agent-2']);
    expect(m.getAll()[0]!.isActive).toBe(true);
  });

  it('옛 체크포인트에 쌓여 있던 빈 ref 는 복원할 때 걷어낸다', () => {
    const seed = new EdgeManager();
    seed.upsert('g1', node('a'), node('b'), 'Read', 'agent-1');
    const snap = seed.toSnapshot();
    // 사용자 디스크에 실제로 쌓여 있던 모양 — 엣지는 없고 빈 ref 만 2,000개.
    for (let i = 0; i < 2000; i++) snap.refs[`유령-${i}`] = [];

    const m = new EdgeManager();
    m.restoreFromSnapshot(snap);

    expect(Object.keys(m.toSnapshot().refs)).toHaveLength(1);
  });
});

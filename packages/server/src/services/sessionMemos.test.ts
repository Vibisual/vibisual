import { describe, it, expect, beforeEach } from 'vitest';
import { SESSION_MEMO, SESSION_MEMO_DEFAULT_COLOR, sanitizeSessionMemo, sanitizeSessionMemos, type SessionMemo } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';
import { subAgentManager } from './subAgentManager.js';

/**
 * §5.5 #17-36 — 스티키 메모의 **소유·정화·영속 왕복** 회귀 테스트.
 *
 * 이 파일이 지키는 문장은 둘이다.
 *  ① **메모는 그것을 만든 세션의 소지품이다** — 세션이 사라지면 함께 사라진다. 그래서 자리를
 *    `SubAgent.memos` 안에 두었고, 그 사실이 깨지면(별도 맵으로 옮기면) 지우는 것을 잊는 자리가 생긴다.
 *  ② **껐다 켜도 남는다** — 사람이 손으로 쓴 글이라 코드에서 되살릴 길이 없다. 영속은 선언·스냅샷·
 *    체크포인트·복원·병합 다섯 지점을 다 손대야 하는데, 앞의 둘만 채우면 "화면엔 보이는데 껐다 켜면
 *    사라진다" — 조용해서 눈으로는 거의 못 잡는 실패다.
 */

const PROJECT_CWD = '/tmp/memo-project';

function memo(over: Partial<SessionMemo> = {}): SessionMemo {
  return {
    id: 'memo-a1',
    text: '빌드 깨지면 여기부터',
    x: 40,
    y: 60,
    w: SESSION_MEMO.DEFAULT_W,
    h: SESSION_MEMO.DEFAULT_H,
    color: SESSION_MEMO_DEFAULT_COLOR,
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

describe('sanitizeSessionMemo — 밖에서 온 값을 그대로 믿지 않는다', () => {
  it('정상 메모는 그대로 통과한다', () => {
    expect(sanitizeSessionMemo(memo())).toEqual(memo());
  });

  it('객체가 아니거나 id 가 없으면 버린다', () => {
    expect(sanitizeSessionMemo(null)).toBeNull();
    expect(sanitizeSessionMemo('memo')).toBeNull();
    expect(sanitizeSessionMemo({ ...memo(), id: '' })).toBeNull();
    expect(sanitizeSessionMemo({ ...memo(), id: 'has space' })).toBeNull();
  });

  it('색은 #RRGGBB 만 — 임의 문자열이 style 로 새지 않는다', () => {
    expect(sanitizeSessionMemo({ ...memo(), color: 'red; background:url(x)' })?.color).toBe(SESSION_MEMO_DEFAULT_COLOR);
    expect(sanitizeSessionMemo({ ...memo(), color: '#123ABC' })?.color).toBe('#123ABC');
  });

  it('좌표·크기는 상한 안으로 접는다(화면 밖 실종·거대 메모 차단)', () => {
    const out = sanitizeSessionMemo({ ...memo(), x: -99, y: 9e9, w: 99999, h: 0 })!;
    expect(out.x).toBe(0);
    expect(out.y).toBe(SESSION_MEMO.MAX_COORD);
    expect(out.w).toBe(SESSION_MEMO.MAX_W);
    expect(out.h).toBe(SESSION_MEMO.MIN_H);
  });

  it('본문은 상한에서 잘린다(§3.2.3 — 값 길이에도 상한)', () => {
    const out = sanitizeSessionMemo({ ...memo(), text: 'x'.repeat(SESSION_MEMO.TEXT_MAX + 500) })!;
    expect(out.text).toHaveLength(SESSION_MEMO.TEXT_MAX);
  });

  it('collapsed 는 true 일 때만 남는다(저장 비교가 흔들리지 않게)', () => {
    expect('collapsed' in sanitizeSessionMemo({ ...memo(), collapsed: false })!).toBe(false);
    expect(sanitizeSessionMemo({ ...memo(), collapsed: true })!.collapsed).toBe(true);
  });
});

describe('sanitizeSessionMemos — 장수에도 상한이 있다', () => {
  it('배열이 아니면 빈 목록', () => {
    expect(sanitizeSessionMemos({ nope: 1 })).toEqual([]);
  });

  it('상한을 넘는 장수는 잘린다 — 키 개수로 붓는 길을 막는다', () => {
    const many = Array.from({ length: SESSION_MEMO.MAX_PER_OWNER + 40 }, (_, i) => memo({ id: `memo-${i}` }));
    expect(sanitizeSessionMemos(many)).toHaveLength(SESSION_MEMO.MAX_PER_OWNER);
  });

  it('중복 id 는 첫 장만 남는다(React key 충돌 = 남의 장이 사라진 것처럼 보인다)', () => {
    const out = sanitizeSessionMemos([memo({ text: '첫째' }), memo({ text: '둘째' })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('첫째');
  });

  it('망가진 장만 버리고 나머지는 살린다', () => {
    const out = sanitizeSessionMemos([memo({ id: 'memo-ok' }), null, { id: '' }, memo({ id: 'memo-ok2' })]);
    expect(out.map((m) => m.id)).toEqual(['memo-ok', 'memo-ok2']);
  });
});

describe('세션 탭 메모 — 세션의 소지품', () => {
  const created: string[] = [];

  beforeEach(() => {
    while (created.length > 0) {
      const id = created.pop();
      if (id) subAgentManager.remove(id);
    }
  });

  // id 를 직접 준다 — 아카이브(닫은 세션)까지 한 프로세스에 쌓이므로, 이름을 고정해 두면 어느
  //   테스트가 어느 세션을 보는지가 눈으로 확정된다(발급 자체의 충돌은 `subAgentIdCollision.test.ts`).
  function newSub(agentId: string, id: string): string {
    const sub = subAgentManager.create(agentId, id);
    created.push(sub.id);
    return sub.id;
  }

  it('저장하면 그 세션에서 읽힌다 — 목록 전량 교체 규약', () => {
    const subId = newSub('agent-memo-1', 'sub-memo-t1');
    expect(subAgentManager.setSessionMemos(subId, [memo()])).toBe(true);
    expect(subAgentManager.getSessionMemos(subId)).toHaveLength(1);

    // 같은 값을 다시 보내면 "안 바뀜" — 브로드캐스트·저장이 헛돌지 않는다.
    expect(subAgentManager.setSessionMemos(subId, [memo()])).toBe(false);

    // 빈 목록을 보내면 항목 자체가 사라진다(빈 배열만 남은 좀비 ❌).
    expect(subAgentManager.setSessionMemos(subId, [])).toBe(true);
    expect(subAgentManager.getSub(subId)!.memos).toBeUndefined();
  });

  it('없는 세션에 저장하면 조용히 false — 만들어 내지 않는다', () => {
    expect(subAgentManager.setSessionMemos('sub-does-not-exist', [memo()])).toBe(false);
  });

  it('세션을 닫으면 메모도 화면에서 함께 사라진다(스냅샷에 없다)', () => {
    const agentId = 'agent-memo-2';
    const subId = newSub(agentId, 'sub-memo-t2');
    subAgentManager.setSessionMemos(subId, [memo()]);
    expect(subAgentManager.getSnapshot()[agentId]?.[0]?.memos).toHaveLength(1);

    subAgentManager.remove(subId);
    created.pop();

    expect(subAgentManager.getSnapshot()[agentId]).toBeUndefined();
    expect(subAgentManager.getSessionMemos(subId)).toEqual([]);
  });

  it('닫은 세션을 되살리면 그 메모도 함께 돌아온다(세션과 운명을 같이한다)', () => {
    const subId = newSub('agent-memo-3', 'sub-memo-t3');
    subAgentManager.setSessionMemos(subId, [memo({ text: '되살아나야 한다' })]);
    subAgentManager.remove(subId);

    const revived = subAgentManager.restoreFromArchive(subId);
    created.push(subId);

    expect(revived?.memos?.[0]?.text).toBe('되살아나야 한다');
  });
});

describe('메인 탭 메모 — 영속 왕복 5지점', () => {
  function makeGraph(): { graph: ProjectGraph; projectName: string; agentId: string } {
    const graph = new ProjectGraph();
    const info = graph.registerProject(PROJECT_CWD);
    // 체크포인트는 **이 프로젝트 소속 버블**만 거른다 — 실제 버블을 만들어야 왕복을 볼 수 있다.
    const bubble = graph.createCustomAgent('Memo Owner', undefined, info.name);
    return { graph, projectName: info.name, agentId: bubble.id };
  }

  it('저장하면 스냅샷에 실린다', () => {
    const { graph, agentId } = makeGraph();
    expect(graph.setAgentMemos(agentId, [memo()])).toBe(true);
    expect(graph.getSnapshot().agentMemos?.[agentId]).toHaveLength(1);
    // 같은 값 재저장은 "안 바뀜".
    expect(graph.setAgentMemos(agentId, [memo()])).toBe(false);
  });

  it('체크포인트로 나갔다가 복원해도 글이 남는다', () => {
    const { graph, projectName, agentId } = makeGraph();
    graph.setAgentMemos(agentId, [memo({ text: '껐다 켜도 남아야 한다' })]);

    const cp = graph.toProjectCheckpoint(projectName)!;
    expect(cp.agentMemos?.[agentId]).toHaveLength(1);

    const revived = new ProjectGraph();
    revived.registerProject(PROJECT_CWD);
    revived.restoreFromCheckpoint(cp);

    expect(revived.getAgentMemos(agentId)[0]!.text).toBe('껐다 켜도 남아야 한다');
  });

  it('복원 경로도 정화를 거친다 — 손상된 옛 파일이 그대로 좌표가 되지 않는다', () => {
    const { graph, projectName, agentId } = makeGraph();
    const cp = graph.toProjectCheckpoint(projectName)!;
    cp.agentMemos = { [agentId]: [{ ...memo(), color: 'javascript:alert(1)', w: 99999 } as SessionMemo] };

    const revived = new ProjectGraph();
    revived.registerProject(PROJECT_CWD);
    revived.restoreFromCheckpoint(cp);

    const restored = revived.getAgentMemos(agentId)[0]!;
    expect(restored.color).toBe(SESSION_MEMO_DEFAULT_COLOR);
    expect(restored.w).toBe(SESSION_MEMO.MAX_W);
  });

  it('병합(다중 프로젝트)에서 사라지지 않는다', () => {
    const a = new ProjectGraph();
    const ai = a.registerProject('/tmp/memo-a');
    const ab = a.createCustomAgent('A', undefined, ai.name);
    a.setAgentMemos(ab.id, [memo({ id: 'memo-a' })]);

    const b = new ProjectGraph();
    const bi = b.registerProject('/tmp/memo-b');
    const bb = b.createCustomAgent('B', undefined, bi.name);
    b.setAgentMemos(bb.id, [memo({ id: 'memo-b' })]);

    const merged = mergeSnapshots(a.getSnapshot(), b.getSnapshot());

    expect(merged.agentMemos?.[ab.id]).toHaveLength(1);
    expect(merged.agentMemos?.[bb.id]).toHaveLength(1);
  });

  it('체크포인트 병합은 사용자가 쓴 글을 덮지 않고 합친다', () => {
    const { graph, projectName, agentId } = makeGraph();
    graph.setAgentMemos(agentId, [memo({ id: 'memo-live', text: '지금 화면' })]);

    const cp = graph.toProjectCheckpoint(projectName)!;
    cp.agentMemos = { [agentId]: [memo({ id: 'memo-disk', text: '디스크에만 있던 것' })] };
    graph.mergeFromCheckpoint(cp);

    const ids = graph.getAgentMemos(agentId).map((m) => m.id);
    expect(ids).toContain('memo-live');
    expect(ids).toContain('memo-disk');
  });

  it('에이전트 버블을 지우면 그 메모도 함께 정리된다(좀비 카드 ❌)', () => {
    const { graph, agentId } = makeGraph();
    graph.setAgentMemos(agentId, [memo()]);

    graph.removeBubble(agentId, { force: true, purgeTaskEdges: true });

    expect(graph.getAgentMemos(agentId)).toEqual([]);
    expect(graph.getSnapshot().agentMemos).toBeUndefined();
  });
});

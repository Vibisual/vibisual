import { describe, it, expect, beforeEach } from 'vitest';
import {
  SESSION_MEMO,
  SESSION_MEMO_DEFAULT_COLOR,
  SESSION_MEMO_LEGACY_COLOR_MAP,
  normalizeMemoName,
  normalizeMemoLinkUrl,
  sanitizeMemoLinks,
  sanitizeSessionMemo,
  sanitizeSessionMemos,
  type SessionMemo,
  type SessionMemoLink,
} from '@vibisual/shared';
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

  it('불투명도는 범위 안으로 접히고 기본값은 남기지 않는다', () => {
    expect('alpha' in sanitizeSessionMemo(memo())!).toBe(false);
    expect('alpha' in sanitizeSessionMemo({ ...memo(), alpha: SESSION_MEMO.DEFAULT_ALPHA })!).toBe(false);
    expect(sanitizeSessionMemo({ ...memo(), alpha: 0 })!.alpha).toBe(SESSION_MEMO.MIN_ALPHA);
    expect(sanitizeSessionMemo({ ...memo(), alpha: 42 })!.alpha).toBe(SESSION_MEMO.MAX_ALPHA);
    expect(sanitizeSessionMemo({ ...memo(), alpha: 'half' })!.alpha).toBeUndefined();
  });

  it('[회귀] 불투명도는 정수로 반올림되지 않는다 — 좌표와 같은 자로 재면 0 아니면 1 이 된다', () => {
    expect(sanitizeSessionMemo({ ...memo(), alpha: 0.35 })!.alpha).toBeCloseTo(0.35, 5);
  });

  it('옛 파스텔 색은 새 팔레트로 갈아 끼운다 — "고쳤다는데 내 메모만 그대로"를 막는다', () => {
    for (const [legacy, next] of Object.entries(SESSION_MEMO_LEGACY_COLOR_MAP)) {
      expect(sanitizeSessionMemo({ ...memo(), color: legacy })!.color).toBe(next);
      // 소문자로 저장된 옛 값도 같은 칸으로 간다.
      expect(sanitizeSessionMemo({ ...memo(), color: legacy.toLowerCase() })!.color).toBe(next);
    }
  });

  it('이관표에 없는 색은 사용자가 고른 자유색이라 건드리지 않는다', () => {
    expect(sanitizeSessionMemo({ ...memo(), color: '#123ABC' })!.color).toBe('#123ABC');
  });

  it('이름은 한 줄로 접히고 상한에서 잘린다 — 제목줄은 한 줄이다', () => {
    expect(sanitizeSessionMemo({ ...memo(), name: '  배포\n전\t점검  ' })!.name).toBe('배포 전 점검');
    expect(sanitizeSessionMemo({ ...memo(), name: 'ㄱ'.repeat(SESSION_MEMO.NAME_MAX + 40) })!.name)
      .toHaveLength(SESSION_MEMO.NAME_MAX);
  });

  it('빈 이름·문자열이 아닌 이름은 키를 남기지 않는다(= 본문 첫 줄이 다시 제목)', () => {
    expect('name' in sanitizeSessionMemo(memo())!).toBe(false);
    expect('name' in sanitizeSessionMemo({ ...memo(), name: '   ' })!).toBe(false);
    expect('name' in sanitizeSessionMemo({ ...memo(), name: 42 })!).toBe(false);
  });

  it('[회귀] 화면과 서버가 같은 자로 이름을 잰다 — 어긋나면 낙관 표시가 영영 안 풀린다', () => {
    // 카드가 올리는 값 = `normalizeMemoName` 를 지난 값. 서버가 그 값을 또 정화해도 그대로여야 한다.
    for (const raw of ['  두 칸  이름 ', '줄\n바꿈', 'ㄱ'.repeat(SESSION_MEMO.NAME_MAX + 5), '']) {
      const fromClient = normalizeMemoName(raw);
      expect(sanitizeSessionMemo({ ...memo(), name: fromClient })!.name ?? '').toBe(fromClient);
    }
  });
});

describe('합쳐진 묶음 — 정화가 무결성을 보정한다', () => {
  const pair = (over: Partial<SessionMemo> = {}, over2: Partial<SessionMemo> = {}): SessionMemo[] => ([
    memo({ id: 'memo-a', groupId: 'mg-1', ...over }),
    memo({ id: 'memo-b', groupId: 'mg-1', groupActive: true, ...over2 }),
  ]);

  it('묶음 이름표는 id 와 같은 모양만 통과한다(임의 문자열이 DOM 키로 새지 않게)', () => {
    expect(sanitizeSessionMemo({ ...memo(), groupId: 'mg-1' })?.groupId).toBe('mg-1');
    expect(sanitizeSessionMemo({ ...memo(), groupId: 'has space' })?.groupId).toBeUndefined();
    expect(sanitizeSessionMemo({ ...memo(), groupId: 42 })?.groupId).toBeUndefined();
  });

  it('묶음이 없으면 활성 표시도 남기지 않는다(고아 필드 ❌)', () => {
    expect('groupActive' in sanitizeSessionMemo({ ...memo(), groupActive: true })!).toBe(false);
  });

  it('혼자 남은 묶음은 묶음이 아니다 — 이름표를 지운다', () => {
    const out = sanitizeSessionMemos([memo({ id: 'memo-a', groupId: 'mg-1', groupActive: true })]);
    expect(out[0]?.groupId).toBeUndefined();
    expect(out[0]?.groupActive).toBeUndefined();
  });

  it('활성 탭이 없으면 마지막 장을 세운다 — 탭은 있는데 본문이 빈 카드 ❌', () => {
    const out = sanitizeSessionMemos([
      memo({ id: 'memo-a', groupId: 'mg-1' }),
      memo({ id: 'memo-b', groupId: 'mg-1' }),
    ]);
    expect(out.map((m) => m.groupActive === true)).toEqual([false, true]);
  });

  it('활성 탭이 여럿이면 하나만 남긴다', () => {
    const out = sanitizeSessionMemos(pair({ groupActive: true }));
    expect(out.filter((m) => m.groupActive === true)).toHaveLength(1);
    expect(out.find((m) => m.groupActive === true)?.id).toBe('memo-b');
  });

  it('묶음 안의 자리·크기·접힘은 활성 장을 따른다 — 한 카드인데 좌표가 갈리면 규칙이 없다', () => {
    const out = sanitizeSessionMemos(pair({ x: 10, y: 10 }, { x: 300, y: 200, collapsed: true }));
    for (const m of out) {
      expect([m.x, m.y]).toEqual([300, 200]);
      expect(m.collapsed).toBe(true);
    }
  });

  it('고칠 것이 없으면 값을 흔들지 않는다(저장 왕복 비교가 흔들리지 않게)', () => {
    const clean = sanitizeSessionMemos(pair());
    expect(sanitizeSessionMemos(clean)).toEqual(clean);
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

  it('불투명도도 껐다 켜면 남는다(새 필드는 디스크 왕복을 안 타면 조용히 사라진다)', () => {
    const { graph, projectName, agentId } = makeGraph();
    graph.setAgentMemos(agentId, [memo({ alpha: 0.35 })]);

    const revived = new ProjectGraph();
    revived.registerProject(PROJECT_CWD);
    revived.restoreFromCheckpoint(graph.toProjectCheckpoint(projectName)!);

    expect(revived.getAgentMemos(agentId)[0]!.alpha).toBeCloseTo(0.35, 5);
  });

  it('사람이 붙인 이름도 껐다 켜면 남는다 — 코드가 되살릴 수 없는 글이다', () => {
    const { graph, projectName, agentId } = makeGraph();
    graph.setAgentMemos(agentId, [memo({ name: '배포 전 점검' })]);

    const revived = new ProjectGraph();
    revived.registerProject(PROJECT_CWD);
    revived.restoreFromCheckpoint(graph.toProjectCheckpoint(projectName)!);

    expect(revived.getAgentMemos(agentId)[0]!.name).toBe('배포 전 점검');
  });

  it('합쳐 둔 묶음도 껐다 켜면 그대로다 — 켰더니 낱장으로 흩어져 있으면 안 된다', () => {
    const { graph, projectName, agentId } = makeGraph();
    graph.setAgentMemos(agentId, [
      memo({ id: 'memo-a', groupId: 'mg-1' }),
      memo({ id: 'memo-b', groupId: 'mg-1', groupActive: true }),
    ]);

    const revived = new ProjectGraph();
    revived.registerProject(PROJECT_CWD);
    revived.restoreFromCheckpoint(graph.toProjectCheckpoint(projectName)!);

    const out = revived.getAgentMemos(agentId);
    expect(out.map((m) => m.groupId)).toEqual(['mg-1', 'mg-1']);
    expect(out.find((m) => m.groupActive === true)?.id).toBe('memo-b');
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

// ─── §5.5 #17-36 ⑫ 메모 링크 ───

/** 링크 시험용 본문 — 오프셋을 눈으로 셀 수 있게 ASCII 로 둔다(0:'build' 6:'log' 10:'app' 14:'docs'). */
const LINK_TEXT = 'build log app docs';

function streamLink(over: Partial<SessionMemoLink> = {}): SessionMemoLink {
  return {
    id: 'ml-stream',
    start: 0,
    end: 5,
    target: { kind: 'stream', sessionId: 'sub-memo-x', anchorId: 'cmd-42', text: '빌드 오류' },
    ...over,
  };
}

const FOUR_KINDS: SessionMemoLink[] = [
  streamLink(),
  { id: 'ml-session', start: 6, end: 9, target: { kind: 'session', sessionId: null, label: '메인' } },
  { id: 'ml-file', start: 10, end: 13, target: { kind: 'file', path: 'src/App.tsx:42' } },
  { id: 'ml-url', start: 14, end: 18, target: { kind: 'url', url: 'https://example.com/docs?q=1' } },
];

describe('메모 링크 정화 — §5.5 #17-36 ⑫ 밖에서 온 링크를 그대로 믿지 않는다', () => {
  it('정상 링크는 네 종류 모두 그대로 통과한다', () => {
    expect(sanitizeSessionMemo(memo({ text: LINK_TEXT, links: FOUR_KINDS }))?.links).toEqual(FOUR_KINDS);
  });

  it('링크가 없으면 필드를 남기지 않는다 — 빈 배열도 "없음"이다(옛 체크포인트가 부풀지 않게)', () => {
    expect(sanitizeSessionMemo(memo({ text: LINK_TEXT }))).not.toHaveProperty('links');
    expect(sanitizeSessionMemo(memo({ text: LINK_TEXT, links: [] }))).not.toHaveProperty('links');
    expect(sanitizeSessionMemo({ ...memo({ text: LINK_TEXT }), links: 'nope' })).not.toHaveProperty('links');
  });

  it('범위가 본문 밖이거나 비었거나 정수가 아니면 버린다', () => {
    const bad = [
      streamLink({ id: 'a', start: 0, end: 99 }),
      streamLink({ id: 'b', start: 3, end: 3 }),
      streamLink({ id: 'c', start: 5, end: 2 }),
      streamLink({ id: 'd', start: -1, end: 2 }),
      streamLink({ id: 'e', start: 0.5, end: 2 }),
    ];
    expect(sanitizeMemoLinks(bad, LINK_TEXT.length)).toEqual([]);
  });

  it('[회귀] 본문이 상한에서 잘리면 그 뒤에 걸린 링크도 함께 사라진다 — 갈 글자가 없다', () => {
    const text = 'x'.repeat(SESSION_MEMO.TEXT_MAX + 10);
    const tail = streamLink({ id: 'tail', start: SESSION_MEMO.TEXT_MAX + 2, end: SESSION_MEMO.TEXT_MAX + 6 });
    const head = streamLink({ id: 'head', start: 0, end: 4 });
    expect(sanitizeSessionMemo(memo({ text, links: [head, tail] }))?.links?.map((l) => l.id)).toEqual(['head']);
  });

  it('겹치는 범위는 앞의 것만 남고, 결과는 시작 순이다 — 한 글자가 두 곳을 가리키지 않는다', () => {
    const out = sanitizeMemoLinks([
      streamLink({ id: 'late', start: 10, end: 13 }),
      streamLink({ id: 'first', start: 0, end: 5 }),
      streamLink({ id: 'overlap', start: 3, end: 8 }),
    ], LINK_TEXT.length);
    expect(out.map((l) => l.id)).toEqual(['first', 'late']);
  });

  it('id 가 겹치면 앞의 것만 — id 모양이 어긋나면 버린다', () => {
    const out = sanitizeMemoLinks([
      streamLink({ id: 'dup', start: 0, end: 5 }),
      streamLink({ id: 'dup', start: 10, end: 13 }),
      streamLink({ id: 'has space', start: 14, end: 18 }),
    ], LINK_TEXT.length);
    expect(out.map((l) => `${l.id}@${l.start}`)).toEqual(['dup@0']);
  });

  it('웹 주소는 http(s) 만 — javascript:·file:·data: 는 바깥 브라우저 길로 새지 않는다', () => {
    expect(normalizeMemoLinkUrl('  https://example.com/a  ')).toBe('https://example.com/a');
    expect(normalizeMemoLinkUrl('HTTP://Example.com')).toBe('HTTP://Example.com');
    expect(normalizeMemoLinkUrl('javascript:alert(1)')).toBe('');
    expect(normalizeMemoLinkUrl('file:///C:/secret.txt')).toBe('');
    expect(normalizeMemoLinkUrl('data:text/html,<b>x</b>')).toBe('');
    expect(normalizeMemoLinkUrl('https://')).toBe('');
    expect(normalizeMemoLinkUrl('https://exa mple.com')).toBe('');
    expect(normalizeMemoLinkUrl(`https://e.com/${'a'.repeat(SESSION_MEMO.LINK_URL_MAX)}`)).toBe('');
    const out = sanitizeMemoLinks([
      { id: 'u1', start: 0, end: 5, target: { kind: 'url', url: 'javascript:alert(1)' } },
    ], LINK_TEXT.length);
    expect(out).toEqual([]);
  });

  it('파일 경로에 제어 문자가 있거나 비었으면 버린다', () => {
    const out = sanitizeMemoLinks([
      { id: 'f1', start: 0, end: 5, target: { kind: 'file', path: 'src/a.ts\u0000b' } },
      { id: 'f2', start: 6, end: 9, target: { kind: 'file', path: '   ' } },
      { id: 'f3', start: 10, end: 13, target: { kind: 'file', path: '  C:\\work\\보고서 (최종).html  ' } },
    ], LINK_TEXT.length);
    expect(out).toEqual([{ id: 'f3', start: 10, end: 13, target: { kind: 'file', path: 'C:\\work\\보고서 (최종).html' } }]);
  });

  it('세션 글 위치는 갈 곳(항목 id 또는 그 자리의 글)이 하나는 있어야 한다', () => {
    const out = sanitizeMemoLinks([
      { id: 's1', start: 0, end: 5, target: { kind: 'stream', sessionId: null, text: '   ' } },
      { id: 's2', start: 6, end: 9, target: { kind: 'stream', sessionId: null, anchorId: 'evt-1', text: '' } },
      { id: 's3', start: 10, end: 13, target: { kind: 'stream', sessionId: null, anchorId: 'bad id"x', text: '남는 글' } },
    ], LINK_TEXT.length);
    expect(out).toEqual([
      { id: 's2', start: 6, end: 9, target: { kind: 'stream', sessionId: null, anchorId: 'evt-1', text: '' } },
      // 항목 id 가 모양이 어긋나면 그 값만 버리고, 글로 찾아가는 길은 남긴다.
      { id: 's3', start: 10, end: 13, target: { kind: 'stream', sessionId: null, text: '남는 글' } },
    ]);
  });

  it('세션 id 는 모양이 맞거나 null(메인 탭)일 때만 — 모르는 종류는 버린다', () => {
    const out = sanitizeMemoLinks([
      { id: 'a', start: 0, end: 5, target: { kind: 'session', sessionId: 'sub-1 2' } },
      { id: 'b', start: 6, end: 9, target: { kind: 'session', sessionId: 42 } },
      { id: 'c', start: 10, end: 13, target: { kind: 'teleport', to: 'x' } },
      { id: 'd', start: 14, end: 18, target: { kind: 'session', sessionId: 'sub-ok_1' } },
    ], LINK_TEXT.length);
    expect(out).toEqual([{ id: 'd', start: 14, end: 18, target: { kind: 'session', sessionId: 'sub-ok_1' } }]);
  });

  it('그 자리의 글·탭 이름은 공백을 접고 상한에서 자른다', () => {
    const long = `첫줄\n\t둘째줄  ${'가'.repeat(SESSION_MEMO.LINK_TEXT_MAX)}`;
    const [s] = sanitizeMemoLinks([streamLink({ target: { kind: 'stream', sessionId: null, text: long } })], LINK_TEXT.length);
    expect(s?.target.kind === 'stream' ? s.target.text : '').toMatch(/^첫줄 둘째줄 가/);
    expect(s?.target.kind === 'stream' ? s.target.text.length : 0).toBe(SESSION_MEMO.LINK_TEXT_MAX);
    const [t] = sanitizeMemoLinks([
      { id: 'lab', start: 0, end: 5, target: { kind: 'session', sessionId: null, label: `  ${'탭'.repeat(200)}  ` } },
    ], LINK_TEXT.length);
    expect(t?.target.kind === 'session' ? t.target.label?.length : 0).toBe(SESSION_MEMO.LINK_LABEL_MAX);
  });

  it('개수 상한(LINK_MAX)을 넘으면 잘린다 — 키 개수로 붓는 길을 막는다', () => {
    const text = 'a'.repeat(SESSION_MEMO.LINK_MAX * 2 + 4);
    const many = Array.from({ length: SESSION_MEMO.LINK_MAX + 5 }, (_, i) => streamLink({ id: `ml-${i}`, start: i * 2, end: i * 2 + 1 }));
    expect(sanitizeMemoLinks(many, text.length)).toHaveLength(SESSION_MEMO.LINK_MAX);
  });

  it('여러 번 거쳐도 같은 답 — 화면과 서버의 왕복 비교가 흔들리지 않는다(멱등)', () => {
    const once = sanitizeSessionMemo(memo({ text: LINK_TEXT, links: [...FOUR_KINDS].reverse() }));
    const twice = sanitizeSessionMemo(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe('메모 링크 — 영속 왕복(사람이 건 연결은 코드가 되살릴 수 없다)', () => {
  it('메인 탭 메모의 링크가 체크포인트를 나갔다 들어와도 그대로다', () => {
    const graph = new ProjectGraph();
    const info = graph.registerProject(PROJECT_CWD);
    const bubble = graph.createCustomAgent('Link Owner', undefined, info.name);
    const [clean] = sanitizeSessionMemos([memo({ text: LINK_TEXT, links: FOUR_KINDS })]);
    graph.setAgentMemos(bubble.id, [clean!]);

    const revived = new ProjectGraph();
    revived.registerProject(PROJECT_CWD);
    revived.restoreFromCheckpoint(graph.toProjectCheckpoint(info.name)!);

    expect(revived.getAgentMemos(bubble.id)[0]!.links).toEqual(FOUR_KINDS);
  });

  it('세션 탭 메모의 링크는 그 세션 스냅샷에 그대로 실린다', () => {
    const agentId = 'agent-memo-link';
    const sub = subAgentManager.create(agentId, 'sub-memo-link');
    try {
      const memos = sanitizeSessionMemos([memo({ text: LINK_TEXT, links: [FOUR_KINDS[0]!] })]);
      expect(subAgentManager.setSessionMemos(sub.id, memos)).toBe(true);
      expect(subAgentManager.getSnapshot()[agentId]?.[0]?.memos?.[0]?.links).toEqual([FOUR_KINDS[0]]);
      // 링크만 바뀌어도 "바뀜"이다 — 같은 본문에 링크를 걸었는데 저장이 헛돌면 안 된다.
      const relinked = sanitizeSessionMemos([memo({ text: LINK_TEXT, links: [FOUR_KINDS[1]!] })]);
      expect(subAgentManager.setSessionMemos(sub.id, relinked)).toBe(true);
    } finally {
      subAgentManager.remove(sub.id);
    }
  });
});

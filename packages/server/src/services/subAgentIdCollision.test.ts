import { describe, it, expect, afterEach, vi } from 'vitest';
import { subAgentManager } from './subAgentManager.js';

/**
 * 세션 id 충돌 회귀 테스트.
 *
 * 종전 발급식은 `sub-<밀리초>` **하나뿐**이었다. 사람이 손으로 두 번 누르기는 어렵지만 **코드가
 * 연달아 만드는 자리**(파이프라인 워커·워처·dispatch 자동 생성)는 실제로 같은 밀리초에 들어가고,
 * 그러면 뒤에 만든 세션이 `index` 에서 앞의 것을 덮어써 **탭 하나가 조용히 사라진다**. 대화 파일
 * (`sub-streams/<agentId>/<subId>.jsonl`)·명령 큐·메모까지 둘이 한 자리를 다툰다.
 *
 * 여기서 못 박는 것 셋 — (a) 시계가 멈춰 있어도 id 는 전부 다르다, (b) **닫힌(아카이브) 세션의
 * id 를 물려받지 않는다**(그 세션의 대화 파일이 디스크에 그대로 남아 있다), (c) id 의 모양은
 * 종전 규약을 지킨다(`sub-` 접두어 + 파일명·termId 로 써도 안전한 글자만).
 */

const created: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (created.length > 0) {
    const id = created.pop();
    if (id) subAgentManager.remove(id);
  }
});

function track(id: string): string {
  created.push(id);
  return id;
}

describe('세션 id 발급 — 같은 밀리초에도 겹치지 않는다', () => {
  it('[회귀] 시계를 멈춰 두고 20개를 만들어도 id 가 전부 다르다', () => {
    // 종전 코드에서는 여기서 id 가 **하나**만 나왔다(20개가 한 칸을 덮어썼다).
    vi.spyOn(Date, 'now').mockReturnValue(1_787_000_000_000);

    const ids = Array.from({ length: 20 }, () => track(subAgentManager.create('agent-id-collision').id));

    expect(new Set(ids).size).toBe(20);
  });

  it('만든 세션은 전부 각자 조회된다 — 한 칸을 덮어쓰지 않는다', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_787_000_000_001);
    const agentId = 'agent-id-collision-2';

    const ids = Array.from({ length: 5 }, () => track(subAgentManager.create(agentId).id));

    for (const id of ids) expect(subAgentManager.getSub(id)?.id).toBe(id);
    // 목록에 5칸이 있는 것만으로는 부족하다 — 옛 코드에서도 5칸은 있었고 **id 가 전부 같았다**.
    const listed = subAgentManager.getSnapshot()[agentId] ?? [];
    expect(new Set(listed.map((s) => s.id)).size).toBe(5);
  });
});

describe('세션 id 발급 — 규약을 지킨다', () => {
  it('`sub-` 로 시작한다 — REST 의 optimistic id 가드(startsWith)가 그대로 통한다', () => {
    const id = track(subAgentManager.create('agent-id-shape').id);
    expect(id.startsWith('sub-')).toBe(true);
  });

  it('파일명·termId 로 써도 안전한 글자만 쓴다', () => {
    const id = track(subAgentManager.create('agent-id-shape-2').id);
    // `sub-streams/<agentId>/<subId>.jsonl` 파일명이 되고, `term:<agentId>:<subId>` · pane 은 `#` 로 갈린다.
    expect(id).toMatch(/^[\w-]+$/);
  });
});

describe('세션 id 발급 — 닫힌 세션의 자리를 뺏지 않는다', () => {
  it('[회귀] 아카이브에 있는 id 를 optimistic id 로 보내도 거절한다', () => {
    const agentId = 'agent-id-archive';
    const archivedId = 'sub-archived-fixture-1';
    subAgentManager.create(agentId, archivedId);
    subAgentManager.remove(archivedId); // 탭 닫기 = 아카이브로 이동(대화 파일은 디스크에 남는다)

    const fresh = track(subAgentManager.create(agentId, archivedId).id);

    expect(fresh).not.toBe(archivedId);
    // 아카이브의 그 세션은 그대로 남아 있어야 한다(되살리면 자기 대화를 본다).
    expect(subAgentManager.getArchived(agentId).map((s) => s.id)).toContain(archivedId);
  });

  it('살아 있는 세션의 id 를 optimistic id 로 보내도 거절한다(기존 동작 유지)', () => {
    const agentId = 'agent-id-live';
    const liveId = track(subAgentManager.create(agentId, 'sub-live-fixture-1').id);

    const fresh = track(subAgentManager.create(agentId, liveId).id);

    expect(fresh).not.toBe(liveId);
    expect(subAgentManager.getSub(liveId)?.id).toBe(liveId);
  });

  it('아무도 안 쓰는 optimistic id 는 그대로 존중한다', () => {
    const wanted = 'sub-client-optimistic-1';
    expect(track(subAgentManager.create('agent-id-ok', wanted).id)).toBe(wanted);
  });
});

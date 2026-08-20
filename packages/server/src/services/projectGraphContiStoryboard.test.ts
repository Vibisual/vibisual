import { describe, expect, it } from 'vitest';
import type { Conti } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';

/**
 * §5.13 (Q) — 대본 콘티·출력 프리셋·렌더 기록의 **영속 왕복** 회귀 테스트.
 *
 * 콘티는 레코드를 통째로 직렬화하므로 필드별 배선이 필요 없지만, 그 "통째로"가 어느
 * 지점에서 필드를 골라 담는 코드로 바뀌면 새 필드는 **화면에는 보이는데 껐다 켜면
 * 사라지는** 상태가 된다(v1.59 contis 누락과 같은 자리). 그 조용한 실패를 여기서 못 박는다.
 */

const PROJECT_CWD = '/tmp/storyboard-project';

function makeGraph(): { graph: ProjectGraph; projectName: string; agentId: string } {
  const graph = new ProjectGraph();
  // 프로젝트가 등록돼 있어야 toProjectCheckpoint 의 이름 필터를 통과한다.
  const info = graph.registerProject(PROJECT_CWD);
  const agent = graph.createCustomAgent('Storyboard', undefined, info.name);
  return { graph, projectName: info.name, agentId: agent.id };
}

function makeConti(agentId: string, overrides: Partial<Conti> = {}): Conti {
  const now = Date.now();
  return {
    id: `conti-${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    createdAt: now,
    updatedAt: now,
    workId: '',
    title: '첫 장면',
    frames: [{ id: 'frame-1', title: '1. 문이 열린다', action: '주인공이 들어선다.', elements: [] }],
    ...overrides,
  };
}

describe('§5.13 (Q) 대본 콘티 — 출처와 발췌', () => {
  it('대본에서 온 콘티는 출처와 발췌를 달고 스냅샷에 실린다', () => {
    const { graph, agentId } = makeGraph();
    const conti = makeConti(agentId, { source: 'script', scriptExcerpt: '씬 1. 복도', presetId: 'portrait' });
    graph.addConti(conti);

    const snap = graph.getSnapshot().contis?.[conti.id];
    expect(snap?.source).toBe('script');
    expect(snap?.scriptExcerpt).toBe('씬 1. 복도');
    expect(snap?.presetId).toBe('portrait');
  });

  it('출처를 안 적은 기존 콘티는 그대로 남는다(빈 값으로 덮지 않는다)', () => {
    const { graph, agentId } = makeGraph();
    const conti = makeConti(agentId);
    graph.addConti(conti);
    expect(graph.getSnapshot().contis?.[conti.id]?.source).toBeUndefined();
  });
});

describe('§5.13 (Q) 출력 프리셋', () => {
  it('프리셋을 지정하면 콘티에 남는다', () => {
    const { graph, agentId } = makeGraph();
    const conti = makeConti(agentId);
    graph.addConti(conti);

    expect(graph.setContiPreset(conti.id, 'webtoon')?.presetId).toBe('webtoon');
    expect(graph.getConti(conti.id)?.presetId).toBe('webtoon');
  });

  it('판형만 골랐을 때는 수정 시각을 올리지 않는다(히스토리의 edited 마커가 거짓말하지 않게)', () => {
    const { graph, agentId } = makeGraph();
    const conti = makeConti(agentId);
    graph.addConti(conti);
    const before = conti.updatedAt;

    graph.setContiPreset(conti.id, 'portrait');
    expect(graph.getConti(conti.id)?.updatedAt).toBe(before);
  });

  it('없는 콘티에는 무동작으로 null 을 돌려준다', () => {
    const { graph } = makeGraph();
    expect(graph.setContiPreset('conti-nope', 'landscape')).toBeNull();
    expect(graph.setContiRenderLink('conti-nope', {
      appId: 'someapp',
      docId: 'doc-1',
      presetId: 'landscape',
      startedAt: Date.now(),
    })).toBeNull();
  });
});

describe('§5.13 (Q) 렌더 기록', () => {
  it('받아 간 앱의 문서·작업이 콘티에 적힌다', () => {
    const { graph, agentId } = makeGraph();
    const conti = makeConti(agentId);
    graph.addConti(conti);

    const updated = graph.setContiRenderLink(conti.id, {
      appId: 'someapp',
      docId: 'doc-1',
      jobId: 'job-1',
      presetId: 'webtoon',
      startedAt: 1234,
      status: 'queued',
    });
    expect(updated?.render).toEqual({
      appId: 'someapp',
      docId: 'doc-1',
      jobId: 'job-1',
      presetId: 'webtoon',
      startedAt: 1234,
      status: 'queued',
    });
  });

  it('다시 넘기면 마지막 한 건만 남는다(이력으로 부풀지 않게)', () => {
    const { graph, agentId } = makeGraph();
    const conti = makeConti(agentId);
    graph.addConti(conti);

    graph.setContiRenderLink(conti.id, { appId: 'someapp', docId: 'doc-1', presetId: 'landscape', startedAt: 1 });
    graph.setContiRenderLink(conti.id, { appId: 'someapp', docId: 'doc-2', presetId: 'landscape', startedAt: 2 });
    expect(graph.getConti(conti.id)?.render?.docId).toBe('doc-2');
  });
});

describe('§5.13 (Q) 영속 왕복', () => {
  it('프로젝트 체크포인트를 거쳐도 네 필드가 살아 돌아온다', () => {
    const { graph, agentId, projectName } = makeGraph();
    const conti = makeConti(agentId, { source: 'script', scriptExcerpt: '씬 1.', presetId: 'webtoon' });
    graph.addConti(conti);
    graph.setContiRenderLink(conti.id, {
      appId: 'someapp',
      docId: 'doc-9',
      jobId: 'job-9',
      presetId: 'webtoon',
      startedAt: 7,
      status: 'running',
    });

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp).not.toBeNull();

    const revived = new ProjectGraph();
    revived.registerProject(PROJECT_CWD);
    revived.restoreFromCheckpoint(JSON.parse(JSON.stringify(cp)));

    const back = revived.getConti(conti.id);
    expect(back?.source).toBe('script');
    expect(back?.scriptExcerpt).toBe('씬 1.');
    expect(back?.presetId).toBe('webtoon');
    expect(back?.render?.docId).toBe('doc-9');
    expect(back?.render?.status).toBe('running');
  });

  it('병합 복원(merge)에서도 같은 필드가 실려 온다', () => {
    const { graph, agentId, projectName } = makeGraph();
    const conti = makeConti(agentId, { source: 'script', presetId: 'portrait' });
    graph.addConti(conti);
    const cp = graph.toProjectCheckpoint(projectName);

    const other = new ProjectGraph();
    other.registerProject(PROJECT_CWD);
    other.mergeFromCheckpoint(JSON.parse(JSON.stringify(cp)));

    expect(other.getConti(conti.id)?.presetId).toBe('portrait');
    expect(other.getConti(conti.id)?.source).toBe('script');
  });

  it('여러 프로젝트 스냅샷을 합쳐도 콘티가 사라지지 않는다', () => {
    const { graph, agentId } = makeGraph();
    const conti = makeConti(agentId, { presetId: 'webtoon' });
    graph.addConti(conti);

    const merged = mergeSnapshots(graph.getSnapshot(), new ProjectGraph().getSnapshot());
    expect(merged.contis?.[conti.id]?.presetId).toBe('webtoon');
  });
});

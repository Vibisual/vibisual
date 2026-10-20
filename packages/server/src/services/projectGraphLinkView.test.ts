import { describe, expect, it, vi } from 'vitest';
import { APP_BUBBLE_PAST_FILE_MAX } from '@vibisual/shared';

/**
 * §5.4 #36 (H) — 연결 보기의 서버 쪽 회귀 시험.
 *
 * ① 켜고 끄기(`linksHidden` — 에이전트·앱 노드) · ② 보기 전환(`linkLens`) · ③ 지난 결과(`pastFiles`).
 * 전부 표시 형태라 새 영속 창구가 없다 — 에이전트 노드·앱 버블이 **객체째** 실리는지를 왕복으로 못 박는다
 * (§3.2 함정: 스냅샷에만 보이고 껐다 켜면 사라지는 칸).
 *
 * 에이전트를 만들면 설정 창 기본값을 읽으므로, 사용자 홈의 실제 파일에 닿지 않게 막는다.
 */
vi.mock('./userDefaultsService.js', () => ({
  userDefaultsService: { get: () => ({ updatedAt: 1 }), subscribe: () => () => {} },
}));

const { ProjectGraph } = await import('./projectGraph.js');

const PROJECT_CWD = '/tmp/example-link-view';

function makeGraph(): { graph: InstanceType<typeof ProjectGraph>; projectName: string } {
  const graph = new ProjectGraph();
  const info = graph.registerProject(PROJECT_CWD);
  return { graph, projectName: info.name };
}

/** 에이전트는 세션 열쇠(`path`)로 산다 — 스냅샷의 구독 범위와 무관하게 그 버블을 꺼낸다. */
function agentOf(graph: InstanceType<typeof ProjectGraph>, sessionId: string) {
  return graph.getAgentBySession(sessionId);
}

describe('§5.4 #36 (H) ①② 에이전트 연결 보기', () => {
  it('준 칸만 바꾸고, 기본값으로 돌리면 칸을 지운다', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('Linker', undefined, projectName);

    expect(graph.setAgentLinkView(agent.id, { hidden: true })).toEqual({ ok: true, linksHidden: true, linkLens: 'linked' });
    expect(graph.setAgentLinkView(agent.id, { lens: 'files' })).toEqual({ ok: true, linksHidden: true, linkLens: 'files' });
    expect(agentOf(graph, agent.path)).toMatchObject({ linksHidden: true, linkLens: 'files' });

    graph.setAgentLinkView(agent.id, { hidden: false, lens: 'linked' });
    const after = agentOf(graph, agent.path);
    expect(after?.linksHidden).toBeUndefined();
    expect(after?.linkLens).toBeUndefined();
  });

  it('CMD 에이전트도 대상이다 — 파일 선은 누구에게나 있다(말풍선과 달리 입력 여부와 무관)', () => {
    const { graph, projectName } = makeGraph();
    const cmd = graph.createCustomAgent('Term', undefined, projectName, { executionMode: 'interactive-terminal' });
    expect(graph.setAgentLinkView(cmd.id, { hidden: true })).toMatchObject({ ok: true, linksHidden: true });
  });

  it('주변 버블 숨기기는 연결선·보기 전환과 독립이며 연결된 앱을 지우지 않는다', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('Visible agent', undefined, projectName);
    const app = graph.createAppBubble({ projectName, appId: 'vibimage', x: 0, y: 0, linkedAgentIds: [agent.id] });
    graph.setAgentLinkView(agent.id, { hidden: true, lens: 'files' });

    graph.setAgentLinkView(agent.id, { bubblesHidden: true });
    expect(agentOf(graph, agent.path)).toMatchObject({ bubblesHidden: true, linksHidden: true, linkLens: 'files' });
    expect(graph.getSnapshot().agents.find((item) => item.id === agent.id)?.bubblesHidden).toBe(true);
    expect(graph.getAppBubble(app.id)?.linkedAgentIds).toEqual([agent.id]);

    graph.setAgentLinkView(agent.id, { hidden: false, lens: 'linked' });
    expect(agentOf(graph, agent.path)?.bubblesHidden).toBe(true);
    graph.setAgentLinkView(agent.id, { bubblesHidden: false });
    expect(agentOf(graph, agent.path)?.bubblesHidden).toBeUndefined();
    expect(graph.getAppBubble(app.id)?.linkedAgentIds).toEqual([agent.id]);
  });

  it('없는 버블은 not-found 다(조용히 만들어 내지 않는다)', () => {
    const { graph } = makeGraph();
    expect(graph.setAgentLinkView('nope', { hidden: true })).toEqual({ ok: false, reason: 'not-found' });
  });

  it('체크포인트 왕복에 남는다(에이전트 노드째 영속 — 새 창구 없음)', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('Keeper', undefined, projectName);
    graph.setAgentLinkView(agent.id, { hidden: true, bubblesHidden: true, lens: 'files' });
    const fresh = new ProjectGraph();
    const checkpoint = structuredClone(graph.toProjectCheckpoint(projectName));
    expect(checkpoint.graph.agents[agent.path]?.bubblesHidden).toBe(true);
    expect(graph.toCheckpoint().graph.agents[agent.path]?.bubblesHidden).toBe(true);
    fresh.restoreFromCheckpoint(checkpoint);
    expect(agentOf(fresh, agent.path)).toMatchObject({ linksHidden: true, bubblesHidden: true, linkLens: 'files' });
  });

  it('다른 프로젝트 체크포인트를 병합해도 버블 숨김을 보존한다', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('Merged keeper', undefined, projectName);
    graph.setAgentLinkView(agent.id, { bubblesHidden: true });
    const fresh = new ProjectGraph();
    fresh.registerProject('/tmp/another-link-view');
    fresh.mergeFromCheckpoint(structuredClone(graph.toProjectCheckpoint(projectName)));
    expect(agentOf(fresh, agent.path)?.bubblesHidden).toBe(true);
    expect(fresh.toProjectCheckpoint(projectName).graph.agents[agent.path]?.bubblesHidden).toBe(true);
  });

  it('버블 숨김 칸이 없는 기존 체크포인트도 표시 기본값으로 복원한다', () => {
    const { graph, projectName } = makeGraph();
    const agent = graph.createCustomAgent('Legacy view', undefined, projectName);
    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(structuredClone(graph.toProjectCheckpoint(projectName)));
    expect(agentOf(fresh, agent.path)?.bubblesHidden).toBeUndefined();
  });
});

describe('§5.4 #36 (H) ① 앱 노드 켜고 끄기', () => {
  it('불리언만 받고, 끄기(false·null)는 칸을 지운다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0, linkedAgentIds: ['a1'] });
    graph.updateAppBubble(b.id, { linksHidden: true });
    expect(graph.getAppBubble(b.id)?.linksHidden).toBe(true);

    // 다른 값은 칸을 건드리지 않는다(부분 페이로드 규칙).
    graph.updateAppBubble(b.id, { linksHidden: 'yes' } as unknown as Record<string, never>);
    expect(graph.getAppBubble(b.id)?.linksHidden).toBe(true);

    graph.updateAppBubble(b.id, { linksHidden: false });
    expect(graph.getAppBubble(b.id)?.linksHidden).toBeUndefined();
    graph.updateAppBubble(b.id, { linksHidden: true });
    graph.updateAppBubble(b.id, { linksHidden: null } as unknown as Record<string, never>);
    expect(graph.getAppBubble(b.id)?.linksHidden).toBeUndefined();
  });

  it('감춰도 연결(linkedAgentIds)은 그대로다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0, linkedAgentIds: ['a1', 'a2'] });
    graph.updateAppBubble(b.id, { linksHidden: true });
    expect(graph.getAppBubble(b.id)?.linkedAgentIds).toEqual(['a1', 'a2']);
  });

  it('체크포인트 왕복에 남는다(앱 버블은 객체째 영속)', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0 });
    graph.updateAppBubble(b.id, { linksHidden: true });
    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(graph.toProjectCheckpoint(projectName));
    expect(fresh.getAppBubble(b.id)?.linksHidden).toBe(true);
  });
});

describe('§5.4 #36 (H) ③ 지난 결과', () => {
  it('결과 전달이 파일을 바꾸면 바뀌기 전 파일이 버전과 함께 앞에 쌓인다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibimage', x: 0, y: 0 });
    graph.setAppBubbleFile(b.id, 'out/v1.png', 10);
    expect(graph.getAppBubble(b.id)?.pastFiles).toBeUndefined();
    graph.setAppBubbleFile(b.id, 'out/v2.png', 20);
    graph.setAppBubbleFile(b.id, 'out/v3.png', 30);
    expect(graph.getAppBubble(b.id)?.pastFiles).toEqual([
      { file: 'out/v2.png', at: 20 },
      { file: 'out/v1.png', at: 10 },
    ]);
  });

  it('같은 파일을 다시 보낸 것은 쌓지 않는다 — 그 파일은 방금 덮였다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibimage', x: 0, y: 0 });
    graph.setAppBubbleFile(b.id, 'out/v1.png', 10);
    graph.setAppBubbleFile(b.id, 'out/v1.png', 11);
    expect(graph.getAppBubble(b.id)?.pastFiles).toBeUndefined();
  });

  it('상한을 넘으면 오래된 것부터 버린다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibimage', x: 0, y: 0 });
    for (let i = 0; i <= APP_BUBBLE_PAST_FILE_MAX + 2; i += 1) graph.setAppBubbleFile(b.id, `out/v${i}.png`, i);
    const past = graph.getAppBubble(b.id)?.pastFiles ?? [];
    expect(past).toHaveLength(APP_BUBBLE_PAST_FILE_MAX);
    expect(past[0]?.file).toBe(`out/v${APP_BUBBLE_PAST_FILE_MAX + 1}.png`);
  });

  it('PATCH 로는 적을 수 없다 — 쌓는 길은 결과 전달 하나다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibimage', x: 0, y: 0 });
    graph.updateAppBubble(b.id, { pastFiles: [{ file: 'evil.png' }] } as unknown as Record<string, never>);
    expect(graph.getAppBubble(b.id)?.pastFiles).toBeUndefined();
  });

  it('담긴 파일을 비워도 지난 결과는 남고, 체크포인트 왕복에도 남는다', () => {
    const { graph, projectName } = makeGraph();
    const b = graph.createAppBubble({ projectName, appId: 'vibimage', x: 0, y: 0 });
    graph.setAppBubbleFile(b.id, 'out/v1.png', 10);
    graph.setAppBubbleFile(b.id, 'out/v2.png', 20);
    graph.updateAppBubble(b.id, { file: null } as unknown as Record<string, never>);
    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(graph.toProjectCheckpoint(projectName));
    expect(fresh.getAppBubble(b.id)?.pastFiles).toEqual([{ file: 'out/v1.png', at: 10 }]);
  });
});

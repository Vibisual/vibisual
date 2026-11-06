/**
 * §5.26 (E) — 복원 브리핑이 **압축된 그 세션**에만, **한 통로로** 실리는가.
 * 재현하는 사고: 우리가 띄운 세션의 훅은 `session_id` 가 주인 버블 키로 바뀌어 들어온다. 마커도 훅 경로의 꺼내기도 그 키로 돌아서,
 * 탭 A 의 압축 브리핑이 형제 탭 B 의 첫 프롬프트와 턴 도중 [작업에 반영] 메시지 옆에 실렸고 A 자신은 받지 못했다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CompactMarker } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { takeHookRecoveryBriefing, type HookRecoveryDeps } from './compactRecoveryHook.js';

const TAB_A = '11111111-2222-4333-8444-555555555555'; // 압축된 탭
const TAB_B = '66666666-7777-4888-8999-aaaaaaaaaaaa'; // 압축이 없던 형제 탭
const EXTERNAL = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'; // 훅으로만 붙은 바깥 세션
const TASK = 'nightly 빌드 감시';

let root: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-recovery-hook-')));
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 임시 폴더 정리 실패는 시험 결과가 아니다 */ }
});

function transcript(sessionId: string): string {
  const p = path.join(root, `${sessionId}.jsonl`);
  fs.writeFileSync(p, `${JSON.stringify({ type: 'user', message: { role: 'user', content: '압축 전 대화' } })}\n`, 'utf8');
  return p;
}

/** CLI 가 실제로 덧붙이는 두 줄 — 경계와 표식 달린 요약. 요약은 돌던 작업을 언급하지 않는다. */
function appendCompaction(file: string): void {
  const boundary = { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'manual', preTokens: 500_000 } };
  const summary = { type: 'user', isCompactSummary: true, message: { role: 'user', content: [{ type: 'text', text: '요약 본문' }] } };
  fs.appendFileSync(file, `${JSON.stringify(boundary)}\n${JSON.stringify(summary)}\n`, 'utf8');
}

/** 한 커스텀 버블에 탭 둘. 탭 A 만 압축됐다 — 훅 라우트가 넘기는 모양 그대로(그래프 키 = 버블 키, 마커 신원 = CLI id). */
function setup(): { graph: ProjectGraph; bubbleKey: string; marker: CompactMarker } {
  const graph = new ProjectGraph();
  const projectName = graph.registerProject(root).name;
  const agent = graph.createCustomAgent('worker', undefined, projectName);
  const bubbleKey = graph.findSessionByAgentId(agent.id)!;
  const file = transcript(TAB_A);
  transcript(TAB_B);
  const marker = graph.recordCompactMarker({
    sessionId: bubbleKey,
    claudeSessionId: TAB_A,
    transcriptPath: file,
    trigger: 'manual',
    cwd: root,
    subAgentId: 'sub-a',
    runningTasks: [TASK],
  });
  if (!marker) throw new Error('마커를 못 세웠다 — 하네스가 틀렸다');
  appendCompaction(file);
  graph.sweepCompactOutcomes();
  return { graph, bubbleKey, marker };
}

function hookDeps(graph: ProjectGraph, assembled: ReadonlySet<string>, enabled = true): HookRecoveryDeps & { take: ReturnType<typeof vi.fn> } {
  return {
    isAssembledByUs: (sid) => assembled.has(sid),
    enabled: () => enabled,
    take: vi.fn((sid: string) => graph.takeCompactBriefing(sid)),
  };
}

describe('§5.26 (E) 마커는 압축된 CLI 세션에 선다', () => {
  it('그래프 조회는 버블 키, 마커 신원은 CLI id — 형제 탭이 공유하는 키로 서지 않는다', () => {
    const { graph, bubbleKey, marker } = setup();
    expect(marker.sessionId).toBe(TAB_A);
    expect(marker.agentId).toBeDefined(); // 버블 키로 에이전트를 찾았다
    expect(marker.workingSet.runningTasks).toEqual([TASK]);
    expect(graph.peekCompactBriefing(TAB_A)?.outcome?.notCarried.runningTasks).toEqual([TASK]);
    // 옛 훅 경로는 바뀐 `body.session_id`(버블 키)로 꺼냈다 — 그 키로는 아무것도 안 나와야 한다.
    expect(graph.takeCompactBriefing(bubbleKey)).toBeUndefined();
  });
});

describe('§5.26 (E) 훅 경로 — 압축 없는 세션에는 싣지 않는다', () => {
  it('① 형제 탭의 첫 프롬프트는 남의 브리핑을 받지 않는다', () => {
    const { graph } = setup();
    // 판정이 "조립 세션"을 몰라도(최악의 경우) 키가 갈려 있으니 새지 않는다.
    expect(takeHookRecoveryBriefing(TAB_B, hookDeps(graph, new Set()))).toBe('');
    expect(graph.peekCompactBriefing(TAB_B)).toBeUndefined();
    // 탭 A 의 브리핑은 그대로 남아 있다.
    expect(graph.peekCompactBriefing(TAB_A)).toBeDefined();
  });

  it('세션 id 가 비면 아무것도 꺼내지 않는다', () => {
    const { graph } = setup();
    const deps = hookDeps(graph, new Set());
    expect(takeHookRecoveryBriefing('', deps)).toBe('');
    expect(deps.take).not.toHaveBeenCalled();
  });
});

describe('§5.26 (E) 훅 경로 — 우리가 조립하는 세션은 건너뛴다', () => {
  it('② 압축된 탭 자신의 훅에도 싣지 않고, 꺼내지도 않는다 — 스폰 경로가 실을 몫이다', () => {
    const { graph } = setup();
    const deps = hookDeps(graph, new Set([TAB_A, TAB_B]));
    expect(takeHookRecoveryBriefing(TAB_A, deps)).toBe('');
    // 꺼낸 뒤 버리면 `briefedAt` 이 찍혀 다음 턴 조립이 실을 것이 없다.
    expect(deps.take).not.toHaveBeenCalled();
    expect(graph.peekCompactBriefing(TAB_A)).toBeDefined();
  });

  it('③ 턴 도중 [작업에 반영] 메시지의 `UserPromptSubmit` 에도 붙지 않는다', () => {
    const { graph } = setup();
    const deps = hookDeps(graph, new Set([TAB_A, TAB_B]));
    // 탭 B 가 일하는 중에 사용자가 조종 메시지를 넣었다 — CLI 가 도구 경계에서 꺼내며 훅을 낸다.
    expect(takeHookRecoveryBriefing(TAB_B, deps)).toBe('');
    expect(takeHookRecoveryBriefing(TAB_A, deps)).toBe('');
    expect(deps.take).not.toHaveBeenCalled();
    expect(graph.peekCompactBriefing(TAB_A)?.briefedAt).toBeUndefined();
  });
});

describe('§5.26 (E) 훅 경로 — 바깥 세션은 그대로 받는다', () => {
  function seedExternal(): ProjectGraph {
    const graph = new ProjectGraph();
    graph.registerProject(root);
    const file = transcript(EXTERNAL);
    const marker = graph.recordCompactMarker({
      sessionId: EXTERNAL, transcriptPath: file, cwd: root, runningTasks: [TASK],
    });
    if (!marker) throw new Error('마커를 못 세웠다 — 하네스가 틀렸다');
    appendCompaction(file);
    graph.sweepCompactOutcomes();
    return graph;
  }

  it('압축 뒤 첫 프롬프트에 한 번, 다음부터는 싣지 않는다', () => {
    const graph = seedExternal();
    const deps = hookDeps(graph, new Set());
    const first = takeHookRecoveryBriefing(EXTERNAL, deps);
    expect(first).toContain('# 방금 대화가 압축됐다');
    expect(first).toContain(TASK);
    expect(takeHookRecoveryBriefing(EXTERNAL, deps)).toBe('');
  });

  it('주입원 창에서 끄면 싣지 않고 소모하지도 않는다', () => {
    const graph = seedExternal();
    expect(takeHookRecoveryBriefing(EXTERNAL, hookDeps(graph, new Set(), false))).toBe('');
    expect(graph.peekCompactBriefing(EXTERNAL)).toBeDefined();
  });
});

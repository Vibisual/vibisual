/**
 * §5.26 (F) `[지금 사본 뜨기]` — 세션 탭의 사본이 그 탭의 대화록으로, 주인 버블의 프로젝트 원장에 서는가.
 * 재현하는 사고: 라우트가 탭의 CLI UUID 를 그래프 키로 넘겨 프로젝트를 못 짚고 409("no transcript for this session")가 났다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraph } from './projectGraph.js';
import { resolveSnapshotTarget, type SnapshotTargetDeps } from './insuranceSnapshotTarget.js';

const TAB_A = '11111111-2222-4333-8444-555555555555';
const TAB_B = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const HOOK_ONLY = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const BUBBLE = 'agent-1';
const BUBBLE_KEY = 'custom-abc-1-x';

function deps(subs: { id: string; sessionId: string; parentAgentId: string }[]): SnapshotTargetDeps {
  return {
    getSub: (id) => subs.find((s) => s.id === id),
    findSubBySessionId: (sid) => subs.find((s) => s.sessionId === sid),
    findSessionByAgentId: (agentId) => (agentId === BUBBLE ? BUBBLE_KEY : null),
  };
}

const TABS = [
  { id: 'sub-a', sessionId: TAB_A, parentAgentId: BUBBLE },
  { id: 'sub-b', sessionId: TAB_B, parentAgentId: BUBBLE },
];

describe('resolveSnapshotTarget', () => {
  it('탭 id 만 오면 그 탭의 UUID 가 마커 신원, 주인 버블 키가 그래프 키다', () => {
    expect(resolveSnapshotTarget({ subAgentId: 'sub-a' }, deps(TABS))).toEqual({
      graphSessionId: BUBBLE_KEY,
      claudeSessionId: TAB_A,
      subAgentId: 'sub-a',
    });
  });

  it('UUID 만 와도 탭을 찾아 같은 두 키로 푼다 — 형제 탭으로 새지 않는다', () => {
    expect(resolveSnapshotTarget({ sessionId: TAB_B }, deps(TABS))).toEqual({
      graphSessionId: BUBBLE_KEY,
      claudeSessionId: TAB_B,
      subAgentId: 'sub-b',
    });
  });

  it('훅으로만 붙은 세션은 CLI id 가 곧 그래프 키다', () => {
    expect(resolveSnapshotTarget({ sessionId: HOOK_ONLY }, deps(TABS))).toEqual({
      graphSessionId: HOOK_ONLY,
      claudeSessionId: HOOK_ONLY,
    });
  });

  it('UUID 가 없는 탭(CMD 처럼 아직 못 받은 것)은 풀지 않는다', () => {
    const cmdTab = [{ id: 'sub-c', sessionId: '', parentAgentId: BUBBLE }];
    expect(resolveSnapshotTarget({ subAgentId: 'sub-c' }, deps(cmdTab))).toBeNull();
    expect(resolveSnapshotTarget({}, deps(TABS))).toBeNull();
  });
});

describe('§5.26 (F) 세션 탭의 손 사본은 주인 버블 원장에 선다', () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-snapshot-target-')));
  });

  afterEach(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 임시 폴더 정리 실패는 시험 결과가 아니다 */ }
  });

  it('UUID 를 그래프 키로 넘기던 옛 라우트는 못 서고, 푼 두 키로는 그 탭의 마커가 선다', () => {
    const graph = new ProjectGraph();
    const projectName = graph.registerProject(root).name;
    const agent = graph.createCustomAgent('worker', undefined, projectName);
    const bubbleKey = graph.findSessionByAgentId(agent.id)!;
    const file = path.join(root, `${TAB_A}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: 'user', message: { role: 'user', content: '대화' } })}\n`, 'utf8');

    // 옛 라우트 모양 — 경로가 있어도 프로젝트를 못 짚는다.
    expect(graph.recordCompactMarker({ sessionId: TAB_A, transcriptPath: file, trigger: 'manual' })).toBeNull();

    const target = resolveSnapshotTarget({ subAgentId: 'sub-a' }, {
      getSub: (id) => (id === 'sub-a' ? { id, sessionId: TAB_A, parentAgentId: agent.id } : undefined),
      findSubBySessionId: () => undefined,
      findSessionByAgentId: (id) => graph.findSessionByAgentId(id),
    });
    expect(target?.graphSessionId).toBe(bubbleKey);

    const marker = graph.recordCompactMarker({
      sessionId: target!.graphSessionId,
      claudeSessionId: target!.claudeSessionId,
      transcriptPath: file,
      trigger: 'manual',
      ...(target!.subAgentId ? { subAgentId: target!.subAgentId } : {}),
    });
    expect(marker).not.toBeNull();
    expect(marker?.sessionId).toBe(TAB_A);
    expect(marker?.projectName).toBe(projectName);
    expect(marker?.agentId).toBe(agent.id);
    expect(marker?.subAgentId).toBe('sub-a');
    expect(marker?.trigger).toBe('manual');
  });
});

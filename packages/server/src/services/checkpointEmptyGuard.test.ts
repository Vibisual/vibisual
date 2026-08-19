/**
 * §3.2.1-3 통째-0 가드의 **루트 노드 예외** 회귀 테스트.
 *
 * 배경: 가드는 "디스크에 뭐라도 있었는데 새 저장본이 비었다" 를 빈 인스턴스의 덮어쓰기로 보고 거부한다.
 * 그런데 프로젝트 루트 노드(`__root__:<이름>`)는 프로젝트를 등록하면 자동으로 생기는 골격이라
 * 지켜야 할 사용자 데이터가 아니다. 워크트리처럼 화면 표현이 부모 캔버스로 옮겨간 프로젝트는
 * 자기 소유 버블이 **정상적으로 0개**가 되는데, 디스크에 루트 노드 하나가 남아 있으면 매 저장이 거부됐다.
 *
 * 거부는 디스크도 합계 캐시도 갱신하지 않으므로 다음 저장의 판정 조건이 그대로 남는다 —
 * 즉 한 번 이 상태에 빠지면 **영원히** 같은 경고가 쌓인다(가드가 자기를 발화시키는 파일을 스스로 보존).
 *
 * 계약: 루트 노드는 보호 대상 집계에서 빼되, **실제 버블이 하나라도 있으면 종전대로 거부**한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectCheckpoint, ProjectInfo } from '@vibisual/shared';
import { writeCheckpoint } from './statePersistence.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-emptyguard-')));
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** 테스트용 프로젝트 폴더 하나. 이름이 곧 폴더명이라 체크포인트 경로도 테스트마다 갈린다
 *  (합계 캐시는 경로 키라, 폴더를 나누면 테스트끼리 서로 오염되지 않는다). */
function makeProject(name: string): ProjectInfo {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return { name, path: dir.replace(/\\/g, '/') };
}

function cpPathOf(project: ProjectInfo): string {
  return path.join(project.path, '.vibisual', 'save', 'checkpoint.json');
}

function makeCheckpoint(project: ProjectInfo, nodeKeys: string[], agentIds: string[] = []): ProjectCheckpoint {
  const bubble = (key: string, bubbleType: string) => ({
    id: `${bubbleType}-${key}`,
    label: key,
    bubbleType,
    path: key,
    status: 'idle',
    activity: 0,
    lastActivity: Date.now(),
    childCount: 0,
  });
  return {
    version: 1,
    seq: 1,
    savedAt: Date.now(),
    project,
    graph: {
      agentCounter: 0,
      agents: Object.fromEntries(agentIds.map((a) => [a, bubble(a, 'agent')])),
      nodes: Object.fromEntries(nodeKeys.map((k) => [k, bubble(k, k.startsWith('__root__') ? 'root' : 'file')])),
      refs: {},
    },
  } as unknown as ProjectCheckpoint;
}

/** 디스크에 실제로 남은 그래프 합계. */
function diskTotals(project: ProjectInfo): { agents: number; nodes: number } {
  const o = JSON.parse(fs.readFileSync(cpPathOf(project), 'utf8')) as {
    graph: { agents?: Record<string, unknown>; nodes?: Record<string, unknown> };
  };
  return {
    agents: Object.keys(o.graph.agents ?? {}).length,
    nodes: Object.keys(o.graph.nodes ?? {}).length,
  };
}

describe('통째-0 가드 — 루트 노드는 보호 대상이 아니다', () => {
  it('디스크가 루트 노드 하나뿐이면 빈 저장을 통과시킨다 (합계 캐시 경로)', () => {
    const project = makeProject('root-only-cached');

    writeCheckpoint(makeCheckpoint(project, ['__root__:root-only-cached']));
    expect(diskTotals(project)).toEqual({ agents: 0, nodes: 1 });

    writeCheckpoint(makeCheckpoint(project, []));
    expect(diskTotals(project)).toEqual({ agents: 0, nodes: 0 });
  });

  it('부팅 직후처럼 캐시가 비어 있어도 같은 판정이다 (디스크 판독 경로)', () => {
    const project = makeProject('root-only-from-disk');
    const cpPath = cpPathOf(project);
    fs.mkdirSync(path.dirname(cpPath), { recursive: true });
    // 이 프로세스가 쓴 적 없는 파일 = 합계 캐시 미스 → readCheckpointTotalsFromDisk 로 비교한다.
    fs.writeFileSync(cpPath, JSON.stringify(makeCheckpoint(project, ['__root__:root-only-from-disk'])), 'utf8');

    writeCheckpoint(makeCheckpoint(project, []));
    expect(diskTotals(project)).toEqual({ agents: 0, nodes: 0 });
  });

  it('프로젝트별 키 이전의 레거시 루트 키(`__root__`)도 같은 예외를 받는다', () => {
    const project = makeProject('legacy-root');

    writeCheckpoint(makeCheckpoint(project, ['__root__']));
    writeCheckpoint(makeCheckpoint(project, []));

    expect(diskTotals(project)).toEqual({ agents: 0, nodes: 0 });
  });
});

describe('통째-0 가드 — 실제 버블이 있으면 종전대로 지킨다', () => {
  it('루트 노드 + 파일 노드가 있으면 빈 저장을 거부한다', () => {
    const project = makeProject('has-file-node');

    writeCheckpoint(makeCheckpoint(project, ['__root__:has-file-node', 'src/index.ts']));
    expect(diskTotals(project)).toEqual({ agents: 0, nodes: 2 });

    writeCheckpoint(makeCheckpoint(project, []));
    expect(diskTotals(project)).toEqual({ agents: 0, nodes: 2 }); // 보존
  });

  it('에이전트만 있어도 빈 저장을 거부한다', () => {
    const project = makeProject('has-agent');

    writeCheckpoint(makeCheckpoint(project, [], ['sess-1']));
    expect(diskTotals(project)).toEqual({ agents: 1, nodes: 0 });

    writeCheckpoint(makeCheckpoint(project, []));
    expect(diskTotals(project)).toEqual({ agents: 1, nodes: 0 }); // 보존
  });

  it('루트 노드가 섞여 있어도 실제 버블 수로 판정한다 (루트만 예외)', () => {
    const project = makeProject('root-plus-agent');

    writeCheckpoint(makeCheckpoint(project, ['__root__:root-plus-agent'], ['sess-1']));
    writeCheckpoint(makeCheckpoint(project, []));

    expect(diskTotals(project)).toEqual({ agents: 1, nodes: 1 }); // 보존
  });
});

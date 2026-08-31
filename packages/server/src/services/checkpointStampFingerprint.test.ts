/**
 * §3.2.4 — **저장 시각 하나가 "안 바뀌었으면 쓰지 않는다"를 무력화하던 자리**의 회귀 테스트.
 *
 * `SaveScheduler` 는 직렬화 결과의 지문을 들고 있다가 같으면 디스크 쓰기(백업 복사 + 원자적 쓰기)를
 * 통째로 건너뛴다. 그런데 체크포인트 core 에는 `savedAt: Date.now()` 가 들어 있어, 그래프가 한 톨도
 * 안 바뀐 저장에서도 지문이 매번 달라졌다 — 스킵이 **한 번도 발동하지 못했다.**
 *
 * 실측(2026-08-31): 가동 6.1시간 메인 프로세스 누적 쓰기 15.2GB(2.5GB/h). 서버가 메인 프로세스와
 * 한 몸이라 그 동기 I/O 가 곧 UI 멈칫이다. 2026-08-19 라운드가 같은 이유로 `seq` 를 "저장 대상만
 * 올린다"로 고쳤을 때 `savedAt` 은 함께 잡히지 않았다.
 *
 * 여기서 고정하는 계약: **저장 시각만 다른 저장은 디스크를 건드리지 않는다. 내용이 바뀌면 쓴다.**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectCheckpoint, ProjectInfo } from '@vibisual/shared';
import { SaveScheduler, fingerprintSource } from './statePersistence.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-stampfp-')));
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

function makeProject(name: string): ProjectInfo {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return { name, path: dir.replace(/\\/g, '/') };
}

function cpPathOf(project: ProjectInfo): string {
  return path.join(project.path, '.vibisual', 'save', 'checkpoint.json');
}

/** 노드는 늘 하나 이상 둔다 — 통째-0 가드가 저장을 거부하면 이 시험의 관찰 대상이 사라진다. */
function makeCheckpoint(project: ProjectInfo, savedAt: number, nodeKeys: string[] = ['file-a']): ProjectCheckpoint {
  const bubble = (key: string) => ({
    id: `file-${key}`,
    label: key,
    bubbleType: 'file',
    path: key,
    status: 'idle',
    activity: 0,
    lastActivity: 1_700_000_000_000,
    childCount: 0,
  });
  return {
    version: 1,
    seq: 1,
    savedAt,
    project,
    graph: {
      agentCounter: 0,
      agents: {},
      nodes: Object.fromEntries(nodeKeys.map((k) => [k, bubble(k)])),
      refs: {},
    },
  } as unknown as ProjectCheckpoint;
}

describe('fingerprintSource — 지문에서 저장 시각을 고정한다', () => {
  it('savedAt 만 다른 두 직렬화가 같은 지문 원본이 된다', () => {
    const a = JSON.stringify({ version: 1, savedAt: 1_700_000_000_000, graph: { nodes: {} } });
    const b = JSON.stringify({ version: 1, savedAt: 1_700_000_999_999, graph: { nodes: {} } });

    expect(a).not.toBe(b);
    expect(fingerprintSource(a)).toBe(fingerprintSource(b));
  });

  it('내용이 다르면 여전히 다르다 — 변경 감지를 잃지 않는다', () => {
    const a = JSON.stringify({ savedAt: 1, graph: { nodes: { x: 1 } } });
    const b = JSON.stringify({ savedAt: 1, graph: { nodes: { x: 2 } } });

    expect(fingerprintSource(a)).not.toBe(fingerprintSource(b));
  });

  it('중첩된 savedAt(identity 등)도 함께 고정한다', () => {
    const a = JSON.stringify({ savedAt: 10, identity: { savedAt: 11 } });
    const b = JSON.stringify({ savedAt: 20, identity: { savedAt: 21 } });

    expect(fingerprintSource(a)).toBe(fingerprintSource(b));
  });

  it('savedAt 이 없는 문서는 그대로 둔다', () => {
    const json = JSON.stringify({ version: 1, graph: {} });
    expect(fingerprintSource(json)).toBe(json);
  });
});

describe('SaveScheduler — 저장 시각만 바뀐 저장은 디스크를 건드리지 않는다', () => {
  it('savedAt 만 다르면 두 번째 저장이 파일을 다시 쓰지 않는다', () => {
    const project = makeProject('stamp-skip');
    const scheduler = new SaveScheduler();
    const cpPath = cpPathOf(project);

    scheduler.forceCheckpoint(makeCheckpoint(project, 1_000));
    expect(fs.existsSync(cpPath)).toBe(true);

    // 파일을 치운다 — 다시 생기면 "스킵이 안 됐다"는 뜻이다(디스크 쓰기의 직접 증거).
    fs.rmSync(cpPath);
    scheduler.forceCheckpoint(makeCheckpoint(project, 2_000));
    expect(fs.existsSync(cpPath)).toBe(false);

    // 몇 번을 더 불러도 마찬가지 — 조용한 프로젝트는 조용히 있는다.
    scheduler.forceCheckpoint(makeCheckpoint(project, 3_000));
    scheduler.forceCheckpoint(makeCheckpoint(project, 4_000));
    expect(fs.existsSync(cpPath)).toBe(false);
  });

  it('그래프가 실제로 바뀌면 저장한다 — 스킵이 유실로 번지지 않는다', () => {
    const project = makeProject('stamp-change');
    const scheduler = new SaveScheduler();
    const cpPath = cpPathOf(project);

    scheduler.forceCheckpoint(makeCheckpoint(project, 1_000));
    fs.rmSync(cpPath);

    // 노드가 하나 늘었다 = 내용 변경 → 반드시 써야 한다.
    scheduler.forceCheckpoint(makeCheckpoint(project, 2_000, ['file-a', 'file-b']));
    expect(fs.existsSync(cpPath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(cpPath, 'utf8')) as ProjectCheckpoint;
    expect(Object.keys(saved.graph.nodes)).toHaveLength(2);
  });

  it('디스크에 남는 savedAt 은 정규화하지 않는다 — 비교용 사본에만 적용한다', () => {
    const project = makeProject('stamp-preserved');
    const scheduler = new SaveScheduler();

    scheduler.forceCheckpoint(makeCheckpoint(project, 1_700_000_123_456));

    const saved = JSON.parse(fs.readFileSync(cpPathOf(project), 'utf8')) as ProjectCheckpoint;
    expect(saved.savedAt).toBe(1_700_000_123_456);
  });
});

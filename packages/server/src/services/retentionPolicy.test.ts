/**
 * §3.2.3 보존 정책 회귀 테스트.
 *
 * 지키는 것은 두 가지다.
 *  1. **쓸수록 커지던 축이 실제로 멈춘다** — 병합창(D)·경로 개수(E)·보존 기간(A).
 *  2. **사용자가 보던 것은 줄지 않는다** — `0`(무제한)이면 종전과 바이트 단위로 같고,
 *     `unlimitedFileEdits` 로 사용자가 명시한 파일은 어느 축에도 걸리지 않는다.
 *
 * 그리고 §3.2.2 `activity.json` 분리는 **왕복이 손실 없이 같은가**로 검증한다 — 갈라 담았는데
 * 복원이 달라지면 그건 최적화가 아니라 데이터 손실이다. 구버전 트리(파일 없음) 하위호환도 함께 본다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectCheckpoint, ProjectInfo, RetentionSettings } from '@vibisual/shared';
import { DEFAULT_RETENTION_SETTINGS } from '@vibisual/shared';

// 보존 설정은 머신 단위(`~/.vibisual/app-state.json`)라 테스트가 사용자 실제 설정을 읽으면 안 된다.
// 여기서만 갈아 끼운다 — 판정 로직은 그대로 두고 입력만 고정하는 것이 목적.
const retention = vi.hoisted(() => ({ current: null as RetentionSettings | null }));
vi.mock('./appState.js', () => ({
  appStateGetRetention: (): RetentionSettings => retention.current as RetentionSettings,
}));

const { ProjectGraph } = await import('./projectGraph.js');
const { writeCheckpoint, discoverProjectMetas, loadCheckpointByMeta, projectDirForInfo, splitCheckpointForDisk } =
  await import('./statePersistence.js');

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-retention-')));
  retention.current = { ...DEFAULT_RETENTION_SETTINGS };
});

afterEach(() => {
  vi.useRealTimers();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** 파일 하나를 만들고 그 파일에 대한 Edit PostToolUse 훅 이벤트를 흘려보낸다. */
function editFile(graph: InstanceType<typeof ProjectGraph>, sessionId: string, relPath: string, newText: string): void {
  const abs = path.join(tmpRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, newText, 'utf8');
  graph.processHookEvent({
    session_id: sessionId,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    // tool_use_id 가 같으면 중복 방지(`fileEditSeen`)에 걸리므로 매번 다르게 준다.
    tool_use_id: `toolu-${relPath}-${newText}-${Date.now()}-${Math.random()}`,
    tool_input: { file_path: abs, old_string: 'before', new_string: newText },
    cwd: tmpRoot,
  });
}

function editsFor(graph: InstanceType<typeof ProjectGraph>, projectName: string, suffix: string) {
  const cp = graph.toProjectCheckpoint(projectName);
  const key = Object.keys(cp.activity?.fileEdits ?? {}).find((k) => k.endsWith(suffix));
  return key ? cp.activity!.fileEdits[key] ?? [] : [];
}

// ─────────────────────────────────────────────────────────────
describe('D축 — 연속 편집 병합창', () => {
  it('병합창 안의 연속 편집은 한 항목으로 합쳐지고, oldString 은 처음 것을 유지한다', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-13T00:00:00Z'));
    retention.current = { ...DEFAULT_RETENTION_SETTINGS, fileEditMergeWindowMs: 10_000 };

    const graph = new ProjectGraph();
    const project = graph.registerProject(tmpRoot);

    editFile(graph, 'sess-merge', 'a.ts', 'first');
    vi.advanceTimersByTime(3_000); // 병합창 안
    editFile(graph, 'sess-merge', 'a.ts', 'second');

    const edits = editsFor(graph, project.name, 'a.ts');
    expect(edits).toHaveLength(1);
    expect(edits[0]?.newString).toBe('second');   // 최신 내용으로 갱신되고
    expect(edits[0]?.oldString).toBe('before');   // 창 전체의 시작점은 유지된다
  });

  it('병합창을 벗어나면 별개 항목으로 남는다', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-13T00:00:00Z'));
    retention.current = { ...DEFAULT_RETENTION_SETTINGS, fileEditMergeWindowMs: 10_000 };

    const graph = new ProjectGraph();
    const project = graph.registerProject(tmpRoot);

    editFile(graph, 'sess-merge2', 'a.ts', 'first');
    vi.advanceTimersByTime(30_000); // 창 밖
    editFile(graph, 'sess-merge2', 'a.ts', 'second');

    expect(editsFor(graph, project.name, 'a.ts')).toHaveLength(2);
  });

  it('병합창 0 이면 합치지 않는다 (= 종전 동작)', () => {
    retention.current = { ...DEFAULT_RETENTION_SETTINGS, fileEditMergeWindowMs: 0 };
    const graph = new ProjectGraph();
    const project = graph.registerProject(tmpRoot);

    editFile(graph, 'sess-merge3', 'a.ts', 'first');
    editFile(graph, 'sess-merge3', 'a.ts', 'second');

    expect(editsFor(graph, project.name, 'a.ts')).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────
describe('E축 — 편집 이력을 든 경로 개수 상한', () => {
  it('상한을 넘으면 마지막 편집이 가장 오래된 경로부터 버린다', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-13T00:00:00Z'));
    retention.current = { ...DEFAULT_RETENTION_SETTINGS, maxFileEditPaths: 2, fileEditMergeWindowMs: 0 };

    const graph = new ProjectGraph();
    const project = graph.registerProject(tmpRoot);

    editFile(graph, 'sess-lru', 'old.ts', 'x');
    vi.advanceTimersByTime(60_000);
    editFile(graph, 'sess-lru', 'mid.ts', 'x');
    vi.advanceTimersByTime(60_000);
    editFile(graph, 'sess-lru', 'new.ts', 'x');

    const keys = Object.keys(graph.toProjectCheckpoint(project.name).activity?.fileEdits ?? {});
    expect(keys).toHaveLength(2);
    expect(keys.some((k) => k.endsWith('old.ts'))).toBe(false); // 가장 오래된 것이 나갔다
    expect(keys.some((k) => k.endsWith('mid.ts'))).toBe(true);
    expect(keys.some((k) => k.endsWith('new.ts'))).toBe(true);
  });

  it('상한 0 이면 무제한 — 종전처럼 계속 쌓인다', () => {
    retention.current = { ...DEFAULT_RETENTION_SETTINGS, maxFileEditPaths: 0, fileEditMergeWindowMs: 0 };
    const graph = new ProjectGraph();
    const project = graph.registerProject(tmpRoot);

    for (const rel of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) editFile(graph, 'sess-unl', rel, 'x');

    expect(Object.keys(graph.toProjectCheckpoint(project.name).activity?.fileEdits ?? {})).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A축 — 보존 기간', () => {
  it('pruneFileEditRetention 이 보존 기간을 넘긴 편집을 버린다', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    retention.current = { ...DEFAULT_RETENTION_SETTINGS, fileEditRetentionDays: 30, fileEditMergeWindowMs: 0 };

    const graph = new ProjectGraph();
    const project = graph.registerProject(tmpRoot);
    editFile(graph, 'sess-age', 'stale.ts', 'x');
    expect(editsFor(graph, project.name, 'stale.ts')).toHaveLength(1);

    // 40일 뒤 — 보존 기간(30일)을 넘겼다.
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'));
    const result = graph.pruneFileEditRetention();

    expect(result.removedEdits).toBe(1);
    expect(result.removedPaths).toBe(1);
    expect(editsFor(graph, project.name, 'stale.ts')).toHaveLength(0);
  });

  it('보존 기간 0 이면 아무리 오래돼도 버리지 않는다 (무제한)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    retention.current = { ...DEFAULT_RETENTION_SETTINGS, fileEditRetentionDays: 0, fileEditMergeWindowMs: 0 };

    const graph = new ProjectGraph();
    const project = graph.registerProject(tmpRoot);
    editFile(graph, 'sess-forever', 'keep.ts', 'x');

    vi.setSystemTime(new Date('2026-08-13T00:00:00Z')); // 6년 뒤
    const result = graph.pruneFileEditRetention();

    expect(result.removedEdits).toBe(0);
    expect(editsFor(graph, project.name, 'keep.ts')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
describe('§3.2.2 activity.json 물리 분리', () => {
  function seedCheckpoint(): { graph: InstanceType<typeof ProjectGraph>; project: ProjectInfo; cp: ProjectCheckpoint } {
    const graph = new ProjectGraph();
    const project = graph.registerProject(tmpRoot);
    editFile(graph, 'sess-split', 'split.ts', 'x');
    return { graph, project, cp: graph.toProjectCheckpoint(project.name) };
  }

  it('checkpoint.json 은 이력을 비우고, activity.json 이 그것을 든다', () => {
    const { project, cp } = seedCheckpoint();
    expect(Object.keys(cp.activity?.fileEdits ?? {}).length).toBeGreaterThan(0);

    writeCheckpoint(cp);

    const saveDir = projectDirForInfo(project);
    const onDisk = JSON.parse(fs.readFileSync(path.join(saveDir, 'checkpoint.json'), 'utf8')) as ProjectCheckpoint;
    expect(Object.keys(onDisk.activity?.fileEdits ?? {})).toHaveLength(0); // 골격 파일에는 이력이 없다

    const activityPath = path.join(saveDir, 'activity.json');
    expect(fs.existsSync(activityPath)).toBe(true);
    const activityFile = JSON.parse(fs.readFileSync(activityPath, 'utf8')) as { activity: ProjectCheckpoint['activity'] };
    expect(Object.keys(activityFile.activity.fileEdits)).toHaveLength(1);
  });

  it('왕복이 손실 없이 같다 — 나눠 담아도 복원 결과가 종전과 동일하다', () => {
    const { project, cp } = seedCheckpoint();
    writeCheckpoint(cp);

    const meta = discoverProjectMetas([project.path]).find((m) => m.project.path === project.path);
    expect(meta).toBeDefined();
    const loaded = loadCheckpointByMeta(meta!);

    expect(loaded).not.toBeNull();
    expect(loaded!.activity.fileEdits).toEqual(cp.activity.fileEdits);
    expect(loaded!.activity.bashHistory).toEqual(cp.activity.bashHistory);
  });

  it('구버전 트리 하위호환 — activity.json 이 없으면 checkpoint 안의 이력을 그대로 읽는다', () => {
    const { project, cp } = seedCheckpoint();
    writeCheckpoint(cp);

    const saveDir = projectDirForInfo(project);
    // 구버전이 저장한 모양을 그대로 만든다: 이력이 checkpoint 안에 있고 activity.json 은 없다.
    fs.writeFileSync(path.join(saveDir, 'checkpoint.json'), JSON.stringify(cp), 'utf8');
    for (const f of fs.readdirSync(saveDir)) {
      if (f.startsWith('activity.json')) fs.unlinkSync(path.join(saveDir, f));
    }

    const meta = discoverProjectMetas([project.path]).find((m) => m.project.path === project.path);
    const loaded = loadCheckpointByMeta(meta!);

    expect(loaded).not.toBeNull();
    expect(loaded!.activity.fileEdits).toEqual(cp.activity.fileEdits);
  });

  it('splitCheckpointForDisk 는 원본을 건드리지 않는다 (호출자가 계속 쓰는 객체다)', () => {
    const { cp } = seedCheckpoint();
    const beforeKeys = Object.keys(cp.activity.fileEdits).length;

    const { core, activity } = splitCheckpointForDisk(cp);

    expect(Object.keys(cp.activity.fileEdits)).toHaveLength(beforeKeys); // 원본 그대로
    expect(Object.keys(core.activity.fileEdits)).toHaveLength(0);
    expect(Object.keys(activity.activity.fileEdits)).toHaveLength(beforeKeys);
  });
});

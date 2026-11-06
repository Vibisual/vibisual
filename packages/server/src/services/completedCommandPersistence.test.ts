/**
 * §3.2.3 — 사용자가 보낸 말(완료 이력 `completedCommands`)은 앱을 껐다 켜도 남는다.
 * 직접 타이핑한 원문이라 다른 어디서도 재생성할 수 없다 — 지키는 시험이 없으면 회귀가 조용히 지나간다(어느 시점 이후 저장된 프로젝트가 전부 0건이 된 적이 있다).
 * 잠그는 것 셋: 완료된 명령이 ① 체크포인트에 실리고 ② 껐다 켠 뒤 되살아나고 ③ 그 세션의 큐가 비어 있어도(평소 상태) 남는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { QueuedCommand } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { ProjectGraphManager } from './projectGraphManager.js';
import { pathKey } from './pathKey.js';
import { trySendLiveFollowUp } from './liveFollowUp.js';

// Manager registration must never write this test project to the user's app state.
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-cmdpersist-')));
});

afterEach(() => {
  vi.restoreAllMocks();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

const SESSION = 'custom-persist-1';

function cmd(id: string, text: string): QueuedCommand {
  return {
    id,
    text,
    timestamp: 1_700_000_000_000,
    subAgentId: null,
    status: 'completed',
    result: '됐습니다',
  } as QueuedCommand;
}

/** 실제 앱과 같은 배선 — 그래프는 큐/아카이브 Map 을 참조로 들고 index.ts 가 그 Map 에 명령을 넣는다(`archiveCompletedCommands`). 시험도 ref 를 주입해야 실제 경로를 밟는다. */
function makeGraph(): {
  graph: ProjectGraph;
  projectName: string;
  archive: Map<string, QueuedCommand[]>;
  queues: Map<string, QueuedCommand[]>;
} {
  const graph = new ProjectGraph();
  const queues = new Map<string, QueuedCommand[]>();
  const archive = new Map<string, QueuedCommand[]>();
  graph.setCommandQueuesRef(queues);
  graph.setCompletedCommandArchiveRef(archive);
  const info = graph.registerProject(tmpRoot);
  // 그 세션이 이 프로젝트에서 돈다는 사실을 남긴다(훅 한 건 = 실제 앱의 등록 경로).
  graph.processHookEvent({
    session_id: SESSION,
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_use_id: 'toolu-persist-1',
    tool_input: { file_path: path.join(tmpRoot, 'a.txt') },
    cwd: tmpRoot,
  });
  return { graph, projectName: info?.name ?? 'unknown', archive, queues };
}

describe('§3.2.3 — 완료 명령(사용자 말풍선)은 저장·복원된다', () => {
  it.each(['restoreFromCheckpoint', 'mergeFromCheckpoint'] as const)('%s restores interrupted deliveries as uncertain without changing saved input', (restore) => {
    const { graph, projectName, queues } = makeGraph();
    const sending: QueuedCommand = { ...cmd('sending', 'Reflect this in the current task'), status: 'queued',
      dispatchMode: 'steer', liveDelivery: { state: 'sending' }, attachments: ['design.png'] };
    // §5.5 #17-18 ⑫ — queued in the old process only; whether it ran is unknown.
    const received: QueuedCommand = { ...cmd('received', 'Queued by the engine'), status: 'queued',
      dispatchMode: 'steer', liveDelivery: { state: 'received', receivedAt: 5 } };
    const unavailable: QueuedCommand = { ...cmd('unavailable', 'Keep this input'), status: 'queued',
      dispatchMode: 'steer', liveDelivery: { state: 'unavailable', reason: 'noActiveTurn' } };
    const uncertain: QueuedCommand = { ...cmd('uncertain', 'Already unknown'), status: 'queued',
      dispatchMode: 'steer', liveDelivery: { state: 'uncertain', reason: 'deliveryUnknown' } };
    const waiting: QueuedCommand = { ...cmd('waiting', 'Wait for the previous delivery'), status: 'queued', dispatchMode: 'steer' };
    const ordinary: QueuedCommand = { ...cmd('ordinary', 'Run later'), status: 'queued' };
    queues.set(SESSION, [sending, unavailable, uncertain, waiting, ordinary, received]);
    const cp = JSON.parse(JSON.stringify(graph.toProjectCheckpoint(projectName)!));
    const revived = new ProjectGraph();
    const revivedQueues = new Map<string, QueuedCommand[]>();
    revived.setCommandQueuesRef(revivedQueues);
    revived.setCompletedCommandArchiveRef(new Map());
    const restoredFrom = Date.now();
    revived[restore](cp);
    const restoredTo = Date.now();

    expect(revivedQueues.get(SESSION)).toEqual([
      { ...sending, liveDelivery: { state: 'uncertain', reason: 'deliveryUnknown', decidedAt: expect.any(Number) } },
      unavailable, uncertain,
      { ...waiting, liveDelivery: { state: 'unavailable', reason: 'noActiveTurn' } }, ordinary,
      { ...received, liveDelivery: { state: 'uncertain', reason: 'deliveryUnknown', decidedAt: expect.any(Number) } },
    ]);
    // §5.5 #17-18 ⑥-6 — 복원이 정한 확인 불가는 그 시각에 선다(옛 출력 끝 = 끄기 전 꼬리 자리). 이미 확인 불가였던 것은 그대로.
    const decidedAt = revivedQueues.get(SESSION)![0]!.liveDelivery!.decidedAt!;
    expect(decidedAt).toBeGreaterThanOrEqual(restoredFrom);
    expect(decidedAt).toBeLessThanOrEqual(restoredTo);
    expect(cp.commandQueues[SESSION][0].liveDelivery).toEqual({ state: 'sending' });
    expect(sending.liveDelivery).toEqual({ state: 'sending' });
    expect(cp.commandQueues[SESSION][3].liveDelivery).toBeUndefined();
    expect(waiting.liveDelivery).toBeUndefined();
  });

  it.each([
    { routed: true, archived: false },
    { routed: false, archived: false },
    { routed: true, archived: true },
  ])('invalidates a cached command snapshot after live acknowledgement: %j', async ({ routed, archived }) => {
    const { graph, queues, archive } = makeGraph();
    const manager = new ProjectGraphManager();
    const state = manager as unknown as {
      instances: Map<string, ProjectGraph>;
      sessionRouting: Map<string, string>;
    };
    state.instances.set(pathKey(tmpRoot), graph);
    if (routed) state.sessionRouting.set(SESSION, pathKey(tmpRoot));
    const base: QueuedCommand = { ...cmd('active-cached', 'Original request'), subAgentId: 'live-cached-sub', status: 'executing' };
    const incoming: QueuedCommand = { ...cmd('incoming-cached', 'Keep this separate'), subAgentId: base.subAgentId,
      status: 'queued', dispatchMode: 'steer', attachments: ['addition.png'] };
    queues.set(SESSION, [base, incoming]);
    // Keep the TTL valid so a missing invalidation cannot accidentally pass on a slow machine.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const before = graph.getSnapshot();
    expect(graph.getSnapshot()).toBe(before);
    expect(Object.values(before.commandQueues).flat().map((entry) => entry.id)).toEqual([base.id, incoming.id]);

    let acknowledge!: (accepted: boolean) => void;
    const acknowledgement = new Promise<boolean>((resolve) => { acknowledge = resolve; });
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });
    const started = trySendLiveFollowUp(incoming, {
      getQueue: () => queues.get(SESSION),
      canSend: () => true,
      send: () => acknowledgement,
      onChange: () => manager.invalidateCommandSnapshot(SESSION),
      onReceived: () => {},
      onSettled: finish,
    });
    try {
      expect(started).toBe(true);
      if (archived) {
        base.status = 'completed';
        archive.set(SESSION, [base]);
        queues.set(SESSION, [incoming]);
        manager.invalidateCommandSnapshot(SESSION);
      }
      const duringDelivery = graph.getSnapshot();
      expect(graph.getSnapshot()).toBe(duringDelivery);
      expect(Object.values(duringDelivery.commandQueues).flat()).toContain(incoming);
      acknowledge(true);
      await settled;

      const after = graph.getSnapshot();
      expect(after).not.toBe(duringDelivery);
      const pending = Object.values(after.commandQueues).flat();
      expect(pending.find((entry) => entry.id === incoming.id)).toBeUndefined();
      const history = Object.values(after.completedCommands).flat();
      const savedBase = [...pending, ...history].find((entry) => entry.id === base.id);
      expect(savedBase).toMatchObject({ id: base.id, text: 'Original request', status: archived ? 'completed' : 'executing' });
      expect(savedBase?.followUps).toEqual([expect.objectContaining({
        id: incoming.id, text: 'Keep this separate', timestamp: incoming.timestamp, attachments: ['addition.png'],
      })]);
    } finally {
      acknowledge(false);
      if (started) await settled;
    }
  });

  it.each(['restoreFromCheckpoint', 'mergeFromCheckpoint'] as const)('%s preserves accepted follow-ups in snapshots and the queue/archive checkpoint', (restore) => {
    const { graph, projectName, queues, archive } = makeGraph();
    const followUps = [{ id: 'follow-up', text: 'Use the keyboard design', timestamp: 2, deliveredAt: 3, attachments: ['keyboard.png'] }];
    const active: QueuedCommand = { ...cmd('active', 'Original request'), status: 'queued', followUps };
    const completed = { ...cmd('completed', 'Earlier request'), followUps };
    queues.set(SESSION, [active]);
    archive.set(SESSION, [completed]);
    const snapshot = graph.getSnapshot();
    expect(Object.values(snapshot.commandQueues).flat().find((entry) => entry.id === active.id)?.followUps).toEqual(followUps);
    expect(Object.values(snapshot.completedCommands).flat().find((entry) => entry.id === completed.id)?.followUps).toEqual(followUps);

    const cp = JSON.parse(JSON.stringify(graph.toProjectCheckpoint(projectName)!));
    const revived = new ProjectGraph();
    const revivedQueues = new Map<string, QueuedCommand[]>();
    const revivedArchive = new Map<string, QueuedCommand[]>();
    revived.setCommandQueuesRef(revivedQueues);
    revived.setCompletedCommandArchiveRef(revivedArchive);
    revived[restore](cp);
    expect(revivedQueues.get(SESSION)).toEqual([active]);
    expect(revivedArchive.get(SESSION)).toEqual([completed]);
    const savedAgain = JSON.parse(JSON.stringify(revived.toProjectCheckpoint(projectName)));
    expect(savedAgain.commandQueues[SESSION][0].followUps).toEqual(followUps);
    expect(savedAgain.completedCommands[SESSION][0].followUps).toEqual(followUps);
  });

  it('merging a checkpoint leaves a currently live delivery in the existing session untouched', () => {
    const { graph, projectName, queues } = makeGraph();
    const live: QueuedCommand = { ...cmd('live', 'Current input'), status: 'queued', dispatchMode: 'steer', liveDelivery: { state: 'sending' } };
    queues.set(SESSION, [live]);
    const cp = JSON.parse(JSON.stringify(graph.toProjectCheckpoint(projectName)!));
    graph.mergeFromCheckpoint(cp);
    expect(queues.get(SESSION)?.[0]).toBe(live);
    expect(live.liveDelivery).toEqual({ state: 'sending' });
  });

  it('새 작업이 기다리던 선행 명령 ID도 체크포인트 왕복 후 유지된다', () => {
    const { graph, projectName, queues } = makeGraph();
    const waiting: QueuedCommand = { ...cmd('new-task', '새 작업'), status: 'queued', waitForCommandIds: ['prior-1', 'prior-2'] };
    queues.set(SESSION, [waiting]);
    const cp = JSON.parse(JSON.stringify(graph.toProjectCheckpoint(projectName)!));
    const revived = new ProjectGraph();
    const revivedQueues = new Map<string, QueuedCommand[]>();
    revived.setCommandQueuesRef(revivedQueues);
    revived.setCompletedCommandArchiveRef(new Map());
    revived.registerProject(tmpRoot);
    revived.restoreFromCheckpoint(cp);
    expect([...revivedQueues.values()].flat().find((command) => command.id === 'new-task'))
      .toMatchObject({ status: 'queued', waitForCommandIds: ['prior-1', 'prior-2'] });
  });

  it('완료된 명령이 체크포인트에 실린다', () => {
    const { graph, projectName, archive } = makeGraph();
    archive.set(SESSION, [cmd('c1', '첫 명령'), cmd('c2', '둘째 명령')]);

    const cp = graph.toProjectCheckpoint(projectName);

    expect(cp, '체크포인트가 만들어져야 한다').toBeTruthy();
    const saved = cp!.completedCommands ?? {};
    const total = Object.values(saved).reduce((n, v) => n + v.length, 0);
    expect(total, '완료 이력이 통째로 빠지면 재시작 후 사용자의 말이 사라진다').toBe(2);
  });

  it('껐다 켜면 그 말이 그대로 돌아온다', () => {
    const { graph, projectName, archive } = makeGraph();
    archive.set(SESSION, [cmd('c1', '첫 명령')]);
    const cp = graph.toProjectCheckpoint(projectName)!;

    const revived = new ProjectGraph();
    const revivedArchive = new Map<string, QueuedCommand[]>();
    revived.setCommandQueuesRef(new Map());
    revived.setCompletedCommandArchiveRef(revivedArchive);
    revived.registerProject(tmpRoot);
    revived.restoreFromCheckpoint(cp);

    const total = [...revivedArchive.values()].reduce((n, v) => n + v.length, 0);
    expect(total, '복원 뒤 아카이브가 비면 화면에 말풍선이 안 뜬다').toBe(1);
  });

  it('큐가 비어 있어도(평소 상태) 완료 이력은 남는다', () => {
    const { graph, projectName, archive, queues } = makeGraph();
    archive.set(SESSION, [cmd('c1', '끝난 명령')]);
    queues.set(SESSION, []); // 실행 중인 것 없음 — 대화가 끝난 평상시 모습

    const cp = graph.toProjectCheckpoint(projectName)!;

    const total = Object.values(cp.completedCommands ?? {}).reduce((n, v) => n + v.length, 0);
    expect(total).toBe(1);
  });
});

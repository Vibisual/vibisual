/**
 * §3.2.3 — **사용자가 보낸 말은 앱을 껐다 켜도 남는다.**
 *
 * 사용자 보고(2026-09-08): 세션을 오가다 돌아오면 대화 내역이 사라지고 명령 말풍선만,
 * 재시작해도 그대로. 실측(살아 있는 저장분 21개 프로젝트)에서 갈림이 선명했다 —
 * **07-31 이전에 저장된 프로젝트는 완료 이력이 남아 있고(2DEngine 66건·CPU온도 54건),
 * 오늘 저장된 6개 프로젝트는 전부 0건이다**(세션 탭이 157개인 프로젝트조차 0건).
 *
 * 완료 이력(`completedCommands`)은 사용자가 **직접 타이핑한 원문**이라 다른 어디서도
 * 재생성할 수 없다. 그런데 이 축을 지키는 테스트가 한 줄도 없어서 회귀가 조용히 지나갔다.
 *
 * 여기서 잠그는 것은 셋 — 완료된 명령이 ① 체크포인트에 실리고 ② 껐다 켠 뒤 되살아나고
 * ③ 그 세션이 아직 큐에 아무것도 없어도(= 평소 상태) 남는다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { QueuedCommand } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-cmdpersist-')));
});

afterEach(() => {
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

/**
 * 실제 앱과 같은 배선 — 그래프는 큐/아카이브 Map 을 **참조로** 들고, index.ts 가 그 Map 에
 * 명령을 넣는다(`archiveCompletedCommands`). 그래프가 자기 Map 을 새로 만들지 않는 구조라,
 * 테스트도 같은 방식으로 ref 를 주입해야 실제 경로를 밟는다.
 */
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

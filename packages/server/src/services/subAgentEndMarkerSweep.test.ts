import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TASK_CHIP_START_SUBTYPE } from '@vibisual/shared';
import { SubAgentManager } from './subAgentManager.js';
import { resetBackgroundTaskOutputCache } from './backgroundTaskOutput.js';

/**
 * §5.5 #17-9 ⑬ — 세션이 **살아 있는 동안**에도 끝난 작업을 내린다.
 *
 * 여기서 고정하는 상황이 사용자가 본 그 화면이다: 세션은 상주 프로세스라 탭이 열려 있는 한
 * `isSessionProcessGone()` 이 결코 참이 되지 않고(=①② 가 손을 못 댄다), 끝 통지(`task_notification`)
 * 는 유실됐다. 종전에는 이 조합에서 항목이 **영영** "실행 중"으로 남았다(실측 2026-09-01,
 * 목적을 다한 `tail -f` 둘이 10·16분째). 유일하게 남은 근거가 하니스가 출력 파일에 쓴 종료 표식이다.
 */
const PARENT = 'agent-endmarker';
/** 실제 임시 폴더 아래에 우리 이름의 슬러그 한 겹만 만든다(다른 세션 폴더는 건드리지 않는다). */
const SLUG = 'vibisual-endmarker-test';
const SLUG_ROOT = path.join(os.tmpdir(), 'claude', SLUG);

let m: SubAgentManager;
let subId: string;
let tasksDir: string;

/** 셸 작업 한 건을 스트림 장부에 올린다(`subagentType` 없음 = 훅 장부가 세지 않는 것). */
function seedTask(id: string, description: string, subagentType?: string): void {
  m.noteStreamTaskChip(subId, TASK_CHIP_START_SUBTYPE, {
    id,
    description,
    ...(subagentType ? { subagentType } : {}),
  });
}

const writeOutput = (id: string, body: string) =>
  fs.writeFileSync(path.join(tasksDir, `${id}.output`), body, 'utf8');

const running = () => m.getRunningSubagentTasks()?.[PARENT] ?? [];
const finished = () => m.getFinishedSubagentTasks()?.[PARENT] ?? [];

beforeEach(() => {
  resetBackgroundTaskOutputCache();
  m = new SubAgentManager();
  subId = m.create(PARENT).id;
  const sessionId = randomUUID();
  m.getSub(subId)!.sessionId = sessionId;
  // 세션은 살아 있다 — ①(프로세스 없음) 이 이 항목에 닿지 못하게 하는 것이 이 테스트의 전제다.
  m.markCmdSubActivity(`term:${PARENT}:${subId}`, false);
  tasksDir = path.join(SLUG_ROOT, sessionId, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(SLUG_ROOT, { recursive: true, force: true });
  resetBackgroundTaskOutputCache();
});

describe('sweepOrphanedBackgroundTasks ⓪ — 출력 파일이 종료를 적었으면 내린다', () => {
  it('세션이 살아 있어도 표식이 있으면 "방금 끝난 것"으로 옮기고 종료 코드를 싣는다', () => {
    seedTask('bg-1', 'tail -f pkg.log');
    writeOutput('bg-1', 'PKG_DONE exit=0\n\n[exited with code 0]\n');
    expect(running()).toHaveLength(1);

    expect(m.sweepOrphanedBackgroundTasks()).toContain(PARENT);

    expect(running()).toHaveLength(0);
    const done = finished();
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({
      id: 'bg-1',
      description: 'tail -f pkg.log',
      subAgentId: subId,
      origin: 'stream',
      exitCode: 0,
    });
    expect(done[0]?.killed).toBeUndefined();
  });

  it('실패로 끝난 작업의 종료 코드도 그대로 싣는다 (실측 UAT_EXIT=25)', () => {
    seedTask('bg-2', '패키징 감시');
    writeOutput('bg-2', 'BUILD FAILED\n[exited with code 25]\n');

    m.sweepOrphanedBackgroundTasks();

    expect(finished()[0]).toMatchObject({ id: 'bg-2', exitCode: 25 });
  });

  it('[killed] 은 종료 코드 없이 "끊겼다"로만 적는다', () => {
    seedTask('bg-3', '감시');
    writeOutput('bg-3', '중단\n[killed]\n');

    m.sweepOrphanedBackgroundTasks();

    const done = finished()[0];
    expect(done).toMatchObject({ id: 'bg-3', killed: true });
    expect(done?.exitCode).toBeUndefined();
  });

  it('끝난 시각은 파일이 마지막으로 바뀐 때 — "우리가 알아챈 때"로 부풀리지 않는다', () => {
    seedTask('bg-4', '감시');
    writeOutput('bg-4', '[exited with code 0]\n');
    const mtime = fs.statSync(path.join(tasksDir, 'bg-4.output')).mtimeMs;

    // 10분 뒤에야 알아챘다고 해도 카드에 10분이 붙어서는 안 된다.
    m.sweepOrphanedBackgroundTasks(Date.now() + 600_000);

    const done = finished()[0]!;
    expect(done.endedAt).toBeLessThanOrEqual(Math.max(mtime, done.startedAt) + 1);
    expect(done.endedAt).toBeGreaterThanOrEqual(done.startedAt);
  });
});

describe('sweepOrphanedBackgroundTasks ⓪ — 모르는 것은 손대지 않는다', () => {
  it('표식이 없으면 도는 목록에 그대로 둔다 (조용함은 근거가 아니다)', () => {
    seedTask('bg-live', 'tail -f app.log');
    writeOutput('bg-live', '[16:24:41] watching...\n');

    expect(m.sweepOrphanedBackgroundTasks()).not.toContain(PARENT);

    expect(running()).toHaveLength(1);
    expect(m.getFinishedSubagentTasks()).toBeUndefined();
  });

  it('출력 파일 자체가 없으면 그대로 둔다 (힌트 없음 = 종전 동작)', () => {
    seedTask('bg-nofile', '감시');

    m.sweepOrphanedBackgroundTasks();

    expect(running()).toHaveLength(1);
  });

  it('작업 자신이 찍은 대괄호 낱말에 속지 않는다', () => {
    seedTask('bg-fake', '재설치 감시');
    writeOutput('bg-fake', '[reinstall] 3/7 단계\n');

    m.sweepOrphanedBackgroundTasks();

    expect(running()).toHaveLength(1);
  });

  it('Task/Agent 자식은 이 경로가 건드리지 않는다 — 훅 대차대조 소관이다', () => {
    seedTask('bg-agent', '조사', 'general-purpose');
    writeOutput('bg-agent', '[exited with code 0]\n');

    m.sweepOrphanedBackgroundTasks();

    // 표시 목록에는 원래 안 나오고(훅 장부가 센다), 끝난 것 꼬리에 유령 카드도 생기지 않는다.
    expect(m.getFinishedSubagentTasks()).toBeUndefined();
  });

  it('두 번 훑어도 한 번만 내려간다 (같은 카드가 겹치지 않는다)', () => {
    seedTask('bg-once', '감시');
    writeOutput('bg-once', '[exited with code 0]\n');

    m.sweepOrphanedBackgroundTasks();
    expect(m.sweepOrphanedBackgroundTasks()).not.toContain(PARENT);

    expect(finished()).toHaveLength(1);
  });
});

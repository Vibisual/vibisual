import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_BG_TASK_PROBE_SETTINGS, TASK_CHIP_START_SUBTYPE, type BackgroundTaskProbeResult } from '@vibisual/shared';

/**
 * §5.5 #17-9 ⑭ — **표식 없이 오래 조용한 항목**을 한 번 물어보고 유지·정리를 결정한다.
 *
 * ⑬ 이 "끝났다고 적힌 것"을 걷고 나면 남는 회색지대가 이 파일의 무대다. 여기서 지키는 계약은
 * 전부 **한 방향**이다 — 확실할 때만 손댄다.
 *   · 표식이 있으면 ⑬ 소관이라 묻지 않는다.        · 명령을 모르면 묻지 않는다(판정 근거가 없다).
 *   · 답이 `alive`/`unknown`/실패면 항목을 남긴다.  · `finished` + 자동정리일 때만 내린다.
 * 시간은 **착수 조건**일 뿐 판정 근거가 아니다(⑩ — "루프 대기 중일 수도 있잖아").
 *
 * 판정과 프로세스 회수는 각자 파일에서 이미 굳혀 뒀으므로(`backgroundTaskProbe.test.ts` ·
 * `processDescendants.test.ts`) 여기서는 둘을 가짜로 두고 **오케스트레이션만** 본다.
 */

/** 판정 1회를 가로챈다 — 진짜 모델을 부르지 않는다. */
const probeCalls: { command: string; quietMin: number; model: string }[] = [];
let probeAnswer: BackgroundTaskProbeResult | null = null;
vi.mock('./backgroundTaskProbe.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./backgroundTaskProbe.js')>();
  return {
    ...real,
    runBackgroundTaskProbe: (ev: { command: string; quietMin: number }, model: string) => {
      probeCalls.push({ command: ev.command, quietMin: ev.quietMin, model });
      return Promise.resolve(probeAnswer);
    },
  };
});

/** 프로세스 회수도 가로챈다 — 테스트가 진짜 프로세스를 죽이면 안 된다. */
const killCalls: { command: string }[] = [];
let killResult: number | null = 3;
vi.mock('./processDescendants.js', () => ({
  terminateTaskProcesses: (_pid: number | undefined, command: string) => {
    killCalls.push({ command });
    return Promise.resolve(killResult);
  },
}));

const { SubAgentManager } = await import('./subAgentManager.js');
const { resetBackgroundTaskOutputCache } = await import('./backgroundTaskOutput.js');
const { getSessionJsonlPath } = await import('./sessionDiscovery.js');

const PARENT = 'agent-quietprobe';
const SLUG = 'vibisual-quietprobe-test';
const SLUG_ROOT = path.join(os.tmpdir(), 'claude', SLUG);
/** 트랜스크립트를 놓을 가짜 프로젝트 — `projectResolver` 가 이 경로를 돌려준다. */
const PROJECT_DIR = path.join(os.tmpdir(), SLUG, 'project');

let m: InstanceType<typeof SubAgentManager>;
let subId: string;
let sessionId: string;
let tasksDir: string;
let jsonlPath: string;

const running = () => m.getRunningSubagentTasks()?.[PARENT] ?? [];
const finished = () => m.getFinishedSubagentTasks()?.[PARENT] ?? [];

/** 셸 작업 한 건을 스트림 장부에 올린다(= 화면의 한 줄). */
function seedTask(id: string, description: string): void {
  m.noteStreamTaskChip(subId, TASK_CHIP_START_SUBTYPE, { id, description });
}

/** 출력 파일을 쓰고 **마지막으로 바뀐 시각을 과거로 돌린다** — 조용한 시간은 이 시계로 잰다. */
function writeOutput(id: string, body: string, quietMinutes: number): string {
  const file = path.join(tasksDir, `${id}.output`);
  fs.writeFileSync(file, body, 'utf8');
  const at = new Date(Date.now() - quietMinutes * 60_000);
  fs.utimesSync(file, at, at);
  return file;
}

/** 그 작업의 명령이 적힌 트랜스크립트 두 줄(도구 호출 + 결과)을 남긴다. */
function writeTranscript(entries: { id: string; command: string; outputPath: string }[]): void {
  fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
  const lines: string[] = [];
  for (const [i, e] of entries.entries()) {
    const uid = `toolu_${i}`;
    lines.push(JSON.stringify({
      timestamp: new Date(Date.now() - 60 * 60_000).toISOString(),
      message: {
        content: [{ type: 'tool_use', id: uid, name: 'Bash', input: { command: e.command, run_in_background: true } }],
      },
    }));
    lines.push(JSON.stringify({
      timestamp: new Date(Date.now() - 60 * 60_000).toISOString(),
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: uid,
          content: `Command running in background with ID: ${e.id}. Output is being written to: ${e.outputPath}. You will be notified when it completes.`,
        }],
      },
    }));
  }
  fs.writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf8');
}

/**
 * 착수 → 판정 반영 → `probesInFlight` 해제까지가 비동기다(모델 호출 자리).
 * `then → async applyProbeVerdict → catch → finally` 가 각각 틱을 먹으므로 마이크로태스크만으로는
 * 모자란다 — 매크로태스크를 두 번 돌려 사슬이 완전히 끝난 뒤에 확인한다.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) await new Promise((r) => { setTimeout(r, 0); });
};

beforeEach(() => {
  probeCalls.length = 0;
  killCalls.length = 0;
  probeAnswer = null;
  killResult = 3;
  resetBackgroundTaskOutputCache();

  m = new SubAgentManager();
  m.setProjectResolver(() => ({ id: 'p1', path: PROJECT_DIR, name: 'p1' }));
  m.setBackgroundTaskProbeSettings(DEFAULT_BG_TASK_PROBE_SETTINGS);
  subId = m.create(PARENT).id;
  sessionId = randomUUID();
  m.getSub(subId)!.sessionId = sessionId;
  // 세션은 살아 있다 — 프로세스 소멸 경로가 이 항목에 닿지 못하는 것이 회색지대의 전제다.
  m.markCmdSubActivity(`term:${PARENT}:${subId}`, false);

  tasksDir = path.join(SLUG_ROOT, sessionId, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  jsonlPath = getSessionJsonlPath(PROJECT_DIR, sessionId);
});

afterEach(() => {
  fs.rmSync(SLUG_ROOT, { recursive: true, force: true });
  fs.rmSync(jsonlPath, { force: true });
  resetBackgroundTaskOutputCache();
});

/** 표식 없이 오래 조용한 항목 하나를 만들어 둔다 — 이 파일의 기본 무대. */
function seedQuietTask(id = 'bg-1', quietMinutes = 30, command = 'until [ "$(ls /work/out-*.json | wc -l)" -ge 11 ]; do sleep 10; done'): void {
  seedTask(id, '결과 파일 11개 기다리기');
  const outputPath = writeOutput(id, 'waiting...\n', quietMinutes);
  writeTranscript([{ id, command, outputPath }]);
}

describe('⑭ 착수 조건 — 확실하지 않으면 아예 묻지 않는다', () => {
  it('표식 없이 임계를 넘겨 조용하면 그 명령으로 판정을 띄운다', async () => {
    seedQuietTask('bg-1', 30);

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(probeCalls).toHaveLength(1);
    expect(probeCalls[0]?.command).toContain('-ge 11');
    expect(probeCalls[0]?.quietMin).toBeGreaterThanOrEqual(29);
    expect(probeCalls[0]?.model).toBe(DEFAULT_BG_TASK_PROBE_SETTINGS.model);
  });

  it('아직 임계를 안 넘겼으면 묻지 않는다 — 시간은 착수 조건이다', async () => {
    seedQuietTask('bg-1', 3);

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(probeCalls).toHaveLength(0);
  });

  it('종료 표식이 있으면 묻지 않는다 — 그건 ⑬ 이 답한 자리다', async () => {
    seedTask('bg-1', '패키징 감시');
    const outputPath = writeOutput('bg-1', 'done\n[exited with code 0]\n', 30);
    writeTranscript([{ id: 'bg-1', command: 'tail -f /work/pkg.log', outputPath }]);

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(probeCalls).toHaveLength(0);
  });

  it('명령을 트랜스크립트에서 못 읽으면 묻지 않는다 — 판정할 근거가 없다', async () => {
    seedTask('bg-1', '정체 불명');
    writeOutput('bg-1', 'waiting...\n', 30);
    writeTranscript([]); // 이 작업의 명령이 없다

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(probeCalls).toHaveLength(0);
  });

  it('출력 파일이 없으면 묻지 않는다 — 조용한 시간을 잴 시계가 없다', async () => {
    seedTask('bg-1', '출력 없음');
    writeTranscript([{ id: 'bg-1', command: 'sleep 99999', outputPath: path.join(tasksDir, 'bg-1.output') }]);

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(probeCalls).toHaveLength(0);
  });

  it('꺼 두면 모델을 아예 부르지 않는다', async () => {
    seedQuietTask('bg-1', 30);
    m.setBackgroundTaskProbeSettings({ ...DEFAULT_BG_TASK_PROBE_SETTINGS, enabled: false });

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(probeCalls).toHaveLength(0);
  });

  it('임계 0 도 끔이다 — 0 분을 "즉시 묻기"로 읽으면 모든 항목을 태운다', async () => {
    seedQuietTask('bg-1', 30);
    m.setBackgroundTaskProbeSettings({ ...DEFAULT_BG_TASK_PROBE_SETTINGS, quietMinutes: 0 });

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(probeCalls).toHaveLength(0);
  });

  it('한 번에 하나만 띄운다 — 앞의 판정이 끝나기 전에는 다시 착수하지 않는다', async () => {
    seedQuietTask('bg-1', 30);

    m.maybeProbeQuietBackgroundTasks();
    m.maybeProbeQuietBackgroundTasks();
    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(probeCalls).toHaveLength(1);
  });
});

describe('⑭ 판정 반영 — 확실할 때만 내린다', () => {
  it('finished 면 "방금 끝난 것"으로 내리고 사유·모델·끊은 프로세스 수를 카드에 싣는다', async () => {
    seedQuietTask('bg-1', 30);
    probeAnswer = { at: Date.now(), verdict: 'finished', reason: '11/11 files present, loop should have exited', exitCondition: '11 files', model: 'haiku' };

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(running()).toHaveLength(0);
    expect(finished()[0]).toMatchObject({
      id: 'bg-1',
      origin: 'stream',
      closedBy: 'probe',
      killedProcesses: 3,
      probe: { verdict: 'finished', reason: '11/11 files present, loop should have exited', exitCondition: '11 files', model: 'haiku' },
    });
  });

  it('alive 면 항목을 남기고 판정만 붙인다 — 정당한 대기를 끊지 않는다', async () => {
    seedQuietTask('bg-1', 30);
    probeAnswer = { at: Date.now(), verdict: 'alive', reason: 'only 8 of 11 files exist', model: 'haiku' };

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(running()).toHaveLength(1);
    expect(finished()).toHaveLength(0);
    expect(m.getBackgroundTaskProbeState(subId, 'bg-1')).toMatchObject({ verdict: 'alive' });
    expect(killCalls).toHaveLength(0);
  });

  it('unknown 도 남긴다 — 모른다는 답으로 남의 작업을 죽이지 않는다', async () => {
    seedQuietTask('bg-1', 30);
    probeAnswer = { at: Date.now(), verdict: 'unknown', reason: 'facts do not settle it', model: 'haiku' };

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(running()).toHaveLength(1);
    expect(killCalls).toHaveLength(0);
  });

  it('답을 못 받으면(스폰 실패·파싱 실패) 아무 일도 일어나지 않는다', async () => {
    seedQuietTask('bg-1', 30);
    probeAnswer = null;

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(running()).toHaveLength(1);
    expect(finished()).toHaveLength(0);
    expect(m.getBackgroundTaskProbeState(subId, 'bg-1')).toBeUndefined();
  });

  it('자동 정리를 꺼 두면 finished 여도 항목을 남긴다 — 판정만 적고 결정은 사용자가 한다', async () => {
    seedQuietTask('bg-1', 30);
    m.setBackgroundTaskProbeSettings({ ...DEFAULT_BG_TASK_PROBE_SETTINGS, autoClose: false });
    probeAnswer = { at: Date.now(), verdict: 'finished', reason: 'log ended 20 min ago', model: 'haiku' };

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(running()).toHaveLength(1);
    expect(killCalls).toHaveLength(0);
    expect(m.getBackgroundTaskProbeState(subId, 'bg-1')).toMatchObject({ verdict: 'finished' });
  });

  it('프로세스 끊기를 꺼 두면 장부만 내린다', async () => {
    seedQuietTask('bg-1', 30);
    m.setBackgroundTaskProbeSettings({ ...DEFAULT_BG_TASK_PROBE_SETTINGS, killProcess: false });
    probeAnswer = { at: Date.now(), verdict: 'finished', reason: 'watched process ended', model: 'haiku' };

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(killCalls).toHaveLength(0);
    expect(finished()[0]).toMatchObject({ closedBy: 'probe' });
    expect(finished()[0]?.killedProcesses).toBeUndefined();
  });

  it('프로세스 목록을 못 떠서 "모른다"(null)면 개수를 적지 않는다 — 0 으로 적으면 거짓말이다', async () => {
    seedQuietTask('bg-1', 30);
    killResult = null;
    probeAnswer = { at: Date.now(), verdict: 'finished', reason: 'done', model: 'haiku' };

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(killCalls).toHaveLength(1);
    expect(finished()[0]?.killedProcesses).toBeUndefined();
  });

  it('끊을 프로세스가 하나도 없었으면(0) 그 사실을 그대로 적는다', async () => {
    seedQuietTask('bg-1', 30);
    killResult = 0;
    probeAnswer = { at: Date.now(), verdict: 'finished', reason: 'done', model: 'haiku' };

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(finished()[0]?.killedProcesses).toBe(0);
  });
});

describe('⑭ 반복 억제 — 같은 항목에 판정을 계속 태우지 않는다', () => {
  // 기본 임계는 10분, 백오프 배수는 ×3 이다. 20분 조용한 항목은 **첫 회에는 걸리고**
  //   한 번 물어본 뒤에는 임계가 30분이 되어 걸리지 않는다 — 억제를 보려면 이 자리여야 한다.
  const QUIET_BETWEEN = 20;

  it('alive 로 나온 항목은 임계가 배수만큼 늘어 곧바로 다시 묻지 않는다', async () => {
    seedQuietTask('bg-1', QUIET_BETWEEN);
    probeAnswer = { at: Date.now(), verdict: 'alive', reason: 'still waiting', model: 'haiku' };

    m.maybeProbeQuietBackgroundTasks();
    await settle();
    expect(probeCalls).toHaveLength(1);

    m.maybeProbeQuietBackgroundTasks(); // 조용한 시간은 그대로 20분 — 늘어난 임계(30분)에 못 미친다
    await settle();
    expect(probeCalls).toHaveLength(1);
  });

  it('그래도 더 오래 조용해지면 다시 묻는다 — 억제는 영구 면제가 아니다', async () => {
    seedQuietTask('bg-1', QUIET_BETWEEN);
    probeAnswer = { at: Date.now(), verdict: 'alive', reason: 'still waiting', model: 'haiku' };

    m.maybeProbeQuietBackgroundTasks();
    await settle();

    // 늘어난 임계(10분 × 3)를 넘길 만큼 더 조용해졌다.
    writeOutput('bg-1', 'waiting...\n', 45);
    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(probeCalls).toHaveLength(2);
  });

  it('답을 못 받았을 때도 간격을 벌린다 — 실패가 반복 호출로 번지지 않게', async () => {
    seedQuietTask('bg-1', QUIET_BETWEEN);
    probeAnswer = null;

    m.maybeProbeQuietBackgroundTasks();
    await settle();
    m.maybeProbeQuietBackgroundTasks();
    await settle();

    expect(probeCalls).toHaveLength(1);
  });
});

describe('⑭ 화면에 실리는 값', () => {
  it('도는 항목에 조용한 시계(lastOutputAt)가 붙는다 — 착수 판정과 화면이 같은 시계를 본다', () => {
    seedQuietTask('bg-1', 30);

    const task = running()[0];
    expect(task?.lastOutputAt).toBeDefined();
    expect(Date.now() - (task?.lastOutputAt ?? 0)).toBeGreaterThan(29 * 60_000);
  });

  it('판정이 도는 동안 "확인 중"이 서고, 끝나면 내려간다', async () => {
    seedQuietTask('bg-1', 30);
    probeAnswer = { at: Date.now(), verdict: 'alive', reason: 'waiting', model: 'haiku' };

    m.maybeProbeQuietBackgroundTasks();
    expect(running()[0]?.probing).toBe(true);

    await settle();
    expect(running()[0]?.probing).toBeUndefined();
    expect(running()[0]?.probe).toMatchObject({ verdict: 'alive', reason: 'waiting' });
  });
});

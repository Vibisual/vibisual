import { describe, it, expect } from 'vitest';
import {
  createTurnSealState, noteTaskChip, mayTurnResume, noteTurnResumed, noteTurnSealed,
  isTurnResumeSignal, MAX_TRACKED_TASKS,
  listDisplayableLiveTasks, turnIdOfLiveTask, shouldSleepResumedTurn,
} from './turnSeal.js';

const START = 'task_started';
const END = 'task_notification';

describe('turnSeal — 백그라운드 작업 대차대조', () => {
  it('아무 작업도 없으면 턴 종료는 곧 완료다(종전 동작 유지)', () => {
    const s = createTurnSealState();
    expect(mayTurnResume(s)).toBe(false);
  });

  it('시작만 본 작업이 살아 있으면 재진입 가능으로 본다', () => {
    const s = createTurnSealState();
    expect(noteTaskChip(s, START, { id: 'bfl52vk5f', description: 'Monitor' })).toBe(true);
    expect(mayTurnResume(s)).toBe(true);
  });

  it('끝 통지가 오면 그 작업은 살아 있는 목록에서 빠지되, 전달 대기 통지로 남는다', () => {
    const s = createTurnSealState();
    noteTaskChip(s, START, { id: 'bbeerj5yf' });
    noteTaskChip(s, END, { id: 'bbeerj5yf', status: 'completed' });
    expect(s.liveTasks.size).toBe(0);
    expect(s.deliveredNotices).toBe(1);
    // 통지가 밀려 있으면 CLI 가 턴 경계에서 세션을 다시 돌린다 → 봉인 보류.
    expect(mayTurnResume(s)).toBe(true);
  });

  it('failed / stopped 도 끝이다 — 어느 쪽이든 통지가 세션으로 간다', () => {
    for (const status of ['failed', 'stopped'] as const) {
      const s = createTurnSealState();
      noteTaskChip(s, START, { id: 'x' });
      noteTaskChip(s, END, { id: 'x', status });
      expect(s.deliveredNotices).toBe(1);
    }
  });

  it('시작을 못 본 작업의 끝 통지도 센다(버퍼 절단·중간 부착 대비)', () => {
    const s = createTurnSealState();
    noteTaskChip(s, END, { id: 'unseen', status: 'completed' });
    expect(s.deliveredNotices).toBe(1);
    expect(mayTurnResume(s)).toBe(true);
  });

  it('턴이 이어지면 밀린 통지는 소진되고, 살아 있는 작업은 그대로 남는다', () => {
    const s = createTurnSealState();
    noteTaskChip(s, START, { id: 'monitor' });
    noteTaskChip(s, START, { id: 'build' });
    noteTaskChip(s, END, { id: 'build', status: 'completed' });
    noteTurnResumed(s);
    expect(s.deliveredNotices).toBe(0);
    expect(s.liveTasks.has('monitor')).toBe(true);
    expect(mayTurnResume(s)).toBe(true); // 모니터가 아직 돈다
  });

  it('봉인하면 통지 셈은 다음 명령으로 넘어가지 않는다', () => {
    const s = createTurnSealState();
    noteTaskChip(s, END, { id: 'a', status: 'completed' });
    noteTurnSealed(s);
    expect(mayTurnResume(s)).toBe(false);
  });

  it('실측 타임라인 재현 — 첫 result 는 잠정, 이어진 턴의 끝이 진짜 완료', () => {
    // P_MPS_GPT 세션 e78cf71c… (2026-08-07) 그대로.
    const s = createTurnSealState();
    noteTaskChip(s, START, { id: 'bbeerj5yf' });               // 15:00:15 백그라운드 빌드
    noteTaskChip(s, START, { id: 'bfl52vk5f' });               // 15:00:30 Monitor
    noteTaskChip(s, END, { id: 'bbeerj5yf', status: 'completed' }); // 15:01:14
    expect(mayTurnResume(s)).toBe(true);                        // 15:01:25 result → 봉인 보류

    noteTurnResumed(s);                                         // 15:01:25.040 재진입
    noteTaskChip(s, END, { id: 'bfl52vk5f', status: 'completed' });
    noteTurnResumed(s);
    expect(mayTurnResume(s)).toBe(false);                       // 15:03:15 result → 진짜 완료
  });

  it('오래 돌았다는 이유로는 걷지 않는다 — 몇 시간짜리 패키징·무한 폴링이 정상이다', () => {
    const s = createTurnSealState();
    const t0 = 1_000_000;
    noteTaskChip(s, START, { id: 'long-running' }, t0);
    // 하루가 지나도, 그 사이 다른 작업이 새로 시작돼도 그대로 살아 있어야 한다.
    noteTaskChip(s, START, { id: 'fresh' }, t0 + 24 * 60 * 60 * 1000);
    expect(s.liveTasks.has('long-running')).toBe(true);
    expect(s.liveTasks.has('fresh')).toBe(true);

    // 걷히는 것은 **실제 끝 통지**를 받았을 때뿐이다.
    noteTaskChip(s, END, { id: 'long-running' }, t0 + 24 * 60 * 60 * 1000 + 1);
    expect(s.liveTasks.has('long-running')).toBe(false);
  });

  it('추적 개수에 상한이 있다', () => {
    const s = createTurnSealState();
    for (let i = 0; i < MAX_TRACKED_TASKS + 20; i++) noteTaskChip(s, START, { id: `t${i}` });
    expect(s.liveTasks.size).toBeLessThanOrEqual(MAX_TRACKED_TASKS);
  });

  it('작업 칩이 아니거나 id 가 없으면 대차대조를 건드리지 않는다', () => {
    const s = createTurnSealState();
    expect(noteTaskChip(s, 'task_progress', { id: 'x' })).toBe(false);
    expect(noteTaskChip(s, START, null)).toBe(false);
    expect(noteTaskChip(s, START, { id: '' })).toBe(false);
    expect(mayTurnResume(s)).toBe(false);
  });
});

describe('turnSeal — 재진입 신호', () => {
  it('모델이 말하거나 도구를 쓰면 턴이 이어진 것이다', () => {
    for (const t of ['text', 'thinking', 'tool_use', 'tool_result']) {
      expect(isTurnResumeSignal(t)).toBe(true);
    }
  });

  it('상태 칩·오류 줄은 재진입 근거가 아니다 — 턴이 끝난 뒤에도 흐를 수 있다', () => {
    for (const t of ['system', 'error']) {
      expect(isTurnResumeSignal(t)).toBe(false);
    }
  });
});

describe('listDisplayableLiveTasks — 화면에 내보낼 백그라운드 작업', () => {
  it('훅이 못 보는 작업(Bash run_in_background · Monitor)은 내보낸다', () => {
    const s = createTurnSealState();
    noteTaskChip(s, START, { id: 'bg1', description: '백그라운드 빌드' });
    const out = listDisplayableLiveTasks(s);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('bg1');
    expect(out[0]!.info.description).toBe('백그라운드 빌드');
  });

  it('Task/Agent 자식은 훅 대차대조가 이미 세므로 뺀다 — 같은 자식을 두 번 세지 않는다', () => {
    const s = createTurnSealState();
    noteTaskChip(s, START, { id: 'child1', description: '리뷰', subagentType: 'code-reviewer' });
    expect(listDisplayableLiveTasks(s)).toHaveLength(0);
  });

  it('끝 통지가 오면 목록에서 빠진다', () => {
    const s = createTurnSealState();
    noteTaskChip(s, START, { id: 'bg1', description: '빌드' });
    noteTaskChip(s, END, { id: 'bg1', status: 'completed' });
    expect(listDisplayableLiveTasks(s)).toHaveLength(0);
  });

  it('둘이 섞여 있으면 훅이 못 보는 쪽만 남는다', () => {
    const s = createTurnSealState();
    noteTaskChip(s, START, { id: 'bg1', description: 'Monitor' });
    noteTaskChip(s, START, { id: 'child1', subagentType: 'explorer' });
    const out = listDisplayableLiveTasks(s);
    expect(out.map((x) => x.id)).toEqual(['bg1']);
  });

  it('봉인 지연 판정은 종전 그대로 — 표시에서 뺀 Task 자식도 재진입 근거다', () => {
    const s = createTurnSealState();
    noteTaskChip(s, START, { id: 'child1', subagentType: 'explorer' });
    expect(listDisplayableLiveTasks(s)).toHaveLength(0);
    expect(mayTurnResume(s)).toBe(true);
  });
});

describe('턴 세대 도장 — 백그라운드 작업은 시작한 턴의 것이다', () => {
  it('시작할 때 찍은 턴을 끝 통지가 물려받는다', () => {
    const s = createTurnSealState();
    noteTaskChip(s, START, { id: 'bg1', description: '빌드' }, 1000, 'cmd-A');
    expect(turnIdOfLiveTask(s, 'bg1')).toBe('cmd-A');
  });

  it('턴이 바뀌어도 앞서 시작한 작업의 주인은 그대로다 — 새 명령이 남의 일을 떠안지 않는다', () => {
    const s = createTurnSealState();
    noteTaskChip(s, START, { id: 'bg1' }, 1000, 'cmd-A');
    noteTaskChip(s, START, { id: 'bg2' }, 2000, 'cmd-B');
    expect(turnIdOfLiveTask(s, 'bg1')).toBe('cmd-A');
    expect(turnIdOfLiveTask(s, 'bg2')).toBe('cmd-B');
  });

  it('시작을 못 본 작업은 주인이 없다 — 그때는 도착 시점 턴으로 폴백한다', () => {
    const s = createTurnSealState();
    expect(turnIdOfLiveTask(s, 'unseen')).toBeUndefined();
  });

  it('도장 없이 시작한 작업(옛 버퍼)도 대차대조는 종전대로 돈다', () => {
    const s = createTurnSealState();
    noteTaskChip(s, START, { id: 'bg1' });
    expect(turnIdOfLiveTask(s, 'bg1')).toBeUndefined();
    expect(mayTurnResume(s)).toBe(true);
  });
});

describe('shouldSleepResumedTurn — 되살아난 턴이 끝나면 세션을 재운다', () => {
  /** 재진입으로 깨어나 있고, 재우지 말아야 할 사유는 하나도 없는 상태. */
  const AWAKE = {
    subStatus: 'active',
    processingCommand: false,
    dispatching: false,
    cmdDriven: false,
  } as const;

  it('닫아 줄 명령이 없어도 턴이 끝났으면 재운다 — 이것이 파란 점이 굳던 자리다', () => {
    expect(shouldSleepResumedTurn(AWAKE)).toBe(true);
  });

  it('봉인 유예 사이에 다음 명령이 나갔으면 재우지 않는다 — 막 시작한 턴을 끄면 안 된다', () => {
    expect(shouldSleepResumedTurn({ ...AWAKE, processingCommand: true })).toBe(false);
  });

  it('스폰 진행 중이면 재우지 않는다 — 이제 막 뜨는 세션이다', () => {
    expect(shouldSleepResumedTurn({ ...AWAKE, dispatching: true })).toBe(false);
  });

  it('PTY(CMD) 세션은 훅이 상태를 몰고 가므로 건드리지 않는다', () => {
    expect(shouldSleepResumedTurn({ ...AWAKE, cmdDriven: true })).toBe(false);
  });

  it('실패한 턴은 보존한다 — 오류를 조용한 완료로 세탁하지 않는다', () => {
    expect(shouldSleepResumedTurn({ ...AWAKE, subStatus: 'error' })).toBe(false);
  });

  it('이미 재워진 세션에는 할 일이 없다', () => {
    for (const subStatus of ['idle', 'completed'] as const) {
      expect(shouldSleepResumedTurn({ ...AWAKE, subStatus })).toBe(false);
    }
  });

  it('실측 재현 — 백그라운드 통지로 깨어난 턴의 끝은 봉인되고 세션도 재워진다', () => {
    // P_MPS_GPT 세션 `5c01ebc2…` (2026-08-14): 09:30 명령이 codex 검수를 백그라운드로 띄우고
    // 턴을 끝내 봉인(그때 in-flight 가 지워진다) → 09:53:11 완료 통지로 세션 재진입 →
    // 09:56:37 그 턴 종료. 종전에는 이 끝을 받는 자리가 없어 09:59:52 다음 명령까지
    // **3분 14초** 동안 탭 점이 파랗게 돌았다(= 멈췄는데 도는 것처럼 보임).
    const s = createTurnSealState();
    noteTaskChip(s, START, { id: 'b6vj8ja6r', description: 'Run codex-audit ultra in background' });
    noteTaskChip(s, END, { id: 'b6vj8ja6r', status: 'completed' });
    noteTurnResumed(s);                     // 밀린 통지를 세션이 받아 갔다(턴이 이어짐)
    expect(mayTurnResume(s)).toBe(false);   // 남은 작업이 없으니 이 턴의 끝은 즉시 봉인된다

    // 그 되살아난 턴에는 주인(in-flight 명령)이 없다 — 그래도 세션은 재워져야 한다.
    expect(shouldSleepResumedTurn(AWAKE)).toBe(true);
  });
});

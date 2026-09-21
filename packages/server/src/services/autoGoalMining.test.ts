/**
 * §5.10 — 자동 목표 마이닝·3층 판정 회귀.
 *
 * 못 박는 것 셋:
 * ① **기본은 꺼짐** — 아무 층도 안 정한 프로젝트에서 이 기능은 없는 것과 같아야 한다.
 * ② **되풀이만 잡는다** — 한 번 한 일이 스킬이 되면 이 기능은 소음이 되고 사용자가 꺼 버린다.
 * ③ **같은 입력이면 같은 답** — 후보는 저장하지 않는 파생이라, id 가 흔들리면 사용자가 물린
 *    기록과 이미 굳힌 스킬이 다음 분석에서 그 후보를 다시 못 가리킨다.
 *
 * 함수는 shared 순수 모듈이지만 shared 에는 러너가 없다 — `specReadingScope.test.ts` 선례대로
 * 서버 패키지에서 돌린다.
 */
import { describe, expect, it } from 'vitest';
import {
  autoGoalScopeStates,
  resolveAutoGoalEnabled,
  withAutoGoalDismissed,
  withAutoGoalScope,
  normalizeAutoGoalSettings,
  autoGoalSequenceId,
  autoGoalSkillBody,
  autoGoalSkillDescription,
  autoGoalTitle,
  isSubsequenceRun,
  mineAutoGoalCandidates,
  AUTO_GOAL_COMMAND_MAX,
  AUTO_GOAL_SCAN_TAIL,
  AUTO_GOAL_WINDOW_MS,
} from '@vibisual/shared';
import type { BashEntry, SessionGoal } from '@vibisual/shared';

const T0 = 1_700_000_000_000;

/** 한 줄기(같은 시간 창 안)로 이어지는 명령 이력을 만든다. */
function run(commands: readonly string[], startAt: number): BashEntry[] {
  return commands.map((command, i) => ({
    id: `b${startAt}-${i}`,
    command,
    timestamp: startAt + i * 1000,
    status: 'success',
  }));
}

describe('자동 목표 — 3층 켬/끔', () => {
  it('아무 층도 안 정하면 꺼짐이다(기본 off)', () => {
    expect(resolveAutoGoalEnabled(undefined)).toBe(false);
    expect(resolveAutoGoalEnabled({})).toBe(false);
    expect(resolveAutoGoalEnabled({}, { agentId: 'a1', subAgentId: 's1' })).toBe(false);
  });

  it('아래 층이 위 층을 덮는다 — 프로젝트 켬 + 이 세션만 끔', () => {
    const s = { enabledProject: true, enabledSessions: { s1: false } };
    expect(resolveAutoGoalEnabled(s, { agentId: 'a1', subAgentId: 's1' })).toBe(false);
    expect(resolveAutoGoalEnabled(s, { agentId: 'a1', subAgentId: 's2' })).toBe(true);
  });

  it('상속(null)과 끔(false)은 다르다', () => {
    const off = { enabledProject: true, enabledAgents: { a1: false } };
    const inherit = { enabledProject: true };
    expect(resolveAutoGoalEnabled(off, { agentId: 'a1' })).toBe(false);
    expect(resolveAutoGoalEnabled(inherit, { agentId: 'a1' })).toBe(true);
  });

  it('층 상태는 상속을 명시와 구분해 말한다', () => {
    const states = autoGoalScopeStates({ enabledProject: true }, { agentId: 'a1', subAgentId: 's1' });
    expect(states.map((x) => x.scope)).toEqual(['project', 'agent', 'session']);
    expect(states[0]?.own).toBe(true);
    expect(states[1]?.own).toBeNull();
    expect(states[1]?.inherited).toBe(true);
    expect(states[1]?.effective).toBe(true);
    // 마지막 층의 effective 는 판정 함수와 항상 같다.
    expect(states[2]?.effective).toBe(resolveAutoGoalEnabled({ enabledProject: true }, { agentId: 'a1', subAgentId: 's1' }));
  });

  it('id 없는 층은 고를 수 없다 — 세션 탭이 없는 화면', () => {
    const states = autoGoalScopeStates({}, { agentId: 'a1', subAgentId: null });
    expect(states[1]?.available).toBe(true);
    expect(states[2]?.available).toBe(false);
  });

  it('한 칸만 갈아 끼우고 나머지는 그대로 옮긴다 — 물린 기록이 함께 날아가지 않는다', () => {
    const before = { enabledProject: true, dismissed: ['command:abc'] };
    const after = withAutoGoalScope(before, 'session', 's1', false);
    expect(after.dismissed).toEqual(['command:abc']);
    expect(after.enabledSessions).toEqual({ s1: false });
    // null 은 그 칸을 지운다(= 상속으로 되돌린다).
    expect(withAutoGoalScope(after, 'session', 's1', null).enabledSessions).toEqual({});
  });

  it('물림은 덮는 것이지 지우는 것이 아니다 — 풀면 되돌아온다', () => {
    const a = withAutoGoalDismissed({}, 'command:x', true);
    expect(a.dismissed).toEqual(['command:x']);
    expect(withAutoGoalDismissed(a, 'command:x', false).dismissed).toBeUndefined();
  });

  it('손으로 적은 JSON 이 들어와도 계약 안으로 접는다', () => {
    const s = normalizeAutoGoalSettings({
      enabledProject: 'yes',
      enabledAgents: { a1: true, a2: 'nope' },
      dismissed: ['x', 'x', 42, ''],
    });
    expect(s.enabledProject).toBeUndefined();
    expect(s.enabledAgents).toEqual({ a1: true });
    expect(s.dismissed).toEqual(['x']);
  });
});

describe('자동 목표 — 되풀이 마이닝', () => {
  it('한 번 한 일은 후보가 아니다', () => {
    const out = mineAutoGoalCandidates({
      bashHistory: { a1: run(['pnpm build', 'pnpm test'], T0) },
    });
    expect(out.candidates).toEqual([]);
    expect(out.observed).toBe(2);
  });

  it('같은 순서를 세 번 되풀이하면 후보가 선다', () => {
    const out = mineAutoGoalCandidates({
      bashHistory: {
        a1: [
          ...run(['pnpm build', 'pnpm test'], T0),
          ...run(['pnpm build', 'pnpm test'], T0 + 60_000),
          ...run(['pnpm build', 'pnpm test'], T0 + 120_000),
        ],
      },
    });
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]?.runs).toBe(3);
    expect(out.candidates[0]?.steps).toEqual(['pnpm build', 'pnpm test']);
    expect(out.candidates[0]?.source).toBe('command');
  });

  it('시간 창을 넘으면 이어진 일이 아니다', () => {
    const far = AUTO_GOAL_WINDOW_MS + 60_000;
    const out = mineAutoGoalCandidates({
      bashHistory: {
        a1: [
          ...run(['pnpm build'], T0),
          ...run(['pnpm test'], T0 + far),
          ...run(['pnpm build'], T0 + far * 2),
          ...run(['pnpm test'], T0 + far * 3),
          ...run(['pnpm build'], T0 + far * 4),
          ...run(['pnpm test'], T0 + far * 5),
        ],
      },
    });
    expect(out.candidates).toEqual([]);
  });

  it('연달아 같은 명령(재시도)은 한 단계로 접는다', () => {
    const out = mineAutoGoalCandidates({
      bashHistory: {
        a1: [
          ...run(['pnpm build', 'pnpm build', 'pnpm test'], T0),
          ...run(['pnpm build', 'pnpm test'], T0 + 60_000),
          ...run(['pnpm build', 'pnpm build', 'pnpm build', 'pnpm test'], T0 + 120_000),
        ],
      },
    });
    expect(out.candidates[0]?.steps).toEqual(['pnpm build', 'pnpm test']);
    expect(out.candidates[0]?.runs).toBe(3);
  });

  it.each(['error', 'running', undefined] as const)('성공이 확인되지 않은 명령은 세지 않는다: %s', (status) => {
    const entries = run(['pnpm build', 'pnpm test', 'pnpm build', 'pnpm test', 'pnpm build', 'pnpm test'], T0)
      .map((entry) => ({ ...entry, status }));
    const out = mineAutoGoalCandidates({ bashHistory: { a1: entries } });
    expect(out.candidates).toEqual([]);
    expect(out.observed).toBe(0);
  });

  it.each(['error', 'running', undefined] as const)('성공 사이의 미확인 명령을 지워 가짜 이웃을 만들지 않는다: %s', (status) => {
    const bashHistory: Record<string, BashEntry[]> = {};
    for (let i = 0; i < 3; i += 1) {
      bashHistory[`s${i}`] = run(['pnpm build', 'blocked command', 'pnpm test'], T0)
        .map((entry, index) => index === 1 ? { ...entry, status } : entry);
    }
    const out = mineAutoGoalCandidates({ bashHistory });
    expect(out.candidates).toEqual([]);
    expect(out.observed).toBe(6);
  });

  it('실패 경계 뒤의 완전한 성공 절차는 따로 센다', () => {
    const entries = run(['old command', 'failed command', 'pnpm build', 'pnpm test', 'pnpm build', 'pnpm test', 'pnpm build', 'pnpm test'], T0);
    entries[1] = { ...entries[1]!, status: 'error' };
    const out = mineAutoGoalCandidates({ bashHistory: { a1: entries } });
    expect(out.candidates[0]?.steps).toEqual(['pnpm build', 'pnpm test']);
    expect(out.candidates[0]?.runs).toBe(3);
  });

  it('인용된 공백·개행·들여쓰기와 앞뒤 공백까지 실행 원문으로 보존한다', () => {
    const command = '  cat <<\'EOF\'\n  a  b\n\tline two\nEOF\n';
    const sequence = [command, 'printf "a  b\\n"'];
    const out = mineAutoGoalCandidates({ bashHistory: { a1: run([...sequence, ...sequence, ...sequence], T0) } });
    expect(out.candidates[0]?.steps).toEqual(sequence);
    const body = autoGoalSkillBody(out.candidates[0]!, T0);
    expect(body).toContain(command);
    expect(body).toContain(sequence[1]);
  });

  it('인용된 공백이 다른 명령을 한 반복으로 합치지 않는다', () => {
    const out = mineAutoGoalCandidates({
      bashHistory: {
        a1: run(['echo "a  b"', 'echo done', 'echo "a b"', 'echo done', 'echo "a   b"', 'echo done'], T0),
      },
    });
    expect(out.candidates).toEqual([]);
  });

  it('앞 200자가 같은 긴 명령은 끝까지 비교하고 보존한다', () => {
    const prefix = `echo ${'x'.repeat(240)}`;
    const commands = [`${prefix} one`, `${prefix} two`, `${prefix} three`];
    const distinct = mineAutoGoalCandidates({
      bashHistory: { a1: run(commands.flatMap((command) => [command, 'echo done']), T0) },
    });
    expect(distinct.candidates).toEqual([]);

    const sequence = [commands[0]!, 'echo done'];
    const repeated = mineAutoGoalCandidates({ bashHistory: { a1: run([...sequence, ...sequence, ...sequence], T0) } });
    expect(repeated.candidates[0]?.steps).toEqual(sequence);
    expect(autoGoalSkillBody(repeated.candidates[0]!, T0)).toContain(commands[0]);
  });

  it('안전 상한을 넘는 명령은 잘라 담지 않고 순서 경계로 남긴다', () => {
    const command = 'x'.repeat(AUTO_GOAL_COMMAND_MAX + 1);
    const bashHistory: Record<string, BashEntry[]> = {};
    for (let i = 0; i < 3; i += 1) bashHistory[`s${i}`] = run(['before', command, 'after'], T0);
    const out = mineAutoGoalCandidates({ bashHistory });
    expect(out.candidates).toEqual([]);
    expect(out.observed).toBe(6);
  });

  it('최신순·오래된순 이력 모두 정렬 후 최신 꼬리를 훑는다', () => {
    const old = run(Array.from({ length: AUTO_GOAL_SCAN_TAIL }, (_, i) => `old ${i}`), T0);
    const recent = run(['build', 'test', 'build', 'test', 'build', 'test'], T0 + AUTO_GOAL_WINDOW_MS * 2);
    const entries = [...old, ...recent];
    const ascending = mineAutoGoalCandidates({ bashHistory: { a1: entries } });
    const descending = mineAutoGoalCandidates({ bashHistory: { a1: [...entries].reverse() } });
    expect(descending).toEqual(ascending);
    expect(descending.observed).toBe(AUTO_GOAL_SCAN_TAIL);
    expect(descending.candidates[0]?.steps).toEqual(['build', 'test']);
    expect(entries[0]?.command).toBe('old 0');
  });

  it('겹쳐 세지 않는다 — a b a b a b 에서 a b 는 3회다', () => {
    const out = mineAutoGoalCandidates({
      bashHistory: { a1: run(['a x', 'b y', 'a x', 'b y', 'a x', 'b y'], T0) },
    });
    const ab = out.candidates.find((c) => c.steps.join('|') === 'a x|b y');
    expect(ab?.runs).toBe(3);
  });

  it('절차 앞에 다른 명령이 있어도 모든 시작 위치에서 반복을 찾는다', () => {
    const out = mineAutoGoalCandidates({
      bashHistory: { a1: run(['prefix', 'a x', 'b y', 'a x', 'b y', 'a x', 'b y'], T0) },
    });
    expect(out.candidates[0]?.steps).toEqual(['a x', 'b y']);
    expect(out.candidates[0]?.runs).toBe(3);
  });

  it('모든 시작 위치를 보아도 같은 후보의 겹친 실행은 문턱에 보태지 않는다', () => {
    const out = mineAutoGoalCandidates({
      bashHistory: { a1: run(['a', 'b', 'a', 'b', 'a', 'b', 'a', 'b', 'a'], T0) },
    });
    // a b a 는 네 시작점에 보이지만 겹치지 않는 관찰은 두 번뿐이다.
    expect(out.candidates.some((c) => c.steps.join('|') === 'a|b|a')).toBe(false);
    expect(out.candidates.every((c) => c.runs <= Math.floor(9 / c.steps.length))).toBe(true);
  });

  it('긴 절차가 서면 그 부분 묶음은 목록에 또 서지 않는다', () => {
    const seq = ['git add -A', 'git commit -m x', 'git push'];
    const out = mineAutoGoalCandidates({
      bashHistory: {
        a1: [...run(seq, T0), ...run(seq, T0 + 60_000), ...run(seq, T0 + 120_000)],
      },
    });
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]?.steps).toEqual(seq);
  });

  it('사용자가 물린 후보는 목록에서 빠진다 — 관찰은 계속된다', () => {
    const bashHistory = {
      a1: [
        ...run(['pnpm build', 'pnpm test'], T0),
        ...run(['pnpm build', 'pnpm test'], T0 + 60_000),
        ...run(['pnpm build', 'pnpm test'], T0 + 120_000),
      ],
    };
    const first = mineAutoGoalCandidates({ bashHistory });
    const id = first.candidates[0]?.id ?? '';
    const after = mineAutoGoalCandidates({ bashHistory, dismissed: [id] });
    expect(after.candidates).toEqual([]);
    expect(after.observed).toBe(first.observed);
  });

  it('사용자가 꽂은 단계도 원천이다 — 에이전트가 쓴 단계는 아니다', () => {
    const goal = (steps: { text: string; authoredBy: 'user' | 'session' }[]): SessionGoal =>
      ({
        steps: steps.map((s, i) => ({
          id: `st${i}`,
          text: s.text,
          status: 'done',
          authoredBy: s.authoredBy,
          updatedAt: T0 + i,
        })),
      } as unknown as SessionGoal);
    const mine = (n: number): Record<string, SessionGoal> => {
      const out: Record<string, SessionGoal> = {};
      for (let i = 0; i < n; i += 1) {
        out[`s${i}`] = goal([
          { text: '/vibisual-qa', authoredBy: 'user' },
          { text: 'pnpm typecheck', authoredBy: 'user' },
        ]);
      }
      return out;
    };
    const hit = mineAutoGoalCandidates({ sessionGoals: mine(3) });
    expect(hit.candidates[0]?.source).toBe('step');
    expect(hit.candidates[0]?.steps).toEqual(['/vibisual-qa', 'pnpm typecheck']);

    const bySession: Record<string, SessionGoal> = {};
    for (let i = 0; i < 3; i += 1) {
      bySession[`s${i}`] = goal([
        { text: '/vibisual-qa', authoredBy: 'session' },
        { text: 'pnpm typecheck', authoredBy: 'session' },
      ]);
    }
    expect(mineAutoGoalCandidates({ sessionGoals: bySession }).candidates).toEqual([]);
  });

  it.each(['pending', 'in_progress'] as const)('미완료 사용자 단계는 성공 절차가 아니다: %s', (status) => {
    const sessionGoals: Record<string, SessionGoal> = {};
    for (let i = 0; i < 3; i += 1) {
      // 이 검증은 단계 채굴 입력만 필요하며 나머지 목표 필드는 읽지 않는다.
      sessionGoals[`s${i}`] = {
        steps: ['build', 'test'].map((text, index) => ({ id: `st${index}`, text, status, authoredBy: 'user', updatedAt: T0 })),
      } as SessionGoal;
    }
    const out = mineAutoGoalCandidates({ sessionGoals });
    expect(out.candidates).toEqual([]);
    expect(out.observed).toBe(0);
  });

  it('완료 사용자 단계 사이의 미완료·세션 작성 단계는 순서를 끊는다', () => {
    for (const middle of [
      { status: 'pending', authoredBy: 'user' },
      { status: 'in_progress', authoredBy: 'user' },
      { status: 'done', authoredBy: 'session' },
    ] as const) {
      const sessionGoals: Record<string, SessionGoal> = {};
      for (let i = 0; i < 3; i += 1) {
        // 이 검증은 단계 채굴 입력만 필요하며 나머지 목표 필드는 읽지 않는다.
        sessionGoals[`s${i}`] = {
          steps: ['build', 'middle', 'test'].map((text, index) => ({
            id: `st${index}`, text, updatedAt: T0,
            ...(index === 1 ? middle : { status: 'done', authoredBy: 'user' }),
          })),
        } as SessionGoal;
      }
      const out = mineAutoGoalCandidates({ sessionGoals });
      expect(out.candidates).toEqual([]);
      expect(out.observed).toBe(6);
    }
  });

  it('같은 입력이면 id 가 같다 — 저장하지 않는 파생이라 이것이 유일한 안정 키다', () => {
    const a = autoGoalSequenceId('command', ['x', 'y']);
    expect(a).toBe(autoGoalSequenceId('command', ['x', 'y']));
    expect(a).not.toBe(autoGoalSequenceId('command', ['y', 'x']));
    expect(a).not.toBe(autoGoalSequenceId('step', ['x', 'y']));
  });

  it('제목은 첫 걸음에서 마지막 걸음까지를 말한다', () => {
    expect(autoGoalTitle(['git add -A', 'git commit -m x', 'git push origin main'])).toBe('git add → git push');
    expect(autoGoalTitle(['pnpm build'])).toBe('pnpm build');
  });

  it('연속 포함만 부분 묶음으로 본다 — 흩어진 포함은 절차가 아니다', () => {
    expect(isSubsequenceRun(['b', 'c'], ['a', 'b', 'c', 'd'])).toBe(true);
    expect(isSubsequenceRun(['a', 'c'], ['a', 'b', 'c'])).toBe(false);
  });

  it('스킬 본문은 단계 원문을 그대로 담는다 — 요약하면 다시 돌릴 수 없다', () => {
    const body = autoGoalSkillBody(
      { id: 'command:x', title: 't', steps: ['pnpm build', 'pnpm test'], runs: 4, lastSeenAt: T0, source: 'command' },
      T0,
    );
    expect(body).toContain('pnpm build');
    expect(body).toContain('pnpm test');
    expect(body).toContain('4번 되풀이');
    expect(body).toContain('검토 대기 후보');
    expect(body).toContain('반복 관찰만으로 실행이 승인되지는 않습니다');
    expect(body).toContain('수정한 본문을 덮어쓰지 않으며');
    expect(autoGoalSkillDescription({
      id: 'command:x', title: 'git add → git push', steps: ['git add -A', 'git push'], runs: 5, lastSeenAt: T0, source: 'command',
    })).toContain('5번 되풀이');
  });
});

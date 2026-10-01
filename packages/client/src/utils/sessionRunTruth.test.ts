/**
 * **"실행 중"이 거짓말하지 않는가** — §2.4 세션 생존 판정의 회귀 고정.
 *
 * 사용자 보고: 일이 갑자기 멈췄는데 화면은 계속 "실행 중"이라 적혀 있고, 끝난 것인지·끊긴
 * 것인지·이어서 하는 것인지 구별할 수단도, 빠져나갈 방법도 없었다. 원인은 하나가 아니라
 * **판정이 여러 벌로 흩어져 있던 것**이었다:
 *  (A) 화면용 사본(displayCommands)이 생존 판정에 샜고, 그 목록엔 세션 필터조차 없었다,
 *  (B) executing/queued 를 호출부마다 손으로 적어 술어가 두 벌이 됐고,
 *  (C) 상태바만 sessionRunStateOf 를 인자 둘로 불러 다른 답을 냈고,
 *  (D) [중지]가 응답을 버려 "멈출 것이 없다"는 답이 화면에 닿지 않았고,
 *  (G) 실행 축에 시간이 없어 "얼마나 조용한가"를 말할 수 없었다.
 *  (I) **줄 서 있는 명령이 판정에서 통째로 빠져 있었다** — 앞 턴의 `executing` 이 좀비로 남아
 *      자물쇠를 쥐면 뒤에 선 덧말은 `queued` 로 멈추는데, 그 세션의 `sub.status` 는 `idle` 이라
 *      화면은 **"완료"**라고 적었다. 사용자는 그 완료를 믿고 또 덧말을 보냈고, 그 덧말도 줄만
 *      섰다 — 그러는 내내 스트림 바닥은 "작업 중 · 마지막 업데이트 24m 26s 전"을 키웠다
 *      (사용자 보고 그대로). 완료와 작업 중 **둘 다 거짓말**이었고, 참말은 "대기"였다.
 *  (J) 조용한 사전 압축(§5.3 #9-1 (P)) 뒤에 막 나간 명령이 **앞 턴 끝부터 잰** "마지막 업데이트 N분 전"
 *      으로 시작해 멈춘 세션처럼 보였다 — 라이브 1줄 시계가 보인 줄만 쟀고, 감춘 턴의 움직임은
 *      클라에 오지 않는다. 압축이 도는 동안에도 그 줄은 입력한 순간부터 세는 평소 "작업 중"이다.
 *  (E) 그 압축을 물려받은 명령은 "실행 중…" 배지 아래에 대기 명령의 칩·설명·삭제가 **함께** 붙어
 *      대기에 빠진 것으로 읽혔다 — 물려받은 명령은 실행 중인 명령과 구별되지 않아야 한다.
 *  (K) 입력창 위 백단 셸 띠가 셸 개수 하나만 보고 떠서, 턴이 아직 도는 중에도 "답은 이미 나왔으니
 *      계속 입력하셔도 된다"고 적었다 — 그 말을 믿고 보낸 말은 줄에 섰다. 띠를 걷었다(§5.5 #17-9 ⑰(c-1)).
 *  (L) 라이브 1줄의 경과가 **마지막 활동부터** 재여 줄이 올 때마다 0 으로 되감겼고(`0s`·`1s` 반복),
 *      1초 틱에 멈춘 `now` 로 그 사이 온 줄을 재면 음수라 숫자가 사라졌다. 평소엔 턴 시작부터 잰다.
 *
 * jsdom 이 없어 렌더 테스트는 못 한다 — 판정은 순수 함수로, 배선은
 * import.meta.glob(?raw) 소스 스캔으로 고정한다(promptBubbleCollapse.test.ts 와 같은 방식).
 */
import { describe, it, expect } from 'vitest';
import {
  EMPTY_SESSION_RUN_INPUTS,
  SESSION_NO_RESPONSE_MS,
  displayCommands,
  hasSessionWork,
  isSessionRunning,
  isSessionExecuting,
  isSessionWaiting,
  resolveSessionLiveness,
  resolveSessionRunState,
  sessionSilenceMs,
  type QueuedCommand,
  type SessionRunState,
  type SubAgent,
  type SubAgentStreamEvent,
} from '@vibisual/shared';
import {
  SESSION_STATUS_DOT,
  SESSION_STATUS_LABEL_KEY,
  buildSessionRunInputs,
  serializePendingSubIds,
  sessionRunStateOf,
} from './sessionStatus.js';
import { buildBaseItems, IncrementalStreamParser, sameStreamItem } from '../components/IDE/streamItems.js';
import { countSessionTasks } from '../components/IDE/runningSubagents.js';
import { formatElapsed } from '../components/IDE/elapsed.js';
import {
  liveLineClockFrom, liveLineStalled, sessionHiddenTurnRunning, sessionLastActivityAt, sessionTurnStartedAt,
} from './sessionActivity.js';
import {
  classifyStopResponse, stoppedCount, sessionStopUrl, sessionForceStopUrl,
} from '../hooks/useSessionStop.js';
import { turnStopLabelKey } from '../components/IDE/turnStopLabel.js';
import en from '../i18n/locales/en.json';
import ko from '../i18n/locales/ko.json';

function cmd(patch: Partial<QueuedCommand>): QueuedCommand {
  return {
    id: 'cmd-1',
    text: 'hello',
    timestamp: 1_000,
    subAgentId: 'sub-A',
    status: 'queued',
    ...patch,
  } as QueuedCommand;
}

function sub(patch: Partial<SubAgent> = {}): SubAgent {
  return {
    id: 'sub-A',
    sessionId: 'sess-A',
    label: 'Sub A',
    parentAgentId: 'agent-1',
    status: 'idle',
    createdAt: 0,
    lastActivityAt: 0,
    ...patch,
  } as SubAgent;
}

const SOURCES = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

/**
 * `fn(...)` 호출의 **최상위 인자 수**.
 *
 * 정규식 한 줄로 세면 안 된다 — `\([^)]*\)` 는 `busySubIds.has(sub.id)` 같은 중첩 괄호에서
 * 첫 `)` 에 끊겨 인자를 **적게** 센다. 그래서 인자가 하나 빠져도 그 검사는 통과한다.
 * 괄호 깊이를 세어 잘라야 이 목록이 실제로 무언가를 막는다.
 */
function callArgCounts(src: string, fn: string): number[] {
  const out: number[] = [];
  const needle = fn + '(';
  for (let at = src.indexOf(needle); at >= 0; at = src.indexOf(needle, at + 1)) {
    let depth = 0;
    let commas = 0;
    for (let i = at + needle.length - 1; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) {
          out.push(commas + 1);
          break;
        }
      } else if (ch === ',' && depth === 1) commas++;
    }
  }
  return out;
}

/** 소스 스캔용 — glob 이 조용히 비면 검사가 통째로 무력해지므로 길이까지 본다. */
function readSource(path: string): string {
  const src = SOURCES[path] as string | undefined;
  expect(src, path + ' 를 읽지 못했다').toBeTypeOf('string');
  expect((src ?? '').length, path + ' 가 비어 있다').toBeGreaterThan(500);
  return src ?? '';
}

describe('(A) 표시용 사본은 생존 판정에 쓰이지 않는다', () => {
  // 조용한 압축이 도는 세션 — 원본 큐에는 silent 실행 1건 + 사용자 대기 1건.
  const raw: QueuedCommand[] = [
    cmd({ id: 'silent-1', status: 'executing', silent: true, text: '/compact' }),
    cmd({ id: 'user-1', status: 'queued' }),
  ];
  const shown = displayCommands(raw) as QueuedCommand[];
  const sources = { sub: sub({ status: 'active' }), runningTasks: undefined, acknowledged: false };

  it('사본은 원본과 다른 목록이다 — 감추고, 승격한다', () => {
    expect(shown).toHaveLength(1);
    expect(shown[0]!.id).toBe('user-1');
    // 아직 나가지도 않은 명령이 화면에서는 실행 중으로 그려진다(표시 전용 승격).
    expect(shown[0]!.status).toBe('executing');
  });

  it('원본 큐는 대기와 실제 executing을 보존하고 서버 active가 실행 판정을 유지한다', () => {
    const fromRaw = buildSessionRunInputs({ ...sources, commands: raw });
    const fromShown = buildSessionRunInputs({ ...sources, commands: shown });

    // 원본은 "줄 서 있는 명령이 있다"를 안다 — 사본은 그 사실을 승격으로 지운다.
    //   이 한 칸 때문에 대기 명령의 취소 손잡이가 화면에서 사라졌다.
    expect(fromRaw.hasQueuedCommand).toBe(true);
    expect(fromShown.hasQueuedCommand).toBe(false);

    // 조용한 압축은 원본에만 있지만, 실제 실행 상태는 서버 active가 보장한다.
    const onlySilent = [raw[0]!];
    const silentRaw = buildSessionRunInputs({ ...sources, commands: onlySilent });
    const silentShown = buildSessionRunInputs({
      ...sources, commands: displayCommands(onlySilent) as QueuedCommand[],
    });
    expect(isSessionRunning(silentRaw)).toBe(true);
    expect(isSessionRunning(silentShown)).toBe(true);
    expect(isSessionExecuting(silentRaw)).toBe(true);
    expect(isSessionExecuting(silentShown)).toBe(false);
  });
});

describe('(A) 배선 — 생존 판정 자리에 손글씨 술어가 없다', () => {
  it('생존 판정 훅은 displayCommands 를 아예 쓰지 않는다', () => {
    const src = readSource('../hooks/useSessionRunning.ts');
    expect(src).not.toMatch(/displayCommands\s*\(/);
    expect(src).toMatch(/isSessionRunning/);
    expect(src).toMatch(/hasSessionWork/);
  });

  it('메인 탭 라이브 1줄·스트림 바닥은 공유 훅을 본다', () => {
    const src = readSource('../components/IDE/IDEMainArea.tsx');
    // 종전의 손글씨가 되살아나면 이 검사가 잡는다.
    expect(src).not.toMatch(/commands\.some\(\(c\) => c\.status === 'executing' \|\| c\.status === 'queued'\)/);
    expect(src).toMatch(/useSessionWork\(agentId, activeSessionId\)/);
    expect(src).toMatch(/useSessionExecuting\(agentId, activeSessionId\)/);
    expect(src).toMatch(/sessionBusy=\{sessionHasWork\}/);
  });

  it('스트림 렌더러는 부모가 준 생존 값을 파서까지 내려보낸다', () => {
    const renderer = readSource('../components/IDE/StreamRenderer.tsx');
    expect(renderer).toMatch(/sessionBusy\??:/);
    // (I) 대기 축도 **같은 경로로** 내려간다 — 한쪽만 내려보내면 Sub 탭만 대기를 못 그린다.
    expect(renderer).toMatch(/sessionWaiting\??:/);
    // (J) 라이브 1줄 시계의 바닥·감춘 턴도 같은 경로로 내려간다. (L) 턴 시계의 시작점도.
    expect(renderer).toMatch(/sync\(events, commands, sessionBusy, sessionWaiting, sessionActivityAt, sessionActivityHidden, sessionTurnStartedAt\)/);
    const items = readSource('../components/IDE/streamItems.ts');
    expect(items).toMatch(/agentBusyOverride/);
    expect(items).toMatch(/agentWaitingOverride/);
  });
});

describe('(A) 다른 세션의 executing 이 이 세션을 "실행 중"으로 칠하지 않는다', () => {
  // 실측: 멈춘 화면의 큐에는 세션 id 가 빈 채 executing 으로 남은 좀비가 있었다.
  const zombie = cmd({ id: 'zombie', status: 'executing', subAgentId: '' });
  const otherSession = cmd({ id: 'other', status: 'executing', subAgentId: 'sub-B' });
  const commands = [zombie, otherSession];

  it('세션 탭은 자기 것만 센다', () => {
    const inputs = buildSessionRunInputs({
      sub: sub({ status: 'idle' }), commands, runningTasks: undefined, acknowledged: false,
    });
    expect(inputs.hasExecutingCommand).toBe(false);
    expect(isSessionRunning(inputs)).toBe(false);
    expect(hasSessionWork(inputs)).toBe(false);
  });

  it('세션 필터 없이 세면(종전 손글씨) 거짓 양성이 난다 — 그 차이가 이 버그였다', () => {
    expect(commands.some((c) => c.status === 'executing')).toBe(true);
  });

  it('메인 탭(좁힐 세션이 없음)은 종전대로 에이전트 전체를 본다', () => {
    const inputs = buildSessionRunInputs({
      sub: null, commands, runningTasks: undefined, acknowledged: false,
    });
    expect(inputs.hasExecutingCommand).toBe(true);
  });
});

describe('(B) 술어는 한 벌 — running / waiting / work 가 서로 어긋나지 않는다', () => {
  const queuedOnly = { ...EMPTY_SESSION_RUN_INPUTS, hasQueuedCommand: true };
  const executing = { ...EMPTY_SESSION_RUN_INPUTS, hasExecutingCommand: true };

  it('줄만 서 있는 것은 "돌고 있다"가 아니다', () => {
    expect(isSessionRunning(queuedOnly)).toBe(false);
    expect(isSessionWaiting(queuedOnly)).toBe(true);
    expect(hasSessionWork(queuedOnly)).toBe(true);
  });

  it('돌고 있으면 waiting 이 아니다 — 두 술어는 배타다', () => {
    expect(isSessionRunning(executing)).toBe(true);
    expect(isSessionWaiting(executing)).toBe(false);
    expect(hasSessionWork(executing)).toBe(true);
  });

  it('아무것도 없으면 셋 다 거짓', () => {
    expect(isSessionRunning(EMPTY_SESSION_RUN_INPUTS)).toBe(false);
    expect(isSessionWaiting(EMPTY_SESSION_RUN_INPUTS)).toBe(false);
    expect(hasSessionWork(EMPTY_SESSION_RUN_INPUTS)).toBe(false);
  });
});

describe('(C) 상태바·탭바·분할 칸은 같은 입력에 같은 답을 낸다', () => {
  const s = sub({ status: 'idle' });

  it('백그라운드 작업 인자를 빼면 답이 갈린다 — 그래서 빼면 안 된다', () => {
    expect(sessionRunStateOf(s, false, false)).not.toBe('running');
    expect(sessionRunStateOf(s, false, true)).toBe('running');
    // 인자를 생략한 호출은 곧 "false 로 본다" = 탭 도트는 켜지고 상태바만 꺼지던 그 어긋남.
    expect(sessionRunStateOf(s, false)).toBe(sessionRunStateOf(s, false, false));
  });

  it('도트를 그리는 자리는 모두 인자 **넷**을 넘긴다', () => {
    // (I) 셋째(백그라운드)까지만 넘기던 것이 이 목록의 종전 규약이었다. 넷째(줄 선 명령)가
    //   빠진 자리는 그 세션을 "완료"로 적는다 — 그 한 칸이 사용자를 속인 바로 그 표시다.
    for (const path of [
      '../components/IDE/IDEStatusBar.tsx',
      '../components/IDE/IDETabBar.tsx',
      '../components/IDE/IDESplitCell.tsx',
      '../components/IDE/IDETabSortMenu.tsx',
      '../components/Panel/SubAgentList.tsx',
    ]) {
      const src = readSource(path);
      const counts = callArgCounts(src, 'sessionRunStateOf');
      expect(counts.length, path + ' 에 sessionRunStateOf 호출이 없다').toBeGreaterThan(0);
      for (const n of counts) {
        expect(n, path + ': 인자가 모자란 sessionRunStateOf 호출이 있다').toBeGreaterThanOrEqual(4);
      }
      // 재료는 같은 방식으로 집는다(참조 안정 문자열 → 집합).
      expect(src).toMatch(/serializeBusySubIds/);
      expect(src).toMatch(/parseBusySubIds/);
      expect(src).toMatch(/serializePendingSubIds/);
    }
  });
});

describe('(I) 줄 서 있는 세션은 "완료"가 아니다 — 대기다', () => {
  const idle = sub({ status: 'idle' });

  it('큐에 남은 명령 하나가 doneUnseen 을 waiting 으로 되돌린다', () => {
    // 사고 재현: 앞 턴이 자물쇠를 쥔 채 사라져 sub.status 는 idle, 덧말은 queued.
    expect(sessionRunStateOf(idle, false, false, false)).toBe('doneUnseen');
    expect(sessionRunStateOf(idle, false, false, true)).toBe('waiting');
    // 사용자가 그 세션을 이미 확인했어도 마찬가지다 — 확인은 "봤다"이지 "끝났다"가 아니다.
    expect(sessionRunStateOf(idle, true, false, true)).toBe('waiting');
  });

  it('넷째 인자를 생략한 호출은 종전 답 그대로 — 기존 호출부를 깨지 않는다', () => {
    expect(sessionRunStateOf(idle, false, false)).toBe(sessionRunStateOf(idle, false, false, false));
  });

  it('우선순위: error > running > limited > waiting > doneUnseen', () => {
    const q = { ...EMPTY_SESSION_RUN_INPUTS, hasQueuedCommand: true };
    expect(resolveSessionRunState(q)).toBe('waiting');
    // 도는 중이면 파랑이 이긴다(줄 선 것은 그 뒤에 나갈 일이라 말할 것이 없다).
    expect(resolveSessionRunState({ ...q, hasExecutingCommand: true })).toBe('running');
    // 한도로 끊긴 세션은 사유가 더 구체적이다.
    expect(resolveSessionRunState({ ...q, usageLimited: true })).toBe('limited');
    // 실패는 언제나 가장 먼저.
    expect(resolveSessionRunState({ ...q, subStatus: 'error' })).toBe('error');
  });

  it('생존 축(resolveSessionLiveness)과 표시 축이 같은 말을 한다', () => {
    const q = { ...EMPTY_SESSION_RUN_INPUTS, hasQueuedCommand: true };
    expect(resolveSessionLiveness(q, 1_000, 1_000 + SESSION_NO_RESPONSE_MS * 9)).toBe('waiting');
    // 종전엔 생존 축만 'waiting' 을 알고 표시 축은 그 값을 갖지도 않았다 — 그 비대칭이 사고였다.
    expect(resolveSessionRunState(q)).toBe('waiting');
  });

  it('표시 표 셋 모두 새 값을 안다(빠지면 색·낱말이 undefined 로 샌다)', () => {
    const ALL: SessionRunState[] = ['running', 'error', 'limited', 'waiting', 'doneUnseen', 'done'];
    for (const st of ALL) {
      expect(SESSION_STATUS_DOT[st], st + ' 도트 색이 없다').toBeTruthy();
      expect(SESSION_STATUS_LABEL_KEY[st], st + ' 라벨 키가 없다').toBeTruthy();
    }
    // 대기는 **끝난 둘과 다른 색**이어야 한다 — 같으면 이 축을 만든 의미가 없다.
    expect(SESSION_STATUS_DOT.waiting).not.toBe(SESSION_STATUS_DOT.done);
    expect(SESSION_STATUS_DOT.waiting).not.toBe(SESSION_STATUS_DOT.doneUnseen);
    // "대기"와 "완료"가 같은 낱말이면 화면은 여전히 거짓말을 한다.
    expect(SESSION_STATUS_LABEL_KEY.waiting).not.toBe(SESSION_STATUS_LABEL_KEY.done);
  });
});

describe('(I) serializePendingSubIds — 줄 선 세션만, 값이 바뀔 때만', () => {
  it('queued 만 센다 — executing 은 빼고(좀비가 도는 중으로 세탁되지 않게)', () => {
    const list = [
      cmd({ id: 'a', status: 'executing', subAgentId: 'sub-Z' }),
      cmd({ id: 'b', status: 'queued', subAgentId: 'sub-A' }),
    ];
    expect(serializePendingSubIds(list)).toBe('sub-A');
  });

  it('정렬·중복 제거 — 같은 집합이면 같은 문자열(불필요한 리렌더 ❌)', () => {
    const one = [cmd({ id: '1', subAgentId: 'b' }), cmd({ id: '2', subAgentId: 'a' })];
    const two = [cmd({ id: '3', subAgentId: 'a' }), cmd({ id: '4', subAgentId: 'b' }), cmd({ id: '5', subAgentId: 'a' })];
    expect(serializePendingSubIds(one)).toBe(serializePendingSubIds(two));
  });

  it('빈 입력·주인 없는 명령은 아무도 켜지 않는다', () => {
    expect(serializePendingSubIds(undefined)).toBe('');
    expect(serializePendingSubIds([])).toBe('');
    expect(serializePendingSubIds([cmd({ subAgentId: '' })])).toBe('');
  });
});

describe('(I) 라이브 1줄 — 대기는 "작업 중"이 아니다', () => {
  const events: never[] = [];

  it('줄만 서 있으면 mode 가 waiting 이다', () => {
    const live = buildBaseItems(events, undefined, /*busy=*/true, /*waiting=*/true).thinkingLive;
    expect(live?.mode).toBe('waiting');
  });

  it('도는 중이면 종전대로 working — 대기가 실행을 덮지 않는다', () => {
    const live = buildBaseItems(events, undefined, /*busy=*/true, /*waiting=*/false).thinkingLive;
    expect(live?.mode).toBe('working');
  });

  it('낼 일이 없으면 줄 자체가 없다(#17-24 ② 는 작동 중에만 상시 표시)', () => {
    expect(buildBaseItems(events, undefined, /*busy=*/false, /*waiting=*/true).thinkingLive).toBeNull();
  });

  it('override 가 없으면 큐만 보고 추정한다 — executing 이 있으면 대기가 아니다', () => {
    const queuedOnly = [cmd({ id: 'q', status: 'queued' })];
    const withExec = [cmd({ id: 'q', status: 'queued' }), cmd({ id: 'e', status: 'executing' })];
    expect(buildBaseItems(events, queuedOnly).thinkingLive?.mode).toBe('waiting');
    expect(buildBaseItems(events, withExec).thinkingLive?.mode).toBe('working');
  });

  it('배선 — 대기 줄은 뛰지도, 무응답 문구를 붙이지도 않는다', () => {
    const src = readSource('../components/IDE/ThinkingIndicator.tsx');
    // 셋 다 "지금 뭔가 하는 중"이라는 신호다. 대기에 붙으면 그 줄이 다시 거짓말을 한다.
    expect(src).toMatch(/const waiting = mode === 'waiting'/);
    // 무응답 판정은 순수 함수 한 곳(대기·감춘 턴 예외 포함 — sessionActivity.test.ts 가 값을 고정한다).
    expect(src).toMatch(/const stalled = liveLineStalled\(mode, silence, hiddenTurn\)/);
    expect(liveLineStalled('waiting', SESSION_NO_RESPONSE_MS * 10)).toBe(false);
    expect(src).toContain("stalled || waiting ? '' : 'animate-pulse'");
    expect(src).toContain('!stalled && !waiting && <ThinkingDots />');
  });

  it('배선 — 메인 탭도 같은 축을 본다(탭을 옮기면 말이 바뀌는 일 ❌)', () => {
    const src = readSource('../components/IDE/IDEMainArea.tsx');
    expect(src).toMatch(/waiting: sessionWaiting/);
    expect(src).toMatch(/sessionWaiting=\{sessionWaiting\}/);
    expect(src).toMatch(/MAIN_LIVE_LABEL_KEY/);
  });
});

describe('(D) 중지는 응답을 버리지 않는다', () => {
  it('네 갈래를 모두 구분한다', () => {
    expect(classifyStopResponse(false, 500, null)).toEqual({ kind: 'failed', status: 500 });
    expect(classifyStopResponse(true, 200, { ok: false })).toEqual({ kind: 'failed', status: 200 });
    // 200 인데 멈춘 것이 0 건 — 종전에는 이 응답을 버려 화면이 그대로였다.
    expect(classifyStopResponse(true, 200, { stopped: 0, cancelledQueued: 0 })).toEqual({ kind: 'nothing' });
    expect(classifyStopResponse(true, 200, null)).toEqual({ kind: 'nothing' });
    expect(classifyStopResponse(true, 200, { cancelledQueued: 2 })).toEqual({ kind: 'stopped', count: 2 });
  });

  it('두 라우트의 이름 다른 계수를 모두 센다', () => {
    expect(stoppedCount({ stopped: true, loopStopped: true })).toBe(2);
    expect(stoppedCount({ sealedExecuting: 1, loopsStopped: 2 })).toBe(3);
    expect(stoppedCount(null)).toBe(0);
  });

  it('범위 규칙 — 세션 탭은 그 세션, 메인 탭만 전체', () => {
    expect(sessionStopUrl('a1', 'sub-1')).toBe('/api/subagents/a1/sub-1/stop-session');
    expect(sessionStopUrl('a1', null)).toBe('/api/subagents/a1/stop-all');
    expect(sessionForceStopUrl('a1')).toBe('/api/subagents/a1/stop-all');
  });
});

describe('(D) 배선 — stopping 이 응답으로 풀리고, 결과가 화면에 드러난다', () => {
  it('useSessionStop 은 자기 요청의 응답으로 풀고 타이머로 풀지 않는다', () => {
    const src = readSource('../hooks/useSessionStop.ts');
    expect(src).toContain('activeScope.current !== scope || inFlight.current !== request');
    expect(src).toContain('setState({ scope, stopping: false, outcome });');
    expect(src).not.toMatch(/setTimeout\([^)]*setStopping/);
    expect(src).toMatch(/res\.ok/);
  });

  it('IDEMainArea 가 nothing / failed 를 그리고 강제 마감 손잡이를 연다', () => {
    const src = readSource('../components/IDE/IDEMainArea.tsx');
    expect(src).toMatch(/stopOutcome\.kind === 'nothing'/);
    expect(src).toMatch(/stopOutcome\.kind === 'failed'/);
    expect(src).toMatch(/onClick=\{forceStop\}/);
    expect(src).toMatch(/ide\.mainArea\.stopNothing/);
    expect(src).toMatch(/ide\.mainArea\.stopFailed/);
  });
});

describe('(G) 무응답 문턱 — 실행 인디케이터가 시간을 본다', () => {
  it('sessionSilenceMs 는 근거가 없으면 0 이 아니라 null 이다', () => {
    expect(sessionSilenceMs(null, 10_000)).toBeNull();
    expect(sessionSilenceMs(undefined, 10_000)).toBeNull();
    expect(sessionSilenceMs(0, 10_000)).toBeNull();
    // 시계가 어긋나 미래를 가리키면 "방금"으로 읽지 않고 근거 없음으로 둔다.
    expect(sessionSilenceMs(20_000, 10_000)).toBeNull();
    expect(sessionSilenceMs(4_000, 10_000)).toBe(6_000);
  });

  it('문턱을 넘는 순간 running 이 stalled 로 뒤집힌다', () => {
    const running = { ...EMPTY_SESSION_RUN_INPUTS, hasExecutingCommand: true };
    const now = 1_000_000;
    const justUnder = now - (SESSION_NO_RESPONSE_MS - 1);
    const atThreshold = now - SESSION_NO_RESPONSE_MS;
    expect(resolveSessionLiveness(running, justUnder, now)).toBe('running');
    expect(resolveSessionLiveness(running, atThreshold, now)).toBe('stalled');
    // 근거가 없으면 끊겼다고 단정하지 않는다.
    expect(resolveSessionLiveness(running, null, now)).toBe('running');
  });

  it('돌지 않는 세션은 문턱과 무관하게 waiting / idle 이다', () => {
    const queued = { ...EMPTY_SESSION_RUN_INPUTS, hasQueuedCommand: true };
    const now = 1_000_000;
    expect(resolveSessionLiveness(queued, 0, now)).toBe('waiting');
    expect(resolveSessionLiveness(queued, now - SESSION_NO_RESPONSE_MS * 10, now)).toBe('waiting');
    expect(resolveSessionLiveness(EMPTY_SESSION_RUN_INPUTS, null, now)).toBe('idle');
  });
});

describe('(G) 배선 — 무응답 문턱은 한 값, 시간을 말하는 자리는 카드·스트림 줄이다(상태바·입력창 위 ❌)', () => {
  it('카드가 자기 숫자를 들고 있지 않다', () => {
    const src = readSource('../components/IDE/IDERunningSubagentsCards.tsx');
    expect(src).toMatch(/NO_RESPONSE_HINT_MS\s*=\s*SESSION_NO_RESPONSE_MS/);
    expect(src).not.toMatch(/NO_RESPONSE_HINT_MS\s*=\s*\d/);
  });

  it('스트림 "작업 중..." 줄이 마지막 활동 시각을 받는다', () => {
    const src = readSource('../components/IDE/ThinkingIndicator.tsx');
    expect(src).toMatch(/lastActivityAt/);
    expect(src).toMatch(/liveLineStalled\(/);
    expect(src).toMatch(/ide\.runningSubagents\.noResponse/);
    // 문턱은 shared 상수 하나 — 줄이 자기 숫자를 들고 있지 않다.
    // 같은 폴더의 파일은 glob 키가 `./` 로 잡힌다.
    const judge = readSource('./sessionActivity.ts');
    expect(judge).toMatch(/silenceMs >= SESSION_NO_RESPONSE_MS/);
    expect(judge).not.toMatch(/silenceMs >= \d/);
  });

  // 사용자 지시(2026-09-23) — 상태바 "실행 중" 옆의 경과 시계(`· 0s`)는 걷었다. 축(⑥-6)은 그대로고
  //   줄어든 것은 표시 자리 하나다(위 스트림 줄이 같은 사실을 계속 말한다).
  //   판정은 **코드 모양**으로만 한다 — 왜 뺐는지 적은 주석이 낱말을 품고 있어 낱말 부재로 재면 헛실패한다.
  it('상태바는 경과 시계를 그리지 않는다', () => {
    const src = readSource('../components/IDE/IDEStatusBar.tsx');
    expect(src).not.toMatch(/statusElapsed/);
    expect(src).not.toMatch(/ide\.statusBar\.elapsedTip/);
    expect(src).not.toMatch(/from '\.\.\/\.\.\/hooks\/useNowTick\.js'/);
  });

  // 사용자 지시(2026-09-23) — 입력창 위 무응답 띠(경과 안내 · [더 기다리기] · [중지])도 걷었다.
  //   그 [중지]는 바로 아래 입력줄의 [중지](같은 handleStop)와 같은 기능 두 벌이었다.
  //   빠져나갈 길은 입력줄 [중지]가 그대로 맡는다 — 그것까지 사라지면 안 된다.
  it('입력창 위에는 무응답 띠를 두지 않는다 — [중지]는 입력줄 하나다', () => {
    const src = readSource('../components/IDE/IDEMainArea.tsx');
    expect(src).not.toMatch(/ide\.mainArea\.stallNotice/);
    expect(src).not.toMatch(/ide\.mainArea\.stallKeepWaiting/);
    expect(src).not.toMatch(/setStallSnoozeMs/);
    expect(src).not.toMatch(/from '\.\.\/\.\.\/hooks\/useNowTick\.js'/);
    expect(src).toMatch(/aria-label=\{t\('ide\.mainArea\.stop'\)\}/);
  });
});

describe('(K) 입력창 위에 백단 셸 띠를 두지 않는다 — 턴이 도는 중에도 "답은 나왔다"고 적었다', () => {
  // 사용자 지시(2026-09-29) — §5.5 #17-9 ⑰(c-1). 그 띠는 셸 개수 하나만 보고 떠서, 턴이 아직 도는 중
  //   (실행 중 · 입력줄 [중지] · "작업 중…")에도 "답변은 이미 도착했으니 계속 입력하셔도 됩니다"라고 적었고,
  //   그 말을 믿고 보낸 말은 #17-18 대로 줄에 섰다. [보기]는 활동바 항목과 같은 뷰를 여는 두 번째 손잡이였다.
  //   판정은 코드 모양으로만 한다 — 왜 뺐는지 적은 주석이 낱말을 품고 있다.
  it('입력창은 셸 개수를 구독하지도, 띠 문구를 그리지도 않는다', () => {
    const src = readSource('../components/IDE/IDEMainArea.tsx');
    expect(src).not.toMatch(/useBackgroundShellCount/);
    expect(src).not.toMatch(/t\('ide\.mainArea\.backgroundShells/);
    expect(src).not.toMatch(/openBackgroundShells/);
    // 그 띠만 쓰던 훅도 걷었다 — 남겨 두면 "짝으로 읽으라"는 주석을 보고 다음 사람이 띠를 되살린다.
    expect(readSource('../hooks/useSessionRunning.ts')).not.toMatch(/export function useBackgroundShellCount/);
  });

  it('띠 문구는 로케일에서도 걷혔고, 커맨드 센터의 회색 칩은 남는다', () => {
    for (const [name, bundle] of [['en', en], ['ko', ko]] as const) {
      expect(lookupText(bundle, 'ide.mainArea.backgroundShells'), name).toBe('');
      expect(lookupText(bundle, 'ide.mainArea.backgroundShellsTip'), name).toBe('');
      expect(lookupText(bundle, 'ide.mainArea.backgroundShellsOpen'), name).toBe('');
      expect(lookupText(bundle, 'commandCenter.backgroundShells'), name).toContain('{{count}}');
    }
  });

  it('셸이 돈다는 사실은 활동바 숫자가 그대로 센다 — 종류로 거르지 않는다', () => {
    const shell = { id: 'b1', parentAgentId: 'agent-1', subAgentId: 'sub-A', startedAt: 1, origin: 'stream' as const };
    const child = {
      id: 't1', parentAgentId: 'agent-1', subAgentId: 'sub-A', startedAt: 1, origin: 'hook' as const, subagentType: 'general-purpose',
    };
    expect(countSessionTasks([shell], 'sub-A')).toBe(1);
    expect(countSessionTasks([shell, child], 'sub-A')).toBe(2);
    // 활동바 "백그라운드 작업" 항목의 불과 아래 숫자가 바로 그 수다 — 띠가 없어도 셸은 화면에 남는다.
    expect(readSource('../components/IDE/IDEActivityBar.tsx')).toMatch(/useRunningSubagentCount\(agentId\)/);
    expect(readSource('../components/IDE/IDERunningSubagentsView.tsx')).toMatch(/countSessionTasks\(agentId \? s\.runningSubagentTasks\[agentId\]/);
  });
});

describe('(J) 조용한 사전 압축 뒤 — 막 나간 명령이 "마지막 업데이트 N분 전"으로 시작하지 않는다', () => {
  // 실측(2026-09-28): 끝남을 본 사용자가 다음 지시를 보냈고, 서버는 그 앞에 조용한 /compact 를
  //   끼웠다(73.6s). 명령이 나간 뒤에도 첫 줄까지 81s 가 더 걸렸다. 그 내내 라이브 1줄은 앞 턴 끝부터
  //   재어 무응답(회색)으로 그렸다 — 사용자는 일이 멈춘 줄 알았다.
  const now = 10_000_000;
  const prevTurnEnd = now - 8 * 60_000;
  const events: SubAgentStreamEvent[] = [{
    id: 'e-prev', subAgentId: 'sub-A', parentAgentId: 'agent-1', timestamp: prevTurnEnd,
    eventType: 'text', content: '끝났습니다.',
  }];
  const streams = { 'sub-A': events };
  const session = sub({ status: 'active', lastActivityAt: prevTurnEnd });
  // 압축이 문턱(3분)보다 오래 돈다 — 그 명령의 시작 시각만으로는 이번엔 압축 도중에 무응답이 된다.
  const compacting: QueuedCommand[] = [
    cmd({ id: 'silent-1', status: 'executing', silent: true, text: '/compact', dispatchMode: 'wait', startedAt: now - 4 * 60_000 }),
    cmd({ id: 'user-1', status: 'queued', timestamp: now - 4 * 60_000 - 5_000 }),
  ];
  const userStarted = now - 30_000;
  const running: QueuedCommand[] = [
    cmd({ id: 'silent-1', status: 'completed', silent: true, text: '/compact', dispatchMode: 'wait', startedAt: now - 4 * 60_000 }),
    cmd({ id: 'user-1', status: 'executing', timestamp: now - 4 * 60_000 - 5_000, startedAt: userStarted }),
  ];
  /** 화면이 하는 그대로 — 판정은 원본 큐, 그리기는 표시용 사본. */
  function liveOf(raw: QueuedCommand[], parser?: IncrementalStreamParser) {
    const inputs = buildSessionRunInputs({ sub: session, commands: raw, runningTasks: undefined, acknowledged: false });
    const shown = displayCommands(raw) as QueuedCommand[];
    const activity = sessionLastActivityAt([session], streams, raw, 'sub-A');
    const hidden = sessionHiddenTurnRunning(raw, 'sub-A');
    const busy = isSessionRunning(inputs);
    const waiting = isSessionWaiting(inputs);
    return parser
      ? parser.sync(events, shown, busy, waiting, activity, hidden).thinkingLive
      : buildBaseItems(events, shown, busy, waiting, activity, hidden).thinkingLive;
  }

  /** 그 줄이 지금 무응답으로 그려지는가 — `ThinkingLiveLine` 이 하는 그대로. */
  function stalledAt(live: ReturnType<typeof liveOf>, at: number): boolean {
    return liveLineStalled(live!.mode, sessionSilenceMs(live!.lastActivityAt, at), live!.hiddenTurn === true);
  }

  // §5.5 #17-10 ⑥-6 (2026-09-28 대체) — 종전엔 "모름"이라 경과를 적지 않았다. 경과 없는 줄은 실행 중인
  //   줄과 달라 보여, 사용자는 방금 넣은 지시가 대기에 빠졌다고 읽었다("입력을 하면 압축이 입력 실행처럼").
  it('압축이 도는 동안에도 평소 "작업 중" — 입력한 순간부터 세고, 문턱을 넘겨도 무응답이 아니다', () => {
    expect(sessionHiddenTurnRunning(compacting, 'sub-A')).toBe(true);
    const live = liveOf(compacting);
    expect(live?.mode).toBe('working');
    // 압축이 나간 시각 = 사용자가 명령을 넣은 순간. 앞 턴 끝(8분 전)이 아니다.
    expect(live?.lastActivityAt).toBe(now - 4 * 60_000);
    expect(live?.hiddenTurn).toBe(true);
    // 이 압축은 이미 문턱(3분)보다 오래 돌았다 — 그래도 뒤집지 않는다(그 턴의 줄은 서버가 안 보낸다).
    expect(sessionSilenceMs(live!.lastActivityAt, now)!).toBeGreaterThanOrEqual(SESSION_NO_RESPONSE_MS);
    expect(stalledAt(live, now)).toBe(false);
  });

  it('명령이 나가면 시계는 그 시작부터 잰다 — 앞 턴 끝이 아니다', () => {
    expect(sessionHiddenTurnRunning(running, 'sub-A')).toBe(false);
    const live = liveOf(running);
    expect(live?.lastActivityAt).toBe(userStarted);
    // 감춘 턴이 끝났으니 표식도 없다 — 이제부터는 평소 줄과 같은 규칙으로 무응답이 될 수 있다.
    expect(live?.hiddenTurn).toBeUndefined();
    expect(stalledAt(live, now)).toBe(false);
    expect(stalledAt(live, userStarted + SESSION_NO_RESPONSE_MS)).toBe(true);
    // 바닥을 주지 않으면 종전 그대로 마지막 보인 줄이다 — 사용자가 본 바로 그 줄.
    const stale = buildBaseItems(events, displayCommands(running) as QueuedCommand[], true, false).thinkingLive;
    expect(stale?.lastActivityAt).toBe(prevTurnEnd);
    expect(sessionSilenceMs(stale!.lastActivityAt, now)!).toBeGreaterThanOrEqual(SESSION_NO_RESPONSE_MS);
  });

  it('새 줄이 오면 그 줄이 시계다(늦은 쪽)', () => {
    const fresh: SubAgentStreamEvent = { ...events[0]!, id: 'e-new', timestamp: now - 2_000 };
    const live = buildBaseItems([...events, fresh], displayCommands(running) as QueuedCommand[], true, false, userStarted, false).thinkingLive;
    expect(live?.lastActivityAt).toBe(now - 2_000);
  });

  it('증분 파서도 같은 시계·같은 표식을 낸다(두 파서가 한 규칙)', () => {
    const parser = new IncrementalStreamParser();
    for (const raw of [compacting, running]) {
      const a = liveOf(raw, parser);
      const b = liveOf(raw);
      expect(a?.lastActivityAt).toBe(b?.lastActivityAt);
      expect(a?.hiddenTurn).toBe(b?.hiddenTurn);
    }
  });

  // Sub 탭은 같은 id 의 항목이 "렌더에 쓰는 칸"까지 같으면 옛 객체를 재사용한다. 라이브 줄은 모드만 비교해,
  //   압축이 끝나 명령이 나가도(모드는 그대로 working) 줄이 감춘 턴의 시계·표식에 머물렀다.
  it('identity 안정화가 옛 시계·옛 표식을 붙들지 않는다', () => {
    const during = liveOf(compacting)!;
    const after = liveOf(running)!;
    expect(during.mode).toBe(after.mode);
    expect(sameStreamItem(during, after)).toBe(false);
    expect(sameStreamItem(during, { ...during, lastActivityAt: (during.lastActivityAt ?? 0) + 1 })).toBe(false);
    expect(sameStreamItem(after, { ...after, hiddenTurn: true })).toBe(false);
    expect(sameStreamItem(during, { ...during })).toBe(true);
  });

  it('배선 — 메인 탭·Sub 탭이 같은 함수·같은 사실을 쓴다', () => {
    const main = readSource('../components/IDE/IDEMainArea.tsx');
    expect(main).toMatch(/hiddenTurn: sessionHiddenTurn/);
    expect(main).toMatch(/liveLineActivityAt\(latest\?\.timestamp, sessionLastActivityAt\)/);
    expect(main).toMatch(/\.\.\.\(sessionHiddenTurn \? \{ hiddenTurn: true as const \} : \{\}\)/);
    expect(main).toMatch(/hiddenTurn=\{n\.item\.hiddenTurn === true\}/);
    expect(main).toMatch(/sessionActivityAt=\{sessionLastActivityAt\}/);
    expect(main).toMatch(/sessionActivityHidden=\{sessionHiddenTurn\}/);
    const items = readSource('../components/IDE/streamItems.ts');
    expect(items).toMatch(/liveLineActivityAt\(lastRaw\?\.timestamp, sessionActivityAt\)/);
    expect(items).toMatch(/\.\.\.\(activityHidden \? \{ hiddenTurn: true as const \} : \{\}\)/);
    // 전체 재구축(정답지)·증분 두 경로가 모두 넘긴다 — 한쪽만 넘기면 두 파서가 다른 줄을 낸다.
    expect(items.match(/computeThinkingLive\(events, agentBusy, agentWaiting, sessionActivityAt \?\? null, activityHidden \?\? false, resolveTurnStartedAt\(commands, agentWaiting, turnStartedAt\)\)/g)).toHaveLength(2);
    const renderer = readSource('../components/IDE/StreamRenderer.tsx');
    expect(renderer).toMatch(/hiddenTurn=\{item\.hiddenTurn === true\}/);
    // 감춘 턴은 원본 큐로만 안다 — 표시용 사본은 silent 명령을 이미 지웠다.
    const hook = readSource('../hooks/useSessionRunning.ts');
    expect(hook).toMatch(/sessionHiddenTurnRunning\(commands, activeSessionId\)/);
    expect(hook).toMatch(/const commands = s\.queuedCommands\[agentId\]/);
  });
});

describe('(L) 턴 시계 — 라이브 1줄 경과가 줄마다 0 으로 되감기거나 틱 사이에 사라지지 않는다', () => {
  // 사용자 보고(2026-09-29): IDE 스트림 "작업 중…" 줄의 `0s`·`1s` 가 "정상적인 시간은 표시 못하고 계속 같은
  //   시간이 반복되거나 사라지거나 0만". 시계가 마지막 활동부터 재어 줄이 올 때마다 0 으로 되감겼고,
  //   1초 틱에 멈춘 now 보다 늦은 줄이 오면 차가 음수 → 모름(null) → 다음 틱까지 숫자가 사라졌다.
  const now = 20_000_000;
  const turnStart = now - 65_000;
  const running = [cmd({ id: 'run-1', status: 'executing', timestamp: turnStart - 2_000, startedAt: turnStart })];

  /** 도는 턴 — 턴 시작 1초 뒤부터 `until` 까지 매초 한 줄씩 온다. */
  function linesUntil(until: number): SubAgentStreamEvent[] {
    const out: SubAgentStreamEvent[] = [];
    for (let at = turnStart + 1_000; at <= until; at += 1_000) {
      out.push({ id: `e-${at}`, subAgentId: 'sub-A', parentAgentId: 'agent-1', timestamp: at, eventType: 'text', content: '.' });
    }
    return out;
  }

  type Live = NonNullable<ReturnType<typeof buildBaseItems>['thinkingLive']>;

  /** `ThinkingLiveLine` 이 적는 그대로 — 무응답이면 문구("마지막 업데이트 N 전")에 들어갈 값. */
  function shownAt(live: Live, at: number): { stalled: boolean; text: string | null } {
    const stalled = liveLineStalled(live.mode, sessionSilenceMs(live.lastActivityAt, at), live.hiddenTurn === true);
    const from = liveLineClockFrom(stalled, live.turnStartedAt, live.lastActivityAt, at);
    return { stalled, text: from === null ? null : formatElapsed(from, at) };
  }

  it('줄이 매초 와도 경과는 턴 시작부터 오른다 — 종전 시계(마지막 활동)는 줄마다 0 이었다', () => {
    const shown: (string | null)[] = [];
    const before: string[] = [];
    for (const at of [now - 2_000, now - 1_000, now]) {
      const live = buildBaseItems(linesUntil(at), running, true, false, turnStart, false, turnStart).thinkingLive!;
      shown.push(shownAt(live, at).text);
      before.push(formatElapsed(live.lastActivityAt!, at));
    }
    expect(shown).toEqual(['1m 3s', '1m 4s', '1m 5s']);
    // 사용자가 본 그 줄 — 방금 온 줄부터 재니 매번 0 이다.
    expect(before).toEqual(['0s', '0s', '0s']);
  });

  it('1초 틱 사이에 온 줄이 숫자를 지우지 않는다', () => {
    const tick = now - 400; // 마지막 틱이 찍어 둔 now
    const live = buildBaseItems(linesUntil(now), running, true, false, turnStart, false, turnStart).thinkingLive!;
    // 그 틱 뒤에 온 줄 — 멈춘 now 로 재면 미래라 "모름"이다(종전엔 이것이 곧 표시였다).
    expect(live.lastActivityAt).toBe(now);
    expect(sessionSilenceMs(live.lastActivityAt, tick)).toBeNull();
    expect(shownAt(live, tick)).toEqual({ stalled: false, text: '1m 4s' });
  });

  it('무응답이면 마지막 업데이트부터 — "마지막 업데이트 N 전"이 말하는 그 시각', () => {
    const start = now - 10 * 60_000;
    const lastLine = now - SESSION_NO_RESPONSE_MS - 5_000;
    const lines: SubAgentStreamEvent[] = [{
      id: 'e-last', subAgentId: 'sub-A', parentAgentId: 'agent-1', timestamp: lastLine, eventType: 'text', content: '.',
    }];
    const quiet = [cmd({ id: 'run-2', status: 'executing', startedAt: start })];
    expect(shownAt(buildBaseItems(lines, quiet, true, false, start, false, start).thinkingLive!, now))
      .toEqual({ stalled: true, text: '3m 5s' });
    // 감춘 턴(조용한 사전 압축)은 문턱을 넘겨도 무응답이 아니다 — 평소처럼 턴 시계.
    expect(shownAt(buildBaseItems(lines, quiet, true, false, start, true, start).thinkingLive!, now))
      .toEqual({ stalled: false, text: '10m 0s' });
    // 대기 줄도 무응답이 아니다 — 줄 선 지 얼마나 됐는가.
    const waiting = buildBaseItems(lines, [cmd({ status: 'queued', timestamp: start })], true, true, lastLine, false, start).thinkingLive!;
    expect(waiting.mode).toBe('waiting');
    expect(shownAt(waiting, now)).toEqual({ stalled: false, text: '10m 0s' });
  });

  it('시작을 모르면 평소 시간을 적지 않는다 — 0 으로 적지 않는다', () => {
    const live = buildBaseItems([], [], true, false, null, false, null).thinkingLive!;
    expect(live.turnStartedAt).toBeNull();
    expect(shownAt(live, now)).toEqual({ stalled: false, text: null });
  });

  it('부모가 준 값이 답이다 — 안 줄 때만(Auto Agent 패널) 받은 목록으로 추정한다', () => {
    expect(buildBaseItems([], running, true, false, null, false, now - 5_000).thinkingLive?.turnStartedAt).toBe(now - 5_000);
    // 모름(null)도 답이다 — 추정으로 덮지 않는다.
    expect(buildBaseItems([], running, true, false, null, false, null).thinkingLive?.turnStartedAt).toBeNull();
    // 생존 사실을 내려 주지 않는 자리 — 추정이 없으면 그 줄은 평소 시간을 통째로 잃는다.
    expect(buildBaseItems([], running).thinkingLive?.turnStartedAt).toBe(turnStart);
    expect(buildBaseItems([], [cmd({ status: 'queued', timestamp: turnStart })]).thinkingLive)
      .toMatchObject({ mode: 'waiting', turnStartedAt: turnStart });
    // 표시 사본에서도 같은 답 — 물려받은 명령이 조용한 압축이 나간 시각을 달고 실행 중으로 선다.
    const compacting = [
      cmd({ id: 'silent-1', status: 'executing', silent: true, text: '/compact', dispatchMode: 'wait', startedAt: turnStart }),
      cmd({ id: 'user-1', status: 'queued', timestamp: turnStart - 2_000 }),
    ];
    expect(sessionTurnStartedAt(compacting, [], 'sub-A', false)).toBe(turnStart);
    expect(buildBaseItems([], displayCommands(compacting) as QueuedCommand[]).thinkingLive?.turnStartedAt).toBe(turnStart);
  });

  it('증분 파서도 같은 턴 시계를 낸다(두 파서가 한 규칙)', () => {
    const parser = new IncrementalStreamParser();
    for (const at of [now - 2_000, now - 1_000, now]) {
      const lines = linesUntil(at);
      expect(parser.sync(lines, running, true, false, at, false, turnStart).thinkingLive)
        .toEqual(buildBaseItems(lines, running, true, false, at, false, turnStart).thinkingLive);
    }
    // 추정 경로(부모가 값을 안 줌)도 둘이 같다.
    expect(parser.sync(linesUntil(now), running).thinkingLive?.turnStartedAt).toBe(turnStart);
  });

  // Sub 탭은 같은 id 의 항목이 렌더에 쓰는 칸까지 같으면 옛 객체를 재사용한다. 턴 시계를 비교에서 빼면
  //   다음 명령이 나가도(모드는 그대로 working) 줄이 앞 턴의 시작부터 계속 잰다.
  it('identity 안정화가 옛 턴 시계를 붙들지 않는다', () => {
    const first = buildBaseItems([], running, true, false, turnStart, false, turnStart).thinkingLive!;
    const next = buildBaseItems([], running, true, false, turnStart, false, now - 1_000).thinkingLive!;
    expect(first.mode).toBe(next.mode);
    expect(sameStreamItem(first, next)).toBe(false);
    expect(sameStreamItem(first, { ...first })).toBe(true);
  });

  it('배선 — 메인 탭·Sub 탭이 같은 사실·같은 함수로 재고, 틱은 그리는 순간의 시계를 준다', () => {
    const line = readSource('../components/IDE/ThinkingIndicator.tsx');
    // 어느 시각부터 잴지는 한 함수 — 줄이 제 손으로 마지막 활동부터 재지 않는다.
    expect(line).toMatch(/liveLineClockFrom\(stalled, turnStartedAt, lastActivityAt, now\)/);
    expect(line).not.toMatch(/formatElapsed\(lastActivityAt/);
    expect(line).toMatch(/useNowTick\(lastActivityAt !== null \|\| turnStartedAt !== null\)/);
    const main = readSource('../components/IDE/IDEMainArea.tsx');
    expect(main).toMatch(/turnStartedAt: sessionTurnStartedAt,\s*\}\s*=\s*useSessionLivenessFacts\(agentId, activeSessionId\)/);
    // 구조분해 한 번 + 메인 탭 라이브 항목 한 번.
    expect(main.match(/turnStartedAt: sessionTurnStartedAt,/g)).toHaveLength(2);
    expect(main).toMatch(/turnStartedAt=\{n\.item\.turnStartedAt\}/);
    expect(main).toMatch(/sessionTurnStartedAt=\{sessionTurnStartedAt\}/);
    expect(readSource('../components/IDE/StreamRenderer.tsx')).toMatch(/turnStartedAt=\{item\.turnStartedAt\}/);
    // 원본 큐 + 보관분 + 세션 필터 + 백단 자식 — 표시 사본으로 재면 감춘 압축이 안 보인다.
    const hook = readSource('../hooks/useSessionRunning.ts');
    expect(hook).toMatch(
      /sessionTurnStartedAt\(\s*commands, s\.completedCommands\?\.\[agentId\] \?\? \[\], activeSessionId, waiting, s\.runningSubagentTasks\[agentId\] \?\? \[\],?\s*\)/,
    );
    // 틱은 다시 그리는 계기일 뿐 — 멈춘 틱 값으로 새 줄을 재면 음수라 숫자가 사라진다.
    expect(readSource('../hooks/useNowTick.ts')).toMatch(/return active \? Math\.max\(now, Date\.now\(\)\) : now;/);
  });
});

describe('(E) 조용한 압축을 물려받은 명령은 실행 중인 명령과 구별되지 않는다', () => {
  // §5.5 #17-10 ⑥-5 (2026-09-28 대체) — 종전엔 손잡이만 원본 큐(`queued`)를 따라, "실행 중…" 배지 아래에
  //   [대기|합치기|즉시] 칩·"지금 턴이 끝난 뒤 보냅니다"·삭제(×)가 함께 붙었다. 사용자는 방금 넣은
  //   지시가 대기에 빠졌다가 압축 뒤에야 도는 것으로 읽었다.
  const raw: QueuedCommand[] = [
    cmd({ id: 'silent-1', status: 'executing', silent: true, text: '/compact', dispatchMode: 'wait', startedAt: 5_000 }),
    cmd({ id: 'mine', status: 'queued' }),
    cmd({ id: 'later', status: 'queued' }),
  ];

  it('물려받은 명령은 표시 사본에서 executing — 손잡이가 붙을 근거(queued)가 없다', () => {
    const shown = displayCommands(raw);
    expect(shown.map((c) => [c.id, c.status])).toEqual([['mine', 'executing'], ['later', 'queued']]);
    // 뒤에 선 두 번째 명령은 진짜 대기다 — 그 손잡이는 종전대로 산다(#17-18 ⑤).
  });

  it('배선 — 손잡이는 배지와 같은 사실(표시 사본의 status)을 따른다', () => {
    const src = readSource('../components/IDE/CollapsiblePrompt.tsx');
    expect(src).toMatch(/const controlAgentId = command\?\.status === 'queued' \? command\.agentId : undefined/);
    expect(src).toMatch(/const controlCommandId = command\?\.status === 'queued' \? command\.commandId : undefined/);
    // 원본 큐를 따로 읽어 손잡이를 되살리는 길이 없다.
    expect(src).not.toMatch(/s\.queuedCommands\[/);
    expect(src).not.toMatch(/effectiveStatus/);
    expect(src).not.toMatch(/queuedBehindSilent/);
  });

  it('"아직 안 나갔다" 툴팁 문구는 로케일에서도 걷혔다', () => {
    expect(lookupText(en, 'ide.mainArea.queuedBehindSilent')).toBe('');
    expect(lookupText(ko, 'ide.mainArea.queuedBehindSilent')).toBe('');
  });
});

describe('(H) 서버가 말한 중단 사유가 화면에 닿는다', () => {
  it('새 사유(disconnected)에도 라벨이 있다', () => {
    expect(turnStopLabelKey('disconnected', 'completed')).toBe('ide.turnStop.disconnected');
    expect(turnStopLabelKey('cancelled', 'completed')).toBe('ide.turnStop.cancelled');
  });

  it('정상 종료와 진행 중에는 아무 말도 하지 않는다', () => {
    expect(turnStopLabelKey('end_turn', 'completed')).toBeNull();
    expect(turnStopLabelKey(undefined, 'completed')).toBeNull();
    expect(turnStopLabelKey('disconnected', 'executing')).toBeNull();
  });

  it('앞으로 늘어날 사유도 말없이 사라지지 않는다', () => {
    // 서버가 사유를 하나 더 늘려도 화면은 "중단됨"이라도 적는다 — 종전처럼 조용히 빠지면
    //   사용자는 또 "끝난 것인지 끊긴 것인지" 알 수 없게 된다.
    expect(turnStopLabelKey('some_future_reason' as never, 'completed')).toBe('ide.turnStop.interrupted');
  });
});

/** 점으로 이어진 키를 로케일 묶음에서 꺼낸다 — 없으면 빈 문자열. */
function lookupText(bundle: unknown, key: string): string {
  const v = key.split('.').reduce<unknown>((acc, part) => (
    acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)
      ? (acc as Record<string, unknown>)[part]
      : undefined
  ), bundle);
  return typeof v === 'string' ? v : '';
}

describe('새 문자열은 en·ko 양쪽에 있다', () => {
  const KEYS = [
    'ide.mainArea.stallHint',
    'ide.mainArea.stopNothing',
    'ide.mainArea.stopNothingHint',
    'ide.mainArea.stopForce',
    'ide.mainArea.stopForceTitle',
    'ide.mainArea.stopFailed',
    'ide.mainArea.stopRetry',
    'ide.statusBar.elapsedTip',
    'ide.turnStop.disconnected',
    'ide.turnStop.interrupted',
    // (I) 대기 — 도트 라벨과 라이브 1줄. 둘 다 "완료"·"작업 중"과 **다른 낱말**이어야 한다.
    'panel.subAgent.status.waiting',
    'ide.streamRenderer.waiting',
  ];

  for (const [name, bundle] of [['en', en], ['ko', ko]] as const) {
    it(name + ' 에 빠진 키가 없다', () => {
      for (const key of KEYS) {
        expect(lookupText(bundle, key).trim().length, name + ' 에 ' + key + ' 가 없다').toBeGreaterThan(0);
      }
    });
  }

  it('자리표시자가 양쪽에서 같다', () => {
    expect(lookupText(en, 'ide.runningSubagents.noResponse')).toContain('{{value}}');
    expect(lookupText(ko, 'ide.runningSubagents.noResponse')).toContain('{{value}}');
    expect(lookupText(en, 'ide.mainArea.stopFailed')).toContain('{{status}}');
    expect(lookupText(ko, 'ide.mainArea.stopFailed')).toContain('{{status}}');
  });
});

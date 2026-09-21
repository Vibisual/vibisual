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
  isSessionWaiting,
  resolveSessionLiveness,
  sessionSilenceMs,
  type QueuedCommand,
  type SubAgent,
} from '@vibisual/shared';
import { buildSessionRunInputs, sessionRunStateOf } from './sessionStatus.js';
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
  const sources = { sub: sub({ status: 'idle' }), runningTasks: undefined, acknowledged: false };

  it('사본은 원본과 다른 목록이다 — 감추고, 승격한다', () => {
    expect(shown).toHaveLength(1);
    expect(shown[0]!.id).toBe('user-1');
    // 아직 나가지도 않은 명령이 화면에서는 실행 중으로 그려진다(표시 전용 승격).
    expect(shown[0]!.status).toBe('executing');
  });

  it('사본으로 판정하면 답이 갈린다 — 두 방향 모두', () => {
    const fromRaw = buildSessionRunInputs({ ...sources, commands: raw });
    const fromShown = buildSessionRunInputs({ ...sources, commands: shown });

    // 원본은 "줄 서 있는 명령이 있다"를 안다 — 사본은 그 사실을 승격으로 지운다.
    //   이 한 칸 때문에 대기 명령의 취소 손잡이가 화면에서 사라졌다.
    expect(fromRaw.hasQueuedCommand).toBe(true);
    expect(fromShown.hasQueuedCommand).toBe(false);

    // 조용한 압축만 도는 순간 — 원본은 돌고 있다고, 사본은 아무것도 없다고 말한다.
    const onlySilent = [raw[0]!];
    const silentRaw = buildSessionRunInputs({ ...sources, commands: onlySilent });
    const silentShown = buildSessionRunInputs({
      ...sources, commands: displayCommands(onlySilent) as QueuedCommand[],
    });
    expect(isSessionRunning(silentRaw)).toBe(true);
    expect(isSessionRunning(silentShown)).toBe(false);
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
    expect(renderer).toMatch(/sync\(events, commands, sessionBusy\)/);
    const items = readSource('../components/IDE/streamItems.ts');
    expect(items).toMatch(/agentBusyOverride/);
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

  it('세 자리가 모두 셋째 인자를 넘긴다', () => {
    for (const path of [
      '../components/IDE/IDEStatusBar.tsx',
      '../components/IDE/IDETabBar.tsx',
      '../components/IDE/IDESplitCell.tsx',
    ]) {
      const src = readSource(path);
      const calls = src.match(/sessionRunStateOf\([^)]*\)/g) ?? [];
      expect(calls.length, path + ' 에 sessionRunStateOf 호출이 없다').toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.split(',').length, path + ': 인자가 모자란 호출 — ' + call).toBeGreaterThanOrEqual(3);
      }
      // 재료는 같은 방식으로 집는다(참조 안정 문자열 → 집합).
      expect(src).toMatch(/serializeBusySubIds/);
      expect(src).toMatch(/parseBusySubIds/);
    }
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
  it('useSessionStop 은 finally 에서 풀고 타이머로 풀지 않는다', () => {
    const src = readSource('../hooks/useSessionStop.ts');
    expect(src).toMatch(/finally\s*\{[\s\S]*?setStopping\(false\)/);
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

describe('(G) 배선 — 무응답 문턱은 한 값, 화면 셋이 모두 시간을 말한다', () => {
  it('카드가 자기 숫자를 들고 있지 않다', () => {
    const src = readSource('../components/IDE/IDERunningSubagentsCards.tsx');
    expect(src).toMatch(/NO_RESPONSE_HINT_MS\s*=\s*SESSION_NO_RESPONSE_MS/);
    expect(src).not.toMatch(/NO_RESPONSE_HINT_MS\s*=\s*\d/);
  });

  it('스트림 "작업 중..." 줄이 마지막 활동 시각을 받는다', () => {
    const src = readSource('../components/IDE/ThinkingIndicator.tsx');
    expect(src).toMatch(/lastActivityAt/);
    expect(src).toMatch(/SESSION_NO_RESPONSE_MS/);
    expect(src).toMatch(/ide\.runningSubagents\.noResponse/);
  });

  it('상태바가 경과 시간을 적고, 넘으면 무응답으로 바꾼다', () => {
    const src = readSource('../components/IDE/IDEStatusBar.tsx');
    expect(src).toMatch(/statusStalled/);
    expect(src).toMatch(/ide\.runningSubagents\.noResponse/);
    expect(src).toMatch(/ide\.statusBar\.elapsedTip/);
  });

  it('입력창이 빠져나갈 길을 연다 — 더 기다리기 / 중지', () => {
    const src = readSource('../components/IDE/IDEMainArea.tsx');
    expect(src).toMatch(/ide\.mainArea\.stallNotice/);
    expect(src).toMatch(/ide\.mainArea\.stallKeepWaiting/);
    expect(src).toMatch(/setStallSnoozeMs/);
  });
});

describe('(E) 조용한 압축 뒤에 선 명령에도 취소 손잡이가 남는다', () => {
  it('표시 승격과 무관하게 원본 큐의 상태로 조작 가능 여부를 정한다', () => {
    const src = readSource('../components/IDE/CollapsiblePrompt.tsx');
    // 원본 큐 직접 조회 — displayCommands 가 승격해 준 사본이 아니라.
    expect(src).toMatch(/s\.queuedCommands\[queueAgentId\]/);
    expect(src).toMatch(/effectiveStatus/);
    expect(src).toMatch(/ide\.mainArea\.queuedBehindSilent/);
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
    'ide.mainArea.stallNotice',
    'ide.mainArea.stallKeepWaiting',
    'ide.mainArea.stallKeepWaitingTitle',
    'ide.mainArea.stopNothing',
    'ide.mainArea.stopNothingHint',
    'ide.mainArea.stopForce',
    'ide.mainArea.stopForceTitle',
    'ide.mainArea.stopFailed',
    'ide.mainArea.stopRetry',
    'ide.mainArea.queuedBehindSilent',
    'ide.statusBar.elapsedTip',
    'ide.turnStop.disconnected',
    'ide.turnStop.interrupted',
  ];

  for (const [name, bundle] of [['en', en], ['ko', ko]] as const) {
    it(name + ' 에 빠진 키가 없다', () => {
      for (const key of KEYS) {
        expect(lookupText(bundle, key).trim().length, name + ' 에 ' + key + ' 가 없다').toBeGreaterThan(0);
      }
    });
  }

  it('자리표시자가 양쪽에서 같다', () => {
    expect(lookupText(en, 'ide.mainArea.stallNotice')).toContain('{{value}}');
    expect(lookupText(ko, 'ide.mainArea.stallNotice')).toContain('{{value}}');
    expect(lookupText(en, 'ide.mainArea.stopFailed')).toContain('{{status}}');
    expect(lookupText(ko, 'ide.mainArea.stopFailed')).toContain('{{status}}');
  });
});

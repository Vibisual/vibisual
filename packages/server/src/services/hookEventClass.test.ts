/**
 * §3.6 — 훅 이벤트 **생명주기 분류** 테스트.
 *
 * 이 판정이 틀리는 방향은 한쪽으로 치우쳐 있다: 분기에 안 걸린 이벤트는 전부 활동으로 떨어지므로,
 * **끝났다는 신호를 등록하면 그 세션이 오히려 영영 도는 것처럼 보인다**(`StopFailure` 가 겪은 함정).
 * 이벤트를 33종으로 늘리면서 그 자리가 셋(`SessionEnd`·`TeammateIdle`·`MessageDisplay`) 늘었다.
 *
 * 이름을 문자열로 비교하므로 **오타는 조용히 통과한다**(그 이벤트는 영원히 아무 분기에도 안 걸린다).
 * 그래서 마지막 묶음에서 모든 판정 대상 이름이 `HOOK_EVENTS` 안에 실재하는지 함께 본다.
 */
import { describe, it, expect } from 'vitest';
import {
  QUIESCENT_HOOK_EVENTS,
  isSessionEndEvent,
  isTurnEndEventName,
  marksActivity,
  raisesAwaitingInput,
  clearsAwaitingInput,
  needsSnapshotRefresh,
  isTaskLedgerEvent,
} from './hookEventClass.js';
import { HOOK_EVENTS } from './hookInstaller.js';

/** 판정 함수가 true 를 주는 이벤트만 추린다 — 전수 대조용. */
function trueSet(pred: (name: string) => boolean): string[] {
  return HOOK_EVENTS.filter((e) => pred(e)).slice().sort();
}

// ─────────────────────────────────────────────────────────────
describe('종료류 판정', () => {
  it('턴 종료는 정상·API 오류 둘 다', () => {
    expect(isTurnEndEventName('Stop')).toBe(true);
    expect(isTurnEndEventName('StopFailure')).toBe(true);
    expect(isTurnEndEventName('SubagentStop')).toBe(false);
    expect(isTurnEndEventName('SessionEnd')).toBe(false);
  });

  it('세션 종료는 턴 종료와 별개다', () => {
    expect(isSessionEndEvent('SessionEnd')).toBe(true);
    expect(isSessionEndEvent('Stop')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('활동 판정', () => {
  it('종료류는 활동이 아니다', () => {
    for (const ev of ['Stop', 'StopFailure', 'SessionEnd']) {
      expect(marksActivity(ev), ev).toBe(false);
    }
  });

  it('멈추려는 신호를 활동으로 세지 않는다', () => {
    for (const ev of ['SubagentStop', 'TeammateIdle', 'MessageDisplay']) {
      expect(marksActivity(ev), ev).toBe(false);
    }
  });

  it('실제로 일이 일어나는 이벤트는 활동이다', () => {
    for (const ev of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'SubagentStart', 'FileChanged']) {
      expect(marksActivity(ev), ev).toBe(true);
    }
  });

  it('모르는 이벤트는 활동으로 본다(CLI 가 이벤트를 늘려도 앱이 안 깨진다)', () => {
    expect(marksActivity('SomeFutureEventFromClaudeCode')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe('사용자 입력 대기 표시', () => {
  it('MCP 되묻기도 승인 대기와 같은 상태로 본다', () => {
    expect(trueSet(raisesAwaitingInput)).toEqual(['Elicitation', 'PermissionRequest']);
  });

  it('답이 왔거나 압축이 끝나면 표시를 내린다', () => {
    expect(trueSet(clearsAwaitingInput)).toEqual(['ElicitationResult', 'PermissionDenied', 'PostCompact']);
  });

  it('올리는 이벤트와 내리는 이벤트가 겹치지 않는다', () => {
    for (const ev of HOOK_EVENTS) {
      expect(raisesAwaitingInput(ev) && clearsAwaitingInput(ev), ev).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────
describe('스냅샷 갱신 대상', () => {
  it('버블에 적힌 내용이 달라지는 사건만 화면을 다시 민다', () => {
    expect(trueSet(needsSnapshotRefresh)).toEqual([
      'ConfigChange', 'CwdChanged', 'DirectoryAdded', 'PostModelSwitch',
      'PreModelSwitch', 'SessionEnd', 'WorktreeCreate', 'WorktreeRemove',
    ]);
  });

  it('FileChanged 는 일부러 뺀다(빈도가 가장 높고 IDE 감시자가 이미 맡는다)', () => {
    expect(needsSnapshotRefresh('FileChanged')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('작업 장부 이벤트', () => {
  it('TaskCreated / TaskCompleted 만', () => {
    expect(trueSet(isTaskLedgerEvent)).toEqual(['TaskCompleted', 'TaskCreated']);
  });
});

// ─────────────────────────────────────────────────────────────
describe('이름 실재 확인(오타는 조용히 통과한다)', () => {
  it('조용한 이벤트 목록이 전부 실제 등록 이벤트다', () => {
    for (const ev of QUIESCENT_HOOK_EVENTS) {
      expect(HOOK_EVENTS as readonly string[], ev).toContain(ev);
    }
  });

  it('각 판정이 잡는 이벤트가 하나 이상 실재한다', () => {
    const preds: Array<[string, (n: string) => boolean]> = [
      ['raisesAwaitingInput', raisesAwaitingInput],
      ['clearsAwaitingInput', clearsAwaitingInput],
      ['needsSnapshotRefresh', needsSnapshotRefresh],
      ['isTaskLedgerEvent', isTaskLedgerEvent],
      ['isTurnEndEventName', isTurnEndEventName],
      ['isSessionEndEvent', isSessionEndEvent],
    ];
    for (const [name, pred] of preds) {
      expect(trueSet(pred).length, name).toBeGreaterThan(0);
    }
  });
});

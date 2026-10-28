/**
 * §3.6 — `/api/hook-event` 이벤트를 턴 종료(`markStop`)·활동(`markActive`)·없음으로 가른다. 분기에 안 걸리면 `markActive` 라 끝 신호를 빠뜨리면 세션이 영영 돈다(`StopFailure`·`SessionEnd`·`TeammateIdle`).
 * 새 이벤트는 `HOOK_EVENTS` 와 이 파일을 같이 본다(짝 검사 `hookEventExpansion.test.ts`).
 */

/** 활동이 아닌 이벤트(`markActive` ❌): `SubagentStop`(자식의 끝) · `TeammateIdle`(곧 유휴 — 세면 5분 유휴 스윕이 밀린다) · `MessageDisplay`(빈도가 매우 높은 표시 — 세면 할 일 없는 세션이 깨어 있다). */
export const QUIESCENT_HOOK_EVENTS: ReadonlySet<string> = new Set([
  'SubagentStop',
  'TeammateIdle',
  'MessageDisplay',
]);

/**
 * **세션 자체가 끝났다는 신고.** 턴 종료(`Stop`/`StopFailure`)와 달리 서브에이전트 마커와
 * 무관하게 언제나 부모의 끝이다.
 */
export function isSessionEndEvent(eventName: string): boolean {
  return eventName === 'SessionEnd';
}

/** 턴이 끝났다는 신고(정상·API 오류). */
export function isTurnEndEventName(eventName: string): boolean {
  return eventName === 'Stop' || eventName === 'StopFailure';
}

/** 종료류(턴·세션)와 `QUIESCENT_HOOK_EVENTS` 만 빼고 전부 활동이다 — CLI 가 이벤트를 늘려도 깨지지 않게(§3.6 "알 수 없는 이벤트"). */
export function marksActivity(eventName: string): boolean {
  if (isTurnEndEventName(eventName)) return false;
  if (isSessionEndEvent(eventName)) return false;
  return !QUIESCENT_HOOK_EVENTS.has(eventName);
}

/** 사용자 입력 대기 이벤트. MCP 가 도구 도중 되묻는 `Elicitation` 도 같은 상태라 같은 표시를 쓴다. */
export function raisesAwaitingInput(eventName: string): boolean {
  return eventName === 'PermissionRequest' || eventName === 'Elicitation';
}

/**
 * 위 대기 표시를 **내리는** 이벤트. 답이 왔거나 거부로 끝났거나, 압축이 끝났거나.
 * 상태 자체는 `markActive` 가 이미 되돌리므로 여기서는 화면을 다시 밀어 주기만 하면 된다.
 */
export function clearsAwaitingInput(eventName: string): boolean {
  return eventName === 'PermissionDenied'
    || eventName === 'ElicitationResult'
    || eventName === 'PostCompact';
}

/**
 * §5.5 #17-24 ⑥ — 압축 끝(`SubAgent.compactingSince` 를 걷는다). `PostCompact` 가 안 오는 압축이 있어(§5.26 (D)) `SessionStart`(compact)·새 프롬프트·턴 끝·세션 끝도 끝이다.
 * 도구 이벤트는 넣지 않는다 — 배경 서브에이전트가 압축 도중에도 낸다.
 */
export function endsCompaction(eventName: string): boolean {
  return eventName === 'PostCompact'
    || eventName === 'SessionStart'
    || eventName === 'UserPromptSubmit'
    || isTurnEndEventName(eventName)
    || isSessionEndEvent(eventName);
}

/** 버블 내용이 바뀌는 이벤트(모델·워크트리·설정·cwd)라 스냅샷을 다시 민다(방송은 디바운스, §9). `FileChanged` 는 뺀다 — 빈도가 가장 높고 IDE 감시자가 맡는다. */
export function needsSnapshotRefresh(eventName: string): boolean {
  return eventName === 'PreModelSwitch'
    || eventName === 'PostModelSwitch'
    || eventName === 'WorktreeCreate'
    || eventName === 'WorktreeRemove'
    || eventName === 'ConfigChange'
    || eventName === 'CwdChanged'
    || eventName === 'DirectoryAdded'
    || eventName === 'SessionEnd';
}

/** 작업(Task) 장부 이벤트 — 세션 목표 단계로 흘려보낸다. */
export function isTaskLedgerEvent(eventName: string): boolean {
  return eventName === 'TaskCreated' || eventName === 'TaskCompleted';
}

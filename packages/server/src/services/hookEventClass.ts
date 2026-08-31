/**
 * §3.6 (판올림 번호 발급 대기) — **훅 이벤트의 생명주기 분류.**
 *
 * `/api/hook-event` 는 들어온 이벤트를 셋 중 하나로 떨어뜨린다: 자기 턴 종료(`markStop`) ·
 * 활동(`markActive`) · 아무것도 아님. 그런데 이 판정이 라우트 함수 안에 부등호로 흩어져 있어,
 * **새 이벤트를 등록할 때마다 "이건 활동인가"를 다시 생각하지 않으면 조용히 틀린다.**
 *
 * 틀리는 방향이 한쪽으로 치우쳐 있어 더 위험하다 — 분기에 안 걸린 이벤트는 전부 `markActive` 라,
 * **끝났다는 신호를 등록하면 그 세션이 오히려 영영 도는 것처럼 보인다**(`StopFailure` 가 그
 * 사례였고, `SessionEnd`·`TeammateIdle` 이 같은 자리다).
 *
 * 그래서 판정만 여기로 꺼내 단위 테스트로 고정한다. 새 이벤트를 등록할 때는 `HOOK_EVENTS` 와
 * 이 파일을 **같이** 본다 — 짝 검사가 `hookEventExpansion.test.ts` 에 있다.
 */

/**
 * **활동 신호가 아닌 이벤트.** `markActive` 로 떨어뜨리면 안 된다.
 *
 * - `SubagentStop`  — 자식이 끝난 것이지 부모가 일한 것이 아니다(종전부터 제외돼 있었다).
 * - `TeammateIdle`  — 동료가 **곧 유휴로 들어간다**는 신고다. 활동으로 세면 멈추려는 세션을
 *                     도는 것으로 되돌려, 5분 유휴 스윕도 계속 미뤄진다.
 * - `MessageDisplay`— 화면에 글자가 뿌려지는 중이라는 표시일 뿐이고 **빈도가 매우 높다**.
 *                     활동으로 세면 그 자체로는 아무 일도 안 하는 세션이 계속 깨어 있게 된다
 *                     (턴이 실제로 도는 동안에는 도구·Stop 이벤트가 이미 활동을 갱신한다).
 */
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

/**
 * 이 이벤트를 받았을 때 세션을 "도는 중"으로 갱신해야 하는가.
 *
 * 종료류(턴·세션)와 위 `QUIESCENT_HOOK_EVENTS` 만 빠지고 나머지는 전부 활동이다 —
 * CLI 가 이벤트를 더 늘려도 앱이 깨지지 않게 하려는 기존 규율(§3.6 "알 수 없는 이벤트")을 그대로 둔다.
 */
export function marksActivity(eventName: string): boolean {
  if (isTurnEndEventName(eventName)) return false;
  if (isSessionEndEvent(eventName)) return false;
  return !QUIESCENT_HOOK_EVENTS.has(eventName);
}

/**
 * **사용자 입력을 기다리는 중**임을 알리는 이벤트.
 *
 * 종전에는 `Notification`(subtype=awaiting_permission)과 `PermissionRequest` 둘뿐이었는데,
 * MCP 서버가 도구 실행 도중 되묻는 `Elicitation` 도 사용자가 답하기 전까지 세션이 멈춰 있는
 * 같은 상태다. 같은 표시(버블 알림 상태)를 쓴다 — 새 상태를 발명하지 않는다.
 */
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
 * 화면 스냅샷을 다시 밀어야 하는 "상태가 바뀐" 이벤트.
 *
 * 모델 전환·워크트리 생성/제거·설정 변경·작업 디렉터리 변경은 전부 **버블에 적힌 내용이 달라지는**
 * 사건인데, 종전에는 어느 것도 등록돼 있지 않아 화면이 다음 도구 호출까지 옛 값을 보여 줬다.
 * 스냅샷 방송은 이미 디바운스+적응 backoff 를 타므로(§9 v3.45) 여기서 부담이 늘지 않는다.
 *
 * ⚠ `FileChanged` 는 **넣지 않는다** — 디스크 감시라 빈도가 이 목록에서 가장 높고, 그 갱신은
 *   IDE 탐색기 자신의 감시자가 이미 맡는다. 스냅샷을 밀어 얻을 것이 없다.
 */
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

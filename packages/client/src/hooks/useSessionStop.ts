import { useCallback, useState } from 'react';

/**
 * useSessionStop — §5.5 #17-10 중지 동작(세션 스코프)의 단일 창구.
 *
 * §5.5 #17-12 로 하단 상태바("지금 무엇을 하는 중" 줄)에도 [중지]가 생기면서 두 곳을 훅 하나로 묶었고,
 * v4.64 에서 그 상태바 버튼을 없애 지금 호출자는 입력창(TerminalInput) 하나다 — 중지 경로는 계속 여기 한 곳.
 *
 * 범위 규칙은 #17-10 그대로: 세션 탭이면 그 세션만(`stop-session`), 스코프를 좁힐 세션이 없는 메인 탭에서만
 * 에이전트 전체(`stop-all`). 실행 중인 게 없어도 서버가 200(멱등)이라 에러 분기가 없다.
 */
/**
 * 중지 요청 경로 — **중지를 내는 모든 자리가 이 함수를 쓴다.**
 *
 * 커맨드센터(§5.12)가 한때 세션 중지에 `/:subId/stop` 을 직접 불렀는데, 그 라우트는 자식 프로세스만
 * 죽이고 **큐에 남은 명령을 비우지 않아** 다음 명령이 곧바로 다시 나갔다(§5.5 #17-10 이 IDE 에서
 * 고친 "눌러도 안 멈춘다"가 그 창에만 남아 있었다). 게다가 broadcast 도 없고 실행 중이 아니면 409 라,
 * 눌러도 화면이 그대로였다. 경로를 여기 한 곳으로 모아 같은 [중지]가 어디서든 같은 일을 하게 한다.
 */
export function sessionStopUrl(agentId: string, subAgentId: string | null): string {
  return subAgentId
    ? `/api/subagents/${agentId}/${subAgentId}/stop-session`
    : `/api/subagents/${agentId}/stop-all`;
}

export function useSessionStop(agentId: string, activeSessionId: string | null): { stopping: boolean; stop: () => void } {
  const [stopping, setStopping] = useState(false);

  const stop = useCallback(() => {
    if (stopping) return;
    setStopping(true);
    void fetch(sessionStopUrl(agentId, activeSessionId), { method: 'POST' })
      .catch(() => { /* no-op — 실패해도 다음 close 이벤트에서 UI 복구 */ });
    // 서버 close 핸들러가 status 를 갱신하면 스냅샷 브로드캐스트로 버튼이 Run 으로 돌아온다.
    // 안전장치로 짧은 타임아웃 후 로컬 stopping 해제.
    setTimeout(() => setStopping(false), 1500);
  }, [agentId, activeSessionId, stopping]);

  return { stopping, stop };
}

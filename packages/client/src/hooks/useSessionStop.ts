import { useCallback, useState } from 'react';

/**
 * useSessionStop — §5.5 #17-10 중지 동작(세션 스코프)의 단일 창구.
 *
 * 종전엔 이 로직이 TerminalInput 안에만 있었는데, §5.5 #17-12 로 하단 상태바("지금 무엇을 하는 중" 줄)에도
 * [중지]가 생기면서 두 곳이 같은 동작을 해야 한다 — 복붙 대신 훅 하나로 묶는다(중지 범위·경로 불일치 방지).
 *
 * 범위 규칙은 #17-10 그대로: 세션 탭이면 그 세션만(`stop-session`), 스코프를 좁힐 세션이 없는 메인 탭에서만
 * 에이전트 전체(`stop-all`). 실행 중인 게 없어도 서버가 200(멱등)이라 에러 분기가 없다.
 */
export function useSessionStop(agentId: string, activeSessionId: string | null): { stopping: boolean; stop: () => void } {
  const [stopping, setStopping] = useState(false);

  const stop = useCallback(() => {
    if (stopping) return;
    setStopping(true);
    const url = activeSessionId
      ? `/api/subagents/${agentId}/${activeSessionId}/stop-session`
      : `/api/subagents/${agentId}/stop-all`;
    void fetch(url, { method: 'POST' }).catch(() => { /* no-op — 실패해도 다음 close 이벤트에서 UI 복구 */ });
    // 서버 close 핸들러가 status 를 갱신하면 스냅샷 브로드캐스트로 버튼이 Run 으로 돌아온다.
    // 안전장치로 짧은 타임아웃 후 로컬 stopping 해제.
    setTimeout(() => setStopping(false), 1500);
  }, [agentId, activeSessionId, stopping]);

  return { stopping, stop };
}

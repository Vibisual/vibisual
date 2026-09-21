/**
 * 경과 시간 표기 한 벌 — **시간을 말하는 자리가 전부 이 두 함수를 쓴다.**
 *
 * 종전에는 `IDERunningSubagentsCards` 안에 살았다. 그 파일은 컴포넌트라 순수 함수를 꺼내 쓰려면
 * 카드 트리 전체를 끌고 와야 했고, DOM 없는 단위 시험에서도 그랬다. §2.4 무응답 표시가 스트림
 * 인디케이터에도 붙으면서 두 번째 소비자가 생겨 여기로 옮긴다(모양은 한 글자도 바꾸지 않는다).
 */

/** 경과 시간 — 초/분/시간 단위로 짧게. 1초마다 갱신되는 now 를 받아 순수 계산으로 유지. */
export function formatElapsed(startedAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** 시작 시각 `HH:MM` — 얼마나 오래 붙잡고 있는지를 경과와 함께 읽게. */
export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

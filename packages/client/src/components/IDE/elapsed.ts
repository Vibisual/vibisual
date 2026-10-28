/** 경과 시간 표기 한 벌 — 시간을 말하는 자리가 전부 이 두 함수를 쓴다(컴포넌트 파일에 두면 순수 함수에 카드 트리가 딸려 온다). */

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

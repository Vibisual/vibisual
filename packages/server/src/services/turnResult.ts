/**
 * §5.5 #17-12 ③-4 — 끝난 턴의 결과(순수 모듈, `turnPrompt` 의 짝). `/compact`·`/clear` 턴은 제 답이 없다
 * (실측 2026-09-08: 스트림 두 줄 · 토큰 0 · assistant 0) — "마지막 user 이후 assistant" 폴백이 앞 턴 답을 건네 같은 말이 두 번 보였다(27건 전부).
 * 산 경로(마감)와 옛 저장분(복원)이 여기 한 판정을 쓴다.
 */

import { AGENT_COMPACT_COMMAND, SESSION_LOOP_CLEAR_COMMAND } from '@vibisual/shared';
import type { QueuedCommand } from '@vibisual/shared';

/**
 * **제 답이 없는 턴**의 명령인가 — CLI 가 대화록을 접거나(`/compact`) 비우기만(`/clear`) 한다.
 *
 * 판정은 **명령 이름 하나**로만 한다. 답을 내는 다른 슬래시 명령(`/verify`·스킬 호출)까지 답 없는
 * 턴으로 몰면 그 답이 통째로 버려진다 — 넓히려면 "모델이 한 마디도 하지 않는다"를 실측한 뒤에 넣어라.
 */
export function isAnswerlessTurnText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return false;
  const firstToken = (trimmed.split(/\s/, 1)[0] ?? '').toLowerCase();
  return firstToken === AGENT_COMPACT_COMMAND || firstToken === SESSION_LOOP_CLEAR_COMMAND;
}

/**
 * 대괄호로 시작하는 결과는 **답이 아니라 상태 표식**이다 — `[Stopped by user]` · `[orphaned] …` ·
 * `[Stopped: max turns reached …]` · `[확인] …`. 답 없는 턴에도 이것들은 남아야 한다(중지·고아 봉합의
 * 유일한 흔적이라, 지우면 그 말풍선이 아무 일도 없었던 것처럼 보인다).
 */
function isStatusMarker(result: string): boolean {
  return result.trimStart().startsWith('[');
}

/**
 * 이 턴이 남길 결과 — 모든 마감이 거친다. @param reported CLI·supervisor 가 신고한 본문(없으면 `undefined`).
 * @param recovered 되찾은 마지막 assistant 본문 + 쓰인 시각(0 = 옛 줄이라 그대로 받는다). @param turnStart `startedAt`, 없으면 큐에 들어간 시각.
 */
export function resolveTurnResult(
  text: string,
  reported: string | undefined,
  recovered: { text: string; ts: number } | null | undefined,
  turnStart: number | undefined,
): string | undefined {
  if (isAnswerlessTurnText(text)) return undefined;
  if (reported) return reported;
  if (!recovered || !recovered.text) return undefined;
  // 되찾은 글이 이 턴보다 **먼저** 쓰였으면 그것은 앞 턴의 답이다 — 물려받지 않는다.
  if (recovered.ts > 0 && typeof turnStart === 'number' && recovered.ts < turnStart) return undefined;
  return recovered.text;
}

/** 옛 완료 이력에서 물려받은 답을 걷는다(제자리, 건수 반환). **답 없는 턴의 상태 표식 아닌 본문만** — 지워지는 글은 늘 남의 턴 것이다. */
export function repairAnswerlessTurnResults(commands: QueuedCommand[]): number {
  let repaired = 0;
  for (const cmd of commands) {
    if (typeof cmd.result !== 'string' || cmd.result.length === 0) continue;
    if (typeof cmd.text !== 'string' || !isAnswerlessTurnText(cmd.text)) continue;
    if (isStatusMarker(cmd.result)) continue;
    cmd.result = undefined;
    repaired++;
  }
  return repaired;
}

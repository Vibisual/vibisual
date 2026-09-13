/**
 * §5.5 #17-12 ③-4 (판올림 번호 발급 대기) — **끝난 턴의 결과는 무엇인가** (순수 모듈).
 *
 * `turnPrompt` 가 "이 턴에 무엇이 나가는가"를 정한다면, 이쪽은 그 짝인 "이 턴이 무엇을 남기는가"다.
 *
 * 자동 압축 직후 **직전 답이 통째로 한 번 더** 화면에 찍히는 증상이 여기서 났다. 사슬은 셋이다:
 *  1. 턴 경계 압축(§4)이 그 세션 큐에 `/compact` 한 건을 얹는다 — 사용자가 친 것과 같은 명령이다.
 *  2. 그 턴은 **제 답이 없다**. CLI 는 대화록을 접기만 하고 모델은 한 마디도 하지 않는다
 *     (실측 2026-09-08 18:52 `cmd-…-turncompact`: 그 턴의 스트림 이벤트는 `compact_boundary` ·
 *     `command_received` 두 줄뿐 · 토큰 증분 0 · 트랜스크립트에 붙은 assistant 줄 0).
 *  3. 그런데 마감 코드에는 "결과가 비면 트랜스크립트의 마지막 assistant 를 읽어 채운다"는 복구
 *     폴백이 있었다. 그 폴백은 **마지막 user 이후의 assistant 본문**을 돌려주므로, 새 줄이 하나도
 *     붙지 않은 압축 턴에게는 **앞 턴의 답**을 그대로 건넸다. 그것이 `completedCommands[].result` 로
 *     저장됐고, 말풍선은 저장된 결과를 그 턴의 답으로 그리므로(③-3) 같은 말이 두 번 읽혔다.
 *     실측: 이 저장소 완료 이력의 `/compact` 27건이 **전부** 직전 턴 답과 바이트 동일.
 *
 * 그래서 규칙 둘을 여기 한 곳에 둔다 — 산 경로(마감)와 옛 저장분(복원)이 **같은 판정**을 쓴다.
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
 * 이 턴이 남길 결과 — 마감하는 모든 경로가 이 한 줄을 거친다.
 *
 * @param reported  CLI·supervisor 가 그 턴의 결과로 신고한 본문(없으면 `undefined`).
 * @param recovered 트랜스크립트에서 되찾은 마지막 assistant 본문 + **그 글이 쓰인 시각**.
 *                  시각이 0 이면(옛 줄에 시각이 없음) 가를 근거가 없으므로 종전대로 받는다.
 * @param turnStart 이 턴이 시작된 시각(`startedAt` → 없으면 큐에 들어간 시각).
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

/**
 * 이미 저장된 완료 이력에서 **물려받은 답**을 걷는다(제자리 수정, 걷은 건수를 돌려준다).
 *
 * 산 경로를 고쳐도 디스크에 남은 옛 기록은 그대로라 화면에서는 같은 중복이 계속 읽힌다. 이 청소는
 * **답 없는 턴에만**, 그중에서도 상태 표식이 아닌 본문에만 손댄다 — 그 턴들은 애초에 제 답을 낸 적이
 * 없으므로 여기서 지워지는 글자는 언제나 다른 턴의 것이다.
 */
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

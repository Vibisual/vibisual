/**
 * 턴 세대 도장(`turnId`)으로 스트림 줄의 자리를 정한다 — 늦게 온 앞 턴 줄을 새 명령 블록 아래가 아니라 제 턴의 끝에 꽂는다(조립 로직은 그대로).
 * 정렬이 아니라 **삽입**이다 — 증분 파서가 꼬리 확장을 전제로 O(신규)로 돈다. 어긋난 줄은 드물어 그때만 파서가 재구축한다(`canAppend`).
 */

import type { SubAgentStreamEvent } from '@vibisual/shared';

/** 삽입 인덱스 — 자기 턴의 마지막 줄 바로 뒤(그 턴이 없으면 맨 끝). 도장 없는 줄은 맨 끝 — 모르는 줄의 순서를 지어내지 않는다. */
export function turnInsertIndex(
  buffer: readonly SubAgentStreamEvent[],
  event: SubAgentStreamEvent,
): number {
  const turnId = event.turnId;
  if (!turnId) return buffer.length;

  // 뒤에서부터 훑는다 — 정상 흐름(같은 턴이 계속 이어지는 경우)이 첫 걸음에 끝난다.
  for (let i = buffer.length - 1; i >= 0; i--) {
    const at = buffer[i];
    if (!at) continue;
    if (at.turnId === turnId) {
      // 내 턴의 마지막 줄이 곧 버퍼의 끝이면 평소처럼 붙이기만 하면 된다.
      return i === buffer.length - 1 ? buffer.length : i + 1;
    }
    // 도장이 없는 줄은 어느 턴의 것인지 모르므로 경계로 치지 않고 지나친다.
    if (!at.turnId) continue;
  }
  // 이 턴의 첫 줄 — 맨 끝에서 시작한다.
  return buffer.length;
}

/**
 * 버퍼에 한 줄을 **제 턴 자리**로 넣는다. 꼬리에 붙는 평소 경우는 새 배열을 만들지 않고
 * `push` 한 것과 같은 결과를 돌려준다(호출부가 기존 append 경로를 그대로 쓸 수 있게).
 *
 * @returns 삽입이 **꼬리가 아니었는지**(= 파서가 재구축해야 하는 경우) 함께 알려 준다.
 */
export function insertEventInTurnOrder(
  buffer: SubAgentStreamEvent[],
  event: SubAgentStreamEvent,
): { buffer: SubAgentStreamEvent[]; reordered: boolean } {
  const at = turnInsertIndex(buffer, event);
  if (at >= buffer.length) {
    buffer.push(event);
    return { buffer, reordered: false };
  }
  buffer.splice(at, 0, event);
  return { buffer, reordered: true };
}

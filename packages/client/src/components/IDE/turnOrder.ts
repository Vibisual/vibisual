/**
 * 턴 세대 도장으로 스트림 줄의 **자리**를 정한다.
 *
 * **왜 필요한가.** 스트림 버퍼는 도착 순으로 쌓이고, 클라는 명령 블록을 **도착 시각**으로 갈랐다.
 * 그래서 사용자가 [중지]·덧말로 새 명령을 넣으면, 앞 턴이 백단에 띄워 둔 작업이 뒤늦게 뱉는 줄이
 * **새 명령 블록 아래**에 그려졌다 — 사용자에겐 새 명령이 그 일을 한 것으로 보인다(사용자 보고:
 * "뒤섞여서 뭐가 어떤 작업을 하고 있는지 모른다").
 *
 * 이제 서버가 줄마다 `turnId`(그 일을 시킨 명령)를 각인해 보내므로, 늦게 온 줄을 **제 턴의 끝**에
 * 꽂아 넣으면 블록 배정이 저절로 맞는다. 시각 기준 조립 로직은 그대로 두고 **자리만** 고친다.
 *
 * 정렬이 아니라 **삽입**인 이유: 버퍼는 길고(수천 줄) 증분 파서가 "꼬리 확장"을 전제로 O(신규)로
 * 돈다(§5.5 v3.10). 매 틱 전체를 다시 정렬하면 그 최적화가 통째로 무너진다. 어긋난 줄은 드물게
 * 오므로, 그때만 중간 삽입이 일어나고 파서가 한 번 재구축한다(그 감지는 파서의 `canAppend` 가 이미 한다).
 */

import type { SubAgentStreamEvent } from '@vibisual/shared';

/**
 * `event` 가 들어갈 자리를 고른다 — 반환값은 삽입 인덱스.
 *
 * 규칙은 하나다: **자기 턴의 마지막 줄 바로 뒤**. 그 턴이 버퍼에 아직 없으면(= 새 턴) 맨 끝이다.
 * 도장이 없는 줄(옛 버퍼·훅 경로)은 종전대로 맨 끝 — 규칙을 모르는 줄의 순서를 우리가 지어내지 않는다.
 */
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

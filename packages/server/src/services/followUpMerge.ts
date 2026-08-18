import type { QueuedCommand } from '@vibisual/shared';
import { COMMAND_MERGE_SEPARATOR, DEFAULT_COMMAND_DISPATCH_MODE } from '@vibisual/shared';

/**
 * §5.5 #17-18 v4.68 — **합치기(merge) 덧말 흡수** (순수 로직 — 큐 배열만 만진다).
 *
 * 실행 중에 넣은 덧말은 종전에 하나씩 따로 턴을 잡아, 덧말 N개가 턴 N개 = 완료 보고 카드 N장이
 * 됐다. 이 함수는 dispatch 직전에 같은 세션 탭(`subAgentId`)의 **뒤따르는 `queued` 명령**을 base 의
 * 텍스트 뒤에 이어 붙이고 큐에서 지운다 = 한 턴에 함께 나간다.
 *
 * **살아남는 것은 base 의 id** — 새 명령을 만들면 루프 회차 대조(`SessionLoop.pendingCommandId`)와
 * 태스크 엣지 완료 매칭(`edgeId`)이 가리키던 id 가 사라져 그 대기가 영영 안 풀린다.
 *
 * 끊는 지점(그 명령은 자기 턴을 갖는다):
 *  - `wait`/`immediate` 로 지정된 명령 — "대기"는 자기 턴을 갖겠다는 뜻이다.
 *  - `edgeId` 가 실린 명령 — 엣지 dispatch 는 1:1 대응이라 남의 덧말을 섞으면 그 결과가 그 엣지의
 *    것이 아니게 된다.
 *  - 이미 `executing`/완료된 명령.
 * 다른 탭 소유 명령은 순서 의미가 없으므로 **건너뛴다**(끊지 않음).
 *
 * @returns 흡수한 명령들(빈 배열이면 큐를 건드리지 않았다).
 */
export function absorbMergeFollowUps(queue: QueuedCommand[], base: QueuedCommand): QueuedCommand[] {
  if ((base.dispatchMode ?? DEFAULT_COMMAND_DISPATCH_MODE) !== 'merge') return [];
  if (base.edgeId) return [];
  const baseIdx = queue.indexOf(base);
  if (baseIdx < 0) return [];

  const absorbed: QueuedCommand[] = [];
  for (let i = baseIdx + 1; i < queue.length; i++) {
    const c = queue[i]!;
    if (c.subAgentId !== base.subAgentId) continue;
    if (c.status !== 'queued') break;
    if (c.edgeId) break;
    if ((c.dispatchMode ?? DEFAULT_COMMAND_DISPATCH_MODE) !== 'merge') break;
    absorbed.push(c);
  }
  if (absorbed.length === 0) return [];

  base.text = [base.text, ...absorbed.map((c) => c.text)]
    .map((t) => t.trim())
    .filter(Boolean)
    .join(COMMAND_MERGE_SEPARATOR);
  // 첨부는 합집합 — 흡수된 덧말에 붙은 이미지도 이 턴에 함께 전달돼야 한다.
  const atts = [...(base.attachments ?? [])];
  for (const c of absorbed) {
    for (const a of c.attachments ?? []) if (!atts.includes(a)) atts.push(a);
  }
  if (atts.length > 0) base.attachments = atts;
  base.mergedCount = (base.mergedCount ?? 0) + absorbed.length;

  for (const c of absorbed) {
    const idx = queue.indexOf(c);
    if (idx >= 0) queue.splice(idx, 1);
  }
  return absorbed;
}

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
 *  - **조용한 내부 명령**(`silent` — §5.3 #9-1 (P) 의 선행 `/compact`). base 로도, 흡수 대상으로도
 *    쓰지 않는다. 사용자가 넣은 적 없는 명령이 사용자 본문을 자기 뒤에 달고 나가면 CLI 는 맨 앞의
 *    슬래시 명령만 읽고 그 턴을 끝내, **그 턴의 사용자 지시가 통째로 사라진다** — 화면에는 압축이
 *    거절당한 `Not enough messages to compact.` 한 줄만 남고 자기가 친 말은 어디에도 없다(실측).
 *    반대로 사용자 명령이 base 일 때 뒤의 조용한 압축을 삼키면 그 압축은 본문 끝에 붙어 **명령이
 *    아니라 글자**가 된다 — 접히지도 않고 사용자 대화에 `/compact` 가 섞인다.
 * 다른 탭 소유 명령은 순서 의미가 없으므로 **건너뛴다**(끊지 않음).
 *
 * @returns 흡수한 명령들(빈 배열이면 큐를 건드리지 않았다).
 */
export function absorbMergeFollowUps(queue: QueuedCommand[], base: QueuedCommand): QueuedCommand[] {
  if ((base.dispatchMode ?? DEFAULT_COMMAND_DISPATCH_MODE) !== 'merge') return [];
  if (base.edgeId) return [];
  // §5.3 #9-1 (P) — 조용한 내부 명령은 남의 본문을 삼키지 않는다(위 "끊는 지점" 참고).
  if (base.silent) return [];
  const baseIdx = queue.indexOf(base);
  if (baseIdx < 0) return [];

  const absorbed: QueuedCommand[] = [];
  for (let i = baseIdx + 1; i < queue.length; i++) {
    const c = queue[i]!;
    if (c.subAgentId !== base.subAgentId) continue;
    if (c.status !== 'queued') break;
    if (c.edgeId) break;
    // 조용한 내부 명령은 남의 턴에 섞이지 않는다 — 자기 턴으로 따로 나간다.
    if (c.silent) break;
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

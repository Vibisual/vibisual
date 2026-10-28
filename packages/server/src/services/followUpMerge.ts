import type { QueuedCommand } from '@vibisual/shared';
import { APP_WORK, COMMAND_MERGE_SEPARATOR, DEFAULT_COMMAND_DISPATCH_MODE } from '@vibisual/shared';

/**
 * §5.5 #17-18 — 합치기 덧말 흡수(순수): dispatch 직전 같은 탭(`subAgentId`)의 뒤따르는 `queued` 명령을 base 뒤에 붙이고 큐에서 지운다.
 * **base 의 id 가 산다** — 새 id 면 `SessionLoop.pendingCommandId`·엣지 완료(`edgeId`) 대기가 영영 안 풀린다.
 * 끊는 명령: `wait`/`immediate` · `edgeId`(1:1) · `executing`/완료 · `silent`(§5.3 #9-1 (P)). 다른 탭 명령은 건너뛴다.
 * `silent` 를 base 로 쓰면 CLI 가 맨 앞 슬래시만 읽어 뒤 본문이 사라지고, 흡수하면 `/compact` 가 글자로 섞인다.
 * @returns 흡수한 명령들(빈 배열 = 큐 그대로).
 */
export function absorbMergeFollowUps(queue: QueuedCommand[], base: QueuedCommand): QueuedCommand[] {
  if ((base.dispatchMode ?? DEFAULT_COMMAND_DISPATCH_MODE) !== 'merge') return [];
  if (base.edgeId) return [];
  // §5.3 #9-1 (P) — 조용한 내부 명령은 남의 본문을 삼키지 않는다(위 "끊는 지점" 참고).
  if (base.silent) return [];
  // §5.3 #10-4 — 지휘 명령·킥오프는 남의 덧말을 삼키지 않는다. 지휘자가 받을 요청 원문이 바뀌면 안 된다.
  if (base.orchestraRunId) return [];
  // Capabilities and execution caps belong to one request, never an absorbed follow-up.
  if (base.executionRequirements || base.runLimits) return [];
  if (base.waitForCommandIds?.length) return [];
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
    // 지휘 명령·킥오프도 자기 턴으로 따로 나간다(§5.3 #10-4).
    if (c.orchestraRunId) break;
    if (c.executionRequirements || c.runLimits) break;
    if (c.waitForCommandIds?.length) break;
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
  // §5.1 #2-1 (F) ① — 앱 노드도 합집합. 흡수된 덧말이 말풍선에서 넣은 노드의 작업이면 이 턴이 그 작업이다.
  const appNodes = [...(base.appNodeIds ?? [])];
  for (const c of absorbed) {
    for (const id of c.appNodeIds ?? []) if (!appNodes.includes(id) && appNodes.length < APP_WORK.commandNodeMax) appNodes.push(id);
  }
  if (appNodes.length > 0) base.appNodeIds = appNodes;
  // 말풍선에서 앱을 모두 뺀 표식은 합쳐지는 명령이 **모두** 뺀 명령일 때만 남는다 — IDE 덧말·앱을 넣은 덧말이 섞이면
  //   그 턴은 더는 "앱 작업 아님"이 아니다(넣은 노드가 있으면 그 노드, 없으면 이어진 앱 폴백 — §5.1 #2-1 (F) ①).
  if (base.appNodesOff && (appNodes.length > 0 || !absorbed.every((c) => c.appNodesOff === true))) delete base.appNodesOff;
  base.mergedCount = (base.mergedCount ?? 0) + absorbed.length;

  for (const c of absorbed) {
    const idx = queue.indexOf(c);
    if (idx >= 0) queue.splice(idx, 1);
  }
  return absorbed;
}

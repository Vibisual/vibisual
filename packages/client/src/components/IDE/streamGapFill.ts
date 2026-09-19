/**
 * 스트림 버퍼에 서버 창을 **겹쳐 얹는** 순수 함수들 — 스토어(`loadStreamBuffers`·`appendStreamEvents`)와
 * 창(`AgentIDEOverlay`·`streamHistory.ts`)이 같이 쓴다. 스토어도 읽으므로 이 파일은 스토어를 import 하지
 * 않는다(순환 방지). DOM 없이 시험한다(`streamGapFill.test.ts` · `streamHistory.test.ts`).
 *
 * 연결이 끊겼다 다시 붙으면 버퍼는 "끊기기 전 줄 → 다시 붙은 뒤 줄"로 곧장 이어져 **가운데가 빈다**
 * (새 연결은 스냅샷만 주고 스트림 줄은 WS 로만 흐른다). 서버에서 다시 받은 창을 여기서 제자리에 끼운다.
 */
import type { SubAgentStreamEvent } from '@vibisual/shared';

/**
 * 깊은 창을 **지금 든 버퍼 위에** 얹는다. 서버 창이 버퍼의 앞부분과 이어지면(서버 창의 첫 줄이 버퍼에 있으면)
 * 그 앞은 남긴다 — 라이브로 쌓여 서버 창보다 길어진 버퍼를 깊은 복원이 도로 줄이지 않게. 요청이 오가는 사이
 * 도착한 라이브 줄(서버 창의 마지막 시각 이후, 서버 창에 없는 id)은 뒤에 붙인다.
 */
export function mergeDeepWindow(
  server: readonly SubAgentStreamEvent[],
  prev: readonly SubAgentStreamEvent[],
): SubAgentStreamEvent[] {
  if (server.length === 0) return [...prev];
  const serverIds = new Set(server.map((e) => e.id));
  const firstId = server[0]!.id;
  const lastTs = server[server.length - 1]!.timestamp;
  const cut = prev.findIndex((e) => e.id === firstId);
  const head = cut > 0 ? prev.slice(0, cut).filter((e) => !serverIds.has(e.id)) : [];
  const tail = prev.filter((e) => e.timestamp >= lastTs && !serverIds.has(e.id));
  return [...head, ...server, ...tail];
}

/**
 * 서버 창의 줄 중 버퍼에 없는 것을 **서버 순서의 제자리**에 끼운다. 버퍼에 이미 든 줄은 하나도 빼거나
 * 옮기지 않는다 — 얕은 조회가 깊은 창·거슬러 불러온 과거를 줄이면 안 되기 때문이다.
 *
 * 빠진 줄의 자리는 서버 창에서 바로 앞에 선 줄 중 버퍼에 있는 것의 **바로 뒤**다. 그런 앞줄이 없으면
 * (서버 창의 머리) 버퍼와 겹치는 첫 서버 줄의 앞, 겹치는 줄이 아예 없으면 버퍼 끝이다.
 *
 * 종전에는 빠진 줄을 전부 끝에 붙였다 — 끊겨 있던 사이의 줄이 다시 붙은 뒤에 온 줄보다 **아래에**
 * 그려져, 글이 뒤섞이거나 중간에서 끊긴 채 끝난 것처럼 읽혔다.
 *
 * @returns 끼울 것이 없으면 `null`(호출부가 버퍼를 그대로 둔다).
 */
export function spliceMissingInServerOrder(
  prev: readonly SubAgentStreamEvent[],
  server: readonly SubAgentStreamEvent[],
): SubAgentStreamEvent[] | null {
  const have = new Set(prev.map((e) => e.id));
  const placed = new Set<string>();
  // 앞줄 id → 그 뒤에 끼울 줄들(서버 순서). 키 null = 버퍼와 겹치는 첫 서버 줄보다 앞.
  const after = new Map<string | null, SubAgentStreamEvent[]>();
  let anchor: string | null = null;
  let firstShared: string | null = null;
  for (const e of server) {
    if (have.has(e.id)) {
      anchor = e.id;
      if (firstShared === null) firstShared = e.id;
      continue;
    }
    if (placed.has(e.id)) continue;
    placed.add(e.id);
    const list = after.get(anchor);
    if (list) list.push(e);
    else after.set(anchor, [e]);
  }
  if (placed.size === 0) return null;
  const head = after.get(null) ?? [];
  if (firstShared === null) return [...prev, ...head];
  const out: SubAgentStreamEvent[] = [];
  for (const e of prev) {
    if (e.id === firstShared) {
      out.push(...head);
      firstShared = null; // 같은 id 가 버퍼에 두 번 있어도 머리는 한 번만.
    }
    out.push(e);
    const tail = after.get(e.id);
    if (tail) {
      out.push(...tail);
      after.delete(e.id);
    }
  }
  return out;
}

/** 라이브 줄이 이미 버퍼에 있는지 볼 때 끝에서부터 훑는 칸 수. */
export const RECENT_EVENT_ID_SCAN = 256;

/**
 * 이 id 가 버퍼 끝 가까이 이미 있나. 서버 창을 다시 받는 사이 WS 로도 같은 줄이 오면(서버는 40ms,
 * 클라는 50ms 로 모아 보낸다) 창에 든 줄이 한 번 더 붙어 같은 글이 두 번 그려진다. 겹치는 줄은
 * 방금 받은 창의 끝자락에 있으므로 끝에서 `RECENT_EVENT_ID_SCAN` 칸만 본다.
 */
export function hasRecentEventId(buffer: readonly SubAgentStreamEvent[], id: string): boolean {
  const stop = Math.max(0, buffer.length - RECENT_EVENT_ID_SCAN);
  for (let i = buffer.length - 1; i >= stop; i--) {
    if (buffer[i]!.id === id) return true;
  }
  return false;
}

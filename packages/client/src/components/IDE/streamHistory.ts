/**
 * §5.5 #17-12 — **복원 창 위쪽의 과거를 거슬러 불러온다.**
 *
 * 세션을 다시 열면 서버는 그 세션의 마지막 2,000건(깊은 복원)만 내려 준다. 그보다 앞은 턴마다 저장된 답
 * (명령 블록 폴백)만 남아, 긴 대화를 위로 올려 보면 **말풍선과 결론만 있고 사이의 대화가 사라진** 모양이
 * 됐다(사용자 보고 — "과거 대화를 다시 보면 기존 내용이 제거되어 안 보인다"). 기록은 디스크에 온전히 있었다.
 *
 * 여기서는 사용자가 창의 윗끝 가까이 올라왔을 때 그 앞 한 쪽(`STREAM_HISTORY_PAGE_EVENTS`)을
 * `GET /api/subagent-streams/:agentId/:subId/older` 로 받아 버퍼 앞에 붙인다(`prependStreamHistory`).
 * 판정과 병합은 순수 함수로 두어 DOM 없이 시험한다(`streamHistory.test.ts`).
 */
import type { SubAgentStreamEvent } from '@vibisual/shared';
import { STREAM_HISTORY_PAGE_EVENTS } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

/** 못 찾음·오류 뒤 같은 세션을 다시 묻기까지 기다리는 시간. 스크롤 한 번마다 서버를 두드리지 않게 한다. */
export const STREAM_HISTORY_RETRY_MS = 8_000;

/**
 * 창의 **윗끝 항목** — 버퍼 첫 이벤트 시각 이후로 처음 선 항목의 순번. 그 위에 선 것은 창 밖 턴의 폴백
 * (명령 블록·카드)뿐이라, 거기까지 올라왔다는 것은 사이의 대화를 불러와야 한다는 뜻이다. 버퍼가 비었거나
 * 그런 항목이 없으면 -1.
 */
export function olderHistoryBoundary(
  items: readonly { timestamp: number }[],
  events: readonly { timestamp: number }[],
): number {
  const first = events[0];
  if (!first) return -1;
  return items.findIndex((it) => it.timestamp >= first.timestamp);
}

/** 그려진 첫 항목(자료 순번)이 창의 윗끝에 닿았나. 선렌더 버퍼(increaseViewportBy top)만큼 미리 닿는다. */
export function reachesHistoryBoundary(renderedStart: number, boundary: number): boolean {
  return boundary >= 0 && renderedStart <= boundary;
}

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

/** 과거 한 쪽을 청하는 주소. 기준은 버퍼의 첫 줄(id 가 정본, 디스크에서 못 찾을 때를 대비해 시각도 함께). */
export function olderHistoryUrl(agentId: string, sessionId: string, first: SubAgentStreamEvent, limit: number): string {
  const q = new URLSearchParams({ beforeId: first.id, beforeTs: String(first.timestamp), limit: String(limit) });
  return `/api/subagent-streams/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionId)}/older?${q.toString()}`;
}

interface OlderPageResponse {
  events?: SubAgentStreamEvent[];
  hasMore?: boolean;
  /** 서버가 그 세션의 폴더를 못 찾았다 — "더 없다"가 아니다. */
  unresolved?: boolean;
}

const inFlight = new Set<string>();
const retryAt = new Map<string, number>();

/** 시험 전용 — 모듈 상태(진행 중·쉬는 중)를 비운다. */
export function resetStreamHistoryRequests(): void {
  inFlight.clear();
  retryAt.clear();
}

/** 이 요청이 할 일을 끝냈나(true) · 못 찾았거나 비어 와서 쉬었다 다시 물어야 하나(false). */
async function fetchOlderPage(agentId: string, sessionId: string, first: SubAgentStreamEvent): Promise<boolean> {
  const res = await fetch(olderHistoryUrl(agentId, sessionId, first, STREAM_HISTORY_PAGE_EVENTS));
  if (!res.ok) return false;
  const page = (await res.json()) as OlderPageResponse;
  if (page.unresolved) return false;
  const st = useGraphStore.getState();
  // 받는 사이 창이 교체·절단돼 기준이 어긋났다 — 이 쪽은 버린다(다음 확인이 새 기준으로 다시 묻는다).
  if (st.subAgentStreams[sessionId]?.[0]?.id !== first.id) return true;
  st.prependStreamHistory(sessionId, page.events ?? [], page.hasMore === true);
  return true;
}

/**
 * 깊은 복원이 아직 안 된 세션(분할의 초점 밖 칸 — 창의 깊은 복원은 창의 활성 세션만 챙긴다)은 과거 쪽보다
 * 먼저 서버의 깊은 창부터 받는다. 얕은 창(500) 앞을 곧장 거슬러 오르면 그 사이 1,500건을 한 쪽씩 다시 받게 된다.
 */
async function fetchDeepWindow(agentId: string, sessionId: string): Promise<boolean> {
  const res = await fetch(`/api/subagent-streams/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionId)}`);
  if (!res.ok) return false;
  const data = (await res.json()) as { events?: SubAgentStreamEvent[] };
  const server = data.events;
  if (!server || server.length === 0) return false;
  const st = useGraphStore.getState();
  if (st.deepRestoredSessions[sessionId]) return true; // 그 사이 창의 깊은 복원이 끝냈다.
  st.loadStreamBuffers({ [sessionId]: mergeDeepWindow(server, st.subAgentStreams[sessionId] ?? []) }, 'deep');
  return true;
}

/**
 * 창의 윗끝에 닿은 세션의 과거 한 쪽을 청한다. 돌려주는 값은 **다시 물어도 되기까지 남은 ms**다
 * (0 = 지금은 할 일이 없거나 이미 청했다). `onSettled` 는 이번에 실제로 청한 요청이 끝났을 때 한 번 불린다 —
 * 붙인 결과로 윗끝이 여전히 화면 가까이면 부르는 쪽이 한 번 더 확인한다.
 */
export function requestOlderStreamHistory(agentId: string, sessionId: string, onSettled?: () => void): number {
  const wait = (retryAt.get(sessionId) ?? 0) - Date.now();
  if (wait > 0) return wait;
  if (inFlight.has(sessionId)) return 0;
  const st = useGraphStore.getState();
  if (st.streamHistoryDone[sessionId]) return 0;
  const buf = st.subAgentStreams[sessionId];
  if (!buf || buf.length === 0) return 0;
  const deep = st.deepRestoredSessions[sessionId] === true;
  // 창의 활성 세션은 창(AgentIDEOverlay)이 깊은 복원을 끝까지 두드린다 — 겹쳐 받지 않고 그 표식을 기다린다.
  if (!deep && Object.values(st.ideOverlays).some((ov) => ov.agentId === agentId && ov.activeSessionId === sessionId)) return 0;
  inFlight.add(sessionId);
  const job = deep ? fetchOlderPage(agentId, sessionId, buf[0]!) : fetchDeepWindow(agentId, sessionId);
  void job
    .then((ok) => {
      if (ok) retryAt.delete(sessionId);
      else retryAt.set(sessionId, Date.now() + STREAM_HISTORY_RETRY_MS);
    })
    .catch(() => { retryAt.set(sessionId, Date.now() + STREAM_HISTORY_RETRY_MS); })
    .finally(() => {
      inFlight.delete(sessionId);
      onSettled?.();
    });
  return 0;
}

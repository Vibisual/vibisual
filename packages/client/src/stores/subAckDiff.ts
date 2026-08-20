/**
 * 세션 "확인함"(`acknowledgedSubAgents`) 집합의 스냅샷 diff — **ack 를 언제 푸는지 여기서만 정한다.**
 *
 * 도트 색은 `utils/sessionStatus.ts` 가 정하지만, 그 판정의 입력 하나(`acknowledged`)를 만드는 것은
 * 이 함수다. 사용자가 확인해 회색으로 내려간 세션이 **저절로 다시 녹색이 되는** 사고는 색표가 아니라
 * 여기서 났다 — 그래서 판정을 스토어 한복판(loadSnapshot)에서 끄집어내 테스트 가능한 순수 함수로 둔다.
 *
 * ack 를 푸는 근거는 둘뿐이다.
 *  ① **새 완료** — `active → idle` 전이. 그 세션이 다시 돌았다가 끝났으니 사용자를 다시 부른다(녹색).
 *  ② **세션이 실제로 닫혔다** — 사라진 세션의 ack 는 남겨 둘 이유가 없다(무한 증식 방지).
 *
 * ⚠ ② 의 근거를 "이번 스냅샷에 없다"로 삼으면 **안 된다.** 브로드캐스트 스냅샷은 §9 스코프드 구독이라
 *   지금 어느 창도 보고 있지 않은 프로젝트의 세션을 아예 싣지 않는다(배경 프로젝트 유휴 해제도 같은
 *   결과를 만든다). 그 침묵을 "닫혔다"로 읽으면 프로젝트 탭을 한 번 옮기는 것만으로 그 프로젝트의
 *   ack 가 전멸하고, 돌아왔을 때 **확인해 둔 세션이 전부 녹색**이 된다(사용자 보고: "분명 확인해서
 *   회색으로 돌아갔는데 어느 순간 다시 녹색"). 그래서 "그 세션의 **소유 에이전트가 이번 스냅샷에
 *   있는가**"를 함께 본다 — 에이전트가 실려 왔다는 것은 그 프로젝트가 범위 안이라는 뜻이므로,
 *   그때 세션이 빠져 있으면 그것은 진짜로 닫힌 것이다. 에이전트째 안 왔으면 **판단을 보류**한다.
 */

import type { SubAgent, SubAgentStatus } from '@vibisual/shared';

/**
 * ack 집합 상한. ② 가 보수적으로 바뀐 만큼(범위 밖은 손대지 않는다) 버블째 사라진 세션의 ack 가
 * 영영 남을 수 있어, 키 개수에 상한을 둔다(값 길이만 재고 키 수는 안 재는 부류의 누수 방지).
 * 자를 때도 **이번 스냅샷에 살아 있는 세션은 절대 건드리지 않는다** — 보이는 탭이 녹색으로
 * 되돌아가면 그것이 곧 이 파일이 고치려는 그 버그다.
 */
export const ACK_MAX_ENTRIES = 2000;

export interface SubAckDiffInput {
  /** 직전 스토어의 세션 목록(에이전트 id → 세션들). */
  prevSubAgents: Record<string, SubAgent[]>;
  /** 이번 스냅샷의 세션 목록. */
  nextSubAgents: Record<string, SubAgent[]>;
  /**
   * 이번 스냅샷에 실려 온 에이전트 버블 id — "그 에이전트가 지금 구독 범위 안에 있다"의 증거.
   * 세션이 0개가 된 에이전트는 `nextSubAgents` 에서 키째 빠지므로(서버가 빈 배열을 안 싣는다)
   * 마지막 한 세션을 닫은 경우를 이 목록이 받아 준다.
   */
  presentAgentIds: Iterable<string>;
  /** 지금 확인 집합(스토어 값 그대로 — 이 함수는 변경하지 않는다). */
  acknowledged: Record<string, true>;
}

/**
 * @returns 바뀐 새 집합. **바뀐 게 없으면 `null`** — 호출부는 그대로 두면 된다(불필요한
 *          리렌더·localStorage 쓰기 방지).
 */
export function diffSubAcknowledgements(input: SubAckDiffInput): Record<string, true> | null {
  const { prevSubAgents, nextSubAgents, presentAgentIds, acknowledged } = input;

  let next = acknowledged;
  let changed = false;
  const ensureClone = (): void => {
    if (!changed) { next = { ...acknowledged }; changed = true; }
  };

  // 직전 상태: 세션별 상태 + 소유 에이전트. 소유는 "사라졌다" 판정에서 범위 안/밖을 가르는 데 쓴다.
  const prevStatus = new Map<string, SubAgentStatus>();
  const prevOwner = new Map<string, string>();
  for (const [agentId, list] of Object.entries(prevSubAgents)) {
    for (const s of list) {
      prevStatus.set(s.id, s.status);
      prevOwner.set(s.id, agentId);
    }
  }

  const currentSubIds = new Set<string>();
  for (const list of Object.values(nextSubAgents)) {
    for (const s of list) currentSubIds.add(s.id);
  }

  // ① active → idle: 새 완료 — 다음 사용자 확인 전까진 미확인(녹색)으로 되돌린다.
  for (const list of Object.values(nextSubAgents)) {
    for (const s of list) {
      if (prevStatus.get(s.id) === 'active' && s.status === 'idle' && next[s.id]) {
        ensureClone();
        delete next[s.id];
      }
    }
  }

  // ② 실제로 닫힌 세션만 정리 — 소유 에이전트가 이번 스냅샷에 있어야 "빠졌다"가 사실이 된다.
  const presentAgents = new Set<string>(presentAgentIds);
  for (const agentId of Object.keys(nextSubAgents)) presentAgents.add(agentId);
  const ackIds = Object.keys(next);
  for (const id of ackIds) {
    if (currentSubIds.has(id)) continue;
    const owner = prevOwner.get(id);
    // 우리가 모르는 세션(부팅 직후 localStorage 로만 아는 것) · 범위 밖 에이전트 → 판단 보류.
    if (owner === undefined || !presentAgents.has(owner)) continue;
    ensureClone();
    delete next[id];
  }

  // ③ 상한 — 삽입 순서(= 확인한 순서)라 오래된 것부터, 단 지금 보이는 세션은 건너뛴다.
  const remaining = Object.keys(next);
  if (remaining.length > ACK_MAX_ENTRIES) {
    let over = remaining.length - ACK_MAX_ENTRIES;
    for (const id of remaining) {
      if (over <= 0) break;
      if (currentSubIds.has(id)) continue;
      ensureClone();
      delete next[id];
      over--;
    }
  }

  return changed ? next : null;
}
